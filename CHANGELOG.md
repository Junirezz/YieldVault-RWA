# Changelog

All notable changes to YieldVault-RWA are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- next-release -->

## [Unreleased]

### Features
- **Structured logging & observability (#1270)**: JSON structured logging now attaches the active OpenTelemetry `traceId` to every log line; HTTP 4xx/5xx responses increment dedicated `http_client_error_count` / `http_error_count` Prometheus counters for alerting; and a new `monitoring/` stack (Prometheus scrape config, Grafana dashboard with request-rate / error-rate / latency / TVL panels, and Alertmanager rules for high 5xx, elevated 4xx, p95 latency, and backend-down) can be run via `monitoring/docker-compose.yml`.
- **Unified error handling (#1267)**: added an `AppError` hierarchy (`ValidationError`, `AuthenticationError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `RateLimitError`, `InternalError`, `ServiceUnavailableError`, `GeolocationBlockedError`) plus a `classifyError` normaliser for Prisma/JWT/Zod/timeout errors. A central `errorHandler` logs every failure with correlation id + trace id and returns a standard envelope `{ status, message, error: { code, message, correlationId } }`; rate limiter and request-validation failures now use the same envelope.
- **OpenAPI / Swagger docs (#1266)**: `swagger.ts` now builds a real OpenAPI 3.1 spec (paths, request/response examples, bearer + API-key auth, and rate-limit documentation) and serves interactive Swagger UI at `/docs` plus the raw spec at `/docs/openapi.json`. `openapi.json` is generated from the spec and verified by CI.
- **Vault dashboard decision hierarchy (#989)**: added a `VaultDecisionSummary` component that leads the dashboard with a scannable strip (Vault APY, Total Value Locked, your USDC balance, and projected annual yield) plus a primary deposit call-to-action, so the most decision-critical information is shown before the strategy detail and the deposit/withdraw wizard.

### Changed
- The error response shape is now a consistent standard envelope across all handlers (legacy clients reading `res.body.error` / `res.body.message` still work; a nested `error` object adds `code`/`correlationId`).

### Bug Fixes
- Vault performance dynamic date filter
- Fixed `referralService.getOrCreateReferralCode` to use `findFirst` (was incorrectly using `findUnique` on a non-unique field).
- Fixed a stale `IS_TEST_ENV` reference and missing OpenTelemetry/decimal.js dependencies so the backend compiles and tests run.

### Chores
- Resolve merge conflict in Skeleton and dateUtils imports
