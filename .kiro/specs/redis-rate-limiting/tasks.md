# Implementation Plan: Redis Rate Limiting

## Overview

Refactor `backend/src/rateLimiter.ts` from a single in-memory `express-rate-limit` instance into a `RateLimiterFactory` backed by `ioredis` and `rate-limit-redis`. Per-endpoint limiters replace the global `apiLimiter` in `index.ts`. The implementation is fail-open: when Redis is unavailable, requests pass through without enforcement.

## Tasks

- [x] 1. Install dependencies and update environment configuration
  - Add `ioredis` and `rate-limit-redis` as production dependencies in `backend/package.json`
  - Add `fast-check` and `@fast-check/jest` as dev dependencies for property-based tests
  - Add `@types/ioredis` if needed (ioredis ships its own types, verify)
  - Add the new environment variables to `backend/.env.example`: `REDIS_URL`, `DEPOSITS_RATE_LIMIT_MAX`, `DEPOSITS_RATE_LIMIT_WINDOW_MS`, `SUMMARY_RATE_LIMIT_MAX`, `SUMMARY_RATE_LIMIT_WINDOW_MS`
  - _Requirements: 1.1, 3.4, 7.3_

- [x] 2. Implement `RedisClientManager` and config loader in `rateLimiter.ts`
  - [x] 2.1 Implement config loader
    - Replace the existing `rateLimiter.ts` content with the new module
    - Define the `EndpointLimiterConfig` interface
    - Implement `loadConfig()` that reads all seven environment variables using `parseInt(..., 10)` with `Number.isFinite` guard to fall back to compiled-in defaults
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 2.2 Write property test for config loader (Property 9)
    - **Property 9: Environment variable overrides are applied**
    - **Validates: Requirements 3.4**
    - Use `fc.integer({ min: 1, max: 1000 })` to generate limit values; set env var, reload config, assert `max === env var value`
    - Tag: `// Feature: redis-rate-limiting, Property 9: Env var override`

  - [x] 2.3 Implement `RedisClientManager` singleton
    - Create `ioredis` client with `lazyConnect: true` when `REDIS_URL` is set; skip Redis entirely when `REDIS_URL` is absent
    - Maintain an internal `redisAvailable` boolean flag
    - Listen to `connect` / `reconnecting` / `error` events and emit structured log messages (`{ level, event, host, port, reason? }`)
    - Log a `warn`-level message when `REDIS_URL` is not set (in-memory fallback)
    - Truncate wallet addresses in log output when `NODE_ENV === 'production'` (show first 4 + last 4 chars)
    - Expose `isReady(): boolean` and `getClient(): Redis | null`
    - _Requirements: 1.4, 1.5, 6.2, 6.3, 6.4, 7.3_

- [x] 3. Implement `extractRateLimitKey` and `buildRedisKey`
  - [x] 3.1 Implement `extractRateLimitKey(req: Request): string`
    - Priority: `req.body.walletAddress` → `req.headers['x-wallet-address']` → `req.headers['x-api-key']` → `req.ip` → `'unknown'`
    - _Requirements: 2.1, 2.2, 7.1_

  - [ ]* 3.2 Write property test for key extraction — wallet address present (Property 1)
    - **Property 1: Key extraction uses wallet address when present**
    - **Validates: Requirements 2.1**
    - Use `fc.string()` for wallet address; construct mock requests with body field and header variant; assert extracted key equals wallet address
    - Tag: `// Feature: redis-rate-limiting, Property 1: Key extraction — wallet address`

  - [ ]* 3.3 Write property test for key extraction — IP fallback (Property 2)
    - **Property 2: Key extraction falls back to IP when no wallet address is present**
    - **Validates: Requirements 2.2, 7.1**
    - Use `fc.ipV4()` for IP; construct mock requests without wallet address; assert extracted key equals IP or `'unknown'`
    - Tag: `// Feature: redis-rate-limiting, Property 2: Key extraction — IP fallback`

  - [x] 3.4 Implement `buildRedisKey(routePrefix: string, identifier: string): string`
    - Format: `` `rl:${routePrefix}:${identifier}` ``
    - _Requirements: 2.4_

  - [ ]* 3.5 Write property test for Redis key prefix (Property 4)
    - **Property 4: Redis key contains endpoint prefix**
    - **Validates: Requirements 2.4**
    - Use `fc.string()` for prefix and identifier; assert returned key contains the prefix as a substring
    - Tag: `// Feature: redis-rate-limiting, Property 4: Redis key prefix`

