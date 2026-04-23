# YieldVault Backend API

Express.js backend for the YieldVault Stellar RWA platform.

## Features

- Health and readiness endpoints
- Rate limiting for public API routes
- Versioned API surface under `/api/v1`
- Replay-safe mutations via idempotency keys
- Background job retry policy and dead-letter metrics
- Migration safety checks in CI
- TypeScript with Jest test coverage

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

The server starts on `http://localhost:3000`.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Runtime mode |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Global rate limit window |
| `RATE_LIMIT_MAX_REQUESTS` | `100` | Global requests per window |
| `API_RATE_LIMIT_WINDOW_MS` | `60000` | API rate limit window |
| `API_RATE_LIMIT_MAX_REQUESTS` | `30` | API requests per window |
| `IDEMPOTENCY_KEY_TTL_MS` | `86400000` | Replay window for mutation requests |
| `STELLAR_RPC_URL` | `https://soroban-testnet.stellar.org` | Stellar RPC endpoint |

## API Endpoints

### Health

```http
GET /health
GET /ready
```

### Versioned API

```http
GET /api/v1/vault/summary
GET /api/v1/transactions
GET /api/v1/portfolio/holdings
GET /api/v1/vault/history
POST /api/v1/vault/deposits
GET /api/v1/ops/job-metrics
```

Legacy `/api/*` routes redirect to `/api/v1/*` with `308 Permanent Redirect`.

## Idempotent Mutations

Mutation endpoints require `x-idempotency-key`.

- Same key + same payload returns the original response.
- Same key + different payload returns `409 Conflict`.
- TTL is controlled by `IDEMPOTENCY_KEY_TTL_MS`.

## Background Jobs

Job execution uses explicit retry policies per job class with exponential backoff.
Failed jobs are written to a dead-letter sink and surfaced through job metrics.

## Migration Safety

The CI scanner flags:

- irreversible schema changes such as `DROP` and `TRUNCATE`
- long-running or locking migration patterns
- schema changes that add indexed columns without an index declaration

Rollback expectations:

- Prefer additive schema changes.
- Add indexes before deploying code that depends on them.
- Avoid destructive drops in the same deploy as a data migration.
- Document manual rollback steps when a migration cannot be reversed automatically.

Run the scanner locally with:

```bash
npm run check:migrations
```

## Testing

```bash
npm test
npm run build
npm run check:migrations
```

## CI

The backend governance workflow runs:

- `npm run lint`
- `npm run test`
- `npm run build`
- `npm run check:migrations`

See [`.github/workflows/backend-governance.yml`](../.github/workflows/backend-governance.yml).

## License

MIT