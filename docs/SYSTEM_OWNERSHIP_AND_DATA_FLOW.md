# System Ownership & Data Flow

> **Related docs:**
> - [Contracts Architecture](./CONTRACTS_ARCHITECTURE.md) — full contract module breakdown and public API
> - [Backend Module Ownership](./BACKEND_MODULE_OWNERSHIP.md) — per-module owner table and criticality
> - [Service Dependency Matrix](./SERVICE_DEPENDENCY_MATRIX.md) — startup order and health checks
> - [Deposit & Withdrawal Lifecycle](./DEPOSIT_WITHDRAWAL_LIFECYCLE.md) — detailed sequence diagrams
> - [Webhook Integration Guide](./WEBHOOK_INTEGRATION.md) — webhook payload formats and consumer patterns
> - [API README](./api/README.md) — backend REST API overview

This document is the single source of truth for **layer ownership boundaries**, **API and event flow maps**, and **cross-layer interface assumptions**. It is intended for contributors, reviewers, and on-call engineers who need to quickly identify who owns what and how data moves through the system.

---

## 1. System Layers at a Glance

YieldVault-RWA is divided into three independently owned layers that interact through well-defined interfaces:

```
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 1 — FRONTEND  (React + Vite, TypeScript)                     │
│  Owned by: @YieldVault-RWA/frontend-maintainers                     │
│  Sources:  frontend/src/                                             │
│  Interface to backend:    REST API  (VITE_API_BASE_URL)             │
│  Interface to blockchain: Soroban RPC  (VITE_SOROBAN_RPC_URL)       │
└─────────────────┬───────────────────┬───────────────────────────────┘
                  │ REST (HTTP/JSON)   │ Soroban RPC (XDR)
                  ▼                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 2 — BACKEND  (Node.js + Express, TypeScript)                 │
│  Owned by: @YieldVault-RWA/backend-maintainers                      │
│  Sources:  backend/src/                                              │
│  Interface to DB:         Prisma ORM → PostgreSQL                   │
│  Interface to cache:      Redis (rate limiting, idempotency, cache)  │
│  Interface to blockchain: Soroban RPC  (sorobanClient.ts)           │
│  Outbound:                Webhook delivery to subscribers           │
└─────────────────┬───────────────────┬───────────────────────────────┘
                  │ Soroban RPC (XDR) │ Webhook HTTPS (HMAC-signed)
                  ▼                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 3 — CONTRACTS  (Rust/Soroban WebAssembly on Stellar)         │
│  Owned by: @YieldVault-RWA/contracts-maintainers                    │
│  Sources:  contracts/vault/  contracts/mock-strategy/               │
│  Interface to token:      USDC SAC (transfer calls)                 │
│  Interface to strategy:   StrategyTrait (pluggable connectors)      │
│  Interface to oracle:     OracleValidator (price heartbeat)         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Ownership Boundaries

### 2.1 Frontend

**Owner:** `@YieldVault-RWA/frontend-maintainers`  
**Source root:** `frontend/src/`  
**Deployment:** Static SPA served at `http://localhost:5173` (dev) or CDN (prod)

The frontend layer owns everything the user sees and initiates. It does not hold authoritative state — it is a consumer of backend REST responses and on-chain data. The frontend is responsible for:

- Wallet connection and session management via Freighter (`WalletConnect.tsx`, `AuthContext.tsx`, `lib/walletSession.ts`)
- Transaction building, simulation preview, and signing (`lib/vaultApi.ts`, `hooks/useVaultMutations.ts`)
- Rendering vault state, APY charts, and transaction history (components in `components/`, pages in `pages/`)
- Form validation and user-side input constraints (`forms/schemas/`, `forms/validate.ts`)
- Reporting indexed transaction events back to the backend for off-chain record keeping (`lib/transactionApi.ts`)

