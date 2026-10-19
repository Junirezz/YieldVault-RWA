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

## Generated Reports

Lint, test and bundle reports are **generated locally and must not be committed**. Write them to the git-ignored `test-results/` directory, or delete them before committing. The common artifacts (`lint-output*.txt`, `lint.txt`, `test-results.txt`, `test-output.txt`, `test_output.json`, `vitest-results*.json`, `bundle-stats.html`) are covered by `.gitignore`.

## Related Docs

- API docs output: [`docs/api/frontend`](/Users/macbook/stellar/YieldVault-RWA/docs/api/frontend)
- Sentry notes: [`SENTRY_GUIDE.md`](/Users/macbook/stellar/YieldVault-RWA/frontend/SENTRY_GUIDE.md:1)
- Security patterns: [`SECURITY_PATTERNS.md`](/Users/macbook/stellar/YieldVault-RWA/frontend/SECURITY_PATTERNS.md:1)
