# Environment Variable Matrix

Complete reference for all environment variables across the YieldVault RWA stack.

**Legend**
- Required: `✅ always` | `🔶 prod only` | `⬜ optional`
- Source: where the variable is consumed

---

## Backend (`backend/`)

### Server

| Variable | Default | Required | Production Recommendation |
|---|---|---|---|
| `PORT` | `3000` | ✅ always | Keep `3000` or set via platform |
| `NODE_ENV` | `development` | ✅ always | Must be `production` |
| `LOG_LEVEL` | `debug` (dev) / `info` (prod) | ⬜ optional | `info` or `warn` |
| `DRAIN_TIMEOUT_MS` | `30000` | ⬜ optional | `30000`–`60000` |
| `CACHE_VAULT_METRICS_TTL_MS` | `60000` | ⬜ optional | `60000` |
| `METRICS_POLL_INTERVAL_MS` | `60000` | ⬜ optional | `60000` |
| `ALLOWLIST_ENABLED` | `true` | ⬜ optional | `true` for private beta |

### Stellar / Soroban

| Variable | Default | Required | Production Recommendation |
|---|---|---|---|
| `STELLAR_RPC_URL` | `https://soroban-testnet.stellar.org` | ✅ always | `https://soroban-mainnet.stellar.org` |
| `STELLAR_NETWORK` | `testnet` | ✅ always | `mainnet` |
| `STELLAR_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | ✅ always | `Public Global Stellar Network ; September 2015` |
| `VAULT_CONTRACT_ID` | _(empty)_ | ✅ always | Deployed mainnet contract ID (56-char `C…`) |

### Database

| Variable | Default | Required | Production Recommendation |
|---|---|---|---|
| `DATABASE_URL` | _(empty)_ | 🔶 prod only | `postgresql://user:pass@host:5432/db?sslmode=require` |
| `DATABASE_REPLICA_URL` | _(empty)_ | ⬜ optional | Same format as primary with `sslmode=require` |
| `DATABASE_POOL_SIZE` | `10` | ⬜ optional | `20` |
| `PRISMA_POOL_MAX` | `10` | ⬜ optional | `20` |
| `PRISMA_POOL_SIZE` | `10` | ⬜ optional | `20` |
| `PRISMA_POOL_TIMEOUT_MS` | `10000` | ⬜ optional | `10000` |
| `PRISMA_POOL_TIMEOUT_SEC` | `10` | ⬜ optional | `10` |
| `PRISMA_QUERY_TIMEOUT_MS` | `5000` | ⬜ optional | `5000` |
| `PRISMA_TX_MAX_WAIT_MS` | `5000` | ⬜ optional | `5000` |
| `PRISMA_TX_TIMEOUT_MS` | `10000` | ⬜ optional | `10000` |
| `ADMIN_AUDIT_LOG_STORAGE` | `hybrid` | ⬜ optional | `prisma` |

### Redis / Cache

| Variable | Default | Required | Production Recommendation |
|---|---|---|---|
| `REDIS_URL` | _(empty — in-memory fallback)_ | 🔶 prod only | `redis://prod-redis.example.com:6379` with TLS |
| `CACHE_TTL` | `300` | ⬜ optional | `300` |

### Authentication (JWT)

| Variable | Default | Required | Production Recommendation |
|---|---|---|---|
| `JWT_SECRET` | `change-me-in-production-must-be-at-least-32-characters` | 🔶 prod only | Min 32 chars, 3+ character classes; rotate every 90 days |
| `JWT_ACCESS_TTL_SECONDS` | `900` (15 min) | ⬜ optional | `900` |
| `JWT_REFRESH_TTL_SECONDS` | `604800` (7 days) | ⬜ optional | `604800` |

> **Production hard requirement:** Server exits at startup if `JWT_SECRET` is absent, shorter than 32 chars, or has fewer than 3 character classes when `NODE_ENV=production`.

### Rate Limiting

