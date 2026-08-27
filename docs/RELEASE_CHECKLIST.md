# 🚀 YieldVault-RWA: Release Checklist (Testnet & Mainnet)

**Issues:** [#1146](https://github.com/kingksjo/YieldVault-RWA/issues/1146), [#1060](https://github.com/kingksjo/YieldVault-RWA/issues/1060)  
**Purpose:** A formal, standardized release checklist covering preflight verification, environment-specific deployment procedures, post-deployment validation, rollback triggers, and multi-disciplinary sign-off for **Testnet (Staging)** and **Mainnet (Production)**.  
**Maintained By:** Release Engineering & Operations  

---

## 1. How to Use This Checklist

1. **Target Environment Selection**: Identify whether this release is for Testnet (staging) or Mainnet (production).
2. **Sequential Execution**: Complete each section in order. Check items `[x]` upon verification.
3. **Waivers**: If an item is not applicable or waived, replace `[ ]` with `[~]` and document the rationale inline.
4. **Sign-Off Gate**: Obtain all mandatory signatures from Engineering and Operations leads (Section 7) prior to tagging production or applying migrations.
5. **Post-Deployment Verification**: Complete Section 5 within 30 minutes of deployment.
6. **Filing**: Attach the filled checklist to the GitHub Release or release tracking ticket.

### Release Metadata

| Metadata Field | Value |
|----------------|-------|
| **Target Environment** | `[ ] Testnet` / `[ ] Mainnet` |
| **Release Version / Git Tag** | `v...` |
| **Target Commit Hash** | `...` |
| **Deployment Lead** | `@username` |
| **Secondary Reviewer** | `@username` |
| **DevOps / Ops Lead** | `@username` |
| **Deployment Window (UTC)** | `YYYY-MM-DD HH:MM UTC` |
| **Incident War Room** | `#yieldvault-war-room` / `#yieldvault-incidents` |

---

## 2. Environment Matrix & Configuration Guidance

| Configuration Item | Testnet (Staging) | Mainnet (Production) |
|--------------------|-------------------|----------------------|
| **Network Name** | `testnet` | `mainnet` |
| **Passphrase** | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` |
| **Soroban RPC URL** | `https://soroban-testnet.stellar.org` | `https://soroban-mainnet.stellar.org` (with failover) |
| **Horizon API URL** | `https://horizon-testnet.stellar.org` | `https://horizon.stellar.org` |
| **Deployer Funding** | Stellar Friendbot faucet | Dedicated cold/warm operations wallet (> 200 XLM) |
| **Admin Key Model** | Dedicated staging keypair | Multi-signature (3-of-5) or Hardware Security Module (HSM) |
| **Emergency Approvers** | Staging ops key | Multi-party distinct emergency approvers |
| **Contract Config** | `deployments/contracts.testnet.json` | `deployments/contracts.mainnet.json` |
| **Backend DB** | Staging PostgreSQL (managed) | Production HA PostgreSQL (multi-AZ, automated backups) |
| **Backend Cache** | Staging Redis | Production Redis (TLS + ACL enabled) |
| **Frontend Base URL** | `https://staging.yieldvault.finance` | `https://yieldvault.finance` |
| **Backend Base URL** | `https://staging-api.yieldvault.finance` | `https://api.yieldvault.finance` |
| **Alerting Destination** | Slack `#staging-alerts` | PagerDuty + Slack `#yieldvault-incidents` |

---

## 3. Preflight Checklist (All Environments)

### 3.1 Toolchains & Shared Packages
- [ ] **Shared Schemas Built**: `cd packages/api-schemas && npm ci && npm run build` (Ensures `@yieldvault/api-schemas` is up to date).
- [ ] **Rust Toolchain**: `rustc --version` matches pinned toolchain (`rust-toolchain.toml`).
- [ ] **WASM Target Installed**: `rustup target list --installed | grep wasm32-unknown-unknown`.
- [ ] **Soroban CLI Version**: `stellar --version` or `soroban --version` verified against pinned version.
- [ ] **Node.js Runtime**: `node --version` is Node 20.x.
- [ ] **Clean Working Tree**: `git status` clean with no untracked or modified artifacts.

### 3.2 Smart Contracts Preflight
- [ ] **Unit Tests**: `cargo test` passes for all crates (`vault`, `mock-strategy`, `share-price-math`).
- [ ] **Share Price Math Formatting & Clippy**:
  - `cargo fmt --all -- --check` passes.
  - `cargo clippy -p share-price-math --all-targets -- -D warnings` passes.
- [ ] **Fuzz Testing**: `share-price-math` fuzz target runs with zero regressions.
- [ ] **Storage Layout**: Storage layout verified against `docs/storage-layout-reference.md`.
- [ ] **WASM Optimization**: Contract WASM built and optimized (`soroban contract optimize`).
- [ ] **Hash Computation**: SHA256 checksums of release WASM binaries recorded.

### 3.3 Backend Preflight
- [ ] **Linting**: `cd backend && npm run lint` exits 0.
- [ ] **Unit & Integration Tests**: `cd backend && npm test` (with `maxWorkers: 1`) passes all test suites.
- [ ] **Governance & Snapshot Checks**:
  - `npm run snapshots:check` exits 0.
  - `npm run generate:openapi` produces no uncommitted diff against `backend/openapi.json`.
  - `npm run check:migrations:canary` verifies schema compatibility.
- [ ] **Migration Safety**: All Prisma migrations verified to be non-destructive (additive changes only; no uncoordinated drops).
- [ ] **Rollback SQL Script**: Reversible migration rollback scripts documented at `backend/prisma/migrations/<version>/rollback.sql`.

### 3.4 Frontend Preflight
- [ ] **Linting**: `cd frontend && npm run lint` passes with no errors.
- [ ] **Unit Tests**: `cd frontend && npm run test:run` completes with 100% passing suites.
- [ ] **Typecheck & Production Build**: `cd frontend && npm run build` (`tsc -b && vite build`) completes cleanly.
- [ ] **Bundle Size Budget**: `npm run check-size` confirms JS bundle ≤ 450 kB gzip, CSS ≤ 50 kB gzip.
- [ ] **Environment Validation**: `npm run validate:frontend-env -- --strict` passes for target environment.

### 3.5 Security, Environment & Secrets
- [ ] **Secrets Scan**: Pre-commit / CI secret check (`scripts/secrets-check.js`) passes.
- [ ] **Security Audits**:
  - `cargo audit` zero high/critical vulnerabilities.
  - `npm audit --audit-level=high` zero unmitigated high findings.
- [ ] **Environment Variables Audit**: Target environment variables verified against `docs/ENV_VARIABLE_MATRIX.md`.
- [ ] **Deployer Balance**: Deployer wallet funded with sufficient native XLM for transaction fees.

### 3.6 CI/CD Release Workflows
- [ ] **CI Pipeline Status**: All target branch workflows green:
  - `backend-governance.yml`
  - `frontend.yml`
  - `rust-wasm.yml`
  - `rust-security.yml`
  - `secret-scanning.yml`
  - `e2e.yml` (staging)

---

## 4. Deployment Procedures

### 4.1 Testnet (Staging) Deployment Flow
1. **Contract Deployment**:
   ```bash
   ./scripts/deploy_contracts.sh testnet
   ```
   - Update `deployments/contracts.testnet.json` with newly deployed contract IDs.
2. **Contract Initialization**:
   - Initialize vault instance with admin address and testnet USDC token contract.
   - Verify: `soroban contract invoke --id <VAULT_ID> --network testnet -- version`.
3. **Backend Deployment**:
   - Apply Prisma migrations: `npx prisma migrate deploy`.
   - Start backend service with `VAULT_CONTRACT_ID` set.
   - Verify health: `curl -f https://staging-api.yieldvault.finance/health`.
4. **Frontend Deployment**:
   - Deploy build artifact to staging environment (Vercel/Cloudflare).
   - Verify staging URL loads with correct network configuration.

### 4.2 Mainnet (Production) Deployment Flow
1. **Change Window & Notice**: Announce scheduled release window in `#yieldvault-incidents` and status channels.
2. **Database Backup**: Take a manual, verified snapshot of the production PostgreSQL database.
3. **Contract Upgrade / Deployment**:
   - **For Upgrades**: Follow `docs/runbooks/CONTRACT_UPGRADE_PLAYBOOK.md`:
     1. Set pause: `soroban contract invoke --id <VAULT_ID> --source admin --network mainnet -- set_pause --paused true`.
     2. Install new WASM: `soroban contract install --wasm <OPTIMIZED_WASM> --network mainnet`.
     3. Execute upgrade via multisig: `soroban contract invoke --id <VAULT_ID> --source admin --network mainnet -- upgrade --new_wasm_hash <HASH>`.
     4. Verify version & state: `soroban contract invoke --id <VAULT_ID> --network mainnet -- version`.
     5. Unpause vault: `soroban contract invoke --id <VAULT_ID> --source admin --network mainnet -- set_pause --paused false`.
   - **For Fresh Deployment**:
     1. Deploy WASM: `soroban contract deploy --wasm <OPTIMIZED_WASM> --source deployer --network mainnet`.
     2. Initialize vault parameters (Admin multisig, Treasury address, Fee BPS, Caps).
     3. Record addresses in `deployments/contracts.mainnet.json`.
4. **Backend Production Deployment**:
   - Execute database migration: `npx prisma migrate deploy`.
   - Deploy backend containers/instances with rolling update strategy (zero downtime).
   - Confirm healthy readiness probe (`/ready`) across all backend instances.
5. **Frontend Production Deployment**:
   - Push release tag `v*.*.*` triggering `production-deploy.yml` (or trigger production Vercel deployment).
   - Invalidate edge CDN cache if necessary.

---

## 5. Post-Deployment Validation

### 5.1 Immediate Checks (T+0 to T+10 min)
- [ ] **Health & Readiness Endpoints**:
  - `GET /health` returns HTTP 200 with status `"healthy"`.
  - `GET /ready` returns HTTP 200 with status `{"ready": true}` and all subsystem probes green.
- [ ] **Core API Responses**:
  - `GET /api/v1/vault/summary` returns valid non-null numerical metrics.
  - `GET /api/v1/transactions?limit=1` returns properly structured envelope.
  - `GET /api/v1/vault/apy/history?days=7` responds within latency SLO.
- [ ] **Frontend Verification**:
  - App loads cleanly with no unhandled console errors or missing chunk errors.
  - Connected wallet correctly identifies target network (no mismatch warning).
  - Share price, APY, and Total Value Locked render accurately on the dashboard.
- [ ] **Contract Smoke Invocations**:
  - `total_assets()` matches expected on-chain accounting.
  - `total_shares()` matches expected share issuance.
  - `paused()` returns `false`.

### 5.2 Extended Monitoring (T+10 to T+30 min)
- [ ] **End-to-End User Journeys**:
  - Perform test deposit transaction (or verify telemetry on live user deposits).
  - Perform test withdrawal transaction.
  - Confirm transactions appear in history index within 1 ledger close (~5 seconds).
- [ ] **Telemetry & Error Budgets**:
  - P95 latency on critical API endpoints remains under 200 ms.
  - HTTP 5xx error rate remains < 0.1%.
  - Zero unhandled exceptions in Sentry.
  - Soroban RPC error rate < 1%.
- [ ] **Background Workers**:
  - APY snapshot background job running on schedule.
  - Event indexing worker keeping pace with the Stellar ledger tip.

---

## 6. Rollback Triggers & Procedures

### 6.1 Rollback Activation Triggers
Initiate immediate rollback if any of the following occur during the 30-minute validation window:
- `/health` or `/ready` fails continuously for > 2 minutes.
- HTTP 5xx error rate on critical write or read endpoints exceeds 5%.
- Critical smart contract logic failure, accounting invariant violation, or unexpected revert on deposits/withdrawals.
- Database data corruption or migration failure affecting core entities.
- Active security vulnerability discovered or exploited.

### 6.2 Rollback Actions by Layer
- **Smart Contracts**:
  1. Immediately pause vault: `soroban contract invoke --id <VAULT_ID> --source admin --network <network> -- set_pause --paused true`.
  2. If upgrade corrupted logic: downgrade to previous known good WASM hash (`upgrade --new_wasm_hash <PREVIOUS_HASH>`).
- **Backend Service**:
  1. Roll back container image / deployment to previous git tag.
  2. If migrations were executed, run designated down-migration: `psql -f backend/prisma/migrations/<version>/rollback.sql`.
- **Frontend SPA**:
  1. Trigger instant rollback in Vercel or point CDN traffic back to previous immutable build hash.
- **Incident Escalation**:
  1. Page Incident Commander and log event in `#yieldvault-incidents`.
  2. Open postmortem tracking ticket.

---

## 7. Sign-Off & Approvals

### Testnet (Staging) Sign-Off

| Role | Name / GitHub Handle | Status | Date (UTC) |
|------|----------------------|--------|------------|
| **Deployment Lead** | | `[ ] Approved` | |
| **Secondary Reviewer** | | `[ ] Approved` | |
| **QA / Integration Tester** | | `[ ] Approved` | |

### Mainnet (Production) Sign-Off

| Role | Name / GitHub Handle | Status | Date (UTC) |
|------|----------------------|--------|------------|
| **Release Owner** | | `[ ] Approved` | |
| **Smart Contracts Lead** | | `[ ] Approved` | |
| **Backend Lead** | | `[ ] Approved` | |
| **Frontend Lead** | | `[ ] Approved` | |
| **DevOps / Operations Lead** | | `[ ] Approved` | |
| **Security Lead** | | `[ ] Approved` | |
| **QA / Release Manager** | | `[ ] Approved` | |

---

## 8. Related Documentation & Workflows

- [Deployment Guide](file:///C:/Users/Kamiye/Desktop/drips/YieldVault-RWA/docs/DEPLOYMENT.md)
- [Deployment Checklist (Operational)](file:///C:/Users/Kamiye/Desktop/drips/YieldVault-RWA/docs/DEPLOYMENT_CHECKLIST.md)
- [Release Readiness Checklist](file:///C:/Users/Kamiye/Desktop/drips/YieldVault-RWA/docs/RELEASE_READINESS_CHECKLIST.md)
- [Incident Response & Rollback Runbook](file:///C:/Users/Kamiye/Desktop/drips/YieldVault-RWA/docs/runbooks/rollback-and-hotfix.md)
- [Contract Upgrade Playbook](file:///C:/Users/Kamiye/Desktop/drips/YieldVault-RWA/docs/runbooks/CONTRACT_UPGRADE_PLAYBOOK.md)
- [Environment Variable Matrix](file:///C:/Users/Kamiye/Desktop/drips/YieldVault-RWA/docs/ENV_VARIABLE_MATRIX.md)
