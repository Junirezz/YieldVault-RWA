# Design Document: Redis Rate Limiting

## Overview

This design replaces the current in-memory `express-rate-limit` store in the YieldVault backend with a Redis-backed store. The migration introduces per-wallet-address keying, per-endpoint limit configuration, RFC 6585-compliant 429 responses, and a fail-open fallback for Redis unavailability.

The existing `rateLimiter.ts` module is refactored into a `RateLimiterFactory` that constructs per-endpoint middleware instances. Each instance shares a single Redis client but uses a key prefix derived from the endpoint path, preventing counter collisions across routes.

**Key design decisions:**

- **`rate-limit-redis`** is used as the Redis store adapter for `express-rate-limit`. It is maintained by the same organisation as `express-rate-limit`, supports both `node-redis` and `ioredis`, and uses an atomic Lua script internally to prevent race conditions on counter increment + expiry-set.
- **`ioredis`** is chosen as the Redis client over `node-redis` because it provides built-in reconnection logic, a `lazyConnect` option that avoids blocking startup, and a well-typed TypeScript API. The npm page for `ioredis` notes it is in maintenance mode and recommends `node-redis` for new projects; however, `ioredis` remains fully functional and its reconnection model is simpler to configure for the fail-open requirement.
- **Fixed window** strategy is used (the default in `express-rate-limit`). It is simpler to reason about, sufficient for the stated abuse-prevention goal, and avoids the memory overhead of sliding-window per-key state.
- **Fail-open** on Redis unavailability: the middleware skips enforcement rather than returning 503, preserving API availability during Redis outages.

---

## Architecture

```mermaid
flowchart TD
    Client -->|HTTP request| Express
    Express -->|/api/v1| VersionMiddleware
    VersionMiddleware -->|route match| EndpointLimiter["Per-Endpoint Rate Limiter\n(express-rate-limit)"]
    EndpointLimiter -->|sendCommand| RedisStore["RedisStore\n(rate-limit-redis)"]
    RedisStore -->|EVAL Lua script| Redis[(Redis)]
    Redis -->|counter + TTL| RedisStore
    RedisStore -->|allow / deny| EndpointLimiter
    EndpointLimiter -->|429 or next()| RouteHandler
    EndpointLimiter -.->|Redis unreachable| FailOpen["Fail-open:\npass request through"]
```

The `RateLimiterFactory` module owns the Redis client lifecycle. It is imported once at application startup and exports pre-built middleware instances for each endpoint. The `index.ts` file replaces the single `apiLimiter` import with the per-endpoint limiters.

---

## Components and Interfaces

### `RateLimiterFactory` (`backend/src/rateLimiter.ts`)

Replaces the current single-export module. Responsibilities:

1. Create and manage the `ioredis` client.
2. Expose a `createLimiter(config: EndpointLimiterConfig): RequestHandler` factory function.
3. Export pre-built limiter instances for each configured endpoint.
4. Export a `getRedisClient()` accessor for health-check use.

```typescript
interface EndpointLimiterConfig {
  /** Route prefix used as Redis key prefix, e.g. '/api/v1/vault/deposits' */
  routePrefix: string;
  /** Maximum requests per window */
  max: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

/**
 * Extracts the rate-limit key from a request.
 * Priority: walletAddress (body) > x-wallet-address (header) > x-api-key (header) > IP > 'unknown'
 */
function extractRateLimitKey(req: Request): string;

/**
 * Constructs the Redis key for a given route prefix and identifier.
 * Format: `rl:{routePrefix}:{identifier}`
 */
function buildRedisKey(routePrefix: string, identifier: string): string;

/**
 * Creates an express-rate-limit middleware instance backed by Redis.
 * Falls back to in-memory store when Redis is unavailable.
 */
function createLimiter(config: EndpointLimiterConfig): RequestHandler;

// Pre-built exports
export const depositsLimiter: RequestHandler;
export const summaryLimiter: RequestHandler;
export const defaultLimiter: RequestHandler;
```

### `RedisClientManager`

An internal singleton that wraps `ioredis`. It:

- Connects lazily (`lazyConnect: true`) so startup is not blocked if Redis is unavailable.
- Emits structured log messages on `connect`, `reconnecting`, and `error` events.
- Exposes `isReady(): boolean` for the fail-open check.
- Truncates/hashes wallet addresses before logging (production mode).

### `index.ts` changes

- Remove the single `app.use('/api/v1', apiLimiter)` call.
- Apply `depositsLimiter` to `POST /api/v1/vault/deposits`.
- Apply `summaryLimiter` to `GET /api/v1/vault/summary`.
- Apply `defaultLimiter` to the remaining `/api/v1` routes.