| Variable | Default | Required | Production Recommendation |
|---|---|---|---|
| `RATE_LIMIT_WINDOW_MS` | `900000` (15 min) | ⬜ optional | `900000` |
| `RATE_LIMIT_MAX_REQUESTS` | `100` | ⬜ optional | `100` |
| `API_RATE_LIMIT_WINDOW_MS` | `60000` (1 min) | ⬜ optional | `60000` |
| `API_RATE_LIMIT_MAX_REQUESTS` | `30` | ⬜ optional | `30` |
| `RATE_LIMIT_AUTH_MAX` | `5` | ⬜ optional | `5` |
| `RATE_LIMIT_AUTH_WINDOW_MS` | `60000` | ⬜ optional | `60000` |
| `RATE_LIMIT_WRITES_MAX` | `10` | ⬜ optional | `10` |
| `RATE_LIMIT_WRITES_WINDOW_MS` | `60000` | ⬜ optional | `60000` |
| `RATE_LIMIT_READS_MAX` | `60` | ⬜ optional | `60` |
| `RATE_LIMIT_READS_WINDOW_MS` | `60000` | ⬜ optional | `60000` |
| `RATE_LIMIT_ADMIN_MAX` | `20` | ⬜ optional | `20` |
| `RATE_LIMIT_ADMIN_WINDOW_MS` | `60000` | ⬜ optional | `60000` |

### CORS

| Variable | Default | Required | Production Recommendation |
|---|---|---|---|
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000,https://app.yieldvault.finance` | ✅ always | `https://app.yieldvault.finance,https://www.yieldvault.finance` only |

### Email

| Variable | Default | Required | Production Recommendation |
|---|---|---|---|
| `EMAIL_PROVIDER` | `resend` | ⬜ optional | `resend` |
| `EMAIL_API_KEY` | _(empty)_ | 🔶 prod only | Production Resend API key (`re_prod_…`) |
| `EMAIL_FROM_ADDRESS` | `notifications@yieldvault.finance` | ⬜ optional | Verified sender domain |

### Latency SLO Monitoring

| Variable | Default | Required | Production Recommendation |
|---|---|---|---|
| `SLO_READ_THRESHOLD_MS` | `200` | ⬜ optional | `200` |
| `SLO_WRITE_THRESHOLD_MS` | `500` | ⬜ optional | `500` |
| `SLO_EVALUATION_WINDOW_MS` | `300000` (5 min) | ⬜ optional | `300000` |
| `SLO_ALERT_COOLDOWN_MS` | `900000` (15 min) | ⬜ optional | `900000` |
| `SLO_CHECK_INTERVAL_MS` | `60000` (1 min) | ⬜ optional | `60000` |

### Alerting

| Variable | Default | Required | Production Recommendation |
|---|---|---|---|
| `ALERT_TYPE` | `slack` | ⬜ optional | `both` |
| `SLACK_WEBHOOK_URL` | _(empty)_ | 🔶 if `ALERT_TYPE` includes `slack` | Production Slack webhook URL |
| `PAGERDUTY_INTEGRATION_KEY` | _(empty)_ | 🔶 if `ALERT_TYPE` includes `pagerduty` | Production PagerDuty integration key |

### Event Polling

| Variable | Default | Required | Production Recommendation |
|---|---|---|---|
| `EVENT_POLL_INTERVAL_MS` | `10000` (10 s) | ⬜ optional | `10000` |
| `EVENT_REPLAY_BATCH_SIZE` | `100` | ⬜ optional | `100` |

### Withdrawal Partial-Failure Recovery

See [Withdrawal Partial-Failure Recovery](../backend/docs/WITHDRAWAL_PARTIAL_FAILURE_RECOVERY.md).

| Variable | Default | Required | Production Recommendation |
|---|---|---|---|
| `WITHDRAWAL_RECOVERY_MAX_STEP_ATTEMPTS` | `3` | ⬜ optional | `3` (irreversible steps are always 1) |
| `WITHDRAWAL_RECOVERY_MAX_ATTEMPTS` | `5` | ⬜ optional | `5` |
| `WITHDRAWAL_RECOVERY_BASE_BACKOFF_MS` | `2000` (2 s) | ⬜ optional | `2000` |
| `WITHDRAWAL_RECOVERY_MAX_BACKOFF_MS` | `60000` (60 s) | ⬜ optional | `60000` |
| `WITHDRAWAL_RECOVERY_STALE_MS` | `120000` (2 min) | ⬜ optional | `120000` |
| `WITHDRAWAL_RECOVERY_SWEEP_MS` | `15000` (15 s) | ⬜ optional | `15000` |
| `WITHDRAWAL_RECOVERY_MAX_PER_SWEEP` | `25` | ⬜ optional | `25` |
| `WITHDRAWAL_RECOVERY_RETENTION` | `1000` | ⬜ optional | `1000` |

### OpenTelemetry (Tracing)

