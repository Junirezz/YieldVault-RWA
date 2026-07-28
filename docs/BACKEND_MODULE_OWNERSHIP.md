# Backend Module Ownership Map & Maintainers Table

This document maps every backend module to its functional domain, primary owner, and secondary reviewer. Use it to route issues, PR reviews, and incident escalations to the correct maintainer quickly.

Related documents:
- [TRIAGE_AND_REVIEW.md](../TRIAGE_AND_REVIEW.md) — Triage workflow and review criteria
- [docs/TRIAGE_ROTATION_CALENDAR.md](./TRIAGE_ROTATION_CALENDAR.md) — Weekly rotation schedule and escalation timeline
- [docs/SERVICE_DEPENDENCY_MATRIX.md](./SERVICE_DEPENDENCY_MATRIX.md) — Cross-service dependencies and startup order
- [backend/README.md](../backend/README.md) — Backend API overview and environment variables

---

## Maintainer Registry

### How to use this table

1. Find the module or feature area affected by the issue / PR in the **Module Ownership Map** below.
2. Look up the **Primary** and **Secondary** maintainers in this registry.
3. Assign or request review from the Primary first. If Primary is unavailable, go to Secondary.
4. For P0/P1 incidents, page both Primary and Secondary immediately (see escalation rules in [TRIAGE_ROTATION_CALENDAR.md](./TRIAGE_ROTATION_CALENDAR.md)).

| Handle | Name | Role | Domains of Expertise | Slack | Timezone |
|--------|------|------|----------------------|-------|----------|
| `@backend-lead` | *[TBD]* | Backend Tech Lead | All domains; architecture & breaking changes | `#backend-oncall` | *[TBD]* |
| `@auth-owner` | *[TBD]* | Senior Engineer | Authentication, RBAC, Wallet Security | `#backend-oncall` | *[TBD]* |
| `@data-owner` | *[TBD]* | Senior Engineer | Database, Prisma, Migrations, Exports | `#backend-oncall` | *[TBD]* |
| `@vault-domain-owner` | *[TBD]* | Domain Specialist | Vault state, Transactions, APY, Reconciliation | `#backend-oncall` | *[TBD]* |
| `@reliability-owner` | *[TBD]* | Reliability Engineer | Observability, Rate Limiting, Circuit Breakers, Jobs | `#backend-oncall` | *[TBD]* |
| `@integrations-owner` | *[TBD]* | Integrations Engineer | Webhooks, Stellar/Soroban RPC, Email, S3 | `#backend-oncall` | *[TBD]* |
| `@platform-owner` | *[TBD]* | Platform Engineer | CI/CD, Deployment, Infra, Security scanning | `#platform-oncall` | *[TBD]* |

> **To update this registry** (e.g., new hire, role change):
> 1. Open a docs-only PR modifying this table.
> 2. Tag the current Backend Tech Lead for approval.
> 3. Notify the team so triage rotation calendars are updated.

---

## Module Ownership Map

Modules are grouped by **functional domain**. Each entry lists:

- **Domain / Module** — High-level area and the specific source files under `backend/src/`.
- **Primary** — Default assignee and first reviewer for changes in this area.
- **Secondary** — Backup reviewer and escalation target.
- **Criticality** — `Core` (P0 if broken), `High` (P1), `Medium` (P2), `Low` (P3).
- **Related Tests** — Key test files under `backend/src/__tests__/` that guard this module.
- **Labels** — GitHub labels to apply when routing.

---

### 1. Application Bootstrap & Entrypoint

| Domain / Module | Primary | Secondary | Criticality | Source Files | Related Tests | Labels |
|-----------------|---------|-----------|-------------|--------------|---------------|--------|
| Server entry, route mounting, dependency wiring | `@backend-lead` | `@reliability-owner` | **Core** | [index.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/index.ts), [swagger.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/swagger.ts), [prisma.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/prisma.ts), [prismaClient.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/prismaClient.ts), [database.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/database.ts) | [api.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/api.test.ts) | `backend`, `api`, `core` |
| Graceful shutdown & drain | `@reliability-owner` | `@backend-lead` | **High** | [gracefulShutdown.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/gracefulShutdown.ts) | — | `backend`, `reliability` |
| Request context & scoped state | `@backend-lead` | `@auth-owner` | **High** | [requestContext.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/requestContext.ts), [types/express.d.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/types/express.d.ts) | [requestContext.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/requestContext.test.ts) | `backend`, `core` |
| OpenTelemetry tracing | `@reliability-owner` | `@backend-lead` | **Medium** | [tracing.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/tracing.ts) | — | `backend`, `observability` |

