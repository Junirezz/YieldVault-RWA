# Environment Variable Matrix

Complete reference for all environment variables across the YieldVault RWA stack, organized by service.

**Legend**

| Symbol | Meaning |
|---|---|
| ✅ always | Must be set in every environment |
| 🔶 prod | Required in production; optional elsewhere |
| ⬜ optional | Sensible default exists; override only if needed |

**Source**: file path(s) where the variable is consumed.

---

## 1. Backend — Server Core

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `PORT` | `3000` | ⬜ optional | HTTP server listen port | `backend/src/index.ts` |
| `NODE_ENV` | `development` | ✅ always | Runtime environment (`development`, `production`, `test`) | `backend/src/index.ts`, `auth.ts`, `database.ts`, `prismaClient.ts`, `tracing.ts`, `rateLimiter.ts`, `cors.ts`, `geofencing.ts`, `allowlist.ts`, `maintenanceMode.ts`, `walletSignature.ts` (30+ files) |
| `LOG_LEVEL` | `debug` (dev) / `info` (prod) | ⬜ optional | Structured logger level (`debug`, `info`, `warn`, `error`) | `backend/src/index.ts` |
| `DRAIN_TIMEOUT_MS` | `30000` | ⬜ optional | Graceful shutdown drain timeout in ms | `backend/src/index.ts`, `gracefulShutdown.ts` |
| `CACHE_TTL_MS` | `60000` | ⬜ optional | Response cache TTL (vault summary, metrics, APY) | `backend/src/index.ts` |
| `CACHE_VAULT_METRICS_TTL_MS` | `60000` | ⬜ optional | Alias for `CACHE_TTL_MS` | `backend/src/index.ts` |
| `METRICS_POLL_INTERVAL_MS` | `60000` | ⬜ optional | Prometheus gauge sync interval | `backend/src/index.ts` |
| `ALLOWLIST_ENABLED` | `true` | ⬜ optional | Enable/disable deposit allowlist | `backend/src/index.ts`, `middleware/allowlist.ts` |

---

## 2. Backend — Stellar / Soroban Network

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `STELLAR_RPC_URL` | `https://soroban-testnet.stellar.org` | ✅ always | Soroban RPC endpoint URL | `backend/src/sorobanClient.ts`, `index.ts`, `diagnosticsBundle.ts` |
| `STELLAR_NETWORK` | `testnet` | ✅ always | Stellar network identifier (`testnet`, `mainnet`) | `backend/src/sorobanClient.ts`, `emailService.ts`, `diagnosticsBundle.ts` |
| `STELLAR_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | ✅ always | Network passphrase for transaction signing | `backend/src/sorobanClient.ts`, `emailService.ts` |
| `VAULT_CONTRACT_ID` | _(empty)_ | ✅ always | Deployed vault contract ID (56-char `C...`) | `backend/src/sorobanClient.ts`, `index.ts` |
| `STELLAR_SECRET_KEY` | _(empty)_ | 🔶 prod | Stellar secret key for on-chain transaction signing | `backend/src/sorobanClient.ts` |
| `STELLAR_HORIZON_URL` | `https://horizon-testnet.stellar.org` | ⬜ optional | Horizon URL for account data | `backend/src/reconciliationReport.ts`, `scripts/fund-testnet-account.js` |
| `STELLAR_FRIENDBOT_URL` | `https://friendbot.stellar.org` | ⬜ optional | Friendbot URL for testnet funding | `scripts/fund-testnet-account.js` |
| `VAULT_PUBLIC_ADDRESS` | _(empty)_ | ⬜ optional | Vault public Stellar address (for reconciliation reports) | `backend/src/reconciliationReport.ts` |
| `SOROBAN_MAX_RETRIES` | `3` | ⬜ optional | Max retries for Soroban RPC calls | `backend/src/sorobanClient.ts` |
| `SOROBAN_RETRY_DELAY_MS` | `1000` | ⬜ optional | Base delay between Soroban RPC retries (ms) | `backend/src/sorobanClient.ts` |
| `FIXED_BASE_FEE` | `100` | ⬜ optional | Base transaction fee for Soroban operations | `backend/src/feeCalculator.ts` |

---

## 3. Backend — Database (PostgreSQL)

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `DATABASE_URL` | _(empty)_ | 🔶 prod | Primary database connection string | `backend/src/database.ts`, `prisma.ts`, `adminConfigChangeAudit.ts`, `dbBackupJob.ts`, `scripts/postgres-migrations.js` |
| `DATABASE_REPLICA_URL` | _(empty)_ | ⬜ optional | Read replica connection string | `backend/src/database.ts` |
| `DATABASE_POOL_SIZE` | `10` | ⬜ optional | PostgreSQL pool size (primary) | `backend/src/database.ts` |
| `DATABASE_CONNECTION_TIMEOUT_MS` | `5000` | ⬜ optional | PostgreSQL connection timeout (ms) | `backend/src/database.ts` |
| `DATABASE_IDLE_TIMEOUT_MS` | `30000` | ⬜ optional | PostgreSQL idle timeout (ms) | `backend/src/database.ts` |

---

