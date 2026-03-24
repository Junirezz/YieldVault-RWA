# API Documentation

This project exposes APIs in two layers:

- Soroban smart contract API (`contracts/vault`)
- Frontend TypeScript API (`frontend/src`)

## Generate docs locally

### 1) Soroban contract docs

```bash
cargo doc -p vault --no-deps
```

### 2) Frontend API docs

```bash
cd frontend
npm install
npm run docs:api
```

Generated output:

- Rust docs: `target/doc`
- Frontend docs: `docs/api/frontend`