---

### 2. Authentication, Authorization & Identity Security

| Domain / Module | Primary | Secondary | Criticality | Source Files | Related Tests | Labels |
|-----------------|---------|-----------|-------------|--------------|---------------|--------|
| JWT login, nonce, refresh, logout | `@auth-owner` | `@backend-lead` | **Core** | [auth.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/auth.ts) | [auth.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/auth.test.ts) | `backend`, `auth`, `security` |
| Wallet nonce, signature & replay protection | `@auth-owner` | `@backend-lead` | **Core** | [walletNonce.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/walletNonce.ts), [walletSignature.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/walletSignature.ts), [walletLock.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/walletLock.ts), [walletUtils.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/walletUtils.ts) | [walletNonce.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/walletNonce.test.ts), [walletUtils.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/walletUtils.test.ts) | `backend`, `auth`, `security`, `wallet` |
| API Key lifecycle & validation | `@auth-owner` | `@backend-lead` | **Core** | [middleware/apiKeyAuth.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/middleware/apiKeyAuth.ts), [scopedAdminTokens.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/scopedAdminTokens.ts) | [rbac.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/rbac.test.ts) | `backend`, `auth`, `rbac`, `security` |
| API Key audit trail | `@auth-owner` | `@data-owner` | **High** | [apiKeyAudit.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/apiKeyAudit.ts) | — | `backend`, `audit`, `security` |
| Role-Based Access Control (admin tiers) | `@auth-owner` | `@backend-lead` | **Core** | [middleware/rbac.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/middleware/rbac.ts) | [rbac.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/rbac.test.ts) | `backend`, `rbac`, `security` |
| Admin impersonation sessions | `@auth-owner` | `@backend-lead` | **High** | [impersonationSessionService.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/impersonationSessionService.ts) | [impersonationSessions.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/impersonationSessions.test.ts) | `backend`, `auth`, `admin`, `security` |
| Tenant guard (multi-tenancy hooks) | `@auth-owner` | `@backend-lead` | **Medium** | [middleware/tenantGuard.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/middleware/tenantGuard.ts) | — | `backend`, `auth` |
| Wallet query guard (authorization) | `@auth-owner` | `@vault-domain-owner` | **High** | [middleware/walletQueryGuard.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/middleware/walletQueryGuard.ts) | [walletQueryGuard.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/walletQueryGuard.test.ts) | `backend`, `auth`, `security` |
| Wallet signed-action middleware | `@auth-owner` | `@vault-domain-owner` | **Core** | [middleware/walletSignedAction.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/middleware/walletSignedAction.ts) | — | `backend`, `auth`, `wallet` |

---

### 3. Middleware Stack (Request Pipeline)