## 4. Backend — Prisma ORM

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `PRISMA_POOL_MAX` | `10` | ⬜ optional | Prisma max pool connections | `backend/src/prisma.ts` |
| `PRISMA_POOL_SIZE` | `10` | ⬜ optional | Prisma pool size alias | `backend/.env.example` |
| `PRISMA_POOL_TIMEOUT_MS` | `10000` | ⬜ optional | Prisma pool timeout (ms) | `backend/src/prisma.ts` |
| `PRISMA_POOL_TIMEOUT_SEC` | `10` | ⬜ optional | Prisma pool timeout (seconds) | `backend/.env.production.example` |
| `PRISMA_QUERY_TIMEOUT_MS` | `5000` | ⬜ optional | Prisma per-query timeout (ms) | `backend/src/prisma.ts` |
| `PRISMA_TX_MAX_WAIT_MS` | `5000` | ⬜ optional | Prisma transaction max wait (ms) | `backend/.env.example` |
| `PRISMA_TX_TIMEOUT_MS` | `10000` | ⬜ optional | Prisma transaction timeout (ms) | `backend/.env.example` |
| `QUERY_READ_BUDGET_MS` | `100` | ⬜ optional | Default budget for read queries (ms) | `backend/src/queryBudgets.ts` |
| `QUERY_WRITE_BUDGET_MS` | `200` | ⬜ optional | Default budget for write queries (ms) | `backend/src/queryBudgets.ts` |
| `QUERY_BUDGETS_JSON` | built-in hot-path budgets | ⬜ optional | JSON map of exact `Model.action` budget overrides | `backend/src/queryBudgets.ts` |
| `SLOW_QUERY_CRITICAL_MULTIPLIER` | `3` | ⬜ optional | Budget multiple that escalates a breach to critical | `backend/src/queryBudgets.ts` |
| `SLOW_QUERY_ALERT_COOLDOWN_MS` | `900000` (15 min) | ⬜ optional | Cooldown between slow query alerts | `backend/src/queryBudgets.ts` |
| `SLOW_QUERY_ALERT_TIMEOUT_MS` | `5000` | ⬜ optional | Slack/PagerDuty delivery timeout (ms) | `backend/src/queryBudgets.ts` |
| `QUERY_ALERT_TYPE` | `ALERT_TYPE` / `slack` | ⬜ optional | Slow-query alert channels: `slack`, `pagerduty`, or `both` | `backend/src/queryBudgets.ts` |
| `SLOW_QUERY_SLACK_WEBHOOK_URL` | `SLACK_WEBHOOK_URL` | ⬜ optional | Dedicated slow-query Slack webhook | `backend/src/queryBudgets.ts` |
| `SLOW_QUERY_PAGERDUTY_INTEGRATION_KEY` | `PAGERDUTY_INTEGRATION_KEY` | ⬜ optional | Dedicated slow-query PagerDuty key | `backend/src/queryBudgets.ts` |

---

## 5. Backend — Redis / Cache

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `REDIS_URL` | _(empty — in-memory fallback)_ | 🔶 prod | Redis connection URL | `backend/src/rateLimiter.ts`, `redisCache.ts`, `auth.ts`, `walletNonce.ts` |
| `REDIS_CACHE_KEY_PREFIX` | `cache:` | ⬜ optional | Redis cache key namespace prefix | `backend/src/redisCache.ts` |
| `REDIS_CACHE_CONNECT_TIMEOUT_MS` | `2000` | ⬜ optional | Redis cache connection timeout (ms) | `backend/src/redisCache.ts` |
| `REDIS_CACHE_COMMAND_TIMEOUT_MS` | `500` | ⬜ optional | Redis cache per-command timeout (ms) | `backend/src/redisCache.ts` |
| `CACHE_TTL` | `300` | ⬜ optional | Cache TTL in seconds (alias) | `backend/.env.example` |
| `CACHE_MAX_ENTRIES` | `500` | ⬜ optional | Max entries in in-memory LRU fallback | `backend/src/middleware/cache.ts` |
| `CACHE_LIST_ENDPOINTS_TTL_MS` | `30000` | ⬜ optional | TTL for cached list endpoints (ms) | `backend/src/listEndpoints.ts` |

---

## 6. Backend — Authentication (JWT)

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `JWT_SECRET` | `change-me-in-production...` | 🔶 prod | JWT signing secret (min 32 chars, 3+ character classes in production) | `backend/src/auth.ts` |
| `JWT_ACCESS_TTL_SECONDS` | `900` (15 min) | ⬜ optional | Access token TTL | `backend/src/auth.ts` |
| `JWT_REFRESH_TTL_SECONDS` | `604800` (7 days) | ⬜ optional | Refresh token TTL | `backend/src/auth.ts` |

> **Production:** Server exits at startup if `JWT_SECRET` is absent, shorter than 32 chars, or has fewer than 3 character classes when `NODE_ENV=production`.

---

## 7. Backend — Admin & Audit

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `ADMIN_AUDIT_LOG_STORAGE` | `hybrid` | ⬜ optional | Audit log storage mode (`memory`, `prisma`, `hybrid`) | `backend/src/adminAudit.ts` |
| `ADMIN_ACTION_RECEIPT_SECRET` | `dev-receipt-secret-change-me` | 🔶 prod | Receipt signing secret for admin actions | `backend/src/adminReceipt.ts` |
| `AUDIT_LOG_RETENTION` | `500` | ⬜ optional | Max admin audit log entries retained | `backend/src/auditLog.ts` |

---

