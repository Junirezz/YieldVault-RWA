# Requirements Document

## Introduction

This feature replaces the current in-memory rate limiter in the YieldVault backend API with a Redis-backed store. The goal is to enforce per-wallet-address rate limits that survive server restarts and horizontal scaling, protect sensitive endpoints (e.g. `/deposit`) from abuse, and return standard HTTP 429 responses with a `Retry-After` header so clients can back off gracefully.

The existing implementation uses `express-rate-limit` with its default in-memory store, keyed on API key or IP address. This feature migrates the store to Redis, changes the key to wallet address where available, adds per-endpoint limit configuration, and ensures the 429 response body and headers meet the RFC 6585 standard.

## Glossary

- **Rate_Limiter**: The middleware component responsible for counting requests and enforcing limits.
- **Redis_Store**: The Redis-backed persistence layer used by the Rate_Limiter to store request counters and window expiry times.
- **Wallet_Address**: A Stellar public key (G… address) supplied by the client, used as the primary rate-limit key.
- **Window**: The fixed time interval (in milliseconds) over which requests are counted before the counter resets.
- **Limit**: The maximum number of requests allowed per Wallet_Address (or fallback key) within a Window.
- **Retry_After**: The number of seconds the client must wait before making another request, returned in the HTTP `Retry-After` response header.
- **Endpoint_Config**: A per-route configuration object that specifies the Limit and Window for a given API path.
- **Fallback_Key**: The value used as the rate-limit key when no Wallet_Address is present in the request (IP address or `unknown`).

---

## Requirements

### Requirement 1: Redis-Backed Counter Storage

**User Story:** As a platform operator, I want rate-limit counters stored in Redis, so that limits are enforced consistently across server restarts and multiple backend instances.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL use the Redis_Store as its backing store for all request counters and Window expiry times.
2. WHEN the backend process restarts, THE Rate_Limiter SHALL retain all existing counters and Window expiry times from the Redis_Store.
3. WHEN multiple backend instances run concurrently, THE Rate_Limiter SHALL share a single set of counters via the Redis_Store so that the combined request count across all instances is enforced against the Limit.
4. IF the Redis_Store is unreachable at startup, THEN THE Rate_Limiter SHALL log an error and fall back to allowing requests through (fail-open), so that a Redis outage does not take down the API.
5. IF the Redis_Store becomes unreachable during operation, THEN THE Rate_Limiter SHALL log an error and continue serving requests without enforcing limits until the Redis_Store reconnects.

---

### Requirement 2: Per-Wallet-Address Rate Limiting

**User Story:** As a platform operator, I want rate limits keyed on wallet address, so that individual wallets cannot abuse the API regardless of IP address or API key.

#### Acceptance Criteria

1. WHEN a request includes a `walletAddress` field in the JSON body or a `x-wallet-address` header, THE Rate_Limiter SHALL use that Wallet_Address as the rate-limit key.
2. WHEN a request does not include a Wallet_Address, THE Rate_Limiter SHALL use the Fallback_Key (client IP address) as the rate-limit key.
3. THE Rate_Limiter SHALL treat each distinct Wallet_Address as an independent counter, so that requests from one Wallet_Address do not affect the counter of another.
4. WHEN constructing the Redis key, THE Rate_Limiter SHALL prefix it with the endpoint path to prevent counter collisions between different endpoints for the same Wallet_Address.

---

### Requirement 3: Per-Endpoint Limit Configuration

**User Story:** As a platform operator, I want to configure different rate limits per endpoint, so that sensitive operations like deposits can be restricted more tightly than read-only queries.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL apply the Endpoint_Config for `/api/v1/vault/deposits` with a Limit of 10 requests per 60-second Window.
2. THE Rate_Limiter SHALL apply the Endpoint_Config for `/api/v1/vault/summary` with a Limit of 30 requests per 60-second Window.
3. WHERE an endpoint does not have an explicit Endpoint_Config, THE Rate_Limiter SHALL apply a default Limit of 30 requests per 60-second Window.
4. THE Rate_Limiter SHALL read Limit and Window values from environment variables, so that operators can override defaults without code changes.
5. WHEN environment variables for Limit or Window are absent or non-numeric, THE Rate_Limiter SHALL use the compiled-in default values.