| Domain / Module | Primary | Secondary | Criticality | Source Files | Related Tests | Labels |
|-----------------|---------|-----------|-------------|--------------|---------------|--------|
| CORS & origin restriction | `@auth-owner` | `@reliability-owner` | **High** | [middleware/cors.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/middleware/cors.ts) | [cors.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/cors.test.ts) | `backend`, `middleware`, `security` |
| Correlation ID injection | `@reliability-owner` | `@backend-lead` | **Medium** | [middleware/correlationId.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/middleware/correlationId.ts) | — | `backend`, `observability`, `middleware` |
| Structured logging | `@reliability-owner` | `@backend-lead` | **Medium** | [middleware/structuredLogging.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/middleware/structuredLogging.ts) | — | `backend`, `observability`, `middleware` |
| Request timeout per route tier | `@reliability-owner` | `@backend-lead` | **High** | [middleware/timeoutMiddleware.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/middleware/timeoutMiddleware.ts) | [timeoutMiddleware.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/timeoutMiddleware.test.ts) | `backend`, `reliability`, `middleware` |
| Error boundary & error formatting | `@reliability-owner` | `@backend-lead` | **High** | [middleware/errorBoundary.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/middleware/errorBoundary.ts), [redaction.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/redaction.ts), [sanitization.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/sanitization.ts) | [errorBoundary.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/errorBoundary.test.ts), [sanitization.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/sanitization.test.ts) | `backend`, `reliability`, `middleware` |
| Zod request validation | `@auth-owner` | `@backend-lead` | **High** | [middleware/validate.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/middleware/validate.ts) | [validation.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/validation.test.ts) | `backend`, `middleware` |
| Payload size limits (tiered body parser) | `@reliability-owner` | `@auth-owner` | **High** | [middleware/payloadLimit.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/middleware/payloadLimit.ts) | [payloadLimit.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/payloadLimit.test.ts) | `backend`, `middleware`, `security` |
| Geofencing / country-based blocking | `@auth-owner` | `@reliability-owner` | **High** | [middleware/geofencing.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/middleware/geofencing.ts) | [geofencing.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/geofencing.test.ts) | `backend`, `middleware`, `security` |
| Allowlist middleware | `@auth-owner` | `@vault-domain-owner` | **High** | [middleware/allowlist.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/middleware/allowlist.ts) | [allowlist.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/allowlist.test.ts) | `backend`, `middleware`, `whitelist` |
| Response caching middleware | `@reliability-owner` | `@data-owner` | **High** | [middleware/cache.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/middleware/cache.ts) | — | `backend`, `cache`, `middleware` |
| Adaptive throttling (SLO-driven) | `@reliability-owner` | `@backend-lead` | **Medium** | [middleware/adaptiveThrottle.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/middleware/adaptiveThrottle.ts) | — | `backend`, `reliability`, `middleware` |
| Withdrawal daily limit override | `@vault-domain-owner` | `@auth-owner` | **High** | [middleware/withdrawalDailyLimit.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/middleware/withdrawalDailyLimit.ts) | [withdrawalDailyLimit.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/withdrawalDailyLimit.test.ts) | `backend`, `vault`, `limits` |

---

### 4. Rate Limiting & Throttling

| Domain / Module | Primary | Secondary | Criticality | Source Files | Related Tests | Labels |
|-----------------|---------|-----------|-------------|--------------|---------------|--------|
| Rate limiter factory (Redis + memory tiers) | `@reliability-owner` | `@auth-owner` | **Core** | [rateLimiter.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/rateLimiter.ts) | [rateLimiter.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/rateLimiter.test.ts), [rateLimiter.property.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/rateLimiter.property.test.ts), [rateLimiter.tiers.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/rateLimiter.tiers.test.ts) | `backend`, `rate-limit`, `reliability` |
| Idempotency store & key handling | `@reliability-owner` | `@data-owner` | **High** | [idempotency.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/idempotency.ts), [idempotencyRetention.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/idempotencyRetention.ts) | [idempotencyRetention.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/idempotencyRetention.test.ts) | `backend`, `reliability`, `idempotency` |
| Retry budget (circuit-breaker adjunct) | `@reliability-owner` | `@backend-lead` | **Medium** | [retryBudget.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/retryBudget.ts) | — | `backend`, `reliability` |
| Soroban RPC circuit breaker | `@integrations-owner` | `@reliability-owner` | **High** | [circuitBreaker.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/circuitBreaker.ts) | [circuitBreaker.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/circuitBreaker.test.ts) | `backend`, `reliability`, `stellar` |
| Withdrawal partial-failure recovery (saga journal) | `@reliability-owner` | `@vault-domain-owner` | **Core** | [withdrawalRecovery.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/withdrawalRecovery.ts) | [withdrawalRecovery.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/withdrawalRecovery.test.ts), [withdrawalRecoveryEndpoint.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/withdrawalRecoveryEndpoint.test.ts) | `backend`, `reliability`, `vault` |

---

### 5. Vault Domain: State, Transactions & APY