## 8. Backend — Rate Limiting

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `RATE_LIMIT_WINDOW_MS` | `900000` (15 min) | ⬜ optional | Global rate limit window | `backend/.env.example` |
| `RATE_LIMIT_MAX_REQUESTS` | `100` | ⬜ optional | Global max requests per window | `backend/.env.example` |
| `API_RATE_LIMIT_WINDOW_MS` | `60000` (1 min) | ⬜ optional | API default rate limit window | `backend/src/rateLimiter.ts` |
| `API_RATE_LIMIT_MAX_REQUESTS` | `30` | ⬜ optional | API default max requests per window | `backend/src/rateLimiter.ts` |
| `RATE_LIMIT_AUTH_MAX` | `5` | ⬜ optional | Auth endpoints max requests | `backend/src/rateLimiter.ts` |
| `RATE_LIMIT_AUTH_WINDOW_MS` | `60000` | ⬜ optional | Auth endpoints window (ms) | `backend/src/rateLimiter.ts` |
| `RATE_LIMIT_WRITES_MAX` | `10` | ⬜ optional | Write endpoints max requests | `backend/src/rateLimiter.ts` |
| `RATE_LIMIT_WRITES_WINDOW_MS` | `60000` | ⬜ optional | Write endpoints window (ms) | `backend/src/rateLimiter.ts` |
| `RATE_LIMIT_READS_MAX` | `60` | ⬜ optional | Read endpoints max requests | `backend/src/rateLimiter.ts` |
| `RATE_LIMIT_READS_WINDOW_MS` | `60000` | ⬜ optional | Read endpoints window (ms) | `backend/src/rateLimiter.ts` |
| `RATE_LIMIT_ADMIN_MAX` | `20` | ⬜ optional | Admin endpoints max requests | `backend/src/rateLimiter.ts` |
| `RATE_LIMIT_ADMIN_WINDOW_MS` | `60000` | ⬜ optional | Admin endpoints window (ms) | `backend/src/rateLimiter.ts` |
| `DEPOSITS_RATE_LIMIT_MAX` | `10` | ⬜ optional | Deposit endpoints max requests | `backend/src/rateLimiter.ts` |
| `DEPOSITS_RATE_LIMIT_WINDOW_MS` | `60000` | ⬜ optional | Deposit endpoints window (ms) | `backend/src/rateLimiter.ts` |
| `SUMMARY_RATE_LIMIT_MAX` | `30` | ⬜ optional | Summary endpoint max requests | `backend/src/rateLimiter.ts` |
| `SUMMARY_RATE_LIMIT_WINDOW_MS` | `60000` | ⬜ optional | Summary endpoint window (ms) | `backend/src/rateLimiter.ts` |

---

## 9. Backend — Payload Size Limits

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `PAYLOAD_LIMIT_GLOBAL` | `1mb` | ⬜ optional | Global route payload cap | `backend/src/middleware/payloadLimit.ts` |
| `PAYLOAD_LIMIT_AUTH` | `4kb` | ⬜ optional | Auth route payload cap | `backend/src/middleware/payloadLimit.ts` |
| `PAYLOAD_LIMIT_ADMIN` | `16kb` | ⬜ optional | Admin route payload cap | `backend/src/middleware/payloadLimit.ts` |
| `PAYLOAD_LIMIT_WRITES` | `32kb` | ⬜ optional | Write route payload cap | `backend/src/middleware/payloadLimit.ts` |

---

## 10. Backend — CORS

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000,https://app.yieldvault.finance` | ✅ always | Comma-separated allowed CORS origins | `backend/src/middleware/cors.ts` |

---

## 11. Backend — Email Notifications

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `EMAIL_PROVIDER` | `resend` | ⬜ optional | Email provider (`resend` or `sendgrid`) | `backend/src/emailService.ts` |
| `EMAIL_API_KEY` | _(empty)_ | 🔶 prod | Email service API key | `backend/src/emailService.ts` |
| `EMAIL_FROM_ADDRESS` | `notifications@yieldvault.finance` | ⬜ optional | From address for system emails | `backend/src/emailService.ts` |

---

## 12. Backend — Latency SLO Monitoring

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `SLO_READ_THRESHOLD_MS` | `200` | ⬜ optional | P95 read latency threshold (ms) | `backend/src/latencyMonitoring.ts` |
| `SLO_WRITE_THRESHOLD_MS` | `500` | ⬜ optional | P95 write latency threshold (ms) | `backend/src/latencyMonitoring.ts` |
| `SLO_EVALUATION_WINDOW_MS` | `300000` (5 min) | ⬜ optional | Rolling P95 calculation window (ms) | `backend/src/latencyMonitoring.ts` |
| `SLO_ALERT_COOLDOWN_MS` | `900000` (15 min) | ⬜ optional | Cooldown between SLO alerts (ms) | `backend/src/latencyMonitoring.ts` |
| `SLO_CHECK_INTERVAL_MS` | `60000` (1 min) | ⬜ optional | SLO violation check interval (ms) | `backend/src/latencyMonitoring.ts` |

---

