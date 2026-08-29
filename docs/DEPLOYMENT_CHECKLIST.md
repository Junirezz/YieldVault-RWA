# 🚀 YieldVault-RWA: Deployment Checklist (Testnet & Mainnet)

**Issues:** [#1146](https://github.com/kingksjo/YieldVault-RWA/issues/1146), [#1060](https://github.com/Junirezz/YieldVault-RWA/issues/1060)  
**Purpose:** A comprehensive, step-by-step deployment checklist covering both **Testnet** and **Mainnet** environments for the YieldVault-RWA stack (smart contracts, backend, frontend, and infrastructure). See also [Release Checklist](./RELEASE_CHECKLIST.md).  
**Last Updated:** August 2026

---

## Table of Contents

1. [How to Use This Checklist](#1-how-to-use-this-checklist)
2. [Environment Overview](#2-environment-overview)
3. [Pre-Deployment Preparation (All Environments)](#3-pre-deployment-preparation-all-environments)
4. [Testnet Deployment Checklist](#4-testnet-deployment-checklist)
5. [Mainnet Deployment Checklist](#5-mainnet-deployment-checklist)
6. [Post-Deployment Verification (All Environments)](#6-post-deployment-verification-all-environments)
7. [Rollback Procedures](#7-rollback-procedures)
8. [Sign-Off & Approvals](#8-sign-off--approvals)
9. [Related Documentation](#9-related-documentation)

---

## 1. How to Use This Checklist

1. **Determine target environment** — Testnet (staging/development) or Mainnet (production).
2. **Work through each section in order.** Mark items `[x]` as you complete them.
3. **For any item you waive**, replace `[ ]` with `[~]` and add a one-line reason inline.
4. **After completing all checks**, obtain sign-off from the appropriate stakeholders (Section 8).
5. **Execute the deployment** following the deployment workflow.
6. **Perform post-deployment verification** (Section 6) within 30 minutes of deployment completion.
7. **File this completed checklist** in the deployment issue or release notes.

### Metadata

| Field | Value |
|-------|-------|
| **Target Environment** | Testnet ☐ / Mainnet ☐ |
| **Release Version / Tag** | |
| **Deployment Date (UTC)** | |
| **Deployment Lead** | |
| **Secondary Reviewer** | |
| **Incident Channel** | |

---

## 2. Environment Overview

### 2.1 Environment Comparison

| Aspect | Testnet | Mainnet |
|--------|---------|---------|
| **Network Name** | `testnet` | `mainnet` |
| **Stellar Network Passphrase** | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` |
| **Soroban RPC URL** | `https://soroban-testnet.stellar.org` | `https://soroban-mainnet.stellar.org` |
| **Horizon URL** | `https://horizon-testnet.stellar.org` | `https://horizon.stellar.org` |
| **Friendbot URL** | `https://friendbot.stellar.org` | N/A (mainnet has no faucet) |
| **Deployment Config File** | `deployments/contracts.testnet.json` | `deployments/contracts.mainnet.json` |
| **CI Trigger** | Push to `main` (`staging-deploy.yml`) | Git tag `v*.*.*` (`production-deploy.yml`) |
| **Contract IDs** | Empty by default, populated on deploy | Empty by default, populated on deploy |
| **XLM Faucet** | Friendbot available | Must purchase XLM from exchange |
| **Frontend URL** | Staging URL (e.g., `yieldvault-staging.vercel.app`) | Production URL (e.g., `yieldvault.finance`) |
| **Backend URL** | Staging backend | Production backend |
| **Monitoring** | Standard dashboards + alerts | Enhanced dashboards + PagerDuty alerts |

### 2.2 Environment-Specific Configurations

#### Testnet

```
Database: PostgreSQL (staging managed service)
Cache: Redis (staging managed service)
RPC: Soroban Testnet (external)
Contracts: Deployed to Testnet
Network Passphrase: Test SDF Network ; September 2015
```

#### Mainnet

```
Database: PostgreSQL (production managed service, multi-region)
Cache: Redis (production managed service, with TLS + ACLs)
RPC: Soroban Mainnet (external, with failover)
Contracts: Deployed to Mainnet
Network Passphrase: Public Global Stellar Network ; September 2015
```

---

## 3. Pre-Deployment Preparation (All Environments)

### 3.1 Toolchain & Build Prerequisites

- [ ] **Verify Rust toolchain**: `rustc --version` — must match pinned version (1.79.0).
- [ ] **Verify Stellar/Soroban CLI**: `stellar --version` or `soroban --version` — must be `v23.0.1`.
- [ ] **Verify WASM target installed**: `rustup target list --installed | grep wasm32-unknown-unknown`.
- [ ] **Clean working tree**: `git status` shows no uncommitted changes.
- [ ] **Node.js version**: `node --version` — must be 20.x.
- [ ] **Install npm dependencies**: `npm ci` in both `backend/` and `frontend/`.

### 3.2 Smart Contract Build & Audit

- [ ] **Run contract unit tests**: `cargo test` — all tests pass (50+ tests).
- [ ] **Run fuzz tests**: `cargo test fuzz_deposit_withdraw_symmetry_no_fee` — 10,000+ iterations pass.
- [ ] **Build WASM artifacts**:
  ```bash
  cargo build --target wasm32-unknown-unknown --release
  ```
- [ ] **Optimize WASM**:
  ```bash
  soroban contract optimize --wasm target/wasm32-unknown-unknown/release/vault.wasm
  ```
- [ ] **Run security checks**: `cargo audit` — zero vulnerabilities.
- [ ] **Run Slither static analysis** (if applicable): `slither . --config-file slither.config.json` — no High/Medium findings.
- [ ] **Run secret scanning**: `scripts/secrets-check.js` — no secrets detected.
- [ ] **Verify storage layout**: `scripts/check_storage_layout.sh` — no layout issues.
- [ ] **Document WASM hashes** for all built artifacts.

### 3.3 Backend Build & Audit

- [ ] **Build TypeScript**: `cd backend && npm run build` — compiles without errors.
- [ ] **Run backend unit tests**: `cd backend && npm test` — all tests pass.
- [ ] **Run linting**: `cd backend && npm run lint` — no errors.
- [ ] **Check database migrations**: `npx prisma migrate status` — all migrations applied.
- [ ] **Verify migration safety**: All migrations are additive (no `DROP COLUMN`, `DROP TABLE` without prior deprecation).
- [ ] **Run migration canary check**: `npm run check:migrations:canary`.
- [ ] **Check schema snapshots**: `npm run snapshots:check` — exits 0.
- [ ] **Verify OpenAPI spec**: `npm run generate:openapi` — produces no diff against committed `backend/openapi.json`.
- [ ] **Run `npm audit`**: zero High severity findings.

### 3.4 Frontend Build & Audit

- [ ] **Build frontend**: `cd frontend && npm run build` — compiles without errors.
- [ ] **Run frontend unit tests**: `cd frontend && npm run test:run` — all tests pass.
- [ ] **Run linting**: `cd frontend && npm run lint` — no errors.
- [ ] **Run bundle size check**: `cd frontend && npm run check-size` — within budget (JS ≤ 450 kB gzip, CSS ≤ 50 kB gzip).
- [ ] **Run E2E tests** (if applicable): Playwright/Cypress tests pass.
- [ ] **Validate frontend env**: `npm run validate:frontend-env -- --strict` — all checks pass.

### 3.5 Environment Variables & Secrets

- [ ] **Verify environment variables** against [`docs/ENV_VARIABLE_MATRIX.md`](./ENV_VARIABLE_MATRIX.md):
  - Backend: `STELLAR_RPC_URL`, `VAULT_CONTRACT_ID`, `DATABASE_URL`, `STELLAR_NETWORK_PASSPHRASE`, `CORS_ALLOWED_ORIGINS`, etc.
  - Frontend: `VITE_SOROBAN_RPC_URL`, `VITE_VAULT_CONTRACT_ID`, `VITE_STELLAR_NETWORK_PASSPHRASE`, `VITE_API_BASE_URL`, etc.
- [ ] **No development defaults leaked**: `NODE_ENV=production`, `STELLAR_NETWORK` matches target.
- [ ] **Secrets rotated if exposed**: If any secret appeared in a commit, PR, or log — rotated before deployment.
- [ ] **`.env.production` not committed**: `git status` confirms no production secret files are tracked.
- [ ] **Run security env check**: `./scripts/verify-env-security.sh` — all checks pass.
- [ ] **Deployer account funded**: Sufficient XLM to cover deployment fees (testnet: use Friendbot; mainnet: purchase XLM).

### 3.6 CI/CD & Workflows

- [ ] **All CI workflows green on target commit**:
  - `backend-governance.yml` — lint, unit tests, API contract snapshot, migration drift check.
  - `frontend.yml` — lint and unit tests.
  - `rust-wasm.yml` — contracts compile to WASM with zero warnings.
  - `rust-security.yml` — `cargo audit` and `cargo deny` pass.
  - `slither.yml` — no new High/Medium findings.
  - `secret-scanning.yml` — no secrets detected.
  - `e2e.yml` / `cypress.yml` — all end-to-end scenarios green (staging only).
  - `integration-smoke.yml` — `GET /health` and `GET /ready` return 200.
  - `load-tests.yml` — P95 latency within SLO budgets.
- [ ] **Secret scanning pre-commit hook active**: `.husky/pre-commit` runs `scripts/secrets-check.js`.

### 3.7 Documentation & Change Log

- [ ] **`CHANGELOG.md` updated**: `[Unreleased]` section promoted to the release version with today's date.
- [ ] **Release notes prepared** (for mainnet): Follow `docs/release-notes-playbook.md`.
- [ ] **Runbooks reviewed**: Relevant runbooks updated if deployment procedures changed.

---

## 4. Testnet Deployment Checklist

### 4.1 Pre-Flight Checks (Testnet)

- [ ] **Network confirmed**: Target is `testnet` (`SOROBAN_NETWORK=testnet`).
- [ ] **Deployer identity configured**: `soroban config identity ls` shows the deployer identity.
- [ ] **Deployer funded**: `soroban account balance --network testnet` — sufficient XLM (at least 50 XLM recommended).
- [ ] **Contract config files prepared**: `deployments/contracts.testnet.json` has empty contract IDs.
- [ ] **Staging environment accessible**: Staging backend and frontend URLs available.

### 4.2 Smart Contract Deployment (Testnet)

Run the automated deployment script or execute manually:

- [ ] **Option A — Automated (CI)**:
  Ensure `staging-deploy.yml` is triggered by pushing to `main`. The workflow:
  1. Builds WASM artifacts.
  2. Deploys contracts via `scripts/deploy_contracts.sh testnet`.
  3. Records contract IDs to `deployments/contracts.testnet.json`.

- [ ] **Option B — Manual**:
  ```bash
  ./scripts/deploy_contracts.sh testnet
  ```
  - [ ] Verify `deployments/contracts.testnet.json` is populated:
    ```json
    {
      "network": "testnet",
      "deployed_at": "2026-07-28T12:00:00Z",
      "identity": "staging",
      "contracts": {
        "vault": "C...",
        "mock_korean_strategy": "C..."
      }
    }
    ```

- [ ] **Initialize the Vault**:
  ```bash
  soroban contract invoke \
    --id <VAULT_CONTRACT_ID> \
    --source deployer \
    --network testnet \
    -- \
    initialize \
    --admin <ADMIN_ADDRESS> \
    --token <USDC_TOKEN_ADDRESS>
  ```

- [ ] **Verify initialization**:
  ```bash
  soroban contract invoke --id <VAULT_CONTRACT_ID> --network testnet -- version
  soroban contract invoke --id <VAULT_CONTRACT_ID> --network testnet -- total_assets
  ```
  Expected: `version` returns the contract version, `total_assets` returns 0.

### 4.3 Backend Deployment (Testnet)

- [ ] **Deploy backend** to staging environment:
  ```bash
  cd backend
  npm ci
  npx prisma migrate deploy
  ```
- [ ] **Verify backend health**: `curl https://staging-backend.yieldvault.finance/health` — returns `{"status": "healthy"}`.
- [ ] **Verify backend readiness**: `curl https://staging-backend.yieldvault.finance/ready` — returns `{"ready": true}`.
- [ ] **Confirm contract ID configured**: Backend `VAULT_CONTRACT_ID` matches deployed testnet contract ID.
- [ ] **Confirm RPC URL configured**: `STELLAR_RPC_URL=https://soroban-testnet.stellar.org`.
- [ ] **Confirm network passphrase**: `STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015`.

### 4.4 Frontend Deployment (Testnet)

- [ ] **Deploy frontend** to staging environment:
  ```bash
  cd frontend
  npm ci
  npm run build
  ```
- [ ] **Verify frontend loads**: Navigate to staging URL — no blocking console/runtime errors.
- [ ] **Confirm frontend env vars**:
  - `VITE_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org`
  - `VITE_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015`
  - `VITE_VAULT_CONTRACT_ID=<deployed_testnet_contract_id>`
  - `VITE_API_BASE_URL=<staging_backend_url>`

### 4.5 Integration & Smoke Tests (Testnet)

- [ ] **Fund test wallet**: Run `node scripts/fund-testnet-account.js` with `TESTNET_SECRET_KEY`.
- [ ] **Connect wallet**: Freighter connects to Testnet with correct network passphrase.
- [ ] **Deposit flow**: Perform deposit from UI — transaction confirms, balance updates.
- [ ] **Withdraw flow**: Perform withdrawal from UI — transaction confirms, balance updates.
- [ ] **Share price display**: Dashboard shows valid share price.
- [ ] **TVL display**: Dashboard shows correct Total Value Locked.
- [ ] **Transaction history**: Transactions appear in history with correct status.
- [ ] **Backend smoke tests**:
  - [ ] `GET /health` returns 200.
  - [ ] `GET /ready` returns 200.
  - [ ] `GET /api/v1/vault/summary` returns valid data.
  - [ ] `GET /api/v1/transactions?limit=1` returns pagination envelope.
- [ ] **Validate frontend env against deployment**: `npm run validate:frontend-env -- --strict --check-rpc --deployment-json deployment.json`.

---

## 5. Mainnet Deployment Checklist

### 5.1 Governance & Approvals (Mainnet)

> **⚠️ IMPORTANT:** Mainnet deployment requires additional governance and security reviews beyond the standard CI checks.

- [ ] **Release readiness checklist completed**: `docs/RELEASE_READINESS_CHECKLIST.md` fully signed off.
- [ ] **Release verification checklist completed**: `docs/RELEASE_VERIFICATION_CHECKLIST.md` fully signed off.
- [ ] **Security audit completed**: External audit performed for major releases; all findings addressed.
- [ ] **Internal security review completed**: `docs/SECURITY_CHECKLIST.md` reviewed and signed off.
- [ ] **Production security checklist completed**: `docs/PRODUCTION_SECURITY_CHECKLIST.md` reviewed and signed off.
- [ ] **Threat model reviewed**: `docs/THREAT_MODEL.md` — no new threats introduced.
- [ ] **DAO threshold raised** (if applicable): `DaoThreshold` set to appropriate mainnet value (not testnet default of 1).
- [ ] **Large withdrawal threshold configured**: Set to appropriate mainnet value based on strategy liquidation times.
- [ ] **Per-user cap configured**: Set to appropriate mainnet value.
- [ ] **Minimum deposit configured**: Set to appropriate mainnet value.
- [ ] **Oracle validated** (if enabled): Oracle contract address configured and heartbeat set.
- [ ] **Protocol fee configured**: `FeeBps` set to production value.
- [ ] **Treasury address configured**: Production treasury address set.
- [ ] **Admin keys secured**: Admin account uses hardware security module (HSM) or multisig.
- [ ] **Emergency approvers configured**: Primary and secondary emergency approver addresses set (distinct entities).

### 5.2 Pre-Flight Checks (Mainnet)

> **⚠️ CRITICAL:** The following checks must pass before any mainnet deployment command is executed.

- [ ] **Network confirmed**: Target is `mainnet` (`STELLAR_NETWORK=mainnet`, `SOROBAN_NETWORK=mainnet`).
- [ ] **Deployer identity configured**: `soroban config identity ls` shows mainnet identity.
- [ ] **Deployer funded**: Sufficient XLM for deployment fees (at least 200 XLM recommended for mainnet).
- [ ] **Contract config files prepared**: `deployments/contracts.mainnet.json` has empty contract IDs.
- [ ] **Release tag prepared**: Git tag `v<MAJOR>.<MINOR>.<PATCH>` created and pushed.
- [ ] **Database backup taken**: Full snapshot of production database within 2 hours before deployment.
- [ ] **Database migration rollback plan documented**: Any irreversible migrations have rollback scripts.
- [ ] **Drain window communicated**: Maintenance window scheduled and users notified (if required).
- [ ] **On-call engineer identified**: Name and contact for 2-hour post-deploy monitoring window.
- [ ] **Incident channel active**: `#yieldvault-incidents` Slack channel monitored.

### 5.3 Smart Contract Deployment (Mainnet)

#### 5.3.1 Fresh Deployment

- [ ] **Build and optimize WASM** (pinned toolchain: Rust 1.79.0, Stellar CLI v23.0.1):
  ```bash
  cargo build --target wasm32-unknown-unknown --release
  soroban contract optimize --wasm target/wasm32-unknown-unknown/release/vault.wasm
  ```
- [ ] **Record WASM hash**: `sha256sum target/wasm32-unknown-unknown/release/vault.optimized.wasm`.
- [ ] **Deploy contract**:
  ```bash
  soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/vault.optimized.wasm \
    --source deployer \
    --network mainnet
  ```
- [ ] **Record contract ID** in `deployments/contracts.mainnet.json`.
- [ ] **Initialize the Vault**:
  ```bash
  soroban contract invoke \
    --id <VAULT_CONTRACT_ID> \
    --source deployer \
    --network mainnet \
    -- \
    initialize \
    --admin <ADMIN_ADDRESS> \
    --token <USDC_MAINNET_TOKEN_ADDRESS>
  ```
- [ ] **Verify initialization**:
  ```bash
  soroban contract invoke --id <VAULT_CONTRACT_ID> --network mainnet -- version
  soroban contract invoke --id <VAULT_CONTRACT_ID> --network mainnet -- total_assets
  ```

#### 5.3.2 Upgrade (If Contract Already Deployed)

- [ ] **Follow contract upgrade playbook**: `docs/runbooks/CONTRACT_UPGRADE_PLAYBOOK.md`.
- [ ] **Pause vault**: `soroban contract invoke --id <ID> --source admin --network mainnet -- set_pause --paused true`.
- [ ] **Install new WASM**: `soroban contract install --wasm <NEW_WASM> --network mainnet`.
- [ ] **Execute upgrade**: `soroban contract invoke --id <ID> --source admin --network mainnet -- upgrade --new_wasm_hash <HASH>`.
- [ ] **Verify version**: `soroban contract invoke --id <ID> --network mainnet -- version`.
- [ ] **Resume operations**: `soroban contract invoke --id <ID> --source admin --network mainnet -- set_pause --paused false`.

### 5.4 Backend Deployment (Mainnet)

- [ ] **Run database migrations**:
  ```bash
  cd backend
  npx prisma migrate deploy
  ```
- [ ] **Deploy backend** to production environment (Railway / Render / Docker / etc.).
- [ ] **Verify backend health**: `curl https://api.yieldvault.finance/health` — returns `{"status": "healthy"}`.
- [ ] **Verify backend readiness**: `curl https://api.yieldvault.finance/ready` — `{"ready": true}`.
- [ ] **Confirm contract ID**: `VAULT_CONTRACT_ID` matches deployed mainnet contract ID.
- [ ] **Confirm RPC URL**: `STELLAR_RPC_URL=https://soroban-mainnet.stellar.org`.
- [ ] **Confirm network passphrase**: `STELLAR_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015`.
- [ ] **Confirm CORS allowed origins**: `CORS_ALLOWED_ORIGINS` set to production domains only (no `localhost`, no `*`).
- [ ] **Confirm wallet signature mode**: `WALLET_SIGNATURE_MODE=stellar` (not `hmac`).
- [ ] **Confirm wallet nonce enforcement**: `WALLET_NONCE_ENFORCEMENT=strict`.
- [ ] **Confirm webhook verification**: `WEBHOOK_ALLOW_UNVERIFIED` absent or `false`.
- [ ] **Confirm alert routing active**: `ALERT_TYPE` set with `SLACK_WEBHOOK_URL` and/or `PAGERDUTY_INTEGRATION_KEY`.
- [ ] **Confirm audit log storage**: `ADMIN_AUDIT_LOG_STORAGE=prisma` (not `memory`).
- [ ] **Confirm Redis URL**: `REDIS_URL` configured for production Redis with TLS and ACLs.

### 5.5 Frontend Deployment (Mainnet)

The frontend deployment is triggered automatically by `production-deploy.yml` when a git tag is pushed:

```bash
git tag v<MAJOR>.<MINOR>.<PATCH>
git push origin v<MAJOR>.<MINOR>.<PATCH>
```

This triggers → `production-deploy.yml` → frontend CI → frontend build → Vercel deploy → smoke test → deployment summary.

#### Manual Steps (If Not Using CI):

- [ ] **Build frontend** with production environment variables:
  ```bash
  cd frontend
  VITE_SOROBAN_RPC_URL=https://soroban-mainnet.stellar.org \
  VITE_STELLAR_NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015" \
  VITE_VAULT_CONTRACT_ID=<mainnet_contract_id> \
  VITE_API_BASE_URL=https://api.yieldvault.finance \
  VITE_SENTRY_DSN=<sentry_dsn> \
  VITE_SENTRY_ENVIRONMENT=production \
  NODE_ENV=production \
  npm run build
  ```
- [ ] **Validate frontend env**: `npm run validate:frontend-env -- --strict --check-rpc`.
- [ ] **Deploy to Vercel**:
  ```bash
  vercel deploy --prebuilt --prod --token=$VERCEL_TOKEN
  ```
- [ ] **Verify deployment**: Check Vercel deployment URL returns HTTP 200.

### 5.6 Security Hardening (Mainnet Only)

- [ ] **API key persistence**: API keys stored in DB with hashed secrets (not in-memory `Map`).
- [ ] **CORS enforced**: Exact origin matching; no `*` or broad regex patterns.
- [ ] **Logging sanitizer active**: Secrets and PII redacted before emission.
- [ ] **Rate limiting applied**: All public endpoints covered by appropriate rate-limiter tier.
- [ ] **JWT secrets in KMS**: JWT signing uses KMS/HSM-backed key (not plain-text `JWT_SECRET`).
- [ ] **Deploy keys short-lived**: CI/CD uses ephemeral credentials with least privilege.
- [ ] **Production security checklist verified**: `docs/PRODUCTION_SECURITY_CHECKLIST.md` all items signed off.

### 5.7 Monitoring & Observability (Mainnet)

- [ ] **SLA registry up to date**: New endpoints registered in `src/endpointSlaRegistry.ts`.
- [ ] **Prometheus metrics**: `/metrics` endpoint scrapes cleanly with no parse errors.
- [ ] **Grafana dashboards**: All critical dashboards (API latency, error rate, chain/indexer lag) configured.
- [ ] **Sentry configured**: `VITE_SENTRY_DSN`, `SENTRY_AUTH_TOKEN` set; error tracking active.
- [ ] **Alerting configured**: `ALERT_TYPE`, `SLACK_WEBHOOK_URL`, `PAGERDUTY_INTEGRATION_KEY` set.
- [ ] **Test alert fired**: Test alert successfully sent to Slack/PagerDuty from staging.
- [ ] **Dead-letter queue empty**: `GET /admin/webhooks/dead-letter` returns empty list.
- [ ] **Health endpoint returns `healthy`**: On production URL.
- [ ] **Readiness endpoint returns `ready: true`**: All dependencies up.

---

## 6. Post-Deployment Verification (All Environments)

### 6.1 Immediate (Within 10 Minutes)

- [ ] **Critical endpoint spot-check**:

  | Endpoint | Expected | Actual |
  |---|---|---|
  | `GET /health` | `200`, `status: healthy` | |
  | `GET /ready` | `200`, `ready: true` | |
  | `GET /api/v1/vault/summary` | `200`, numeric fields | |
  | `GET /api/v1/transactions?limit=1` | `200`, pagination envelope | |
  | `GET /api/v1/vault/apy/history?days=7` | `200`, `count >= 0` | |

- [ ] **Frontend loads**: No blocking console errors (check browser DevTools).
- [ ] **Wallet connect works**: Freighter detects correct network.
- [ ] **Deposit form functional**: Form validates inputs, simulation succeeds.
- [ ] **Withdraw form functional**: Form validates inputs, simulation succeeds.
- [ ] **Share price displays**: Dashboard shows valid, non-zero share price.
- [ ] **TVL displays**: Dashboard shows Total Value Locked (should be 0 for fresh mainnet deploy).

### 6.2 Extended (Within 30 Minutes)

- [ ] **Error rate unchanged**: Check Prometheus/Grafana — no spike in 5xx responses vs pre-deploy baseline.
- [ ] **Latency within SLO**: P95 for critical endpoints within budgets.
- [ ] **No runaway background jobs**: APY snapshot, idempotency retention, event polling healthy.
- [ ] **Audit log entries present**: `GET /admin/audit-logs` shows entries from deploy window.
- [ ] **GitHub Release created** (mainnet): `release.yml` generated the GitHub Release with auto-updated `CHANGELOG.md`.
- [ ] **Deployment summary posted** (mainnet): Production URL and version in release notes.

### 6.3 Contracts-Specific Verification

- [ ] **Contract version** matches expected release version.
- [ ] **Pause status**: `false` (vault is operational).
- [ ] **`total_assets()`** matches pre-deployment snapshot (for upgrades).
- [ ] **`total_shares()`** matches pre-deployment snapshot (for upgrades).
- [ ] **`admin()`** returns correct admin address.
- [ ] **Deposit/withdraw smoke tests**: Small test deposit and withdrawal succeed.
- [ ] **Events emitted**: `deposit`, `withdraw` events visible via Soroban RPC.
- [ ] **Contract ID documented**: Updated in deployment config and release metadata.

### 6.4 Backend-Specific Verification

- [ ] **Database connectivity** verified.
- [ ] **Stellar RPC connectivity** verified (correct network).
- [ ] **Cache connectivity** verified (Redis).
- [ ] **Background workers connected**: Event polling, APY snapshot, idempotency cleanup.
- [ ] **Error rate baseline**: < 1% for all `tier: critical` endpoints.

### 6.5 Frontend-Specific Verification

- [ ] **App builds successfully** in production mode.
- [ ] **No blocking console/runtime errors** on load.
- [ ] **API base URL** points to intended backend.
- [ ] **Network badge** (if present) shows correct environment.
- [ ] **Responsive layout**: No critical breakage on desktop + mobile widths.
- [ ] **Accessibility quick pass**: Keyboard navigation, focus visibility, labels.

---

## 7. Rollback Procedures

### 7.1 Rollback Triggers

Initiate rollback if any of the following occur within 30 minutes of deployment:

- `GET /health` returns non-200 for > 2 consecutive minutes.
- Error rate on any `tier: critical` endpoint exceeds 5%.
- Any `HIGH` Sentry alert fires for a new error type.
- Contract upgrade verification fails (version mismatch, state corruption).
- Deposit or withdrawal transactions revert unexpectedly on mainnet.

### 7.2 Smart Contract Rollback

#### Option A: Revert to Previous WASM Hash

```bash
# Keep vault paused
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network <network> \
  -- upgrade --new_wasm_hash <PREVIOUS_WASM_HASH>
```

#### Option B: Deploy Separate Fallback Contract

1. Deploy a new contract instance from the previous stable binary.
2. Update off-chain configurations (frontend, backend, monitoring) to point to fallback contract ID.
3. Notify users and operators of the new contract address.

### 7.3 Backend Rollback

```bash
# Quick rollback (5 minutes)
sudo systemctl stop yieldvault-backend
cd /app/yieldvault-backend
git checkout <PREVIOUS_STABLE_COMMIT>
npm ci --production
npm run build
sudo systemctl start yieldvault-backend
```

- If migrations were applied and are irreversible, execute the rollback SQL script at `backend/prisma/migrations/<version>/rollback.sql`.

### 7.4 Frontend Rollback

```bash
# Vercel rollback
vercel rollback --token $VERCEL_TOKEN

# Or re-deploy previous version
vercel deploy --prebuilt --prod --token=$VERCEL_TOKEN
```

### 7.5 Post-Rollback Steps

- [ ] Confirm `GET /health` and `GET /ready` return 200 after rollback.
- [ ] Confirm frontend loads correctly.
- [ ] Confirm contract pause status is correct.
- [ ] Open a post-mortem issue within 24 hours.
- [ ] Document root cause and corrective actions.

---

## 8. Sign-Off & Approvals

### Testnet Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Deployment Lead | | | |
| Secondary Reviewer | | | |
| QA Engineer | | | |

### Mainnet Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Release Owner | | | |
| Security Reviewer | | | |
| Backend Owner | | | |
| Frontend Owner | | | |
| Contract Owner | | | |
| QA/Release Manager | | | |
| DevOps Lead | | | |

---

## 9. Related Documentation

### Deployment & Operations
- [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md) — Deployment & operations runbook for smart contracts
- [`docs/RELEASE_READINESS_CHECKLIST.md`](./RELEASE_READINESS_CHECKLIST.md) — Release readiness gate checklist
- [`docs/RELEASE_VERIFICATION_CHECKLIST.md`](./RELEASE_VERIFICATION_CHECKLIST.md) — Release verification checklist
- [`scripts/deploy_contracts.sh`](../scripts/deploy_contracts.sh) — Automated contract deployment script
- [`contracts/vault/DEPLOYMENT.md`](../contracts/vault/DEPLOYMENT.md) — Vault-specific deployment guide

### Environment & Configuration
- [`docs/ENV_VARIABLE_MATRIX.md`](./ENV_VARIABLE_MATRIX.md) — Complete environment variable reference
- [`ENV_SETUP_README.md`](../ENV_SETUP_README.md) — Environment setup instructions
- [`ENV_QUICK_REFERENCE.md`](../ENV_QUICK_REFERENCE.md) — Quick env variable reference
- [`ENVIRONMENT_SETUP_GUIDE.md`](../ENVIRONMENT_SETUP_GUIDE.md) — Comprehensive environment setup guide
- [`SECURITY_ENV_CHECKLIST.md`](../SECURITY_ENV_CHECKLIST.md) — Pre-deployment security env checklist
- [`docs/SERVICE_DEPENDENCY_MATRIX.md`](./SERVICE_DEPENDENCY_MATRIX.md) — Service dependency reference

### Security
- [`docs/PRODUCTION_SECURITY_CHECKLIST.md`](./PRODUCTION_SECURITY_CHECKLIST.md) — Production security checklist
- [`docs/SECURITY_CHECKLIST.md`](./SECURITY_CHECKLIST.md) — Smart contract security review guide
- [`docs/THREAT_MODEL.md`](./THREAT_MODEL.md) — Threat model & trust boundaries
- [`README_SECURITY.md`](../README_SECURITY.md) — Security overview

### Runbooks
- [`docs/runbooks/CONTRACT_UPGRADE_PLAYBOOK.md`](./runbooks/CONTRACT_UPGRADE_PLAYBOOK.md) — Contract upgrade & migration
- [`docs/runbooks/BACKEND_REDEPLOY.md`](./runbooks/BACKEND_REDEPLOY.md) — Backend redeployment
- [`docs/runbooks/RPC_FAILOVER.md`](./runbooks/RPC_FAILOVER.md) — RPC provider failover
- [`docs/runbooks/FULL_DR_PROCEDURE.md`](./runbooks/FULL_DR_PROCEDURE.md) — Full disaster recovery
- [`docs/runbooks/DATABASE_RESTORE.md`](./runbooks/DATABASE_RESTORE.md) — Database restoration
- [`docs/runbooks/README.md`](./runbooks/README.md) — Runbook index

### CI/CD
- `.github/workflows/production-deploy.yml` — Production deployment workflow
- `.github/workflows/staging-deploy.yml` — Staging deployment workflow
- `.github/workflows/rust-wasm.yml` — Rust + WASM CI with testnet deploy
- `.github/workflows/README.md` — CI workflow index

### Architecture & Design
- [`docs/CONTRACTS_ARCHITECTURE.md`](./CONTRACTS_ARCHITECTURE.md) — Contracts architecture overview
- [`docs/DEPOSIT_WITHDRAWAL_LIFECYCLE.md`](./DEPOSIT_WITHDRAWAL_LIFECYCLE.md) — Deposit/withdrawal lifecycle
- [`docs/DEFINITION_OF_DONE.md`](./DEFINITION_OF_DONE.md) — Definition of Done for features
- [`docs/QUALITY_GATES_MATRIX.md`](./QUALITY_GATES_MATRIX.md) — Quality gates by component criticality
- [`docs/NFR_BASELINES.md`](./NFR_BASELINES.md) — Non-functional requirement baselines

---

> **This checklist must be completed and signed off before any production deployment.**
>
> *See [`docs/RELEASE_READINESS_CHECKLIST.md`](./RELEASE_READINESS_CHECKLIST.md) for the release readiness gate process.*