| Domain / Module | Primary | Secondary | Criticality | Source Files | Related Tests | Labels |
|-----------------|---------|-----------|-------------|--------------|---------------|--------|
| Vault endpoints (summary, metrics, APY) | `@vault-domain-owner` | `@backend-lead` | **Core** | [vaultEndpoints.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/vaultEndpoints.ts) | — | `backend`, `vault`, `api` |
| Transaction endpoints & history | `@vault-domain-owner` | `@data-owner` | **Core** | [transactionEndpoints.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/transactionEndpoints.ts) | [transactions.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/transactions.test.ts) | `backend`, `transactions`, `api` |
| Transaction backfill (catch-up indexing) | `@vault-domain-owner` | `@integrations-owner` | **High** | [transactionBackfill.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/transactionBackfill.ts) | [transactionBackfill.persistence.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/transactionBackfill.persistence.test.ts) | `backend`, `transactions`, `indexer` |
| APY snapshots (scheduler + backfill) | `@vault-domain-owner` | `@reliability-owner` | **High** | [apySnapshot.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/apySnapshot.ts) | [apySnapshot.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/apySnapshot.test.ts) | `backend`, `vault`, `apy` |
| List endpoints (vault history, portfolio, holdings) | `@vault-domain-owner` | `@data-owner` | **High** | [listEndpoints.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/listEndpoints.ts) | — | `backend`, `api`, `vault` |
| Pagination primitives | `@data-owner` | `@vault-domain-owner` | **High** | [pagination.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/pagination.ts), [dateRange.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/dateRange.ts) | [pagination.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/pagination.test.ts) | `backend`, `pagination`, `data` |
| Wallet alias endpoints & service | `@vault-domain-owner` | `@auth-owner` | **Medium** | [walletAliasEndpoints.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/walletAliasEndpoints.ts), [walletAliasService.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/walletAliasService.ts) | [walletAliasEndpoints.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/walletAliasEndpoints.test.ts), [walletAliasService.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/walletAliasService.test.ts) | `backend`, `wallet`, `alias` |
| Referral endpoints & service | `@vault-domain-owner` | `@data-owner` | **Medium** | [referralEndpoints.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/referralEndpoints.ts), [referralService.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/referralService.ts) | [referral.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/referral.test.ts) | `backend`, `referrals`, `growth` |
| On-chain event polling & replay | `@integrations-owner` | `@vault-domain-owner` | **Core** | [eventPollingService.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/eventPollingService.ts) | [eventPollingService.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/eventPollingService.test.ts) | `backend`, `indexer`, `stellar`, `events` |

---

### 6. Data, Persistence & Exports

| Domain / Module | Primary | Secondary | Criticality | Source Files | Related Tests | Labels |
|-----------------|---------|-----------|-------------|--------------|---------------|--------|
| Prisma schema & migrations | `@data-owner` | `@backend-lead` | **Core** | [prisma/schema.prisma](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/prisma/schema.prisma), [migrations/](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/migrations/), [scripts/migrate-postgres.js](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/scripts/migrate-postgres.js), [scripts/check-postgres-drift.js](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/scripts/check-postgres-drift.js) | — | `backend`, `database`, `migrations` |
| Database health & connections | `@data-owner` | `@reliability-owner` | **Core** | [database.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/database.ts), [prismaClient.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/prismaClient.ts), [prisma.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/prisma.ts) | — | `backend`, `database` |
| Transaction export jobs (single-shot) | `@data-owner` | `@vault-domain-owner` | **High** | [exportJobs.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/exportJobs.ts) | — | `backend`, `exports`, `data` |
| Bulk export jobs (async, S3-backed) | `@data-owner` | `@integrations-owner` | **Medium** | [bulkExportJobs.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/bulkExportJobs.ts) | — | `backend`, `exports`, `data` |
| Export manifest & checksum verification | `@data-owner` | `@auth-owner` | **High** | [exportManifest.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/exportManifest.ts) | [exportManifest.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/exportManifest.test.ts) | `backend`, `exports`, `integrity` |
| API contract schema snapshots | `@data-owner` | `@backend-lead` | **High** | [apiContractSnapshots.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/apiContractSnapshots.ts), [schema-snapshots/](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/schema-snapshots/) | — | `backend`, `api`, `contract-testing` |
| Audit redaction & PII scrubbing | `@data-owner` | `@auth-owner` | **High** | [auditRedaction.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/auditRedaction.ts), [redaction.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/redaction.ts) | — | `backend`, `audit`, `privacy` |
| Sanitization (input/output cleaning) | `@data-owner` | `@auth-owner` | **High** | [sanitization.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/sanitization.ts) | [sanitization.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/sanitization.test.ts) | `backend`, `security`, `data` |