| Variable | Default | Required | Production Recommendation |
|---|---|---|---|
| `OTEL_ENABLED` | `true` (disabled in `test`) | ⬜ optional | `true` |
| `OTEL_SERVICE_NAME` | `yieldvault-backend` | ⬜ optional | `yieldvault-backend` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | 🔶 prod only | Your OTLP collector URL |

---

## Frontend (`frontend/`)

### Stellar / Soroban

| Variable | Default | Required | Production Recommendation |
|---|---|---|---|
| `VITE_SOROBAN_RPC_URL` | `https://soroban-testnet.stellar.org` | ✅ always | `https://soroban-mainnet.stellar.org` |
| `VITE_STELLAR_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | ✅ always | `Public Global Stellar Network ; September 2015` |
| `VITE_VAULT_CONTRACT_ID` | _(empty)_ | ✅ always | Deployed mainnet contract ID (56-char `C…`) |

### API

| Variable | Default | Required | Production Recommendation |
|---|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:3000` | ✅ always | `https://api.yieldvault.finance` |

### Feature Flags

| Variable | Default | Required | Production Recommendation |
|---|---|---|---|
| `VITE_FF_ANALYTICS_PAGE` | `true` | ⬜ optional | `true` |
| `VITE_FF_ADVANCED_CHARTS` | `false` | ⬜ optional | `false` until stable |
| `VITE_FF_DEBUG_MODE` | `false` | ⬜ optional | Must be `false` |

### Sentry (Error Monitoring)

| Variable | Default | Required | Production Recommendation |
|---|---|---|---|
| `VITE_SENTRY_DSN` | _(empty — disabled)_ | 🔶 prod only | Production Sentry DSN |
| `SENTRY_AUTH_TOKEN` | _(empty)_ | 🔶 prod only | Sentry auth token for source map upload |
| `VITE_SENTRY_ENVIRONMENT` | _(empty)_ | ⬜ optional | `production` |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | _(empty)_ | ⬜ optional | `0.1` (10%) |
| `VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE` | _(empty)_ | ⬜ optional | `0.1` |
| `VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE` | _(empty)_ | ⬜ optional | `1.0` |

---

## Environment-by-Environment Summary

| Variable | Local Dev | Staging | Production |
|---|---|---|---|
| `NODE_ENV` | `development` | `staging` | `production` |
| `STELLAR_NETWORK` | `testnet` | `testnet` | `mainnet` |
| `DATABASE_URL` | `postgresql://localhost:5432/yieldvault_dev` | Staging DB | Prod DB with `sslmode=require` |
| `REDIS_URL` | _(optional)_ | Required | Required |
| `JWT_SECRET` | Default (warn) | Strong secret | Strong secret — server exits if weak |
| `CORS_ALLOWED_ORIGINS` | `localhost:3000,localhost:5173` | Staging domain | Production domains only |
| `ADMIN_AUDIT_LOG_STORAGE` | `memory` | `hybrid` | `prisma` |
| `ALERT_TYPE` | _(disabled)_ | `slack` | `both` |
| `VITE_FF_DEBUG_MODE` | `true` | `false` | `false` |
| `OTEL_ENABLED` | `false` | `true` | `true` |
| `RATE_LIMIT_MAX_REQUESTS` | `1000` (relaxed) | `100` | `100` |

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
REDIS_URL=redis://prod-redis.example.com:6379
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

- `JWT_SECRET` — never reuse across environments; rotate every 90 days
- `DATABASE_URL` — always use `sslmode=require` in production
- `REDIS_URL` — use TLS (`rediss://`) in production
- `CORS_ALLOWED_ORIGINS` — never use `*` in production
- `VITE_*` variables are **embedded in the browser bundle** at build time — never put secrets in them
- `SENTRY_AUTH_TOKEN` is build-time only; do not expose at runtime
- Run `./scripts/verify-env-security.sh` before every deployment

---

## Related Files

| File | Purpose |
|---|---|
| `backend/.env.example` | Backend dev template |
| `backend/.env.local.example` | Backend local dev template |
| `backend/.env.production.example` | Backend production template |
| `frontend/.env.example` | Frontend dev template |
| `frontend/.env.local.example` | Frontend local dev template |
| `frontend/.env.production.example` | Frontend production template |
| `ENVIRONMENT_SETUP_GUIDE.md` | Full setup walkthrough |
| `ENV_QUICK_REFERENCE.md` | One-page cheat sheet |
| `docs/LOCAL_DEVELOPMENT_QUICKSTART.md` | Local dev startup guide |
| `backend/docs/ENVIRONMENT_VARIABLES.md` | Latency monitoring vars detail |