## 13. Backend — Alerting Integrations

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `ALERT_TYPE` | `slack` | ⬜ optional | Alert channel (`slack`, `pagerduty`, `both`) | `backend/src/latencyMonitoring.ts`, `queryBudgets.ts` |
| `SLACK_WEBHOOK_URL` | _(empty)_ | 🔶 if ALERT_TYPE includes slack | Slack webhook URL | `backend/src/latencyMonitoring.ts`, `queryBudgets.ts` |
| `PAGERDUTY_INTEGRATION_KEY` | _(empty)_ | 🔶 if ALERT_TYPE includes pagerduty | PagerDuty integration key | `backend/src/latencyMonitoring.ts`, `queryBudgets.ts` |

---

## 14. Backend — Event Polling (Soroban Ledger)

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `EVENT_POLL_INTERVAL_MS` | `10000` (10 s) | ⬜ optional | Event poll interval (ms) | `backend/src/index.ts` |
| `EVENT_REPLAY_BATCH_SIZE` | `100` | ⬜ optional | Event replay batch size (ledgers) | `backend/src/index.ts` |
| `EVENT_REPLAY_MAX_RANGE_SIZE` | `1000` | ⬜ optional | Max range size for event replay | `backend/src/eventPollingService.ts` |

---

## 15. Backend — APY Snapshots

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `APY_SNAPSHOT_INTERVAL_MS` | _(computed)_ | ⬜ optional | APY snapshot scheduler interval (ms) | `backend/src/apySnapshot.ts` |
| `APY_SNAPSHOT_ENABLED` | `true` | ⬜ optional | Enable/disable APY snapshot scheduler | `backend/src/apySnapshot.ts` |

---

## 16. Backend — Webhook Delivery

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `WEBHOOK_MAX_ATTEMPTS` | `3` | ⬜ optional | Max webhook delivery attempts | `backend/src/webhookDelivery.ts` |
| `WEBHOOK_DELIVERY_TIMEOUT_MS` | `5000` | ⬜ optional | Webhook delivery timeout (ms) | `backend/src/webhookDelivery.ts` |
| `WEBHOOK_RETRY_BASE_DELAY_MS` | `500` | ⬜ optional | Base delay between webhook retries (ms) | `backend/src/webhookDelivery.ts` |
| `WEBHOOK_DELIVERY_RETENTION` | `200` | ⬜ optional | Max delivery records retained | `backend/src/webhookDelivery.ts` |
| `WEBHOOK_JITTER_FACTOR` | `0.5` | ⬜ optional | Webhook retry jitter factor | `backend/src/webhookDelivery.ts` |
| `WEBHOOK_JITTER_MAX_MS` | `30000` | ⬜ optional | Max jitter for webhook retries (ms) | `backend/src/webhookDelivery.ts` |
| `WEBHOOK_VERIFICATION_TIMEOUT_MS` | `5000` | ⬜ optional | Webhook URL verification timeout (ms) | `backend/src/webhookDelivery.ts` |
| `WEBHOOK_CHALLENGE_TTL_SECONDS` | `900` (15 min) | ⬜ optional | Webhook challenge TTL (seconds) | `backend/src/webhookDelivery.ts` |
| `WEBHOOK_SIGNATURE_MAX_SKEW_MS` | `300000` (5 min) | ⬜ optional | Max timestamp skew for webhook signatures (ms) | `backend/src/webhookDelivery.ts` |
| `WEBHOOK_ALLOW_UNVERIFIED` | `false` | ⬜ optional | Allow unverified webhook endpoints | `backend/src/webhookDelivery.ts` |
| `WEBHOOK_DEDUP_TTL_SECONDS` | `86400` (24 h) | ⬜ optional | Webhook deduplication TTL (seconds) | `backend/src/webhookDeduplication.ts` |

---

## 17. Backend — Wallet Signed Actions

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `WALLET_NONCE_TTL_SECONDS` | `300` (5 min) | ⬜ optional | Nonce TTL (seconds) | `backend/src/walletNonce.ts` |
| `WALLET_NONCE_MAX_ACTIVE_PER_WALLET` | `10` | ⬜ optional | Max active nonces per wallet | `backend/src/walletNonce.ts` |
| `WALLET_NONCE_ENFORCEMENT` | `strict` (prod) / `off` (dev) | ⬜ optional | Nonce enforcement mode | `backend/src/walletSignature.ts` |
| `WALLET_SIGNATURE_MODE` | `stellar` (prod) / `hmac` (dev) | ⬜ optional | Signature mode (`hmac`, `stellar`) | `backend/src/walletSignature.ts` |
| `WALLET_ACTION_HMAC_SECRET` | falls back to `JWT_SECRET` | 🔶 prod (HMAC mode) | HMAC secret for wallet action signing | `backend/src/walletSignature.ts` |

---

## 18. Backend — Geofencing

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `GEOIP_ENABLED` | `true` | ⬜ optional | Enable geofencing middleware | `backend/src/middleware/geofencing.ts` |
| `GEOIP_BLOCKED_COUNTRIES` | _(empty)_ | ⬜ optional | Comma-separated blocked country codes (ISO 3166-1 alpha-2) | `backend/src/middleware/geofencing.ts` |
| `GEOIP_COUNTRY_MAP` | _(empty)_ | ⬜ optional | JSON country code mapping override | `backend/src/middleware/geofencing.ts` |

---

