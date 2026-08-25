# Redis Caching for Price and Vault Summary Endpoints

## Overview

The YieldVault backend caches responses for the price and vault summary
endpoints using Redis when available, with automatic fallback to an in-memory
LRU store when Redis is absent or temporarily unreachable.

**Affected endpoints**

| Endpoint | Default TTL | Notes |
|---|---|---|
| `GET /api/v1/vault/summary` | 60 s | Returns live `VaultState` + latest `SharePriceSnapshot` from DB |
| `GET /api/v1/vault/apy` | 60 s | APY data from the nightly snapshot job |
| `GET /api/v1/vault/metrics` | 60 s | High-level vault metrics |
| `GET /api/v1/vault/apy/history` | 60 s | Historical APY chart data |
| `GET /api/v1/vault/strategy` | 30 s | Read-only strategy selection preview |

---

## Architecture

```
                     ┌────────────────────────────────────┐
 GET /api/v1/vault/* │  cacheMiddleware({ ttl })          │
 ──────────────────► │                                    │
                     │  1. Check Redis (if ready)         │
                     │  2. Check in-memory LRU (fallback) │
                     │  3. Cache MISS → call handler      │
                     │  4. Write response to Redis + LRU  │
                     └────────────────────────────────────┘
                                    │
                            ┌───────┴───────┐
                            │               │
                        Redis store    In-memory LRU
                        (shared,       (per-process,
                         durable)       fallback)
```

### Key design decisions

- **Fail-open**: When Redis is configured but unreachable the backend continues
  serving requests using the in-memory LRU. No `500` errors are emitted due to
  Redis unavailability.
- **Dual write**: Every cache write goes to both Redis (TTL-based expiry) and
  the LRU (size-bounded eviction). This means the LRU acts as a read-through
  cache: a warm LRU can serve hits even during a brief Redis reconnect.
- **Deterministic cache keys**: Keys follow the existing format
  `METHOD:path:sorted-query-params`, ensuring that `?a=1&b=2` and `?b=2&a=1`
  hit the same cache entry.
- **Response headers**: Every cached response carries:
  - `X-Cache-Hit: true | false` — whether the response was served from cache.
  - `X-Cache-Backend: redis | memory` — which store served the hit.
  - `Cache-Control: public, max-age=N` — downstream CDN / browser TTL.

---

## Configuration

All variables are optional. The backend runs fully without Redis.

| Variable | Default | Description |
|---|---|---|
| `REDIS_URL` | _(unset)_ | Redis connection URL. Enables Redis caching **and** Redis-backed rate limiting when set. Example: `redis://localhost:6379` |
| `CACHE_TTL_MS` | `60000` | Response cache TTL in milliseconds for vault/price endpoints |
| `CACHE_VAULT_METRICS_TTL_MS` | _(alias for `CACHE_TTL_MS`)_ | Legacy alias, accepted in addition to `CACHE_TTL_MS` |
| `CACHE_STRATEGY_TTL_MS` | `30000` | Response cache TTL for the strategy preview read endpoint |
| `CACHE_MAX_ENTRIES` | `500` | Maximum entries kept in the in-memory LRU fallback store |
| `REDIS_CACHE_KEY_PREFIX` | `cache:` | Redis key namespace. Useful when sharing a Redis instance across multiple services |
| `REDIS_CACHE_CONNECT_TIMEOUT_MS` | `2000` | Timeout (ms) for the initial Redis TCP connection |
| `REDIS_CACHE_COMMAND_TIMEOUT_MS` | `500` | Per-command timeout (ms) to prevent slow Redis from blocking request handlers |

### Example `.env`

```dotenv
REDIS_URL=redis://localhost:6379
CACHE_TTL_MS=60000
CACHE_MAX_ENTRIES=500
```

---

## Cache Invalidation

Cache entries are invalidated:

1. **On vault mutations** (deposit / withdrawal): the `vaultEndpoints.ts`
   router calls `triggerCacheInvalidation('transaction.write')` which invokes
   registered invalidation hooks that delete `GET:/api/v1/vault*`,
   `GET:/api/v1/transactions*`, and `GET:/api/v1/portfolio*` entries from both
   Redis and the LRU simultaneously.

