# Contributor Onboarding Checklist

> **Goal:** Get your local environment fully set up for contributing to YieldVault-RWA across all three layers — smart contracts, backend API, and frontend UI.

---

## 1. Prerequisites

Install the following tools before cloning the repository.

### Required

| Tool | Version | Check Command |
|------|---------|---------------|
| Node.js | v18+ | `node --version` |
| npm / pnpm | latest | `npm --version` |
| Git | latest | `git --version` |
| Rust | 1.74+ | `rustc --version` |
| Docker & Docker Compose | latest | `docker --version && docker compose version` |

### Optional but Recommended

- [Stellar CLI](https://developers.stellar.org/docs/build/CLI) – contract deployment & interaction
- [VS Code](https://code.visualstudio.com/) with extensions:
  - **Rust Analyzer** – Rust language support
  - **ESLint** – JavaScript/TypeScript linting
  - **Prettier** – Code formatting
  - **Docker** – Container management
  - **Prisma** – Database schema visualization
- [Freighter Wallet](https://www.freighter.app/) (browser extension) – Stellar wallet for testnet interaction

### System-Specific Setup

<details>
<summary><b>Windows</b></summary>

```powershell
# Install Node.js from https://nodejs.org (LTS recommended)
# Install Git from https://git-scm.com

# Install Rust using rustup-init (included in repo root):
.\rustup-init.exe -y

# Add WebAssembly target for Soroban smart contracts
rustup target add wasm32-unknown-unknown

# Install Docker Desktop from https://www.docker.com/products/docker-desktop
```
</details>

<details>
<summary><b>macOS</b></summary>

```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install dependencies

## 3. Infrastructure (Docker)

Start PostgreSQL and Redis — these are required by the backend API.

```bash
# Start both services in detached mode
docker compose up -d postgres redis

# Verify they are running
docker ps

# Quick health checks
docker exec -it yieldvault-postgres-1 pg_isready -U postgres
docker exec -it yieldvault-redis-1 redis-cli ping  # Should return PONG
```

> **Note:** If you don't have a `docker-compose.yml` in the root, create one using the settings from [`docs/SERVICE_DEPENDENCY_MATRIX.md`](./SERVICE_DEPENDENCY_MATRIX.md) or use standalone PostgreSQL/Redis installations.

---

## 4. Smart Contracts (Rust/Soroban)

```bash
cd contracts/vault

# Build the contract (compiles to WebAssembly)
cargo build --target wasm32-unknown-unknown --release

# Run full test suite (unit + integration + property-based/fuzz)
cargo test

# Run tests with output (no capture) for debugging
cargo test -- --nocapture

# Check for warnings / clippy linting
cargo clippy --target wasm32-unknown-unknown -- -D warnings

# Generate documentation
cargo doc --no-deps --open

# Build the mock strategy as well
cd ../mock-strategy
cargo build --target wasm32-unknown-unknown
cargo test
```

### Checklist

- [ ] `cargo build` passes without errors
- [ ] `cargo test` passes all test suites (50+ vault tests, fuzz math, oracle, events, proxy, security)
- [ ] `cargo clippy` produces zero warnings
- [ ] `cargo doc --no-deps` generates without errors

---

brew install node@18 git rustup docker

# Install Rust
rustup-init
rustup target add wasm32-unknown-unknown

# Start Docker Desktop (from Applications folder)
```
</details>

<details>
<summary><b>Linux (Ubuntu/Debian)</b></summary>

```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs git

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustup target add wasm32-unknown-unknown

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```
</details>

---

## 2. Clone & Project Setup

```bash
# Clone the repository
git clone https://github.com/Junirezz/YieldVault-RWA.git
cd YieldVault-RWA

# Install root-level dependencies (Husky git hooks, etc.)
npm install

# Build shared packages (build order requirement before backend typecheck or dev)
npm run build:schemas
```

> **Build Order Requirement:** `@yieldvault/api-schemas` must be built before local typechecking or starting the backend. Without this step, `tsc --noEmit` fails because `backend/src/middleware/validate.ts` imports `@yieldvault/api-schemas`.

### Verify Git Hooks

```bash
# Confirm Husky installed the pre-commit hook
ls .husky/pre-commit

# The hook runs secret scanning (gitleaks) before every commit
```

---

## 5. Backend (Express.js / TypeScript)

```bash
cd backend

# Install dependencies (prebuild/predev will build api-schemas automatically)
npm install

# Create environment file from template
cp .env.example .env.local

# Edit .env.local with your values
#   - VAULT_CONTRACT_ID: Get this from deployments/ or deploy your own
#   - DATABASE_URL: postgres://postgres:postgres@localhost:5432/yieldvault (default)
#   - STELLAR_RPC_URL: https://soroban-testnet.stellar.org (default)
#   - CORS_ALLOWED_ORIGINS: http://localhost:5173 (for frontend)

# Run database migrations
npx prisma migrate dev

# Generate Prisma client
npx prisma generate

# Start the development server (with hot-reload)
npm run dev

# In a separate terminal, run tests
npm test

# Lint and format
npm run lint
npm run format
```

### Verify Backend Is Running

```bash
curl http://localhost:3000/health
# Expected: {"status":"healthy","checks":{"api":"up","cache":"up","stellarRpc":"up"}}

curl http://localhost:3000/ready
# Expected: {"ready":true,"dependencies":{"cache":true,"stellarRpc":true}}
```

### Optional: View Database

```bash
npx prisma studio
# Opens http://localhost:5555 with a database browser
```

### Checklist

- [ ] `npm install` completes without errors
- [ ] `npx prisma migrate dev` runs successfully
- [ ] `npm run dev` starts on port 3000
- [ ] `curl http://localhost:3000/health` returns `200 OK`
- [ ] `npm test` passes all tests
- [ ] `npm run lint` produces zero errors

---


## 6. Frontend (React / TypeScript / Vite)

```bash
cd frontend

# Install dependencies
npm install

# Create environment file from template
cp .env.example .env.local

# Edit .env.local with your values
#   - VITE_SOROBAN_RPC_URL: https://soroban-testnet.stellar.org (default)
#   - VITE_VAULT_CONTRACT_ID: Same as backend VAULT_CONTRACT_ID
#   - VITE_STELLAR_NETWORK_PASSPHRASE: Test SDF Network ; September 2015 (default)

# Start the development server
npm run dev

# In a separate terminal, run unit tests
npm run test:run

# Run E2E tests (requires Playwright browsers installed)
npx playwright install
npm run test:e2e

# Lint
npm run lint

# Build for production (verifies TypeScript compilation)
npm run build
```

### Verify Frontend Is Running

- Open http://localhost:5173 in your browser
- You should see the YieldVault UI
- The page should connect to the backend at http://localhost:3000

### Checklist

- [ ] `npm install` completes without errors
- [ ] `npm run dev` starts on port 5173
- [ ] http://localhost:5173 loads in the browser
- [ ] `npm run test:run` passes all unit tests
- [ ] `npm run build` completes without errors
- [ ] `npm run lint` produces zero errors

---

## 7. Shared Packages

The repository uses shared packages for API type consistency:

```bash
cd packages/api-schemas

# Install dependencies
npm install

# Build the schemas
npm run build

# Run tests
npm test
```

### Checklist

- [ ] `npm install` and `npm run build` complete without errors
- [ ] `npm test` passes

---

## 8. End-to-End Validation

Once all three layers are running, perform a full-system validation:

```bash
# From the repository root

# 1. Verify infrastructure is up
docker ps

# 2. Check backend health
curl http://localhost:3000/health

# 3. Check frontend is serving
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173  # Expected: 200

# 4. Run the full test suite across all layers
cd contracts/vault && cargo test && cd ../..
cd backend && npm test && cd ..
cd frontend && npm run test:run && cd ..
cd packages/api-schemas && npm test && cd ..

# 5. Run the frontend env validation script
npm run validate:frontend-env -- --env-file frontend/.env.local --strict --check-rpc
```

---

## 9. Secret Scanning & Security

This repository enforces strict secret scanning to prevent credential leaks.

### Pre-commit Hook (Husky + Gitleaks)

```bash
# The hook runs automatically on git commit
# To test manually:
node scripts/secrets-check.js
```

### Security Best Practices

- [ ] Never commit `.env` files (only `.env.example` templates)
- [ ] Never hardcode API keys, private keys, or passwords
- [ ] Use `git commit --no-verify` only for legitimate false positives
- [ ] Run `npm audit` regularly in both `backend/` and `frontend/`
- [ ] Review [`SECURITY_ENV_CHECKLIST.md`](../SECURITY_ENV_CHECKLIST.md) before deployments

---

## 10. Branching & PR Workflow

### Branch Naming

| Type | Format | Example |
|------|--------|---------|
| Feature | `feat/<issue-number>-<description>` | `feat/616-onboarding-checklist` |
| Bug Fix | `fix/<issue-number>-<description>` | `fix/617-auth-error` |

### Pull Request Checklist

- [ ] Branch is created from `main` and named correctly
- [ ] Changes are scoped to a single concern
- [ ] All tests pass across affected layers
- [ ] New code includes tests (where applicable)
- [ ] Documentation is updated (if changing behavior or adding features)
- [ ] No secrets or `.env` files are committed
- [ ] PR description follows the template (Goal, Changes, Testing)
- [ ] PR links to the relevant issue (e.g., `Closes #616`)

### Commit Convention

```
<type>: <short description>

Examples:
feat: add onboarding checklist for contributors
fix: correct database connection timeout
docs: update environment variable matrix
test: add unit tests for withdrawal edge cases
```


---

## 11. Troubleshooting Quick Reference

| Symptom | Likely Cause | Solution |
|---------|-------------|----------|
| `cargo build` fails | Missing `wasm32-unknown-unknown` target | `rustup target add wasm32-unknown-unknown` |
| Backend won't start | PostgreSQL/Redis not running | `docker compose up -d postgres redis` |
| `ECONNREFUSED :3000` | Backend not started | `cd backend && npm run dev` |
| CORS errors in frontend | Backend `CORS_ALLOWED_ORIGINS` not set | Add `http://localhost:5173` to the list |
| `VAULT_CONTRACT_ID` not set | Missing env variable | Set it in both `backend/.env.local` and `frontend/.env.local` |
| Wrong network error | RPC URL / passphrase mismatch | Both must use testnet or both must use mainnet |
| Pre-commit hook blocks commit | Gitleaks false positive | Use `git commit --no-verify` or update `.gitleaks.toml` |
| `prisma migrate` fails | Database connection wrong | Check `DATABASE_URL` in `backend/.env.local` |

---

## 12. Helpful Resources

| Resource | Link |
|----------|------|
| Local Development Quickstart | [`docs/LOCAL_DEVELOPMENT_QUICKSTART.md`](./LOCAL_DEVELOPMENT_QUICKSTART.md) |
| Service Dependency Matrix | [`docs/SERVICE_DEPENDENCY_MATRIX.md`](./SERVICE_DEPENDENCY_MATRIX.md) |
| Contracts Architecture | [`docs/CONTRACTS_ARCHITECTURE.md`](./CONTRACTS_ARCHITECTURE.md) |
| Environment Variable Guide | [`ENVIRONMENT_SETUP_GUIDE.md`](../ENVIRONMENT_SETUP_GUIDE.md) |
| Environment Quick Reference | [`ENV_QUICK_REFERENCE.md`](../ENV_QUICK_REFERENCE.md) |
| Security Checklist | [`docs/SECURITY_CHECKLIST.md`](./SECURITY_CHECKLIST.md) |
| Security Env Checklist | [`SECURITY_ENV_CHECKLIST.md`](../SECURITY_ENV_CHECKLIST.md) |
| Contributing Guide | [`CONTRIBUTING.md`](../CONTRIBUTING.md) |
| API Documentation | [`docs/api/README.md`](./api/README.md) |
| Deployment Runbook | [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md) |
| Stellar Soroban Docs | https://developers.stellar.org/docs/build/smart-contracts |
| Stellar SDK (JS) | https://github.com/stellar/js-stellar-sdk |

---

## Complete Checklist Summary

### Prerequisites
- [ ] Node.js v18+ installed
- [ ] npm installed
- [ ] Git installed
- [ ] Rust 1.74+ installed with `wasm32-unknown-unknown` target
- [ ] Docker & Docker Compose installed

### Repository Setup
- [ ] Repository cloned
- [ ] `npm install` run at root (Husky hooks installed)

### Infrastructure
- [ ] PostgreSQL Docker container running
- [ ] Redis Docker container running

### Smart Contracts
- [ ] `cargo build` passes
- [ ] `cargo test` passes
- [ ] `cargo clippy` has zero warnings

### Backend
- [ ] `npm install` in `backend/`
- [ ] `.env.local` created from `.env.example`
- [ ] Prisma migration applied
- [ ] `npm run dev` starts on port 3000
- [ ] `npm test` passes
- [ ] `npm run lint` has zero errors

### Frontend
- [ ] `npm install` in `frontend/`
- [ ] `.env.local` created from `.env.example`
- [ ] `npm run dev` starts on port 5173
- [ ] `npm run test:run` passes
- [ ] `npm run build` completes without errors
- [ ] `npm run lint` has zero errors

### Shared Packages
- [ ] `packages/api-schemas` builds and tests pass

### End-to-End
- [ ] Backend health endpoint returns `200 OK`
- [ ] Frontend loads in browser at http://localhost:5173
- [ ] All three layers (contracts, backend, frontend) are operational
- [ ] Environment validation script passes (if available)

### Security
- [ ] No `.env` files are staged for commit
- [ ] Pre-commit hook is active (gitleaks)
- [ ] Secret scanning best practices understood

### Git Workflow
- [ ] Branch naming convention understood
- [ ] PR template requirements understood
- [ ] Commit message format understood

---

> **Onboarding Complete!** 🎉 You are now ready to contribute to YieldVault-RWA.
>
> If you encounter issues not covered here, please check the [Local Development Quickstart](./LOCAL_DEVELOPMENT_QUICKSTART.md) or open a GitHub discussion.