## 19. Backend — Adaptive Throttle

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `ADAPTIVE_THROTTLE_HALFLIFE_MS` | `300000` (5 min) | ⬜ optional | Score decay half-life (ms) | `backend/src/middleware/adaptiveThrottle.ts` |
| `ADAPTIVE_THROTTLE_BASE_BLOCK_MS` | `15000` (15 s) | ⬜ optional | Base block duration (ms) | `backend/src/middleware/adaptiveThrottle.ts` |
| `ADAPTIVE_THROTTLE_SCORE_THRESHOLD` | `6` | ⬜ optional | Block threshold score | `backend/src/middleware/adaptiveThrottle.ts` |
| `ADAPTIVE_THROTTLE_MAX_BLOCK_MS` | `300000` (5 min) | ⬜ optional | Max block duration (ms) | `backend/src/middleware/adaptiveThrottle.ts` |

---

## 20. Backend — Allowlist / RBAC

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `ALLOWLIST_ADDRESSES` | _(empty)_ | ⬜ optional | Comma-separated allowed wallet addresses | `backend/src/middleware/allowlist.ts` |
| `WITHDRAWAL_DAILY_LIMIT_USDC` | `10000` | ⬜ optional | Daily withdrawal limit in USDC | `backend/src/middleware/withdrawalDailyLimit.ts` |

---

## 21. Backend — Circuit Breaker

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `CIRCUIT_BREAKER_FAILURE_THRESHOLD` | `5` | ⬜ optional | Consecutive failures before tripping | `backend/src/circuitBreaker.ts` |
| `CIRCUIT_BREAKER_WINDOW_MS` | `30000` (30 s) | ⬜ optional | Circuit breaker rolling window (ms) | `backend/src/circuitBreaker.ts` |
| `CIRCUIT_BREAKER_COOLDOWN_MS` | `30000` (30 s) | ⬜ optional | Circuit breaker cooldown (ms) | `backend/src/circuitBreaker.ts` |

---

## 22. Backend — Retry Budget

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `RETRY_BUDGET_MAX_RETRIES` | `10` | ⬜ optional | Max retries per window | `backend/src/retryBudget.ts` |
| `RETRY_BUDGET_WINDOW_MS` | `60000` (1 min) | ⬜ optional | Retry budget time window (ms) | `backend/src/retryBudget.ts` |
| `RETRY_BUDGET_MIN_SUCCESS_RATE` | `0.5` | ⬜ optional | Min success rate to allow retries | `backend/src/retryBudget.ts` |
| `RETRY_BUDGET_FAILURE_THRESHOLD` | `5` | ⬜ optional | Consecutive failures to stop retries | `backend/src/retryBudget.ts` |

---

## 23. Backend — Idempotency

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `IDEMPOTENCY_KEY_TTL_MS` | `86400000` (24 h) | ⬜ optional | Idempotency key TTL (ms) | `backend/src/idempotency.ts`, `idempotencyRetention.ts` |
| `IDEMPOTENCY_HASH_THRESHOLD_BYTES` | `4096` (4 KB) | ⬜ optional | Body hash threshold for idempotency | `backend/src/idempotency.ts` |
| `IDEMPOTENCY_RETENTION_ENABLED` | `true` | ⬜ optional | Enable idempotency record pruning | `backend/src/idempotencyRetention.ts` |
| `IDEMPOTENCY_RETENTION_SWEEP_MS` | `3600000` (1 h) | ⬜ optional | Pruning sweep interval (ms) | `backend/src/idempotencyRetention.ts` |

---

## 24. Backend — Maintenance Mode

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `MAINTENANCE_MODE_ENABLED` | `false` | ⬜ optional | Enable maintenance mode on startup | `backend/src/maintenanceMode.ts` |
| `MAINTENANCE_MODE_REASON` | _(empty)_ | ⬜ optional | Maintenance mode reason/message | `backend/src/maintenanceMode.ts` |
| `MAINTENANCE_MODE_RETRY_AFTER_SECONDS` | `300` (5 min) | ⬜ optional | `Retry-After` header value (seconds) | `backend/src/maintenanceMode.ts` |
| `MAINTENANCE_WINDOW_POLL_MS` | `30000` (30 s) | ⬜ optional | Maintenance window scheduler poll interval (ms) | `backend/src/maintenanceWindow.ts` |

---

## 25. Backend — Impersonation Sessions

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `IMPERSONATION_SESSION_STORAGE` | _(empty — off)_ | ⬜ optional | Storage mode (`memory`, `prisma`) | `backend/src/impersonationSessionService.ts`, `index.ts` |
| `IMPERSONATION_SESSION_TTL_SECONDS` | `3600` (1 h) | ⬜ optional | Session TTL (seconds) | `backend/src/impersonationSessionService.ts` |

---

## 26. Backend — Feature Flags

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `FEATURE_FLAGS_PATH` | _(empty)_ | ⬜ optional | Path to feature flags JSON file | `backend/src/featureFlags.ts` |
| `FEATURE_FLAGS` | _(empty)_ | ⬜ optional | Inline feature flags JSON string | `backend/src/featureFlags.ts` |

---

## 27. Backend — OpenTelemetry / Tracing

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `OTEL_ENABLED` | `true` (disabled in test) | ⬜ optional | Enable OpenTelemetry tracing | `backend/src/tracing.ts` |
| `OTEL_SERVICE_NAME` | `yieldvault-backend` | ⬜ optional | OTel service name | `backend/src/tracing.ts` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | 🔶 prod | OTLP collector endpoint | `backend/src/tracing.ts` |

---