2. **On APY snapshot** (nightly job): `apySnapshot.ts` calls
   `invalidateCache('GET:/api/v1/vault/apy')` after persisting the new snapshot.

3. **On strategy configuration changes**: invalidate
  `GET:/api/v1/vault/strategy` after a strategy mutation is introduced. The
  current strategy route is a static preview and has no mutable state.

3. **Admin API** (manual): operators can clear cache via:
   - `DELETE /admin/cache` — clears all entries (or a regex-filtered subset via
     `?pattern=<regex>`)
   - `POST /admin/cache/invalidate` — body `{ "pattern": "<regex>" }`

Invalidation applies to **both** the Redis keyspace (using Redis `SCAN` +
bulk `DEL`) and the in-memory LRU.

---

## Observability

### Prometheus Metrics

| Metric | Type | Labels | Description |
|---|---|---|---|
| `cache_hit_count` | Counter | `method`, `route` | In-process cache hits (LRU or Redis) |
| `cache_miss_count` | Counter | `method`, `route` | In-process cache misses |
| `cache_eviction_count` | Counter | — | LRU evictions (size limit reached) |
| `redis_cache_hit_total` | Counter | `route` | Redis-specific hit counter |
| `redis_cache_miss_total` | Counter | `route` | Redis-specific miss counter |
| `redis_cache_error_total` | Counter | `operation` | Redis operation errors (`get`, `set`, `del`, `invalidate`) |
| `redis_cache_connection_status` | Gauge | — | `1` = connected, `0` = disconnected |

All metrics are exposed at `GET /metrics` (Prometheus scrape endpoint).

### Admin Endpoints

**`GET /admin/cache/stats`** (requires API key)  
Returns in-memory cache statistics plus Redis status:
```json
{
  "entryCount": 3,
  "entries": ["GET:/api/v1/vault/summary", "..."],
  "hitRate": 0.92,
  "redis": {
    "configured": true,
    "ready": true,
    "health": "up"
  },
  "timestamp": "2026-07-25T10:00:00.000Z"
}
```

**`GET /admin/cache/redis-status`** (requires API key)  
Returns detailed Redis connection diagnostics:
```json
{
  "configured": true,
  "ready": true,
  "health": "up",
  "ping": "PONG",
  "fallbackActive": false,
  "timestamp": "2026-07-25T10:00:00.000Z"
}
```

### Health Endpoint

`GET /health` includes `checks.cache` which may be:
- `"up"` — cache is healthy (Redis connected or Redis not configured)
- `"degraded"` — Redis was configured but is currently unreachable; in-memory
  fallback is active and the service continues to operate normally
- `"down"` — in-memory cache itself failed (should not normally occur)

The service returns HTTP 200 for both `"up"` and `"degraded"` cache states.

---

## Vault Summary Response

The `/api/v1/vault/summary` endpoint now returns real data sourced from the
database:

```json
{
  "totalAssets": "1234567.890000",
  "totalShares": "1200000.000000",
  "sharePrice": "1.028806",
  "apy": 0,
  "timestamp": "2026-07-25T10:00:00.000Z"
}
```

- `totalAssets` and `totalShares` come from the `VaultState` table (updated on
  every deposit/withdrawal and by the event-polling service).
- `sharePrice` is the most recent entry in the `SharePriceSnapshot` table.
- `apy` is populated by the nightly APY snapshot job; it remains `0` until the
  first scheduled run completes.

All fields fall back to zero/default values if the database is unavailable,
ensuring the endpoint never returns a `500`.

---

## Local Development

Redis is **not required** to run the backend locally. The in-memory LRU handles
all caching automatically.

To enable Redis locally:

```bash
# Start Redis (Docker)
docker run -d -p 6379:6379 redis:7-alpine

# Add to backend/.env
REDIS_URL=redis://localhost:6379
```

---

## Testing

Unit and integration tests cover the Redis cache layer without requiring a live
Redis instance:

```bash
# All tests
cd backend && npm test

# Redis cache unit tests only
npx jest redisCache.test

# Redis cache integration tests
npx jest redisCacheIntegration.test
```