---

## Data Models

### Redis Key Schema

```
rl:{routePrefix}:{identifier}
```

Examples:
- `rl:/api/v1/vault/deposits:GABC...XYZ` — wallet-keyed deposit counter
- `rl:/api/v1/vault/summary:192.168.1.1` — IP-keyed summary counter
- `rl:/api/v1/vault/deposits:unknown` — fallback key when no identifier is available

The `rate-limit-redis` library stores a single integer counter per key with a TTL equal to the window duration. The Lua script it uses performs an atomic `INCR` + conditional `EXPIRE` in a single round-trip.

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `REDIS_URL` | _(none)_ | Redis connection URL. If absent, falls back to in-memory store. |
| `DEPOSITS_RATE_LIMIT_MAX` | `10` | Max requests per window for `/vault/deposits`. |
| `DEPOSITS_RATE_LIMIT_WINDOW_MS` | `60000` | Window duration (ms) for `/vault/deposits`. |
| `SUMMARY_RATE_LIMIT_MAX` | `30` | Max requests per window for `/vault/summary`. |
| `SUMMARY_RATE_LIMIT_WINDOW_MS` | `60000` | Window duration (ms) for `/vault/summary`. |
| `API_RATE_LIMIT_MAX_REQUESTS` | `30` | Default max requests per window (all other endpoints). |
| `API_RATE_LIMIT_WINDOW_MS` | `60000` | Default window duration (ms). |

### 429 Response Body

```json
{
  "error": "Rate limit exceeded",
  "status": 429,
  "message": "Too many requests. Please try again in {N} seconds.",
  "retryAfter": 42
}
```

### Rate Limit Response Headers (all `/api/v1` responses)

| Header | Description |
|---|---|
| `RateLimit-Limit` | Configured max requests for the endpoint |
| `RateLimit-Remaining` | Requests remaining in current window (0 on 429) |
| `RateLimit-Reset` | UTC epoch second when the window resets |
| `Retry-After` | Seconds until window reset (429 responses only) |

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Key extraction uses wallet address when present

*For any* request containing a `walletAddress` field in the JSON body or an `x-wallet-address` header, the `extractRateLimitKey` function SHALL return that wallet address as the rate-limit key.

**Validates: Requirements 2.1**

---

### Property 2: Key extraction falls back to IP when no wallet address is present

*For any* request that contains neither a `walletAddress` body field nor an `x-wallet-address` header, the `extractRateLimitKey` function SHALL return the client IP address (or `'unknown'` when IP is absent) as the rate-limit key.

**Validates: Requirements 2.2, 7.1**

---

### Property 3: Distinct wallet addresses have independent counters

*For any* two distinct wallet addresses A and B, incrementing the counter for A SHALL NOT change the counter value for B.

**Validates: Requirements 2.3**

---

### Property 4: Redis key contains endpoint prefix

*For any* wallet address and endpoint route prefix, the Redis key produced by `buildRedisKey` SHALL contain the route prefix as a component, ensuring keys for different endpoints never collide.

**Validates: Requirements 2.4**

---

### Property 5: Requests beyond the limit receive 429 with required headers and body

*For any* endpoint with configured limit N and any wallet address, after N+1 requests within the same window, the (N+1)th response SHALL have status 429, include `Retry-After`, `RateLimit-Limit`, `RateLimit-Remaining` (= 0), and `RateLimit-Reset` headers, and a JSON body containing `error`, `status`, `message`, and `retryAfter` fields.

**Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6**

---

### Property 6: Requests within the limit include rate-limit headers

*For any* request to a rate-limited endpoint that returns HTTP 200, the response SHALL include `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset` headers.

**Validates: Requirements 4.7**

---

### Property 7: Counter initialises to 1 on first request in a window

*For any* wallet address with no prior requests in the current window, after exactly one request the `RateLimit-Remaining` header SHALL equal `N - 1` (where N is the configured limit), confirming the counter was initialised to 1.

**Validates: Requirements 5.1**

---

### Property 8: Rate-limit log entries contain required fields without exposing full wallet address

*For any* rate-limited request with any wallet address, the structured log entry emitted SHALL contain the endpoint path, the current counter value, and the window reset time, and in production mode SHALL NOT contain the full wallet address string.

**Validates: Requirements 6.1, 6.4**

---

### Property 9: Environment variable overrides are applied

*For any* valid positive integer value set as `DEPOSITS_RATE_LIMIT_MAX` or `API_RATE_LIMIT_MAX_REQUESTS`, the corresponding limiter's `max` configuration SHALL equal that value.

