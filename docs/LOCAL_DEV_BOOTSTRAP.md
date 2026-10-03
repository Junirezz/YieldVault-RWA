# Local Development Bootstrap

This guide explains how to run the YieldVault-RWA backend, Soroban contracts, and frontend locally. The commands below are intended for development and test environments only.

## Repository layout

- `backend/` — Node.js backend API and supporting jobs.
- `contracts/` — Rust Soroban contracts, including the vault and mock strategy.
- `frontend/` — React/Vite web application.
- `scripts/` — repository-level validation and development utilities.

## Prerequisites

Install the following before starting:

- Git
- Node.js and npm. Use the version required by the repository or your team’s development environment.
- Rust and Cargo, including the `wasm32-unknown-unknown` target.
- A local PostgreSQL instance for backend development and tests.
- Redis if you want to exercise the Redis-backed cache and queue paths. The backend can run in in-memory/degraded cache mode when Redis is unavailable where supported by the selected environment.
- The Stellar CLI with Soroban support if you will deploy or invoke contracts locally or on Testnet.

Verify the toolchain:

```bash
git --version
node --version
npm --version
cargo --version
rustc --version
rustup target list --installed
```

Install the WebAssembly target if it is not already installed:

```bash
rustup target add wasm32-unknown-unknown
```

Do not commit credentials, private keys, database passwords, API keys, or other secrets. Use local environment files that are ignored by Git and use test-only accounts and assets.

## 1. Clone and install repository dependencies

```bash
git clone <repository-url>
cd YieldVault-RWA
npm install
```

The root install includes repository development tooling such as Husky, Vitest, and environment validation utilities. If the pre-commit hook is not active after installation, run:

```bash
git config core.hooksPath .husky
```

Install dependencies for each application separately:

```bash
# Build shared API schemas first (required before backend typecheck or build)
cd packages/api-schemas
npm install
npm run build
cd ..

cd backend
npm install
cd ../frontend
npm install
cd ..
```

> **Note on Build Order:** `@yieldvault/api-schemas` is a workspace package imported by backend middleware (`backend/src/middleware/validate.ts`). Without building `packages/api-schemas` first, TypeScript compilation (`tsc --noEmit`) fails with `Cannot find module '@yieldvault/api-schemas'`. Always ensure `packages/api-schemas` is built first (or use root `npm run build:schemas`).

If a workspace uses a lockfile, prefer the package manager and frozen-lockfile command specified by that lockfile and by CI.

## 2. Configure the backend

Review the backend environment documentation before creating local configuration:

- [`backend/docs/ENVIRONMENT_VARIABLES.md`](../backend/docs/ENVIRONMENT_VARIABLES.md)
- [`ENVIRONMENT_SETUP_GUIDE.md`](../ENVIRONMENT_SETUP_GUIDE.md)
- [`ENV_QUICK_REFERENCE.md`](../ENV_QUICK_REFERENCE.md)
- [`SECURITY_ENV_CHECKLIST.md`](../SECURITY_ENV_CHECKLIST.md)

Create the backend environment file using the project’s documented variable names. For example:

```bash
cd backend
cp .env.example .env
```

If `.env.example` is not present, create `.env` from the variables documented in `backend/docs/ENVIRONMENT_VARIABLES.md`; do not copy production values.

At minimum, configure local values for:

- Application port and environment mode.
- PostgreSQL connection URL.
- Redis URL when using Redis-backed functionality.
- Stellar network, RPC, and Horizon endpoints appropriate for local development or Testnet.
- Contract and asset identifiers required by the selected backend features.
- Authentication, CORS, and API-key values required by the local routes.

Use safe development values, for example:

```dotenv
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/yieldvault
REDIS_URL=redis://127.0.0.1:6379
```

The exact variable names and required values are defined by the backend documentation and must take precedence over this example.

### Start local PostgreSQL and Redis

Start the services using your operating system or container tooling. A typical Docker-based setup is:

```bash
docker run --name yieldvault-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=yieldvault \
  -p 5432:5432 \
  -d postgres

docker run --name yieldvault-redis \
  -p 6379:6379 \
  -d redis
```

If containers with those names already exist, start them instead:

```bash
docker start yieldvault-postgres yieldvault-redis
```

Do not use these example credentials outside a disposable local environment.

### Prepare the database

From `backend/`, inspect the available scripts and run the project’s documented migration command:

```bash
npm run
npm run migrate
```

If the backend package exposes a different migration script, use that script instead. Migration-related utilities are also available under `backend/scripts/`. Do not use destructive reset commands against a shared or production database.

### Start the backend

From `backend/`, list the available scripts and start the development server using the project’s development script:

```bash
npm run
npm run dev
```

If the package uses a different name, use the documented start script, commonly `npm start` or `npm run start:dev`.