---

### 7. Webhooks & Event Delivery

| Domain / Module | Primary | Secondary | Criticality | Source Files | Related Tests | Labels |
|-----------------|---------|-----------|-------------|--------------|---------------|--------|
| Webhook delivery, registration, retries | `@integrations-owner` | `@reliability-owner` | **High** | [webhookDelivery.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/webhookDelivery.ts) | [webhookVerification.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/webhookVerification.test.ts), [webhookDeadLetter.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/webhookDeadLetter.test.ts), [webhookSoftDelete.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/webhookSoftDelete.test.ts) | `backend`, `webhooks` |
| Webhook deduplication (idempotent ingest) | `@integrations-owner` | `@reliability-owner` | **High** | [webhookDeduplication.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/webhookDeduplication.ts) | [webhookDeduplication.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/webhookDeduplication.test.ts) | `backend`, `webhooks`, `reliability` |

---

### 8. Admin Operations, Audit & Governance

| Domain / Module | Primary | Secondary | Criticality | Source Files | Related Tests | Labels |
|-----------------|---------|-----------|-------------|--------------|---------------|--------|
| Admin audit logging (every /admin request) | `@auth-owner` | `@data-owner` | **High** | [auditLog.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/auditLog.ts), [adminAudit.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/adminAudit.ts), [writeAheadAuditLog.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/writeAheadAuditLog.ts) | — | `backend`, `audit`, `admin`, `security` |
| Admin configuration change audit | `@auth-owner` | `@data-owner` | **High** | [adminConfigChangeAudit.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/adminConfigChangeAudit.ts) | — | `backend`, `audit`, `admin` |
| Admin receipts (tamper-evident action proofs) | `@auth-owner` | `@backend-lead` | **Medium** | [adminReceipt.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/adminReceipt.ts) | [adminReceipt.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/adminReceipt.test.ts) | `backend`, `admin`, `audit` |
| Maintenance mode & windows scheduler | `@reliability-owner` | `@backend-lead` | **High** | [maintenanceMode.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/maintenanceMode.ts), [maintenanceWindow.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/maintenanceWindow.ts) | — | `backend`, `admin`, `reliability`, `maintenance` |
| Feature flag overrides | `@backend-lead` | `@reliability-owner` | **High** | [featureFlags.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/featureFlags.ts) | [featureFlags.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/featureFlags.test.ts) | `backend`, `admin`, `feature-flags` |
| Admin features & governance controls | `@backend-lead` | `@auth-owner` | **Medium** | — | [adminFeatures.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/adminFeatures.test.ts), [governance.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/governance.test.ts) | `backend`, `admin`, `governance` |
| Governance snapshot export | `@data-owner` | `@backend-lead` | **Medium** | [governanceSnapshotExport.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/governanceSnapshotExport.ts) | [governanceSnapshotExport.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/governanceSnapshotExport.test.ts) | `backend`, `exports`, `governance` |

---

### 9. Background Jobs & Scheduler Governance

