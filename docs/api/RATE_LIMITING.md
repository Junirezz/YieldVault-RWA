# API Rate Limiting

Sensitive and public API traffic is protected by independent limits. Limits are
applied per client IP and, where an identity is available, per user identity.
Authenticated vault mutations therefore cannot bypass protection by changing
networks, and one noisy client cannot exhaust another user's quota.

## Default tiers

| Tier | Default limit | Scope |
|------|---------------|-------|
| Auth | 5 requests/minute | IP and wallet identity |
| Reads | 60 requests/minute | IP/request identity |
| Writes | 10 requests/minute | Request identity |
| Deposits/withdrawals | 10 requests/minute | IP and wallet identity |
| Admin | 20 requests/minute | API-key tenant and IP |

Operators can override limits with the `RATE_LIMIT_*`, `DEPOSITS_RATE_LIMIT_*`,
and `API_RATE_LIMIT_*` environment variables. Redis is used when configured;
the service falls back to in-memory enforcement when Redis is unavailable.

## 429 response

```json
{
  "error": "Rate limit exceeded",
  "status": 429,
  "code": "RATE_LIMIT_EXCEEDED",
  "message": "Too many requests. Please try again in 42 seconds.",
  "retryable": true,
  "retryAfter": 42,
  "retryAfterSeconds": 42
}
```

The `Retry-After` response header contains the number of seconds to wait.
Adaptive abuse protection may return `code: "ADAPTIVE_THROTTLE"` with the same
retry fields.

## Client behavior

Honor `Retry-After` and do not retry immediately. Use exponential backoff with
jitter, stop retrying when the server continues returning 429, and avoid retrying
non-idempotent mutations unless the API's idempotency mechanism is in use.
Display a temporary unavailable state rather than treating throttling as a
permanent authentication failure.