**Validates: Requirements 3.4**

---

## Error Handling

### Redis Unavailable at Startup

When `REDIS_URL` is set but the Redis server is unreachable at startup:

1. `ioredis` with `lazyConnect: true` does not throw during client construction.
2. The first `sendCommand` call from `rate-limit-redis` will fail.
3. The `store` option in `express-rate-limit` does not have a built-in skip-on-error mechanism; the `skip` callback is used to detect Redis unavailability and bypass the store entirely.
4. A structured error log is emitted: `{ level: 'error', event: 'redis_unavailable', host, port, reason }`.
5. All requests pass through (fail-open).

### Redis Disconnects During Operation

`ioredis` emits an `error` event on connection loss. The `RedisClientManager` listens for this event and sets an internal `redisAvailable` flag to `false`. The `skip` callback in each limiter checks this flag and bypasses enforcement while Redis is down. When `ioredis` reconnects (it retries automatically), the flag is reset to `true` and enforcement resumes.

### Invalid Environment Variables

If `DEPOSITS_RATE_LIMIT_MAX` or similar variables are set to non-numeric values, `parseInt(..., 10)` returns `NaN`. The config loader uses `Number.isFinite(parsed) ? parsed : DEFAULT` to fall back to compiled-in defaults.

### Missing `REDIS_URL`

When `REDIS_URL` is not set, the factory skips Redis client creation entirely and constructs limiters with the default in-memory store. A `warn`-level log is emitted: `{ level: 'warn', event: 'redis_not_configured', message: 'REDIS_URL not set; using in-memory rate limit store' }`.

---

## Testing Strategy

### Dual Testing Approach

Unit tests cover specific examples, edge cases, and error conditions. Property-based tests verify universal properties across generated inputs. Both are needed for comprehensive coverage.

### Property-Based Testing Library

**`fast-check`** with **`@fast-check/jest`** is used for property-based tests. It integrates natively with Jest (the existing test runner), supports TypeScript, and provides rich arbitraries for strings, integers, and records. Each property test is configured to run a minimum of **100 iterations**.

Tag format for each property test:
```
// Feature: redis-rate-limiting, Property {N}: {property_text}
```

### Unit Tests

Located in `backend/src/__tests__/rateLimiter.test.ts`:

- `extractRateLimitKey` with body wallet address, header wallet address, API key fallback, IP fallback, and `unknown` fallback.
- `buildRedisKey` with various route prefixes and identifiers.
- Config loading: valid env vars, non-numeric env vars, absent env vars.
- 429 response body shape.
- Fail-open when Redis is unavailable (mock `ioredis` to throw).
- Redis connection/disconnection log events.
- Wallet address truncation in production log output.

### Property-Based Tests

Located in `backend/src/__tests__/rateLimiter.property.test.ts`:

| Property | Arbitraries | Assertion |
|---|---|---|
| P1: Key extraction — wallet address | `fc.string()` for wallet address, request variants | extracted key === wallet address |
| P2: Key extraction — IP fallback | requests without wallet address, `fc.ipV4()` | extracted key === IP |
| P3: Independent counters | two distinct wallet addresses, `fc.nat()` for counts | counter A unchanged after incrementing B |
| P4: Redis key prefix | `fc.string()` for prefix and identifier | key contains prefix |
| P5: 429 headers and body | `fc.integer({min:1, max:20})` for limit N | after N+1 requests: status=429, all headers present, body fields present |
| P6: 200 includes rate-limit headers | `fc.integer({min:1, max:29})` for request count within limit | all three RateLimit-* headers present |
| P7: Counter initialises to 1 | `fc.string()` for wallet address | RateLimit-Remaining = N-1 after first request |
| P8: Log fields and PII masking | `fc.string()` for wallet address | log contains required fields; full address absent in production |
| P9: Env var override | `fc.integer({min:1, max:1000})` for limit value | limiter.max === env var value |

### Integration Tests

Located in `backend/src/__tests__/rateLimiter.integration.test.ts` (requires a running Redis instance, skipped in CI without `REDIS_URL`):

- Counter persists across client reconnection (Requirement 1.2).
- Window expiry resets counter (Requirements 5.2, 5.3).
- Two simulated instances share the same counter (Requirement 1.3).

### Existing Tests

The existing `api.test.ts` rate-limiting tests are updated to:
- Use per-endpoint limiters instead of the global `apiLimiter`.
- Assert `Retry-After` header presence on 429 responses.
- Assert the new JSON body shape (`retryAfter` field).
