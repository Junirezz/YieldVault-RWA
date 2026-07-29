# YieldVault Frontend

React + TypeScript + Vite frontend for the YieldVault RWA application.

## Local Development

```bash
cp .env.example .env
npm install
npm run dev
```

Default local URL:

- `http://localhost:5173`

Minimum local environment:

```env
VITE_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
VITE_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VITE_VAULT_CONTRACT_ID=
```

Notes:

- Set `VITE_VAULT_CONTRACT_ID` before testing contract-backed UI flows.
- The frontend is intended to run alongside the local backend in `../backend`.
- For the full repo bootstrap order, see [`docs/LOCAL_DEVELOPMENT_QUICKSTART.md`](/Users/macbook/stellar/YieldVault-RWA/docs/LOCAL_DEVELOPMENT_QUICKSTART.md:1).

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm run test:run
npm run test:e2e
```

## Related Docs

- API docs output: [`docs/api/frontend`](/Users/macbook/stellar/YieldVault-RWA/docs/api/frontend)
- Sentry notes: [`SENTRY_GUIDE.md`](/Users/macbook/stellar/YieldVault-RWA/frontend/SENTRY_GUIDE.md:1)
- Security patterns: [`SECURITY_PATTERNS.md`](/Users/macbook/stellar/YieldVault-RWA/frontend/SECURITY_PATTERNS.md:1)