| Domain / Module | Primary | Secondary | Criticality | Source Files | Related Tests | Labels |
|-----------------|---------|-----------|-------------|--------------|---------------|--------|
| Job governance: registry, health, metrics | `@reliability-owner` | `@backend-lead` | **High** | [jobGovernance.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/jobGovernance.ts) | [jobGovernanceMetrics.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/jobGovernanceMetrics.test.ts) | `backend`, `jobs`, `reliability` |
| Position & ledger reconciliation jobs | `@vault-domain-owner` | `@data-owner` | **High** | [positionReconciliationJob.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/positionReconciliationJob.ts) | [ledgerReconciliationJob.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/ledgerReconciliationJob.test.ts) | `backend`, `jobs`, `reconciliation`, `vault` |
| Reconciliation reports | `@vault-domain-owner` | `@data-owner` | **Medium** | [reconciliationReport.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/reconciliationReport.ts) | [reconciliationReport.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/reconciliationReport.test.ts) | `backend`, `reports`, `reconciliation` |
| Database backup scheduler | `@data-owner` | `@reliability-owner` | **High** | [dbBackupJob.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/dbBackupJob.ts) | [dbBackupJob.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/dbBackupJob.test.ts) | `backend`, `jobs`, `database`, `backup` |
| Diagnostics bundle (support artifact) | `@reliability-owner` | `@data-owner` | **Medium** | [diagnosticsBundle.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/diagnosticsBundle.ts) | [diagnosticsBundle.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/diagnosticsBundle.test.ts) | `backend`, `support`, `diagnostics` |

---

### 10. Observability: Metrics, Health & SLO Monitoring

| Domain / Module | Primary | Secondary | Criticality | Source Files | Related Tests | Labels |
|-----------------|---------|-----------|-------------|--------------|---------------|--------|
| Prometheus metrics registry | `@reliability-owner` | `@backend-lead` | **High** | [metrics.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/metrics.ts) | — | `backend`, `observability`, `metrics` |
| Health & readiness probes | `@reliability-owner` | `@backend-lead` | **Core** | [healthProbe.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/healthProbe.ts) | — | `backend`, `observability`, `health` |
| Latency monitoring & SLO tracking | `@reliability-owner` | `@backend-lead` | **High** | [latencyMonitoring.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/latencyMonitoring.ts) | [latencyMonitoring.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/latencyMonitoring.test.ts), [sloMetrics.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/sloMetrics.test.ts) | `backend`, `observability`, `slo` |
| Endpoint SLA registry | `@reliability-owner` | `@backend-lead` | **Medium** | [endpointSlaRegistry.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/endpointSlaRegistry.ts) | [endpointSlaRegistry.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/endpointSlaRegistry.test.ts) | `backend`, `observability`, `slo` |

---

### 11. External Integrations

