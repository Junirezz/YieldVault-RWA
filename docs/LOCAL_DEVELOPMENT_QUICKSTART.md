# Local Development Quickstart

This guide documents the fastest supported way to boot the repository locally for backend, contract, and frontend development.

## What You Need

- Node.js 18+ and npm
- Rust and Cargo
- `wasm32-unknown-unknown` Rust target for Soroban contract builds

Optional:

- Freighter or another Stellar wallet for frontend testing
- Docker, PostgreSQL, and Redis only if you want to test non-default infrastructure paths

## Repo Layout

- `backend/` - Express + TypeScript API with Prisma
- `contracts/vault/` - main Soroban vault contract
- `contracts/mock-strategy/` - mock contract used by tests
- `frontend/` - React + Vite app

## Bootstrap Order

Use this order for a clean first boot:

1. Install backend dependencies and create the local database
2. Build or test contracts if you are changing on-chain code
3. Install frontend dependencies and point it at your local backend
4. Start backend and frontend in separate terminals

## 1. Backend Bootstrap

The default local backend path does not require PostgreSQL or Redis. Prisma falls back to the SQLite database defined in [`backend/prisma/schema.prisma`](/Users/macbook/stellar/YieldVault-RWA/backend/prisma/schema.prisma:1), and Redis-backed features fall back to in-memory behavior when `REDIS_URL` is not set.

```bash
cd backend
cp .env.example .env
npm install
npx prisma migrate dev
npm run dev
```

Backend defaults:

- API base URL: `http://localhost:3000`
- Health endpoint: `http://localhost:3000/health`
- Readiness endpoint: `http://localhost:3000/ready`
- Local Prisma DB: `backend/prisma/dev.db`

Recommended minimum local env updates in `backend/.env`:

```env
PORT=3000
NODE_ENV=development
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VAULT_CONTRACT_ID=
```

Notes:

- Leave `DATABASE_URL` unset to keep the default SQLite workflow.
- Leave `REDIS_URL` unset unless you are explicitly testing Redis-backed rate limiting or nonce storage.
- Routes that invoke Soroban transactions need a real `VAULT_CONTRACT_ID`, and some flows also require backend signing credentials such as `STELLAR_SECRET_KEY`.

## 2. Contract Bootstrap

You only need this section if you are working on the smart contracts.

From the repo root:

```bash
rustup target add wasm32-unknown-unknown
cargo test
```

To build the main contract artifact directly:

```bash
cargo build -p vault --target wasm32-unknown-unknown --release
```

Useful paths:

- Main contract crate: [`contracts/vault`](/Users/macbook/stellar/YieldVault-RWA/contracts/vault)
- Mock strategy crate: [`contracts/mock-strategy`](/Users/macbook/stellar/YieldVault-RWA/contracts/mock-strategy)
- Deployment notes: [`contracts/vault/DEPLOYMENT.md`](/Users/macbook/stellar/YieldVault-RWA/contracts/vault/DEPLOYMENT.md:1)

## 3. Frontend Bootstrap

The frontend expects a local backend plus Stellar network settings.

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Recommended minimum local env in `frontend/.env`:

```env
VITE_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
VITE_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VITE_VAULT_CONTRACT_ID=
```

Frontend default:

- App URL: `http://localhost:5173`

Important:

- Set `VITE_VAULT_CONTRACT_ID` to the same contract ID used by the backend when you want the UI to target a deployed vault.
- Some views can still boot without a contract ID, but transaction flows will not work end-to-end.

## Daily Startup

Once dependencies are installed, the normal dev loop is:

Terminal 1:

```bash
cd backend
npm run dev
```

Terminal 2:

```bash
cd frontend
npm run dev
```

Optional Terminal 3 for contract work:

```bash
cargo test
```

## Validation Checklist

Use these commands after bootstrapping:

```bash
cd backend
npm test
```

```bash
cd frontend
npm run test:run
```

```bash
cd /Users/macbook/stellar/YieldVault-RWA
cargo test
```

Manual checks:

- Open `http://localhost:5173`
- Verify `http://localhost:3000/health` returns a healthy response
- Confirm the frontend can reach the backend without CORS errors

## Troubleshooting

### `VAULT_CONTRACT_ID environment variable is not set`

Set the contract ID in both `backend/.env` and `frontend/.env` before testing real vault actions.

### Prisma migration or DB issues

Re-run:

```bash
cd backend
npx prisma migrate dev
```

If you want a clean local SQLite reset, remove `backend/prisma/dev.db` and rerun the migration.

### Redis warnings in backend logs

Expected in the default local path. Redis is optional unless you are specifically testing Redis-backed behavior.

### Frontend points at the wrong backend

Check backend port `3000`, then verify any frontend API configuration in the app matches your local backend URL.

## Related Docs

- Root overview: [`README.md`](/Users/macbook/stellar/YieldVault-RWA/README.md:1)
- Backend details: [`backend/README.md`](/Users/macbook/stellar/YieldVault-RWA/backend/README.md:1)
- Frontend details: [`frontend/README.md`](/Users/macbook/stellar/YieldVault-RWA/frontend/README.md:1)
- Environment matrix: [`docs/ENV_VARIABLE_MATRIX.md`](/Users/macbook/stellar/YieldVault-RWA/docs/ENV_VARIABLE_MATRIX.md:1)