---

### Requirement 4: Standard 429 Response with Retry-After Header

**User Story:** As an API client developer, I want a standard 429 response with a `Retry-After` header when I exceed the rate limit, so that my client can implement correct back-off behaviour.

#### Acceptance Criteria

1. WHEN a Wallet_Address exceeds the Limit within the current Window, THE Rate_Limiter SHALL respond with HTTP status code 429.
2. WHEN responding with HTTP 429, THE Rate_Limiter SHALL include a `Retry-After` header whose value is the number of whole seconds remaining until the current Window resets.
3. WHEN responding with HTTP 429, THE Rate_Limiter SHALL include a `RateLimit-Limit` header containing the configured Limit for the endpoint.
4. WHEN responding with HTTP 429, THE Rate_Limiter SHALL include a `RateLimit-Remaining` header with value `0`.
5. WHEN responding with HTTP 429, THE Rate_Limiter SHALL include a `RateLimit-Reset` header containing the UTC epoch second at which the Window resets.
6. WHEN responding with HTTP 429, THE Rate_Limiter SHALL return a JSON body with the fields `error`, `status`, `message`, and `retryAfter` (integer seconds).
7. WHILE a Wallet_Address is within the Limit, THE Rate_Limiter SHALL include `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset` headers on every successful response.

---

### Requirement 5: Limit Enforcement and Reset Behaviour

**User Story:** As a platform operator, I want rate-limit counters to reset correctly after the Window expires, so that legitimate users regain access automatically without manual intervention.

#### Acceptance Criteria

1. WHEN a Wallet_Address sends its first request in a new Window, THE Rate_Limiter SHALL initialise the counter to 1 and set the Window expiry in the Redis_Store.
2. WHEN the Window expiry time is reached, THE Rate_Limiter SHALL reset the counter for that Wallet_Address to 0, allowing a fresh set of requests.
3. WHEN a Wallet_Address sends a request after the Window has expired, THE Rate_Limiter SHALL treat it as the first request of a new Window and respond with HTTP 200.
4. THE Rate_Limiter SHALL use a sliding or fixed Window strategy consistently; the chosen strategy SHALL be documented in the Endpoint_Config.
5. IF a Redis key expires between the counter increment and the expiry-set operations, THEN THE Rate_Limiter SHALL use an atomic Redis operation (e.g. a Lua script or `SET … EX … NX`) to prevent race conditions.

---

### Requirement 6: Observability and Logging

**User Story:** As a platform operator, I want rate-limit events logged, so that I can monitor abuse patterns and diagnose issues.

#### Acceptance Criteria

1. WHEN a request is rate-limited (HTTP 429 returned), THE Rate_Limiter SHALL emit a structured log entry containing the Wallet_Address (or Fallback_Key), the endpoint path, the current counter value, and the Window reset time.
2. WHEN the Redis_Store connection is established or re-established, THE Rate_Limiter SHALL log an informational message including the Redis host and port.
3. WHEN the Redis_Store connection is lost, THE Rate_Limiter SHALL log an error message including the Redis host, port, and error reason.
4. THE Rate_Limiter SHALL NOT log the full Wallet_Address in plain text in production environments; it SHALL log a truncated or hashed representation to reduce PII exposure.

---

### Requirement 7: Backward Compatibility

**User Story:** As a platform operator, I want the migration from in-memory to Redis-backed rate limiting to be transparent to existing clients, so that no breaking changes are introduced.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL continue to accept the `x-api-key` header as a fallback key when no Wallet_Address is present, preserving existing client behaviour.
2. THE Rate_Limiter SHALL preserve the existing `RateLimit-*` standard headers (no legacy `X-RateLimit-*` headers) as currently configured.
3. WHEN the `REDIS_URL` environment variable is not set, THE Rate_Limiter SHALL fall back to the in-memory store and log a warning, so that local development environments without Redis continue to work.
