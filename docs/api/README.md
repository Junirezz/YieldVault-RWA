# API Documentation

This project exposes APIs in two layers:

- Soroban smart contract API (`contracts/vault`)
- Frontend TypeScript API (`frontend/src`)

## Backend API

The backend API provides RESTful endpoints for the YieldVault application.

### Base URL

```
http://localhost:3000
```

### Authentication

API endpoints support rate limiting per API key. Include your API key in the `x-api-key` header:

```bash
curl -H "x-api-key: your-api-key" http://localhost:3000/api/vault/summary
```

### Endpoints

#### Health & Readiness

- `GET /health` - Service health status
- `GET /ready` - Readiness status

#### Vault

- `GET /api/vault/summary` - Get vault summary
- `GET /api/vault/history` - Get vault history with pagination

#### Transactions

- `GET /api/transactions` - List transactions with pagination and filtering

#### Portfolio

- `GET /api/portfolio/holdings` - List portfolio holdings with pagination and filtering

### Pagination

All list endpoints support standardized pagination. See [PAGINATION.md](./PAGINATION.md) for detailed documentation.

**Quick Example:**
```bash
# Get first 20 transactions
curl "http://localhost:3000/api/transactions?limit=20"

# Get next page using cursor
curl "http://localhost:3000/api/transactions?limit=20&cursor=base64encodedcursor"
```

### Rate Limiting

API endpoints are rate limited. See [RATE_LIMITING.md](./RATE_LIMITING.md) for details.

### Error Handling

All errors follow a consistent format:

```json
{
  "error": "Error Type",
  "status": 400,
  "message": "Human-readable error message"
}
```

See [ERROR_FORMAT.md](./ERROR_FORMAT.md) for detailed error documentation.

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

## API Reference

### Transactions

#### List Transactions

```http
GET /api/transactions
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 20 | Number of items per page (1-100) |
| `cursor` | string | - | Cursor for next page |
| `page` | number | - | Page number (1-based) |
| `sortBy` | string | timestamp | Field to sort by |
| `sortOrder` | string | desc | Sort direction (asc/desc) |
| `type` | string | all | Filter by type (deposit/withdrawal/all) |
| `walletAddress` | string | - | Filter by wallet address |

**Response:**

```json
{
  "data": [
    {
      "id": "tx-1",
      "type": "deposit",
      "amount": "100.00",
      "asset": "USDC",
      "timestamp": "2026-03-28T18:00:00.000Z",
      "transactionHash": "hash-1-abc123",
      "walletAddress": "GABC..."
    }
  ],
  "pagination": {
    "count": 20,
    "total": 100,
    "nextCursor": "base64encodedcursor",
    "hasNextPage": true,
    "hasPrevPage": false
  },
  "timestamp": "2026-03-28T18:00:00.000Z"
}
```

### Portfolio Holdings

#### List Portfolio Holdings

```http
GET /api/portfolio/holdings
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 20 | Number of items per page (1-100) |
| `cursor` | string | - | Cursor for next page |
| `page` | number | - | Page number (1-based) |
| `sortBy` | string | valueUsd | Field to sort by |
| `sortOrder` | string | desc | Sort direction (asc/desc) |
| `status` | string | all | Filter by status (active/pending/all) |
| `walletAddress` | string | - | Filter by wallet address |

**Response:**

```json
{
  "data": [
    {
      "id": "holding-1",
      "asset": "USDC",
      "vaultName": "Vault 1",
      "symbol": "USDC",
      "shares": 100,
      "apy": 5.5,
      "valueUsd": 100.00,
      "unrealizedGainUsd": 5.00,
      "issuer": "YieldVault",
      "status": "active",
      "walletAddress": "GABC..."
    }
  ],
  "pagination": {
    "count": 20,
    "total": 50,
    "nextCursor": "base64encodedcursor",
    "hasNextPage": true,
    "hasPrevPage": false
  },
  "timestamp": "2026-03-28T18:00:00.000Z"
}
```

### Vault History

#### Get Vault History

```http
GET /api/vault/history
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 30 | Number of items per page (1-365) |
| `cursor` | string | - | Cursor for next page |
| `page` | number | - | Page number (1-based) |
| `sortBy` | string | date | Field to sort by |
| `sortOrder` | string | desc | Sort direction (asc/desc) |
| `from` | string | - | Start date (YYYY-MM-DD) |
| `to` | string | - | End date (YYYY-MM-DD) |

**Response:**

```json
{
  "data": [
    {
      "date": "2026-03-28",
      "value": 103.75
    }
  ],
  "pagination": {
    "count": 30,
    "total": 365,
    "nextCursor": "base64encodedcursor",
    "hasNextPage": true,
    "hasPrevPage": false
  },
  "timestamp": "2026-03-28T18:00:00.000Z"
}
```

## Changelog

### Version 1.0.0 (2026-03-28)
- Initial API documentation
- Pagination conventions
- Rate limiting documentation
- Error format documentation