## 28. Backend — Database Backup Job

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `BACKUP_ENABLED` | `true` | ⬜ optional | Enable database backup scheduler | `backend/src/dbBackupJob.ts` |
| `BACKUP_S3_BUCKET` | _(empty)_ | 🔶 if backups enabled | S3 bucket name | `backend/src/dbBackupJob.ts` |
| `BACKUP_S3_PREFIX` | `backups/` | ⬜ optional | S3 key prefix | `backend/src/dbBackupJob.ts` |
| `BACKUP_S3_ENDPOINT` | _(empty)_ | 🔶 if using S3-compatible | S3-compatible endpoint URL | `backend/src/dbBackupJob.ts` |
| `BACKUP_S3_REGION` | `us-east-1` | ⬜ optional | S3 region | `backend/src/dbBackupJob.ts` |
| `AWS_ACCESS_KEY_ID` | _(empty)_ | 🔶 if S3 requires auth | AWS access key | `backend/src/dbBackupJob.ts` |
| `AWS_SECRET_ACCESS_KEY` | _(empty)_ | 🔶 if S3 requires auth | AWS secret access key | `backend/src/dbBackupJob.ts` |
| `BACKUP_RETENTION_DAYS` | `30` | ⬜ optional | Backup retention in days | `backend/src/dbBackupJob.ts` |
| `BACKUP_SCHEDULE_HOUR_UTC` | `2` | ⬜ optional | Scheduled backup hour (UTC) | `backend/src/dbBackupJob.ts` |
| `BACKUP_SLACK_WEBHOOK_URL` | _(empty)_ | 🔶 if backup alerts via Slack | Slack alert for backup failures | `backend/src/dbBackupJob.ts` |
| `BACKUP_ALERT_EMAIL` | _(empty)_ | 🔶 if backup alerts via email | Email alert for backup failures | `backend/src/dbBackupJob.ts` |

---

## 29. Backend — Bulk Export & Export Manifest

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `BULK_EXPORT_BATCH_SIZE` | `1000` | ⬜ optional | Export batch size | `backend/src/bulkExportJobs.ts` |
| `EXPORT_MANIFEST_RETENTION` | `500` | ⬜ optional | Max export manifests retained | `backend/src/exportManifest.ts` |
| `EXPORT_MANIFEST_STORAGE` | _(computed)_ | ⬜ optional | Storage mode (`memory` or db) | `backend/src/exportManifest.ts` |

---

## 30. Backend — Withdrawal Partial-Failure Recovery

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `WITHDRAWAL_RECOVERY_MAX_STEP_ATTEMPTS` | `3` | ⬜ optional | Max attempts per step (irreversible steps always 1) | `backend/src/withdrawalRecovery.ts` |
| `WITHDRAWAL_RECOVERY_MAX_ATTEMPTS` | `5` | ⬜ optional | Max saga recovery attempts | `backend/src/withdrawalRecovery.ts` |
| `WITHDRAWAL_RECOVERY_BASE_BACKOFF_MS` | `2000` (2 s) | ⬜ optional | Base backoff (ms) | `backend/src/withdrawalRecovery.ts` |
| `WITHDRAWAL_RECOVERY_MAX_BACKOFF_MS` | `60000` (60 s) | ⬜ optional | Max backoff (ms) | `backend/src/withdrawalRecovery.ts` |
| `WITHDRAWAL_RECOVERY_STALE_MS` | `120000` (2 min) | ⬜ optional | Stale saga threshold (ms) | `backend/src/withdrawalRecovery.ts` |
| `WITHDRAWAL_RECOVERY_SWEEP_MS` | `15000` (15 s) | ⬜ optional | Sweeper interval (ms) | `backend/src/withdrawalRecovery.ts` |
| `WITHDRAWAL_RECOVERY_MAX_PER_SWEEP` | `25` | ⬜ optional | Max sagas per sweep | `backend/src/withdrawalRecovery.ts` |
| `WITHDRAWAL_RECOVERY_RETENTION` | `1000` | ⬜ optional | Max saga records retained | `backend/src/withdrawalRecovery.ts` |

---

## 30a. Backend — Transfer Orchestration

See [Transfer Orchestration](../backend/docs/TRANSFER_ORCHESTRATION.md).

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `TRANSFER_ORCHESTRATION_TIMEOUT_MS` | `45000` (45 s) | ⬜ optional | Submission timeout; treated as in-doubt, never auto-retried | `backend/src/transferOrchestrator.ts` |
| `TRANSFER_ORCHESTRATION_MAX_KEY_LENGTH` | `255` | ⬜ optional | Max idempotency key length | `backend/src/transferOrchestrator.ts` |

---

## 31. Backend — Miscellaneous / Utility

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `MAX_UTC_DATE_RANGE_DAYS` | `366` | ⬜ optional | Max UTC date range query (days) | `backend/src/dateRange.ts` |
| `RECONCILIATION_WINDOW_HOURS` | `24` | ⬜ optional | Transaction reconciliation lookback window (hours) | `backend/src/reconciliationReport.ts` |

---

## 32. Backend — Testnet Funding Scripts

