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

> **📘 Comprehensive Guide:** See [AUTH_AND_TOKEN_GUIDE.md](./AUTH_AND_TOKEN_GUIDE.md) for the full authentication and token rotation documentation including JWT session tokens, API key management, scoped admin tokens, wallet-signed actions, refresh token rotation with replay detection, and security best practices.

The backend supports two authentication schemes:

- `Authorization: Bearer <access-token>` — user session authentication for wallet-based access.
- `Authorization: ApiKey <api-key>` — admin/system authentication for privileged backend operations.

> Note: backend auth-protected routes require the `Authorization` header. The `x-api-key` header is used only as a rate-limiting fallback key and is not accepted as the authentication credential for admin routes.

#### API Key Authentication

Admin routes and privileged backend operations use API keys.

- Header format: `Authorization: ApiKey <api-key>`
- Applies to all `/admin/*` endpoints.
- Also applies to admin transaction exports on `GET /api/v1/vault/transactions/export`.

API key roles:

- `admin`
  - Allowed to access protected admin endpoints.
  - Allowed to perform admin-scoped transaction exports.
- `super-admin`
  - Has all `admin` privileges.
  - Required for super-admin-only actions:
    - `GET /admin/impersonate/:wallet`
    - `DELETE /admin/idempotency/keys`
    - `POST /admin/api-keys/register` when creating a key with role `super-admin`

When registering a new API key via `POST /admin/api-keys/register`, an existing `admin` key can create another `admin` key, but only an existing `super-admin` key may register a new `super-admin` key.

#### JWT Authentication

User session authentication uses JWT access tokens and refresh tokens.

- `POST /api/v1/auth/login`
  - Body: `{ "walletAddress": "<wallet-address>" }`
  - Returns a Bearer access token and a refresh token.
- `POST /api/v1/auth/refresh`
  - Body: `{ "refreshToken": "<refresh-token>" }`
  - Rotates the refresh token and returns a new access token pair.
- `POST /api/v1/auth/logout`
  - Requires `Authorization: Bearer <access-token>`.
  - Revokes the current session.
- `POST /api/v1/auth/logout-all`
  - Requires `Authorization: Bearer <access-token>`.
  - Revokes all active sessions for the authenticated wallet.

#### Transaction export access boundaries

`GET /api/v1/vault/transactions/export` supports both authentication methods:

- `Authorization: Bearer <access-token>`
  - The request is scoped to the wallet in the token subject.
  - If `walletAddress` is provided, it must match the authenticated wallet.
  - Attempting to export another wallet's transactions returns `403 Forbidden`.
- `Authorization: ApiKey <api-key>`
  - Requires an `admin`-role API key.
  - `walletAddress` is required for admin exports.
  - Allows exporting any wallet's transactions when authorized.

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

All list endpoints support standardized pagination. See [PAGINATION.md](./PAGINATION.md) for detailed documentation, including deterministic paging walkthroughs and cursor usage examples.

**Quick Example:**
```bash
# Get first 20 transactions
curl "http://localhost:3000/api/transactions?limit=20"

# Get next page using cursor
curl "http://localhost:3000/api/transactions?limit=20&cursor=base64encodedcursor"
```

**Complete examples:**

- [TypeScript pagination consumer](../examples/api_pagination_consumer.ts)
- [Python pagination consumer](../examples/api_pagination_consumer.py)

### API Versioning

The API uses URL path versioning (`/api/v1/`). All new integrations must target the
versioned base path. Unversioned legacy paths redirect with `301` and will be removed
after the transition window.

See [VERSIONING.md](./VERSIONING.md) for the complete versioning scheme, deprecation
windows, sunset policy, and client migration guide.

### Rate Limiting

API endpoints are rate limited. See [RATE_LIMITING.md](./RATE_LIMITING.md) for details.

### SLA and SLO Targets

API reliability, availability/uptime, and latency targets are formally documented and validated. See [SLA_SLO.md](./SLA_SLO.md) for the exact targets and monitoring procedures.

### Error Handling

All errors follow a consistent format:

```json
{
  "error": "Error Type",
  "status": 400,
  "message": "Human-readable error message"
}
```

| Document | Purpose |
|----------|---------|
| [ERROR_FORMAT.md](./ERROR_FORMAT.md) | Frontend `ApiError` / `ValidationError` shapes and handling patterns |
| [ERROR_CODE_CATALOG.md](./ERROR_CODE_CATALOG.md) | Full error code list, HTTP/Soroban codes, and integrator remediation |

See [ERROR_CODE_CATALOG.md](./ERROR_CODE_CATALOG.md) when building SDKs or
support runbooks; use [ERROR_FORMAT.md](./ERROR_FORMAT.md) when working in the
React client.

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

### Version 1.2.0 (2026-07-26)
- Added comprehensive API authentication and token rotation guide ([AUTH_AND_TOKEN_GUIDE.md](./AUTH_AND_TOKEN_GUIDE.md))

### Version 1.1.0 (2026-06-27)
- Added API versioning and deprecation policy ([VERSIONING.md](./VERSIONING.md))

### Version 1.0.0 (2026-03-28)
- Initial API documentation
- Pagination conventions
- Rate limiting documentation
- Error format documentation
