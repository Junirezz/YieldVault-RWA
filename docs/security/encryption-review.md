# Encryption Review — Data at Rest & in Transit

**Last Updated:** 2026-08-26
**Related Issue:** [#1161](https://github.com/Junirezz/YieldVault-RWA/issues/1161) — Add encryption review for sensitive data at rest and in transit
**Maintained By:** Backend & Security reviewers

---

## Purpose

This document satisfies the acceptance criteria of Issue #1161:

- Review storage of secret and PII-like data
- Validate TLS or secure transport settings
- Document encryption responsibilities by service
- Flag unsafe data handling in review checklists

It records the **current, verified state** of the codebase (file/line references throughout) — it is a snapshot, not a target architecture. Findings that describe gaps are flagged explicitly in [§4](#4-findings). This document does not replace [`docs/SECURITY_CHECKLIST.md`](../SECURITY_CHECKLIST.md) (smart-contract vulnerability classes) or [`docs/PRODUCTION_SECURITY_CHECKLIST.md`](../PRODUCTION_SECURITY_CHECKLIST.md) (keys/CORS/logging hardening plan) — it complements both and cross-references them where relevant.

For the companion PR-time checklist, see [`.github/SECURITY_REVIEW_CHECKLIST.md`](../../.github/SECURITY_REVIEW_CHECKLIST.md).

---

## 1. Encryption Responsibilities by Service

| Layer / Service | Sensitive data it handles | At-rest protection | In-transit protection | Owner | Notes |
|---|---|---|---|---|---|
| **Frontend (SPA)** | Wallet address (public), UI preferences, session timestamps. No private keys or JWTs found in browser storage. | N/A — nothing secret is persisted client-side | HTTPS via Vercel/CDN TLS termination for the SPA; REST calls to the backend and Soroban RPC calls over HTTPS | `@frontend-maintainers` | Transaction signing is delegated entirely to the Freighter wallet extension; private keys never enter application code (`useWalletConnection.ts`, `walletSession.ts`). See F5 for missing HSTS/CSP headers. |
| **Backend API (Express)** | `JWT_SECRET`, `WALLET_ACTION_HMAC_SECRET`, API keys, scoped admin tokens, admin action receipts, webhook signing secrets | Secrets held only in process env; persisted tokens/keys are one-way hashed (SHA-256/HMAC) before storage, never in plaintext | TLS is expected to terminate in front of the process (proxy/CDN); no HSTS/security headers are set by the app itself (F3) | `@backend-maintainers` | `JWT_SECRET` is fail-fast validated in production (`backend/src/auth.ts`); `WALLET_ACTION_HMAC_SECRET` is not (F4). |
| **PostgreSQL (raw `pg` pool)** | Transactions, APY snapshots, webhook config, rate-limit backing data | Managed Postgres at-rest encryption (infra-level, outside this repo's code) | `sslmode=require` is documented in `backend/.env.production.example` by convention, but not enforced in code (F2) | `@backend-maintainers` / DevOps | `backend/src/database.ts` — `PostgresDatabasePool` builds `pg.Pool` from the connection string with no explicit `ssl` option. |
| **Prisma-managed store** | Hashed API keys, hashed scoped admin tokens, wallet aliases, admin audit/receipt records | **Silently falls back to a local SQLite file (`file:./dev.db`) whenever `DATABASE_URL` is a `postgres://`/`mysql://` URL** — see F1 | N/A (local file access, not networked) while the SQLite fallback is active | `@backend-maintainers` | `backend/prisma/schema.prisma` declares `provider = "sqlite"`; `backend/src/prisma.ts` explicitly falls back rather than erroring. Contradicts [ADR-001](../architecture-decision-records/ADR-001-use-prisma-for-database-access.md) ("Prisma for PostgreSQL access"). Highest-priority finding in this review. |
| **Redis (cache / rate-limit / token store)** | Refresh tokens, rate-limit counters, idempotency keys | In-memory; falls back to an in-process LRU cache when `REDIS_URL` is unset (documented behavior, not itself a gap) | Depends entirely on the `REDIS_URL` scheme (`redis://` vs `rediss://`); not validated or enforced in code | `@backend-maintainers` | `backend/src/redisCache.ts`, `backend/src/rateLimiter.ts`, `backend/src/auth.ts` |
| **Contracts (Soroban / Rust)** | On-chain vault state, admin address, oracle heartbeat bounds. No off-chain secrets or API keys. | On-chain ledger, governed by the Stellar network's own security model | Soroban RPC over HTTPS (`STELLAR_RPC_URL`) | `@contracts-maintainers` | Confirmed no secret/private-key handling in `contracts/vault`, `contracts/mock-strategy`, `contracts/share-price-math`. |
| **CI/CD (GitHub Actions)** | Deploy tokens (Vercel, Sentry), staging/prod DB URLs, Soroban secret keys | GitHub Actions encrypted secrets store; referenced only via `secrets.*` context, never hardcoded | HTTPS to GitHub/Vercel/Sentry | `@backend-maintainers` / `@frontend-maintainers` | `.github/workflows/secret-scanning.yml` runs `gitleaks` on every push/PR and daily on schedule; no plaintext credentials found in any workflow. |
| **Webhook delivery (outbound)** | Subscriber event payloads | N/A — in-flight only | HTTPS POST, HMAC-SHA256 signed payloads (`webhookDelivery.ts`) | `@integrations-owner` | Existing, solid control — no changes recommended. |

---

## 2. Data at Rest

- **Secret loading**: all secrets are read from `process.env` (populated from `.env` files locally, GitHub Actions secrets in CI, and platform env vars in deployed environments). There is no KMS/HSM/Secrets Manager integration in application code today — this matches the gap already tracked in [`docs/PRODUCTION_SECURITY_CHECKLIST.md`](../PRODUCTION_SECURITY_CHECKLIST.md).
- **Hashing over encryption for tokens**: API keys, scoped admin tokens, admin receipts, and webhook secrets are stored as SHA-256/HMAC digests, never in plaintext (`backend/src/middleware/apiKeyAuth.ts:88,155`, `backend/src/scopedAdminTokens.ts`, `backend/src/adminReceipt.ts`). This is appropriate for high-entropy generated tokens (not user passwords, so bcrypt/argon2 is not required here).
- **PII in the schema**: `backend/prisma/schema.prisma` stores wallet addresses (pseudonymous, not directly PII) and no plaintext secret/PII columns were found. See [`docs/DATA_RETENTION_DELETION_POLICY.md`](../DATA_RETENTION_DELETION_POLICY.md) for retention periods per data category.
- **Log redaction**: `backend/src/auditRedaction.ts` regex-redacts secret/token/password/private-key/mnemonic patterns before audit logging — a real, working control.
- **Prisma/SQLite fallback**: see F1 below — this is the most consequential at-rest finding in this review.

## 3. Transport / TLS Validation

- **CORS**: an explicit origin-allowlist middleware exists (`backend/src/middleware/cors.ts`, driven by `CORS_ALLOWED_ORIGINS`) — validated and working.
- **Database TLS**: `backend/.env.production.example` documents `?sslmode=require` in the example `DATABASE_URL`, but `backend/src/database.ts` does not pass an explicit `ssl` option to `pg.Pool` and does not validate the connection string's `sslmode` at startup — enforcement is convention-only (F2).
- **API transport headers**: no `helmet` (or equivalent) dependency exists in `backend/package.json`; the Express app sets no HSTS/CSP/security headers itself (F3). Auth uses `Authorization: Bearer` headers exclusively — no cookies are set, so `Secure`/`HttpOnly`/`SameSite` flags are not applicable to this service.
- **Frontend headers**: `frontend/vercel.json` sets `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`, and `Permissions-Policy`, but no `Strict-Transport-Security` or `Content-Security-Policy` (F5), despite `frontend/SECURITY_PATTERNS.md` documenting a CSP that was never wired into the deploy config.
- **Soroban RPC**: both frontend (`VITE_SOROBAN_RPC_URL`) and backend (`STELLAR_RPC_URL`) default to `https://` RPC endpoints; no plaintext `http://` RPC or API URLs were found in either codebase.
- **Wallet-action verification**: `backend/src/walletSignature.ts` supports two modes — `stellar` (Ed25519 signature verification via `@stellar/stellar-base`, intended for production) and `hmac` (development/test only, using `WALLET_ACTION_HMAC_SECRET`). See F4 for the missing production guard on this mode selection.

---

## 4. Findings

Findings are flagged, not fixed, per this review's scope. Severity reflects blast radius if the current behavior is relied on in production, not likelihood.

### F1 — High: Prisma-managed secrets may persist to a local SQLite file, not the managed Postgres database

- **Evidence**: `backend/prisma/schema.prisma:8-11` declares `provider = "sqlite"`, `url = "file:./dev.db"`. `backend/src/prisma.ts:16-43` explicitly returns `undefined` (falling back to the schema-declared SQLite file) whenever `DATABASE_URL` starts with `postgres://` or `mysql://`, by design — to avoid a hard crash rather than to intentionally route data to SQLite.
- **Impact**: every model Prisma manages — including hashed API keys, hashed scoped admin tokens, wallet aliases, and admin audit/receipt records — can end up persisted to a local, unencrypted `dev.db` file on the application host instead of the TLS-protected, infra-encrypted Postgres instance referenced everywhere else in this document and in [ADR-001](../architecture-decision-records/ADR-001-use-prisma-for-database-access.md).
- **Recommendation**: align the Prisma datasource provider with the actual production database (`postgresql`) and fail startup loudly if `DATABASE_URL` is unset or unreachable, instead of silently degrading to a local file.

### F2 — Medium: Postgres TLS (`sslmode=require`) is documented, not enforced

- **Evidence**: `backend/src/database.ts` builds `pg.Pool` from `connectionString` alone; `.env.production.example:27-28` documents `sslmode=require` but nothing in code validates it's present, and `.env.example` has no `sslmode` at all.
- **Recommendation**: validate `sslmode=require` (or pass an explicit `ssl` option) at startup when `NODE_ENV=production`, and fail fast if it's missing.

### F3 — Medium: No security-header middleware (helmet/HSTS/CSP) on the backend API

- **Evidence**: `helmet` is not a dependency in `backend/package.json`; no equivalent header middleware exists in `backend/src`.
- **Recommendation**: add `helmet` (or equivalent) with HSTS at minimum, or explicitly document that TLS termination and header hygiene are owned entirely by the fronting proxy/CDN and are out of this repo's scope.

### F4 — Low: `WALLET_ACTION_HMAC_SECRET` has no production fail-fast validation

- **Evidence**: `backend/src/walletSignature.ts:15-18` falls back from `WALLET_ACTION_HMAC_SECRET` → `JWT_SECRET` → a hardcoded dev string, with no equivalent to `auth.ts`'s `assertJwtSecretValid()`. This only matters when `WALLET_SIGNATURE_MODE=hmac`; production is documented to use `stellar` (Ed25519) mode instead.
- **Recommendation**: add the same startup validation used for `JWT_SECRET`, or explicitly forbid `WALLET_SIGNATURE_MODE=hmac` when `NODE_ENV=production`.

### F5 — Low: Frontend is missing HSTS/CSP headers despite having a documented policy

- **Evidence**: `frontend/vercel.json` sets several security headers but no `Strict-Transport-Security` or `Content-Security-Policy`; `frontend/SECURITY_PATTERNS.md` documents a CSP that isn't wired into the deploy config.
- **Recommendation**: add the documented CSP and an HSTS header to `frontend/vercel.json`.

### F6 — Informational: `docs/PRODUCTION_SECURITY_CHECKLIST.md` item 1 is stale

- **Evidence**: that document states API keys use an "in-memory `API_KEYS` Map." `backend/src/middleware/apiKeyAuth.ts:71-110` is already Prisma/DB-backed with SHA-256-hashed keys, roles, and tenant scoping (subject to the F1 SQLite-fallback caveat above).
- **Recommendation**: update that checklist item in a follow-up PR to avoid contributors re-doing already-completed work.

---

## 5. Relationship to Existing Security Documentation

| Document | Scope | How this review relates |
|---|---|---|
| [`docs/SECURITY_CHECKLIST.md`](../SECURITY_CHECKLIST.md) | Smart-contract vulnerability classes (reentrancy, access control, gas/DoS) | Out of scope here — contracts hold no off-chain secrets (§1) |
| [`docs/PRODUCTION_SECURITY_CHECKLIST.md`](../PRODUCTION_SECURITY_CHECKLIST.md) | Keys/secrets management plan, CORS, logging hygiene, operational controls | This review validates and updates several of its claims (see F6) and adds the TLS/at-rest findings (F1-F5) it didn't cover |
| [`docs/DATA_RETENTION_DELETION_POLICY.md`](../DATA_RETENTION_DELETION_POLICY.md) | Retention periods and deletion workflows per data category | Defines *how long* data is kept; this review covers *how it's protected* while it exists |
| [`docs/ENV_VARIABLE_MATRIX.md`](../ENV_VARIABLE_MATRIX.md) | Full env var reference per service | Source of truth for the secret/config variable names referenced throughout this review |
| [`docs/api/AUTH_AND_TOKEN_GUIDE.md`](../api/AUTH_AND_TOKEN_GUIDE.md) | JWT/token issuance and lifecycle | Authoritative for the auth flow this review only summarizes |
| [ADR-001](../architecture-decision-records/ADR-001-use-prisma-for-database-access.md) | Decision to use Prisma for PostgreSQL access | Currently contradicted by the live schema/config — see F1 |

---

## 6. Review Cadence

This review reflects the codebase as of the date above. Re-review when:

- A new service, data store, or third-party integration is introduced
- Any finding in §4 is resolved or its status changes
- The next quarterly review of `docs/PRODUCTION_SECURITY_CHECKLIST.md` occurs