- [x] 4. Implement `createLimiter` factory and pre-built limiter exports
  - [x] 4.1 Implement `createLimiter(config: EndpointLimiterConfig): RequestHandler`
    - When Redis is available: construct a `RedisStore` from `rate-limit-redis` using the `ioredis` client and `config.routePrefix` as the key prefix
    - When Redis is unavailable or `REDIS_URL` is absent: use the default in-memory store
    - Set `keyGenerator` to call `extractRateLimitKey`
    - Set `skip` callback to return `true` (bypass) when `!redisClientManager.isReady()` and a Redis store was configured (fail-open)
    - Set `handler` to emit the structured 429 JSON body (`error`, `status`, `message`, `retryAfter`) and the `Retry-After` header
    - Emit a structured log entry on every 429 response containing truncated/hashed wallet address, endpoint path, counter value, and window reset time
    - Set `standardHeaders: true`, `legacyHeaders: false`
    - _Requirements: 1.1, 1.4, 1.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 6.1_

  - [x] 4.2 Export pre-built limiter instances
    - Export `depositsLimiter` using deposits config (max 10, window 60 s)
    - Export `summaryLimiter` using summary config (max 30, window 60 s)
    - Export `defaultLimiter` using default API config (max 30, window 60 s)
    - Remove the old `apiLimiter` export (or keep as alias pointing to `defaultLimiter` for backward compatibility during transition)
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 5. Checkpoint — unit-test the new rateLimiter module
  - Create `backend/src/__tests__/rateLimiter.test.ts`
  - Write unit tests for `extractRateLimitKey` covering: body wallet address, header wallet address, `x-api-key` fallback, IP fallback, and `'unknown'` fallback
  - Write unit tests for `buildRedisKey` with various prefixes and identifiers
  - Write unit tests for config loading: valid env vars, non-numeric env vars, absent env vars
  - Write unit tests for 429 response body shape (mock `express-rate-limit` handler invocation)
  - Write unit tests for fail-open behaviour: mock `ioredis` to throw; assert requests pass through
  - Write unit tests for Redis connection/disconnection log events
  - Write unit tests for wallet address truncation in production log output
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 1.4, 1.5, 2.1, 2.2, 4.6, 6.2, 6.3, 6.4_

- [x] 6. Wire per-endpoint limiters into `index.ts`
  - [x] 6.1 Replace global `apiLimiter` with per-endpoint limiters
    - Remove `import { apiLimiter } from './rateLimiter'`
    - Import `{ depositsLimiter, summaryLimiter, defaultLimiter }` from `./rateLimiter`
    - Remove `app.use('/api/v1', apiLimiter)`
    - Apply `depositsLimiter` directly on the `POST /api/v1/vault/deposits` route (before the handler)
    - Apply `summaryLimiter` directly on the `GET /api/v1/vault/summary` route (before the handler)
    - Apply `defaultLimiter` to the remaining `/api/v1` catch-all (before `listEndpoints`)
    - _Requirements: 3.1, 3.2, 3.3_

  - [ ]* 6.2 Write property test for independent counters (Property 3)
    - **Property 3: Distinct wallet addresses have independent counters**
    - **Validates: Requirements 2.3**
    - Use two distinct `fc.string()` wallet addresses; make N requests with address A; assert counter for address B is still 0 (use in-memory store for isolation)
    - Tag: `// Feature: redis-rate-limiting, Property 3: Independent counters`

- [x] 7. Write property-based tests for HTTP-level rate limit behaviour
  - Create `backend/src/__tests__/rateLimiter.property.test.ts`
  - [ ]* 7.1 Write property test for 429 headers and body (Property 5)
    - **Property 5: Requests beyond the limit receive 429 with required headers and body**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6**
    - Use `fc.integer({ min: 1, max: 20 })` for limit N; configure in-memory limiter with that N; make N+1 requests; assert status 429, all required headers, and body fields
    - Tag: `// Feature: redis-rate-limiting, Property 5: 429 headers and body`

  - [ ]* 7.2 Write property test for 200 includes rate-limit headers (Property 6)
    - **Property 6: Requests within the limit include rate-limit headers**
    - **Validates: Requirements 4.7**
    - Use `fc.integer({ min: 1, max: 29 })` for request count within limit; assert `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` present on each 200 response
    - Tag: `// Feature: redis-rate-limiting, Property 6: 200 includes rate-limit headers`

  - [ ]* 7.3 Write property test for counter initialisation (Property 7)
    - **Property 7: Counter initialises to 1 on first request in a window**
    - **Validates: Requirements 5.1**
    - Use `fc.string()` for wallet address; send exactly one request; assert `RateLimit-Remaining` header equals `N - 1`
    - Tag: `// Feature: redis-rate-limiting, Property 7: Counter initialises to 1`

  - [ ]* 7.4 Write property test for log fields and PII masking (Property 8)
    - **Property 8: Rate-limit log entries contain required fields without exposing full wallet address**
    - **Validates: Requirements 6.1, 6.4**
    - Use `fc.string({ minLength: 10 })` for wallet address; trigger a 429; capture log output; assert required fields present and full address absent when `NODE_ENV === 'production'`
    - Tag: `// Feature: redis-rate-limiting, Property 8: Log fields and PII masking`

- [x] 8. Update existing `api.test.ts` rate-limiting tests
  - Update the "Rate Limiting - API Endpoints" describe block to assert `Retry-After` header presence on 429 responses
  - Update the 429 response body assertion to include the `retryAfter` field
  - Update the per-user rate limiting test to use `x-wallet-address` header in addition to `x-api-key`
  - _Requirements: 4.2, 4.6, 7.1, 7.2_

- [x] 9. Final checkpoint — run full test suite
  - Ensure all tests in `backend/src/__tests__/` pass
  - Verify TypeScript compiles without errors (`npm run build` in `backend/`)
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests use `fast-check` with `@fast-check/jest`; each runs a minimum of 100 iterations
- Integration tests (Redis persistence, window expiry, multi-instance counter sharing) are out of scope for this task list — they require a live Redis instance and are documented in the design under "Integration Tests"
- The `ioredis` client uses `lazyConnect: true`; startup is never blocked by Redis unavailability
- Fixed-window strategy is used throughout, consistent with the existing `express-rate-limit` default