| Domain / Module | Primary | Secondary | Criticality | Source Files | Related Tests | Labels |
|-----------------|---------|-----------|-------------|--------------|---------------|--------|
| Stellar / Soroban RPC client | `@integrations-owner` | `@vault-domain-owner` | **Core** | [sorobanClient.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/sorobanClient.ts) | [sorobanClient.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/sorobanClient.test.ts) | `backend`, `stellar`, `rpc`, `integrations` |
| Email service & queue | `@integrations-owner` | `@reliability-owner` | **Medium** | [emailService.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/emailService.ts), [emailQueue.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/emailQueue.ts) | [emailService.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/emailService.test.ts), [emailQueue.test.ts](file:///c:/Users/USER/Desktop/YieldVault-RWA/backend/src/__tests__/emailQueue.test.ts) | `backend`, `email`, `integrations` |

---

## File → Domain Quick Lookup

Use this table when you only know the source filename and need to find the owning domain.

| File(s) | Domain | Primary |
|---------|--------|---------|
| `index.ts`, `swagger.ts` | Bootstrap & Entrypoint | `@backend-lead` |
| `auth.ts`, `walletNonce.ts`, `walletSignature.ts`, `walletLock.ts`, `walletUtils.ts`, `scopedAdminTokens.ts`, `impersonationSessionService.ts` | Auth & Identity Security | `@auth-owner` |
| `middleware/apiKeyAuth.ts`, `middleware/rbac.ts`, `middleware/tenantGuard.ts`, `middleware/walletQueryGuard.ts`, `middleware/walletSignedAction.ts` | Auth & Identity Security | `@auth-owner` |
| `apiKeyAudit.ts`, `auditLog.ts`, `adminAudit.ts`, `adminConfigChangeAudit.ts`, `writeAheadAuditLog.ts`, `auditRedaction.ts` | Admin Audit | `@auth-owner` / `@data-owner` |
| `adminReceipt.ts` | Admin Receipts | `@auth-owner` |
| `middleware/correlationId.ts`, `middleware/structuredLogging.ts`, `tracing.ts` | Observability middleware | `@reliability-owner` |
| `middleware/timeoutMiddleware.ts`, `middleware/errorBoundary.ts`, `middleware/adaptiveThrottle.ts` | Reliability middleware | `@reliability-owner` |
| `middleware/cors.ts`, `middleware/geofencing.ts`, `middleware/allowlist.ts`, `middleware/validate.ts`, `middleware/payloadLimit.ts` | Security middleware | `@auth-owner` |
| `middleware/cache.ts` | Cache middleware | `@reliability-owner` |
| `middleware/withdrawalDailyLimit.ts` | Vault limits | `@vault-domain-owner` |
| `rateLimiter.ts`, `idempotency.ts`, `idempotencyRetention.ts`, `retryBudget.ts`, `circuitBreaker.ts`, `withdrawalRecovery.ts` | Resilience & Throttling | `@reliability-owner` |
| `vaultEndpoints.ts`, `apySnapshot.ts` | Vault domain | `@vault-domain-owner` |
| `transactionEndpoints.ts`, `transactionBackfill.ts` | Transactions | `@vault-domain-owner` |
| `listEndpoints.ts`, `pagination.ts`, `dateRange.ts` | Data & pagination | `@data-owner` |
| `walletAliasEndpoints.ts`, `walletAliasService.ts` | Wallet aliases | `@vault-domain-owner` |
| `referralEndpoints.ts`, `referralService.ts` | Referrals | `@vault-domain-owner` |
| `eventPollingService.ts` | Event indexing | `@integrations-owner` |
| `prismaClient.ts`, `prisma.ts`, `database.ts`, `prisma/schema.prisma`, `migrations/` | Database | `@data-owner` |
| `exportJobs.ts`, `bulkExportJobs.ts`, `exportManifest.ts`, `governanceSnapshotExport.ts` | Exports | `@data-owner` |
| `apiContractSnapshots.ts`, `schema-snapshots/` | API contracts | `@data-owner` |
| `redaction.ts`, `sanitization.ts` | Data hygiene | `@data-owner` |
| `webhookDelivery.ts`, `webhookDeduplication.ts` | Webhooks | `@integrations-owner` |
| `maintenanceMode.ts`, `maintenanceWindow.ts` | Maintenance | `@reliability-owner` |
| `featureFlags.ts` | Feature flags | `@backend-lead` |
| `jobGovernance.ts`, `metrics.ts`, `healthProbe.ts`, `latencyMonitoring.ts`, `endpointSlaRegistry.ts`, `gracefulShutdown.ts` | Observability & Job Governance | `@reliability-owner` |
| `positionReconciliationJob.ts`, `reconciliationReport.ts` | Reconciliation | `@vault-domain-owner` |
| `dbBackupJob.ts` | Database backup | `@data-owner` |
| `diagnosticsBundle.ts` | Diagnostics | `@reliability-owner` |
| `sorobanClient.ts` | Stellar RPC | `@integrations-owner` |
| `emailService.ts`, `emailQueue.ts` | Email | `@integrations-owner` |
| `requestContext.ts`, `stellar-sdk-shim.d.ts`, `types/express.d.ts` | Core scaffolding | `@backend-lead` |

---

## PR Review Routing Cheat Sheet

When opening a PR, auto-assign reviewers based on which **top-level directories / patterns** your changes touch:

| If your PR changes… | Add these labels… | Request review from… |
|---------------------|-------------------|----------------------|
| `backend/src/auth.ts` OR `backend/src/wallet*.ts` OR `backend/src/scopedAdminTokens.ts` OR `backend/src/middleware/{apiKeyAuth,rbac,tenantGuard,walletQueryGuard,walletSignedAction}.ts` | `backend`, `auth`, `security` | `@auth-owner` (Primary), `@backend-lead` (Secondary) |
| `backend/src/middleware/*.ts` (any middleware) | `backend`, `middleware` | Primary = owner per module above; Secondary = `@backend-lead` |
| `backend/src/{rateLimiter,circuitBreaker,idempotency*,retryBudget,withdrawalRecovery}.ts` | `backend`, `reliability` | `@reliability-owner` (Primary), `@auth-owner` (Secondary) |
| `backend/src/{vaultEndpoints,transactionEndpoints,apySnapshot,listEndpoints,referral*,walletAlias*}.ts` | `backend`, `vault` or `backend`, `transactions` | `@vault-domain-owner` (Primary), `@data-owner` (Secondary) |
| `backend/prisma/schema.prisma` OR `backend/migrations/` OR `backend/scripts/{migrate-postgres,check-postgres-drift}.js` | `backend`, `database`, `migrations` | `@data-owner` (Primary), `@backend-lead` (Secondary) — 2 approvals required for schema changes |
| `backend/src/{export*,bulkExport*,exportManifest,apiContractSnapshots,governanceSnapshotExport,pagination,dateRange}.ts` OR `backend/schema-snapshots/` | `backend`, `data` | `@data-owner` (Primary), `@vault-domain-owner` (Secondary) |
| `backend/src/{webhook*,eventPollingService,sorobanClient,email*}.ts` | `backend`, `webhooks` or `backend`, `stellar` | `@integrations-owner` (Primary), `@reliability-owner` (Secondary) |
| `backend/src/{metrics,healthProbe,latencyMonitoring,endpointSlaRegistry,jobGovernance,diagnosticsBundle,gracefulShutdown}.ts` | `backend`, `observability` | `@reliability-owner` (Primary), `@backend-lead` (Secondary) |
| `backend/src/{maintenanceMode,maintenanceWindow,featureFlags,adminReceipt,adminAudit,auditLog,adminConfigChangeAudit}.ts` | `backend`, `admin` | Primary = owner per domain; Secondary = `@backend-lead` |
| `backend/src/__tests__/*` only (test-only change) | `backend`, `tests` | Owner of the module under test |
| `backend/README.md` OR `backend/docs/` OR any `docs/*.md` referencing backend | `documentation`, `backend` | `@backend-lead` |

### Additional Rules

- **Smart contract changes** (`contracts/`) follow a separate 2-approval rule; see [TRIAGE_AND_REVIEW.md](../TRIAGE_AND_REVIEW.md).
- **Cross-domain PRs** (touches 3+ modules): assign `@backend-lead` as Primary and one owner per affected module.
- **Docs-only PRs**: single approval from any maintainer is sufficient.
- **Dependency upgrades** (backend `package.json`): require `@data-owner` + `@backend-lead` review; run `npm audit` and link output.

---

## Issue Triage Quick Routing

Copy-paste the following command pattern when routing a newly opened issue:

```
/area backend
/label <module-label> <priority-label>
/assign @<primary-owner>
/cc @<secondary-owner>
```

Use the **Labels** column in the module ownership tables to pick `<module-label>`. Priority labels are `P0`–`P3` as defined in [TRIAGE_AND_REVIEW.md](../TRIAGE_AND_REVIEW.md).

### Escalation path for unowned / orphaned work

1. **No obvious owner?** → Assign to `@backend-lead` with label `triage-needs-owner`.
2. **Owner unresponsive > 48 business hours?** → Re-assign to Secondary owner and add label `triage-escalated`.
3. **Both owners unresponsive > 5 business days?** → Follow [TRIAGE_ROTATION_CALENDAR.md](./TRIAGE_ROTATION_CALENDAR.md) escalation; tag the on-call Primary team from the weekly rotation.

---

## Maintenance & Updates

- **Quarterly review**: At the start of each quarter the Backend Tech Lead audits this document for:
  - New modules added since last review
  - Stale / deprecated modules removed
  - Maintainer handles and roles current
  - Ownership assignments match reality on the ground
- **Immediate updates required when**:
  - A new source file is added to `backend/src/` at the top level (not a pure test helper)
  - A module is split, merged, or deprecated
  - A maintainer changes team, leaves, or goes on leave > 2 weeks
- **Contributing an update**: Open a docs-only PR titled `Docs: Update backend module ownership map` and tag `@backend-lead`. No changelog entry needed.

---

**Version:** 1.0.0
**Last Updated:** July 2026
**Owned by:** Backend Tech Lead (`@backend-lead`)