Verify the backend using its health endpoints. The repository includes `/health` and `/ready` API contracts; the exact base path is determined by the running server configuration. Typical checks are:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/ready
```

If the API is mounted under a versioned path, use the corresponding paths exposed by the backend README or OpenAPI document (`backend/openapi.json`).

## 3. Build and test the Soroban contracts

From the repository root, inspect the workspace:

```bash
cargo metadata --no-deps
```

Run all Rust tests:

```bash
cargo test
```

Run the vault contract tests specifically:

```bash
cargo test -p vault
```

Build the contracts for WebAssembly:

```bash
cargo build --release --target wasm32-unknown-unknown
```

The generated Wasm artifacts are placed under `target/wasm32-unknown-unknown/release/`. Build output is local tooling output and should not be committed unless a release process explicitly requires it.

The contract tests use Soroban’s in-process test environment and do not require a running backend, PostgreSQL instance, or Redis server. They cover vault operations, guard checks, lifecycle behavior, and mock strategy interactions.

### Optional Testnet deployment

Only deploy contracts when you intentionally need a network-backed workflow. Use a dedicated Stellar test account and Testnet assets. Never use a production secret key in local configuration.

Before deployment:

1. Select the intended Stellar network and RPC endpoint.
2. Fund a disposable Testnet account using the official Testnet friendbot where appropriate.
3. Build the target contract Wasm.
4. Deploy with the Soroban CLI using the account, network, and contract-specific command documented by your installed CLI version.
5. Record the resulting contract IDs in the local backend and frontend environment files.
6. Confirm the contract IDs and network match across all three components.

The local development guide does not prescribe a private-key or deployment command because Soroban CLI syntax and deployment configuration vary by installed version. Confirm commands with `stellar contract --help` and the contract package documentation before submitting a transaction.

## 4. Configure and start the frontend

Review the frontend environment files and scripts:

```bash
cd frontend
ls -la
npm run
```

Create the frontend environment file expected by the Vite application, commonly one of `.env.local` or `.env.development`. Use only the variable names documented by the frontend source and repository environment documentation. Vite-exposed variables normally use the `VITE_` prefix.

Typical local configuration includes:

```dotenv
VITE_API_URL=http://localhost:3000
VITE_STELLAR_NETWORK=testnet
VITE_STELLAR_RPC_URL=<testnet-rpc-url>
VITE_VAULT_CONTRACT_ID=<testnet-vault-contract-id>
```

The names above are examples; use the variables actually consumed by the frontend. Do not put private keys or backend secrets in a Vite environment file because values with a `VITE_` prefix are exposed to the browser bundle.

Start the Vite development server from `frontend/`:

```bash
npm run dev
```

Open the URL printed by Vite, usually `http://localhost:5173`.

If the frontend cannot reach the backend, verify that:

- The backend is running on the configured port.
- `VITE_API_URL` points to the backend API base URL.
- Backend CORS settings allow the frontend development origin.
- The browser is not using stale environment values; restart Vite after changing an environment file.
- Contract IDs and network settings refer to the same Stellar network.

## 5. Recommended local workflow

Use separate terminals for each long-running process:

### Terminal 1: infrastructure

```bash
docker start yieldvault-postgres yieldvault-redis
```

### Terminal 2: backend

```bash
cd backend
npm run dev
```

### Terminal 3: frontend

```bash
cd frontend
npm run dev
```

Run contract tests independently from the repository root:

```bash
cargo test
```

The normal request path is:

```text
Browser frontend -> backend API -> PostgreSQL/Redis and Stellar RPC -> Soroban contracts
```

For contract-only tests, the Soroban test environment replaces the network and does not require the backend or frontend.

## 6. Validation before opening a pull request

Run the repository-level checks:

```bash
npm test
npm run validate:frontend-env
npm run test:validate-frontend-env
```

Run backend tests from `backend/`:

```bash
npm test
```

Run contract tests and a release Wasm build:

```bash
cargo test
cargo build --release --target wasm32-unknown-unknown
```

Run the frontend checks exposed by its package scripts:

```bash
cd frontend
npm run
```

Then execute the available lint, type-check, test, and build scripts listed by `npm run`. Use the same Node version and package-manager mode used by CI.

Before committing:

- Confirm no `.env` or other secret-bearing files are staged.
- Run the repository secret check if needed: `node scripts/secrets-check.js`.
- Confirm generated build artifacts are ignored.
- Confirm local services and test accounts are not referenced by production configuration.

## Troubleshooting

### Database connection errors

- Confirm PostgreSQL is running and listening on port `5432`.
- Check that `DATABASE_URL` matches the local database name and credentials.
- Run migrations from `backend/`.
- Ensure the backend process is loading the intended `.env` file.

### Redis unavailable

- Confirm Redis is running on the configured host and port.
- Check `REDIS_URL` and local firewall settings.
- Review `backend/docs/REDIS_CACHING.md`.
- Some development paths intentionally fall back to in-memory behavior; do not assume that fallback is suitable for production.

### Frontend environment changes are ignored

Stop and restart the Vite server after changing environment files. Only variables intended for browser exposure should use the frontend’s public prefix.

### Contract compilation fails

- Confirm the Rust toolchain is installed and current enough for the repository.
- Install the `wasm32-unknown-unknown` target.
- Run `cargo clean` only when stale build output is suspected.
- Re-run `cargo test` before attempting a network deployment.

### Wallet or transaction requests fail

- Confirm the wallet extension is installed and unlocked.
- Confirm the wallet, frontend, backend, and contracts all use the same Stellar network.
- Use a disposable Testnet account with sufficient Testnet funds.
- Check the browser console, backend logs, and transaction status on the selected network.
- Never paste a private key into source code, a browser console, an issue, or a committed environment file.

## Stopping and resetting local services

Stop development processes with `Ctrl+C`. Stop disposable containers with:

```bash
docker stop yieldvault-postgres yieldvault-redis
```

To remove the disposable containers and their data:

```bash
docker rm -f yieldvault-postgres yieldvault-redis
```

Only remove containers or databases when you are certain they contain no data needed by another local project.