These are consumed by `scripts/fund-testnet-account.js` only — not by the running backend.

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `TESTNET_USDC_ASSET_CODE` | `USDC` | ⬜ optional | USDC asset code for testnet funding | `scripts/fund-testnet-account.js` |
| `TESTNET_USDC_ISSUER` | _(empty)_ | ⬜ optional | USDC issuer public key | `scripts/fund-testnet-account.js` |
| `TESTNET_USDC_ISSUER_SECRET` | _(empty)_ | ⬜ optional | USDC issuer secret key | `scripts/fund-testnet-account.js` |
| `TESTNET_USDC_AMOUNT` | `1000` | ⬜ optional | Testnet USDC token amount to fund | `scripts/fund-testnet-account.js` |
| `TESTNET_SECRET_KEY` | _(empty)_ | ⬜ optional | Account secret key for testnet funding | `scripts/fund-testnet-account.js` |
| `STELLAR_HORIZON_URL` | `https://horizon-testnet.stellar.org` | ⬜ optional | Horizon URL for account funding | `scripts/fund-testnet-account.js` |
| `STELLAR_FRIENDBOT_URL` | `https://friendbot.stellar.org` | ⬜ optional | Friendbot URL for testnet funding | `scripts/fund-testnet-account.js` |

---

## 33. Frontend — Stellar / Soroban (Vite `VITE_` prefix)

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `VITE_SOROBAN_RPC_URL` | `https://soroban-testnet.stellar.org` | ✅ always | Soroban RPC endpoint for frontend | `frontend/src/config/network.ts`, `lib/stellarAccount.ts` |
| `VITE_STELLAR_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | ✅ always | Network passphrase for transaction building | `frontend/src/config/network.ts`, `components/TransactionStatus.tsx` |
| `VITE_VAULT_CONTRACT_ID` | _(empty)_ | ✅ always | Vault contract ID for client-side reads | `frontend/src/config/network.ts` |
| `VITE_USDC_ISSUER` | _(empty)_ | ⬜ optional | USDC issuer public key | `frontend/src/lib/stellarAccount.ts` |
| `VITE_HORIZON_URL` | testnet horizon | ⬜ optional | Horizon URL for account data | `frontend/src/lib/stellarAccount.ts` |
| `VITE_E2E_STUB_BALANCES` | _(empty)_ | ⬜ optional | Enable stub balances for E2E tests | `frontend/src/lib/vaultApi.ts`, `hooks/useTokenAllowance.ts`, `hooks/useBalanceData.ts` |

---

## 34. Frontend — API Configuration

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:3000` | ✅ always | Backend API base URL | `frontend/src/lib/apiClient.ts`, `lib/vaultApi.ts` |

---

## 35. Frontend — Feature Flags

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `VITE_FF_ANALYTICS_PAGE` | `true` | ⬜ optional | Enable analytics page | `frontend/src/context/FeatureFlagContext.tsx` |
| `VITE_FF_ADVANCED_CHARTS` | `false` | ⬜ optional | Enable advanced charts | `frontend/src/context/FeatureFlagContext.tsx` |
| `VITE_FF_DEBUG_MODE` | `false` | ⬜ optional | Enable debug mode | `frontend/src/context/FeatureFlagContext.tsx` |

Note: Any `VITE_FF_*` variable is dynamically read via `import.meta.env["VITE_FF_${key}"]`.

---

## 35a. Frontend — Role-Based Navigation

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `VITE_ADMIN_WALLETS` | _(empty)_ | ⬜ optional | Comma-separated wallet addresses granted the admin nav link and `/admin` route. Not a security boundary — ships in the client bundle | `frontend/src/lib/roles.ts` |

---

## 36. Frontend — Sentry Error Monitoring

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `VITE_SENTRY_DSN` | _(empty — disabled)_ | 🔶 prod | Sentry DSN for error tracking | `frontend/src/config/sentry.ts` |
| `SENTRY_AUTH_TOKEN` | _(empty)_ | 🔶 prod | Sentry auth token (build-time, for source map upload) | `frontend/.env.example`, `.env.production.example` |
| `VITE_SENTRY_ENVIRONMENT` | `import.meta.env.MODE` | ⬜ optional | Sentry environment tag | `frontend/src/config/sentry.ts` |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | `0.1` (prod) / `1.0` (dev) | ⬜ optional | Sentry traces sample rate | `frontend/src/config/sentry.ts` |
| `VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE` | `0.1` | ⬜ optional | Session replay sample rate | `frontend/src/config/sentry.ts` |
| `VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE` | `1.0` | ⬜ optional | Error replay sample rate | `frontend/src/config/sentry.ts` |
| `VITE_APP_VERSION` | _(empty)_ | ⬜ optional | App version for Sentry release tracking | `frontend/src/config/sentry.ts` |

---

## 37. Frontend — Analytics (Production)

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `VITE_ANALYTICS_ID` | _(empty)_ | ⬜ optional | Analytics tracking ID | `frontend/.env.production.example` |
| `VITE_GTM_ID` | _(empty)_ | ⬜ optional | Google Tag Manager ID | `frontend/.env.production.example` |

---

## 38. Smart Contract (Rust — Soroban)

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `CARGO_PKG_VERSION` | _(compiler-provided)_ | ✅ always | Contract version compiled at build time via `env!("CARGO_PKG_VERSION")` | `contracts/vault/src/lib.rs` |

---

## 39. Test / CI / Internal

| Variable | Default | Req. | Description | Source |
|---|---|---|---|---|
| `JEST_WORKER_ID` | _(Jest-provided)_ | ⬜ optional | Jest worker ID (used to detect test environment at runtime) | `backend/src/adminConfigChangeAudit.ts` |
| `HUSKY` | _(unset)_ | ⬜ optional | Set to `0` to skip Husky git hooks install | `node_modules/husky/index.js` |