**What the frontend does NOT own:**
- Authoritative vault share balances (owned by the contract's on-chain state)
- Transaction history persistence (owned by the backend/database)
- Webhook subscribers or event fan-out (owned by the backend)
- Any admin or governance actions beyond initiating signed transactions

### 2.2 Backend

**Owner:** `@YieldVault-RWA/backend-maintainers`  
**Source root:** `backend/src/`  
**Port:** `3000`

The backend layer owns all off-chain indexing, persistence, access control, and fan-out. It is the authoritative source for transaction history records, APY snapshots, webhook registrations, and rate-limiting state. It does not execute on-chain logic — it observes and indexes it. Key responsibilities:

- Indexing on-chain events by polling Soroban RPC (`eventPollingService.ts`)
- Persisting transactions, APY snapshots, and audit logs to PostgreSQL via Prisma
- Enforcing access control (JWT auth, API keys, RBAC, wallet signature verification)
- Orchestrating webhook delivery to subscribers with HMAC signing and retry (`webhookDelivery.ts`, `eventOutbox.ts`)
- Providing a REST API for the frontend and external integrators
- Rate limiting and idempotency enforcement

**What the backend does NOT own:**
- On-chain vault state (owned by the contract)
- User wallet keys or signing (owned by the user's Freighter wallet)
- Contract governance or upgrade decisions (owned by `@YieldVault-RWA/contracts-maintainers`)

### 2.3 Contracts

**Owner:** `@YieldVault-RWA/contracts-maintainers` (changes also require `@YieldVault-RWA/security-team`)  
**Source root:** `contracts/`  
**Language:** Rust → WebAssembly (Soroban)

The contracts layer owns all authoritative on-chain state and invariants. Nothing the frontend or backend does can bypass the invariants enforced in contract code. Responsibilities:

- Holding and accounting for deposited USDC, issued `yvUSDC` shares, and accrued yield
- Enforcing deposit/withdrawal constraints (min deposit, per-user cap, large-withdrawal timelock)
- Strategy management and DAO governance
- Protocol fee accounting and timelocked admin parameter changes
- RWA shipment provenance tracking
- Emitting contract events (`deposit`, `pndwdraw`, `withdraw`, `feechg`, `mindepchg`)

**What the contracts do NOT own:**
- Off-chain records or analytics (owned by the backend)
- Webhook delivery (owned by the backend)
- UI presentation (owned by the frontend)

---

## 3. API Flow Maps

### 3.1 Frontend → Backend REST API

The frontend communicates with the backend via the HTTP REST API rooted at `VITE_API_BASE_URL` (default `http://localhost:3000`). The API client lives at `frontend/src/lib/api/client.ts`.

| Frontend action | HTTP call | Backend handler |
|-----------------|-----------|-----------------|
| Index a deposit/withdrawal after on-chain confirmation | `POST /api/v1/vault/deposit` / `POST /api/v1/vault/withdraw` | `vaultEndpoints.ts` |
| Fetch transaction history | `GET /api/v1/transactions?wallet=…` | `transactionEndpoints.ts` |
| Fetch vault summary (APY, TVL, share price) | `GET /api/v1/vault/summary` | `vaultEndpoints.ts` |
| Fetch portfolio / holdings | `GET /api/v1/portfolio/:wallet` | `listEndpoints.ts` |
| Wallet login (nonce + sign) | `POST /api/v1/auth/nonce`, `POST /api/v1/auth/login` | `auth.ts` |
| Refresh JWT | `POST /api/v1/auth/refresh` | `auth.ts` |
| Check backend health | `GET /health` | `healthProbe.ts` |
| Fetch APY history | `GET /api/v1/vault/apy-history` | `apySnapshot.ts` routes in `index.ts` |
| Account statement export | `GET /api/v1/export/statement` | `exportJobs.ts` |
| Referral info | `GET /api/v1/referral/:wallet` | `referralEndpoints.ts` |
| Wallet alias | `GET/POST /api/v1/wallet/alias` | `walletAliasEndpoints.ts` |

**Auth model:** The frontend authenticates using a two-step wallet-sign flow. It first requests a nonce from the backend, then signs it with Freighter, and exchanges the signature for a short-lived JWT. All subsequent API calls include the JWT in `Authorization: Bearer <token>`.

### 3.2 Frontend → Soroban RPC (direct)

Some frontend operations bypass the backend entirely and talk directly to the Stellar Soroban RPC node at `VITE_SOROBAN_RPC_URL`:

| Frontend action | RPC call | Source |
|-----------------|----------|--------|
| Simulate deposit/withdrawal (fee/slippage preview) | `simulateTransaction` | `lib/vaultApi.ts` |
| Submit signed deposit/withdrawal transaction | `sendTransaction` | `lib/vaultApi.ts` → `hooks/useVaultMutations.ts` |
| Read share balance, share price, vault params | `invokeContractFunction` (view calls) | `lib/vaultApi.ts` |
| Check USDC allowance | `invokeContractFunction` (SAC allowance) | `hooks/useTokenAllowance.ts` |

These calls use `@stellar/stellar-sdk` and `@stellar/freighter-api`. The signed transaction XDR is constructed by the frontend, signed by Freighter, and submitted directly to the RPC node — the backend is not in the signing path.

### 3.3 Backend → Soroban RPC (polling & read)

The backend polls Soroban RPC independently to index on-chain events:

| Backend action | RPC call | Source |
|----------------|----------|--------|
| Poll contract events | `getEvents(contractId, startLedger)` | `eventPollingService.ts` |
| Read current vault state (reconciliation) | View invocations | `sorobanClient.ts` |
| Batch-read multiple contract values | `sorobanBatchClient.ts` | `sorobanBatchClient.ts` |

The backend does **not** submit on-chain transactions — it is a read-only observer of the chain. The circuit breaker (`circuitBreaker.ts`) protects the backend from cascading failures when the RPC node is degraded.

---

## 4. Event Flow Map

Contract events emitted on-chain are the source of truth for all off-chain indexing and notifications. The flow from on-chain emission to subscriber webhook delivery is:

```
                    ┌──────────────┐
                    │  YieldVault  │
                    │  Contract    │
                    │  (on-chain)  │
                    └──────┬───────┘
                           │ emits contract event
                           │ (deposit / pndwdraw / withdraw / feechg / mindepchg)
                           ▼
               ┌───────────────────────┐
               │  Stellar Soroban RPC  │
               │  (event ledger)       │
               └──────────┬────────────┘
                          │ getEvents polling (every ~N seconds)
                          ▼
               ┌───────────────────────┐
               │  eventPollingService  │  backend/src/eventPollingService.ts
               │  (Backend)            │
               └──────────┬────────────┘
                          │ persists raw events
                          ▼
               ┌───────────────────────┐
               │  PostgreSQL           │  transactions, events tables
               │  (via Prisma)         │
               └──────────┬────────────┘
                          │ enqueues outbox entry
                          ▼
               ┌───────────────────────┐
               │  eventOutbox          │  backend/src/eventOutbox.ts
               │  (transactional       │  guarantees at-least-once delivery
               │   outbox pattern)     │
               └──────────┬────────────┘
                          │ dequeues & fans out
                          ▼
               ┌───────────────────────┐
               │  webhookDelivery      │  backend/src/webhookDelivery.ts
               │  (Backend)            │  HMAC-SHA256 signed
               └──────────┬────────────┘
                          │ HTTPS POST (with retry + dedup)
                          ▼
               ┌───────────────────────┐
               │  Webhook Subscribers  │
               │  (external services)  │
               └───────────────────────┘
```

**Delivery guarantees:**
- The outbox pattern (`eventOutbox.ts`) ensures an event is not lost between indexing and delivery, even if the delivery worker crashes.
- `webhookDeduplication.ts` prevents duplicate deliveries on retry.
- Failed deliveries are retried with exponential backoff; see [Webhook Integration Guide](./WEBHOOK_INTEGRATION.md) for retry limits and failure modes.

**Frontend notification path (parallel):**
After submitting a transaction, the frontend polls the backend's transaction endpoint (or uses the `usePolling` hook) rather than subscribing to webhooks directly. The frontend has no direct webhook consumer.

---

## 5. Cross-Layer Interface Assumptions

These are the contracts between layers. A violation of any assumption on either side is an integration bug, not a product decision.

### 5.1 Frontend → Backend assumptions

| # | Assumption | Where enforced |
|---|-----------|----------------|
| F1 | Backend returns `application/json` for all REST endpoints. Non-2xx responses include an `error.code` and `error.message` field. | `lib/api/error.ts`, backend `middleware/apiError.ts` |
| F2 | JWT tokens expire; the frontend must handle 401 responses by triggering refresh or re-login. | `lib/api/client.ts` (interceptor), `AuthContext.tsx` |
| F3 | Pagination uses `page` / `pageSize` query params and returns a `data` array plus `pagination.total`. | `lib/transactionQuery.ts`, backend `pagination.ts` |
| F4 | The backend `/health` endpoint returns within 2 seconds and reflects live DB and RPC connectivity. | `hooks/useHealthStatus.ts`, backend `healthProbe.ts` |
| F5 | CORS allows the frontend origin (`VITE_API_BASE_URL` origin). The backend `cors.ts` middleware must include the deployed frontend origin. | `middleware/cors.ts` |
| F6 | The correlation ID header (`X-Correlation-ID`) injected by the frontend is echoed back by the backend in responses and logs. | `components/CorrelationIdSync.tsx`, backend `middleware/correlationId.ts` |
| F7 | Vault summary fields (`totalAssets`, `totalShares`, `sharePrice`, `apy`) are always present in the response (never `null`); loading states are communicated via HTTP status, not missing fields. | backend `vaultEndpoints.ts` |

### 5.2 Backend → Contracts assumptions

| # | Assumption | Where enforced |
|---|-----------|----------------|
| B1 | The contract emits a `deposit` event with `(user, amount, shares)` fields for every successful deposit. The backend indexer depends on this shape. | `eventPollingService.ts` event parser, `contracts/vault/src/lib.rs` |
| B2 | The contract emits a `withdraw` event for completed withdrawals and a `pndwdraw` event when a large-withdrawal timelock is created. | `eventPollingService.ts`, contract `withdraw` / `execute_withdrawal` |
| B3 | Contract function calls revert with typed `VaultError` codes. The backend maps these error codes to HTTP error responses. | `sorobanClient.ts`, [Error Code Catalog](./api/ERROR_CODE_CATALOG.md) |
| B4 | The contract's `total_assets()` and `total_shares()` view functions are always consistent (no in-flight drift between the two). The backend reconciliation job assumes atomic updates. | `positionReconciliationJob.ts`, contract storage layout |
| B5 | The contract admin address is a multi-sig or governance-controlled key. The backend does not hold or rotate this key — it is out of scope for backend ownership. | Deployment config, `@YieldVault-RWA/contracts-maintainers` |
| B6 | Large-withdrawal timelocks are 24 hours. The backend's `withdrawalDailyLimit` middleware and retry logic is calibrated to this window. | `middleware/withdrawalDailyLimit.ts`, contract `LARGE_WITHDRAWAL_DELAY` constant |

### 5.3 Frontend → Contracts assumptions (direct RPC path)

| # | Assumption | Where enforced |
|---|-----------|----------------|
| C1 | `simulate_transaction` returns a fee estimate and the `shares_to_mint` (deposit) or `assets_to_return` (withdrawal) before the user signs. The frontend shows this preview. | `lib/vaultApi.ts` simulation step, `components/TransactionConfirmationModal.tsx` |
| C2 | The contract enforces `min_deposit` on-chain. The frontend validates locally first (form schema) but treats a contract `BelowMinimumDeposit` error as the authoritative rejection. | `forms/schemas/depositFormSchema.ts`, `lib/errorMappers.ts` |
| C3 | The vault contract ID is configured via `VITE_VAULT_CONTRACT_ID`. If this env var is missing or wrong, all transactions will fail silently. Frontend startup must validate this env var. | `frontend/src/config/network.ts`, [ENV Variable Matrix](./ENV_VARIABLE_MATRIX.md) |
| C4 | The USDC token is an SEP-0041 Stellar Asset Contract (SAC). The frontend calls its `approve` function before depositing. If the allowance is already sufficient, the approve step is skipped. | `hooks/useTokenAllowance.ts`, `hooks/useVaultMutations.ts` |
| C5 | Network passphrase (`VITE_STELLAR_NETWORK_PASSPHRASE`) must match the network the contract was deployed to. A mismatch produces invalid transaction signatures. | `frontend/src/config/network.ts`, `NetworkMismatchGuideModal.tsx` |

### 5.4 Backend → Infrastructure assumptions

| # | Assumption | Where enforced |
|---|-----------|----------------|
| I1 | PostgreSQL is available and migrated before the backend starts. A failed DB connection at startup causes the backend to exit (not silently degrade). | `database.ts`, `SERVICE_DEPENDENCY_MATRIX.md` |
| I2 | Redis is available for rate limiting and idempotency. If Redis is unavailable, the backend falls back to in-memory limits (degraded, not offline). | `rateLimiter.ts` fallback logic |
| I3 | The Soroban RPC node is reachable at `STELLAR_RPC_URL`. Unavailability triggers the circuit breaker in `circuitBreaker.ts`; the backend continues serving cached/DB-backed responses. | `circuitBreaker.ts`, `sorobanClient.ts` |
| I4 | Database migrations are applied before the backend API is exposed. Running a new backend image against an un-migrated schema is an error condition covered in the [Deployment Checklist](./DEPLOYMENT_CHECKLIST.md). | `backend/prisma/`, `DEPLOYMENT_CHECKLIST.md` |

---

## 6. API Surface Ownership Table

Who owns each external-facing API surface:

| Surface | Owner team | Auth mechanism | Docs |
|---------|------------|----------------|------|
| REST API (`/api/v1/…`) | `@backend-maintainers` | JWT Bearer / API Key | [api/README.md](./api/README.md) |
| Admin REST endpoints (`/api/v1/admin/…`) | `@backend-maintainers` + `@auth-owner` | JWT + RBAC role `admin` | [api/AUTH_AND_TOKEN_GUIDE.md](./api/AUTH_AND_TOKEN_GUIDE.md) |
| `/health`, `/ready`, `/metrics` | `@reliability-owner` | None (internal network) | [SERVICE_DEPENDENCY_MATRIX.md](./SERVICE_DEPENDENCY_MATRIX.md) |
| Webhook delivery (outbound) | `@integrations-owner` | HMAC-SHA256 signature | [WEBHOOK_INTEGRATION.md](./WEBHOOK_INTEGRATION.md) |
| Soroban contract public functions | `@contracts-maintainers` | Stellar account authorization | [CONTRACTS_ARCHITECTURE.md](./CONTRACTS_ARCHITECTURE.md) |
| Soroban contract events | `@contracts-maintainers` | N/A (on-chain, public) | [WEBHOOK_EVENT_SCHEMA_CATALOG.md](./WEBHOOK_EVENT_SCHEMA_CATALOG.md) |
| Frontend SPA | `@frontend-maintainers` | Freighter wallet session | — |

---

## 7. Keeping This Document Aligned

This document must be updated whenever:

- A new backend API route is added or removed (update §3.1)
- A new contract event type is added (update §4 and the event shape in §5.2)
- A cross-layer assumption changes — e.g., error code format, pagination shape, JWT expiry (update §5)
- Ownership of a module shifts between teams (update §2 and the [CODEOWNERS](../.github/CODEOWNERS) file)
- A new infrastructure dependency is introduced (update §5.4)

PRs that change interface contracts across layers must update this document as part of the same PR. The CODEOWNERS rule for `/docs/` routes these changes to `@YieldVault-RWA/docs-maintainers` for review.

---

**Last updated:** 2026-08-25  
**Issue:** [#1152](https://github.com/Junirezz/YieldVault-RWA/issues/1152)
