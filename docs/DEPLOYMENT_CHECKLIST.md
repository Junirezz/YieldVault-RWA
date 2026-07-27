# Deployment Checklist — YieldVault RWA

**Issue:** #931
**Purpose:** Step-by-step checklists for deploying the YieldVault RWA platform to
**Stellar Testnet** and **Stellar Mainnet**. Each section must be completed in order.
Mark items `[x]` as you verify them. For any item you waive, replace `[ ]` with
`[~]` and add a one-line reason inline.

> **Audience:** Release engineers, DevOps, and on-call engineers responsible for
> deploying or upgrading YieldVault contracts and services.

---

## Table of Contents

- [Pre-Deployment: Common Prerequisites](#pre-deployment-common-prerequisites)
- [Testnet Deployment Checklist](#testnet-deployment-checklist)
- [Mainnet Deployment Checklist](#mainnet-deployment-checklist)
- [Post-Deployment Verification](#post-deployment-verification)
- [Upgrade Checklist](#upgrade-checklist)
- [Rollback Procedures](#rollback-procedures)
- [Emergency Contacts & Escalation](#emergency-contacts--escalation)

---

## Pre-Deployment: Common Prerequisites

These steps apply to **both** testnet and mainnet deployments. Complete them before
proceeding to the environment-specific checklist.

### Toolchain Verification

- [ ] **Stellar CLI** version matches pinned version (`v23.0.1`):
  ```bash
  stellar --version   # or: soroban --version
  ```
- [ ] **Rust toolchain** installed and matches pinned version (`1.79.0`):
  ```bash
  rustc --version
  ```
- [ ] **WASM target** installed:
  ```bash
  rustup target list --installed | grep wasm32-unknown-unknown
  ```
- [ ] **Node.js** version ≥ 20 installed:
  ```bash
  node --version
  ```
- [ ] **jq** available (used by deploy scripts for JSON output):
  ```bash
  jq --version
  ```

### Code Quality Gates

- [ ] All CI workflows pass on the deployment commit:
  - `rust-wasm.yml` — contracts compile to WASM, unit tests pass, fuzz tests pass
  - `rust-security.yml` — `cargo audit` and `cargo deny` clean
  - `backend-governance.yml` — lint, unit tests, API snapshot check pass
  - `frontend.yml` — lint and unit tests pass
  - `slither.yml` — no new High/Medium findings
  - `secret-scanning.yml` — no secrets detected
- [ ] `cargo fmt --all -- --check` passes (no formatting drift)
- [ ] `cargo clippy -p share-price-math --all-targets -- -D warnings` is clean
- [ ] No `TODO` / `FIXME` comments in release-scoped files without a tracking issue
- [ ] `CHANGELOG.md` updated with the release version and date

### Build Artifacts

- [ ] Contracts compile cleanly to WASM:
  ```bash
  cargo build -p vault --target wasm32-unknown-unknown --release
  cargo build -p mock-strategy --target wasm32-unknown-unknown --release
  ```
- [ ] WASM artifacts exist at:
  - `target/wasm32-unknown-unknown/release/vault.wasm`
  - `target/wasm32-unknown-unknown/release/mock_strategy.wasm`
- [ ] (Optional) Optimize WASM for size:
  ```bash
  soroban contract optimize --wasm target/wasm32-unknown-unknown/release/vault.wasm
  ```

### Identity & Secrets

- [ ] Deployer identity configured in Stellar CLI:
  ```bash
  soroban config identity ls
  ```
- [ ] Secret key stored securely — **never committed to version control**
- [ ] `.gitleaks.toml` rules active; `gitleaks detect` returns clean

---

## Testnet Deployment Checklist

> **Network:** Stellar Testnet
> **Passphrase:** `Test SDF Network ; September 2015`
> **RPC Endpoint:** `https://soroban-testnet.stellar.org`

### 1. Fund Deployer Account

- [ ] Deployer account has sufficient testnet XLM for deployment fees:
  ```bash
  node scripts/fund-testnet-account.js
  ```
- [ ] Verify balance via Stellar Laboratory or Horizon API

### 2. Deploy Contracts

- [ ] Run the deployment script targeting testnet:
  ```bash
  ./scripts/deploy_contracts.sh testnet
  ```
- [ ] Deployment output written to `deployments/contracts.testnet.json`
- [ ] Record the deployed contract IDs:

  | Contract | Contract ID |
  |---|---|
  | Vault | `____________________________________` |
  | Mock Strategy | `____________________________________` |

### 3. Initialize Vault

- [ ] Invoke the `initialize` function on the vault contract:
  ```bash
  soroban contract invoke \
    --id <VAULT_CONTRACT_ID> \
    --source <DEPLOYER_IDENTITY> \
    --network testnet \
    -- \
    initialize \
    --admin <ADMIN_ADDRESS> \
    --token <TOKEN_ADDRESS>
  ```
- [ ] Verify initialization succeeded (no error returned)

### 4. Smoke Test (Testnet)

- [ ] Run the CI smoke test script locally or verify it ran in `rust-wasm.yml`:
  ```bash
  bash contracts/vault/scripts/smoke-test.sh
  ```
- [ ] Verify `deposit(100)` → `balance(user) == 100 shares`
- [ ] Verify `version` invocation returns expected contract version

### 5. Backend Deployment (Staging)

- [ ] Backend dependencies installed: `cd backend && npm ci`
- [ ] Database migrations applied: `npx prisma migrate deploy`
- [ ] Environment variables set:

  | Variable | Expected Value |
  |---|---|
  | `NODE_ENV` | `staging` |
  | `DATABASE_URL` | Staging PostgreSQL connection string |
  | `VAULT_CONTRACT_ID` | Testnet contract ID from step 2 |
  | `STELLAR_RPC_URL` | `https://soroban-testnet.stellar.org` |
  | `STELLAR_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` |

- [ ] Backend deployed to staging environment
- [ ] `GET /health` returns `200` with `status: healthy`
- [ ] `GET /ready` returns `200` with `ready: true`

### 6. Frontend Deployment (Staging)

- [ ] Frontend dependencies installed: `cd frontend && npm ci`
- [ ] Frontend environment variables set:

  | Variable | Expected Value |
  |---|---|
  | `VITE_SOROBAN_RPC_URL` | `https://soroban-testnet.stellar.org` |
  | `VITE_STELLAR_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` |
  | `VITE_VAULT_CONTRACT_ID` | Testnet contract ID from step 2 |
  | `VITE_API_BASE_URL` | Staging backend URL |

- [ ] Frontend built: `npm run build`
- [ ] Frontend env validation passes:
  ```bash
  npm run validate:frontend-env -- --strict --check-rpc \
    --deployment-json deployment.json
  ```
- [ ] Frontend deployed to staging (Vercel preview or equivalent)
- [ ] Manual UI verification: dashboard loads, share price displays, wallet connect works

### 7. Integration Testing

- [ ] E2E test suite passes against staging environment
- [ ] Load test results within SLO budgets (P95 latency ≤ 200 ms for read endpoints)
- [ ] Webhook delivery test confirms events are received

---

## Mainnet Deployment Checklist

> **Network:** Stellar Mainnet (Public)
> **Passphrase:** `Public Global Stellar Network ; September 2015`
> **RPC Endpoint:** Production Soroban RPC (e.g., `soroban-mainnet.stellar.org`)

> [!CAUTION]
> Mainnet deployments are **irreversible** for on-chain contract state.
> Complete the full [Testnet Deployment Checklist](#testnet-deployment-checklist)
> and the [Release Readiness Checklist](RELEASE_READINESS_CHECKLIST.md) before
> proceeding.

### 1. Release Readiness Gate

- [ ] `docs/RELEASE_READINESS_CHECKLIST.md` fully completed and signed off
- [ ] Secondary reviewer has approved the release readiness checklist
- [ ] Security reviewer has signed off (if contract changes are included)
- [ ] All testnet smoke tests passed on the same commit

### 2. Fund Deployer Account

- [ ] Deployer account has sufficient **real XLM** for deployment fees
- [ ] Verify mainnet balance via Stellar Expert or Horizon mainnet API
- [ ] Confirm deployer key is the **production** identity (not testnet):
  ```bash
  soroban config identity ls  # should show "production" identity
  ```

### 3. Pre-Deploy Safety Checks

- [ ] **Audit trail:** Git tag (`vX.Y.Z`) created for the release commit:
  ```bash
  git tag v<MAJOR>.<MINOR>.<PATCH>
  git push origin v<MAJOR>.<MINOR>.<PATCH>
  ```
- [ ] **Database backup:** Full production database snapshot taken within the last 2 hours
- [ ] **Maintenance window:** If required, scheduled via `POST /admin/maintenance` and
  communicated to users
- [ ] **On-call engineer identified** and available for 2-hour post-deploy monitoring

### 4. Deploy Contracts (Mainnet)

- [ ] Deploy vault contract to mainnet:
  ```bash
  soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/vault.optimized.wasm \
    --source production \
    --network mainnet
  ```
- [ ] Deploy strategy contract(s) to mainnet:
  ```bash
  soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/mock_strategy.wasm \
    --source production \
    --network mainnet
  ```
- [ ] Record mainnet contract IDs in `deployments/contracts.mainnet.json`

  | Contract | Contract ID |
  |---|---|
  | Vault | `____________________________________` |
  | Strategy | `____________________________________` |

### 5. Initialize Vault (Mainnet)

- [ ] Invoke `initialize` with **production admin address** and **mainnet token address**:
  ```bash
  soroban contract invoke \
    --id <VAULT_CONTRACT_ID> \
    --source production \
    --network mainnet \
    -- \
    initialize \
    --admin <PROD_ADMIN_ADDRESS> \
    --token <MAINNET_TOKEN_ADDRESS>
  ```
- [ ] Verify initialization succeeded
- [ ] Verify contract version via `soroban contract invoke ... -- version`

### 6. Backend Deployment (Production)

- [ ] Database migrations applied to production: `npx prisma migrate deploy`
- [ ] Production environment variables verified against
  `docs/RELEASE_READINESS_CHECKLIST.md` Section 5:

  | Variable | Expected Value |
  |---|---|
  | `NODE_ENV` | `production` |
  | `DATABASE_URL` | Production PostgreSQL with `sslmode=require` |
  | `VAULT_CONTRACT_ID` | Mainnet contract ID from step 4 |
  | `STELLAR_RPC_URL` | Mainnet Soroban RPC endpoint |
  | `STELLAR_NETWORK_PASSPHRASE` | `Public Global Stellar Network ; September 2015` |
  | `CORS_ALLOWED_ORIGINS` | Production domains only (no `localhost`) |
  | `ADMIN_AUDIT_LOG_STORAGE` | `prisma` |
  | `WALLET_NONCE_ENFORCEMENT` | `strict` |
  | `WALLET_SIGNATURE_MODE` | `stellar` |
  | `WEBHOOK_ALLOW_UNVERIFIED` | absent or `false` |

- [ ] Backend deployed to production
- [ ] `GET /health` returns `200` with `status: healthy`
- [ ] `GET /ready` returns `200` with `ready: true`

### 7. Frontend Deployment (Production)

- [ ] Production build triggered by the git tag push (via `production-deploy.yml`)
- [ ] Or manual production build with correct environment variables:

  | Variable | Expected Value |
  |---|---|
  | `VITE_SOROBAN_RPC_URL` | Mainnet Soroban RPC endpoint |
  | `VITE_STELLAR_NETWORK_PASSPHRASE` | `Public Global Stellar Network ; September 2015` |
  | `VITE_VAULT_CONTRACT_ID` | Mainnet contract ID from step 4 |
  | `VITE_API_BASE_URL` | Production backend URL |
  | `VITE_SENTRY_ENVIRONMENT` | `production` |
  | `VITE_FF_DEBUG_MODE` | `false` |
  | `NODE_ENV` | `production` |

- [ ] Vercel production deployment URL confirmed correct
- [ ] Smoke test workflow (`production-deploy.yml` → `smoke-test` job) passed

---

## Post-Deployment Verification

Complete these checks within **10 minutes** of deployment for both testnet and mainnet.

### Health Checks

- [ ] `GET /health` → `200`, `status: healthy`
- [ ] `GET /ready` → `200`, `ready: true`
- [ ] `GET /metrics` → Prometheus endpoint scrapes with no parse errors

### Endpoint Spot-Checks

| Endpoint | Expected | Actual |
|---|---|---|
| `GET /api/v1/vault/summary` | `200`, numeric fields present | |
| `GET /api/v1/transactions?limit=1` | `200`, pagination envelope | |
| `GET /api/v1/vault/apy/history?days=7` | `200`, `count >= 0` | |

### Monitoring & Observability

- [ ] No spike in 5xx error rate compared to pre-deploy baseline
- [ ] P95 latency within SLO budgets (check `endpointSlaRegistry.ts`)
- [ ] All background jobs healthy: `GET /admin/jobs/dashboard`
- [ ] Audit log entry present from the deploy window: `GET /admin/audit-logs`
- [ ] Alert routing verified — test alert fired in staging before mainnet deploy

### Contract Verification

- [ ] Contract version endpoint returns expected version
- [ ] Contract state is consistent (total supply, share price within expected bounds)
- [ ] TTL extension applied if necessary for long-lived contract instances

---

## Upgrade Checklist

For upgrading an already-deployed contract, follow these additional steps:

### Pre-Upgrade

- [ ] Run the upgrade validation script against old and new WASM:
  ```bash
  ./scripts/validate_upgrade.sh <NEW_WASM_PATH> <OLD_WASM_PATH>
  ```
- [ ] Storage layout comparison passed (no key collisions or deletions)
- [ ] Forbidden operations check passed (no `selfdestruct` equivalents)

### Execute Upgrade

1. **Build and optimize** the new WASM (see [Pre-Deployment](#build-artifacts))
2. **Install** the new WASM on the network:
   ```bash
   soroban contract install --wasm <NEW_WASM> --network <NETWORK>
   ```
3. **Pause the vault** (critical safety step):
   ```bash
   soroban contract invoke --id <CONTRACT_ID> --source admin \
     --network <NETWORK> -- set_pause --paused true
   ```
4. **Verify** the vault is paused before proceeding
5. **Execute the upgrade**:
   ```bash
   soroban contract invoke --id <CONTRACT_ID> --source admin \
     --network <NETWORK> -- upgrade --new_wasm_hash <WASM_HASH>
   ```
6. **Verify** the new version:
   ```bash
   soroban contract invoke --id <CONTRACT_ID> --network <NETWORK> -- version
   ```
7. **Resume operations**:
   ```bash
   soroban contract invoke --id <CONTRACT_ID> --source admin \
     --network <NETWORK> -- set_pause --paused false
   ```

### Post-Upgrade

- [ ] Verify contract version returns the new version
- [ ] Run smoke test (deposit → check balance → withdraw)
- [ ] Monitor error rates and latency for 30 minutes post-upgrade
- [ ] Confirm existing user balances and positions are unchanged

---

## Rollback Procedures

### Smart Contract Rollback

> [!WARNING]
> Smart contract state changes are irreversible on-chain. Rollback means
> re-deploying the previous WASM version via the upgrade mechanism.

1. **Pause** the vault immediately:
   ```bash
   soroban contract invoke --id <CONTRACT_ID> --source admin \
     --network <NETWORK> -- set_pause --paused true
   ```
2. **Re-install** the previous WASM version and execute upgrade to the old hash
3. **Verify** the version reverted, then resume operations
4. Open a **post-mortem** issue within 24 hours

### Backend Rollback

1. Revert the Vercel/Railway deployment to the previous version
2. If database migrations are irreversible, execute the rollback SQL script:
   `backend/prisma/migrations/<version>/rollback.sql`
3. Confirm `GET /health` and `GET /ready` return `200`

### Frontend Rollback

1. Revert via Vercel dashboard: `vercel rollback --token $VERCEL_TOKEN`
2. Or re-tag the previous stable version:
   ```bash
   git tag v<PREV_VERSION>-rollback
   git push origin v<PREV_VERSION>-rollback
   ```
3. Verify the production URL serves the previous version

### Rollback Triggers

Initiate rollback if any of the following occur within 30 minutes of deploy:
- `GET /health` returns non-200 for > 2 consecutive minutes
- Error rate on any `tier: critical` endpoint exceeds 5%
- Any `HIGH` severity Sentry alert fires for a new error type
- Contract calls return unexpected errors (overflow, authorization failures)

---

## Emergency Contacts & Escalation

| Role | Contact | Responsibility |
|---|---|---|
| Release Owner | `____________________` | Coordinates the deployment |
| On-Call Engineer | `____________________` | Monitors for 2 hours post-deploy |
| Security Lead | `____________________` | Signs off on contract changes |
| DBA | `____________________` | Database migration support |

### Escalation Path

1. **L1:** On-call engineer investigates and attempts automated rollback
2. **L2:** Release owner escalates to security lead if contract state is affected
3. **L3:** Full incident response per `docs/incident_response_runbook.md`

---

## Related Documents

- [DEPLOYMENT.md](DEPLOYMENT.md) — Quick-reference deployment and upgrade commands
- [RELEASE_READINESS_CHECKLIST.md](RELEASE_READINESS_CHECKLIST.md) — Gate-by-gate release checklist
- [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md) — Smart contract security review
- [RELEASE_VERIFICATION_CHECKLIST.md](RELEASE_VERIFICATION_CHECKLIST.md) — Post-release verification
- [MONITORING_OBSERVABILITY.md](MONITORING_OBSERVABILITY.md) — Observability setup
- [incident_response_runbook.md](incident_response_runbook.md) — Incident response procedures
- [RPC_PROVIDER_FAILOVER_STRATEGY.md](RPC_PROVIDER_FAILOVER_STRATEGY.md) — RPC failover
- [ENV_VARIABLE_MATRIX.md](ENV_VARIABLE_MATRIX.md) — Environment variable reference

---

**Last Updated:** 2026-07-27
**Maintained By:** DevOps / Release Engineering
**Next Review:** Quarterly or after any deployment process change