---

## Environment-by-Environment Summary

| Variable | Local Dev | Staging | Production |
|---|---|---|---|
| `NODE_ENV` | `development` | `staging` | `production` |
| `STELLAR_NETWORK` | `testnet` | `testnet` | `mainnet` |
| `DATABASE_URL` | `postgresql://localhost:5432/yieldvault_dev` | Staging DB (SSL) | Production DB (`sslmode=require`) |
| `REDIS_URL` | _(optional)_ | Required | Required (TLS) |
| `JWT_SECRET` | Default (warns) | Strong secret (≥32 chars, 3+ classes) | Strong secret — server exits if weak |
| `CORS_ALLOWED_ORIGINS` | `localhost:3000,localhost:5173` | Staging domains | Production domains only |
| `ADMIN_AUDIT_LOG_STORAGE` | `memory` | `hybrid` | `prisma` |
| `ALERT_TYPE` | _(disabled)_ | `slack` | `both` |
| `VITE_FF_DEBUG_MODE` | `true` | `false` | `false` |
| `OTEL_ENABLED` | `false` | `true` | `true` |
| `RATE_LIMIT_MAX_REQUESTS` | `1000` (relaxed) | `100` | `100` |
| `ALLOWLIST_ENABLED` | `true` | `true` | `false` (public) |
| `WALLET_NONCE_ENFORCEMENT` | `off` | `strict` | `strict` |
| `WALLET_SIGNATURE_MODE` | `hmac` | `stellar` | `stellar` |
| `IMPERSONATION_SESSION_STORAGE` | _(off)_ | `prisma` | `prisma` |
| `MAINTENANCE_MODE_ENABLED` | `false` | `false` | `false` |

---

## Minimum Required Sets

### Backend — absolute minimum to start
```bash
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VAULT_CONTRACT_ID=<your-contract-id>
```

### Backend — production minimum
```bash
NODE_ENV=production
STELLAR_RPC_URL=https://soroban-mainnet.stellar.org
STELLAR_NETWORK=mainnet
STELLAR_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
VAULT_CONTRACT_ID=<mainnet-contract-id>
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
REDIS_URL=rediss://prod-redis.example.com:6379
JWT_SECRET=<min-32-char-high-entropy-secret>
CORS_ALLOWED_ORIGINS=https://app.yieldvault.finance
EMAIL_API_KEY=<resend-production-key>
SLACK_WEBHOOK_URL=<production-slack-webhook>
PAGERDUTY_INTEGRATION_KEY=<production-pagerduty-key>
OTEL_EXPORTER_OTLP_ENDPOINT=<your-otlp-collector>
```

### Frontend — absolute minimum to start
```bash
VITE_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
VITE_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VITE_VAULT_CONTRACT_ID=<your-contract-id>
VITE_API_BASE_URL=http://localhost:3000
```

### Frontend — production minimum
```bash
VITE_SOROBAN_RPC_URL=https://soroban-mainnet.stellar.org
VITE_STELLAR_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
VITE_VAULT_CONTRACT_ID=<mainnet-contract-id>
VITE_API_BASE_URL=https://api.yieldvault.finance
VITE_FF_DEBUG_MODE=false
VITE_SENTRY_DSN=<production-sentry-dsn>
SENTRY_AUTH_TOKEN=<sentry-auth-token>
VITE_SENTRY_ENVIRONMENT=production
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
```

---

## Security Notes

- `JWT_SECRET` — never reuse across environments; rotate every 90 days; minimum 32 characters with 3+ character classes in production
- `DATABASE_URL` — always use `sslmode=require` in production; use `rediss://` (TLS) for Redis
- `CORS_ALLOWED_ORIGINS` — never use `*` in production; restrict to known domains
- `VITE_*` variables are **embedded in the browser bundle** at build time — never put secrets (API keys, passwords) in them
- `SENTRY_AUTH_TOKEN` is build-time only; do not expose at runtime
- `WALLET_ACTION_HMAC_SECRET` falls back to `JWT_SECRET` — set explicitly if using HMAC mode
- `STELLAR_SECRET_KEY` is a high-value secret — restrict access and rotate if compromised
- `ADMIN_ACTION_RECEIPT_SECRET` should be a unique value per environment
- `BACKUP_*` and `AWS_*` credentials should use least-privilege IAM policies
- Run `./scripts/verify-env-security.sh` before every deployment to catch accidentally committed secrets

---

## Related Files

| File | Purpose |
|---|---|
| `backend/.env.example` | Backend development template |
| `backend/.env.local.example` | Backend local development template |
| `backend/.env.production.example` | Backend production template |
| `frontend/.env.example` | Frontend development template |
| `frontend/.env.local.example` | Frontend local development template |
| `frontend/.env.production.example` | Frontend production template |
| `ENVIRONMENT_SETUP_GUIDE.md` | Full setup walkthrough |
| `ENV_QUICK_REFERENCE.md` | One-page cheat sheet |
| `ENV_SETUP_README.md` | Quick start setup |
| `SECURITY_ENV_CHECKLIST.md` | Security verification checklist |
| `docs/LOCAL_DEVELOPMENT_QUICKSTART.md` | Local development startup guide |
