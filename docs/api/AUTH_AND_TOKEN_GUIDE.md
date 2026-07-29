# API Authentication & Token Rotation Guide

This document covers all authentication mechanisms available in the YieldVault RWA
backend API, including credential management, token lifecycles, rotation procedures,
and security best practices.

---

## Table of Contents

1. [Authentication Overview](#authentication-overview)
2. [JWT Session Tokens](#jwt-session-tokens)
   - [Login Flow](#login-flow)
   - [Token Structure](#token-structure)
   - [Refresh Token Rotation](#refresh-token-rotation)
   - [Replay Detection & Theft Protection](#replay-detection--theft-protection)
   - [Logout & Session Revocation](#logout--session-revocation)
3. [API Key Authentication](#api-key-authentication)
   - [Key Roles & RBAC](#key-roles--rbac)
   - [Registering API Keys](#registering-api-keys)
   - [Rotating API Keys](#rotating-api-keys)
   - [Revoking & Restoring Keys](#revoking--restoring-keys)
   - [API Key Audit Trail](#api-key-audit-trail)
4. [Scoped Admin Tokens](#scoped-admin-tokens)
   - [Permission Model](#permission-model)
   - [Creating Scoped Tokens](#creating-scoped-tokens)
   - [Authenticating with Scoped Tokens](#authenticating-with-scoped-tokens)
   - [Rotating Scoped Token Secrets](#rotating-scoped-token-secrets)
   - [Revocation & Rotation History](#revocation--rotation-history)
5. [Wallet-Signed Actions](#wallet-signed-actions)
   - [Nonce Flow](#nonce-flow)
   - [Signature Modes](#signature-modes)
6. [Transaction Export Access](#transaction-export-access)
7. [Environment Variables Reference](#environment-variables-reference)
8. [Security Best Practices](#security-best-practices)
9. [Token Rotation Schedule](#token-rotation-schedule)
10. [Common Patterns & Recipes](#common-patterns--recipes)

---

## Authentication Overview

| Scheme | Header Format | TTL | Use Case |
|--------|--------------|-----|----------|
| **JWT Bearer** | `Authorization: Bearer <access-token>` | 15 min (access), 7 days (refresh) | User wallet sessions |
| **API Key** | `Authorization: ApiKey <api-key>` | Indefinite (until revoked) | Admin operations, system integrations |
| **Scoped Admin Token** | Varies by integration route | Configurable | CI/CD pipelines, fine-grained admin access |
| **Wallet Signature** | Body: `{ walletAddress, nonce, signature }` | 5 min (nonce) | Login/write actions when enforcement is strict |

The backend inspects the `Authorization` header to determine the scheme.
- `Bearer` prefix → JWT access token verified via `requireAuth`.
- `ApiKey` prefix → validated against the in-memory API key registry via `validateApiKey`.
- Scoped admin tokens are authenticated separately through dedicated admin routes.

All auth-protected routes return `401 Unauthorized` for missing, malformed, or
expired credentials. RBAC violations return `403 Forbidden`.

---

## JWT Session Tokens

### Login Flow

```
Client                          Server
  │                               │
  │  POST /api/v1/auth/login      │
  │  { walletAddress }            │
  │ ──────────────────────────────▶
  │                               │ 1. Normalize wallet address
  │                               │ 2. Register wallet alias mapping
  │                               │ 3. Issue token pair
  │  { accessToken,               │
  │    refreshToken,               │
  │    accessTokenExpiresAt,       │
  │    tokenType: "Bearer",        │
  │    expiresIn: 900,             │
  │    canonicalWallet }           │
  │ ◀──────────────────────────────│
  │                               │
```

**When wallet signature enforcement is on** (production default), the login flow
requires a server-issued nonce first:

```
1. POST /api/v1/auth/nonce  →  { nonce, message, expiresAt }
2. Sign the message with the wallet private key
3. POST /api/v1/auth/login  →  { walletAddress, nonce, signature }
```

All auth endpoints are rate-limited to 5 requests per minute via `authLimiter`.

### Token Structure

**Access Token** — HS256-signed JWT:

```json
// Header
{ "alg": "HS256", "typ": "JWT" }

// Payload
{
  "sub": "<stellar-wallet-address>",
  "iat": 1719943200,
  "exp": 1719944100,
  "jti": "<uuid>"
}
```

- **Algorithm**: HMAC-SHA256 (HS256)
- **TTL**: 15 minutes (configurable via `JWT_ACCESS_TTL_SECONDS`)
- **Secret**: `JWT_SECRET` env var (minimum 32 chars, 3+ character classes in production)

**Refresh Token** — 80-character hex string (cryptographically random, opaque):

- **TTL**: 7 days (configurable via `JWT_REFRESH_TTL_SECONDS`)
- **Storage**: In-memory `Map` (single-instance) or Redis (multi-instance)
- **Format**: 40 random bytes → hex (no external JWT library dependency)

### Refresh Token Rotation

The server implements **automatic refresh token rotation**. Every call to
`POST /api/v1/auth/refresh` replaces the presented refresh token with a new one:

```
POST /api/v1/auth/refresh
{ "refreshToken": "<old-refresh-token>" }

Response:
{
  "accessToken": "<new-access-token>",
  "refreshToken": "<new-refresh-token>",
  "accessTokenExpiresAt": "2026-07-26T...",
  "tokenType": "Bearer",
  "expiresIn": 900
}
```

**Rotation lifecycle:**

```
Rotation #1:  RT₁ issued → RT₂ issued, RT₁ revoked
Rotation #2:  RT₂ issued → RT₃ issued, RT₂ revoked
     ⋮
Rotation #n:  RTₙ issued → RTₙ₊₁ issued, RTₙ revoked
```

All tokens in a rotation chain share a common **family ID** (UUID). This enables
the server to detect stale or replayed tokens across the entire session.

### Replay Detection & Theft Protection

If a refresh token that has **already been used** (revoked) is presented again,
the server detects a potential **refresh token theft** and:

1. Immediately invalidates the **entire token family** (all tokens in the rotation chain)
2. Returns `401 Unauthorized` with `sessionRevoked: true`
3. Logs a warning with the family ID and wallet fingerprint

```json
// Replay detected response
{
  "error": "Unauthorized",
  "status": 401,
  "message": "Refresh token has already been used. Session revoked for security.",
  "sessionRevoked": true
}
```

**Client-side handling of `sessionRevoked`:**

```typescript
if (error.response?.data?.sessionRevoked) {
  // All sessions for this login are now revoked.
  // Redirect user to login, do not retry.
  redirectToLogin();
}
```

### Logout & Session Revocation

| Endpoint | Auth | Effect |
|----------|------|--------|
| `POST /api/v1/auth/logout` | Bearer token | Returns success; full session revocation via token family is planned |
| `POST /api/v1/auth/logout-all` | Bearer token | Returns success; full wallet-wide revocation with Redis indexing is planned |

> **Note:** The current logout endpoints validate authentication and return a
> success response, but do not yet invoke the server-side `revokeCurrentSession()`
> or `revokeAllSessions()` functions exposed from `auth.ts`. These functions are
> implemented and ready for integration. In the meantime, sessions naturally
> expire based on the refresh token TTL (7 days by default).

**Logout behavior once fully integrated:**
- `logout`: revokes the token family, deleting all family tokens from Redis
- `logout-all`: best-effort — revokes the current token's family; full wallet
  scan requires a secondary index which is not currently implemented

---

## API Key Authentication

API keys grant programmatic access to admin endpoints and privileged operations.
Keys are hashed with SHA-256 and stored in an in-memory registry (test/develop)
or externally managed (production).

### Key Roles & RBAC

| Role | Level | Allowed Operations |
|------|-------|--------------------|
| `viewer` | 1 | Read-only admin endpoints (metrics, health, audit log reads) |
| `operator` | 2 | Viewer + maintenance, cache, allowlist, webhooks, jobs, exports |
| `admin` | 3 | Operator + all admin except impersonation & global idempotency flush |
| `super-admin` | 4 | All operations including impersonation, super-admin key registration, withdrawal limit overrides |

RBAC is enforced by `adminRbacMiddleware` which maps route patterns to
required permissions:

```
POST /admin/api-keys/register  →  requires admin.api_keys.write
POST /admin/api-keys/rotate    →  requires admin.api_keys.write
POST /admin/api-keys/revoke    →  requires admin.api_keys.write
POST /admin/scoped-tokens      →  requires admin.api_keys.super
POST /admin/scoped-tokens/:id/rotate → requires admin.api_keys.super
```

**Role hierarchy rule:** A key can create another key at its own role level or
lower. Only a `super-admin` key can register a new `super-admin` key.

### Registering API Keys

```bash
# Register a new admin key
curl -X POST http://localhost:3000/admin/api-keys/register \
  -H "Authorization: ApiKey <existing-admin-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "<new-api-key-value>",
    "role": "admin"
  }'

# Response
{
  "hash": "<sha256-hash>",
  "role": "admin",
  "createdAt": "2026-07-26T12:00:00.000Z"
}
```

**Key value requirements:**
- Must be sufficiently random (recommend `crypto.randomBytes(32).toString('hex')`)
- Must be kept secret — only the SHA-256 hash is stored
- Plaintext is shown once at registration time

### Rotating API Keys

```bash
# Rotate an existing key (replace old key with a new one)
curl -X POST http://localhost:3000/admin/api-keys/rotate \
  -H "Authorization: ApiKey <existing-admin-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "oldKey": "<current-key-value>",
    "newKey": "<new-key-value>",
    "role": "admin"
  }'
```

**Rotation behavior:**
- The old key hash is deleted from the registry
- The new key is registered with the same role and `createdAt` preserved
- A `rotatedAt` timestamp is recorded on the new key metadata

**Best practice:** Rotate API keys on a regular schedule (e.g., every 90 days)
or immediately upon suspected compromise.

### Revoking & Restoring Keys

```bash
# Revoke a key by its hash
curl -X POST http://localhost:3000/admin/api-keys/revoke \
  -H "Authorization: ApiKey <admin-key>" \
  -H "Content-Type: application/json" \
  -d '{ "key": "<key-value-to-revoke>" }'

# Restore a previously revoked key
curl -X POST http://localhost:3000/admin/api-keys/restore \
  -H "Authorization: ApiKey <admin-key>" \
  -H "Content-Type: application/json" \
  -d '{ "hash": "<sha256-hash>" }'
```

### API Key Audit Trail

All API key operations (register, rotate, revoke, restore) emit immutable audit
events via `recordApiKeyAuditEvent`. Audit events include:

```typescript
{
  action: "registered" | "rotated" | "revoked" | "restored",
  keyFingerprint: "sha256:<first-16-hex-chars>",  // non-reversible
  actor: "apiKey:<hash-fingerprint>",             // who performed the action
  timestamp: "2026-07-26T12:00:00.000Z"
}
```

Audit events are queryable via the `listApiKeyAuditEvents` API.

---

## Scoped Admin Tokens

Scoped admin tokens provide **fine-grained, permission-scoped** admin access
with the ability to issue many tokens without sharing a global API key.

**Use cases:**
- CI/CD pipelines that need limited admin access
- Third-party integrations requiring read-only metrics
- Temporary access grants for support staff

### Permission Model

```typescript
type AdminPermission =
  | 'read:audit'        | 'write:config'
  | 'read:metrics'      | 'write:maintenance'
  | 'read:webhooks'     | 'write:webhooks'
  | 'read:exports'      | 'write:exports'
  | 'read:allowlist'    | 'write:allowlist'
  | 'read:users'        | 'write:users'
  | 'admin:*';           // wildcard — grants all permissions
```

Permissions are enforced per-endpoint. The `admin:*` wildcard grants every
permission.

### Creating Scoped Tokens

```bash
# Requires super-admin API key
curl -X POST http://localhost:3000/admin/scoped-tokens \
  -H "Authorization: ApiKey <super-admin-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "label": "CI Pipeline - Deploy",
    "permissions": ["read:metrics", "read:audit"],
    "expiresInSeconds": 86400,
    "createdBy": "admin@yieldvault.finance"
  }'

# Response (secret shown ONCE)
{
  "token": {
    "keyId": "yv_a1b2c3d4e5f6g7h8",
    "permissions": ["read:metrics", "read:audit"],
    "label": "CI Pipeline - Deploy",
    "createdAt": "2026-07-26T12:00:00.000Z",
    "expiresAt": "2026-07-27T12:00:00.000Z",
    "revoked": false
  },
  "secret": "<64-char-hex-secret>"
}
```

**Important:** The `secret` is only returned once at creation time. Store it
securely (e.g., in a secrets manager). The server only stores the SHA-256 hash.

### Authenticating with Scoped Tokens

```bash
curl -H "Authorization: Bearer <scoped-token-secret>" \
  http://localhost:3000/admin/metrics
```

The server authenticates scoped tokens by matching the `keyId` format (`yv_*`)
in the Bearer token and looking up the corresponding hashed secret. Authentication
uses `crypto.timingSafeEqual` to prevent timing attacks.

### Rotating Scoped Token Secrets

Scoped tokens support **in-place secret rotation** without changing the `keyId`:

```bash
curl -X POST http://localhost:3000/admin/scoped-tokens/yv_a1b2c3d4e5f6g7h8/rotate \
  -H "Authorization: ApiKey <super-admin-key>" \
  -H "Content-Type: application/json" \
  -d '{ "rotatedBy": "admin@yieldvault.finance" }'

# Response
{
  "keyId": "yv_a1b2c3d4e5f6g7h8",
  "newSecret": "<new-64-char-hex-secret>",
  "rotatedAt": "2026-07-26T13:00:00.000Z"
}
```

**Rotation behavior:**
- A new 64-char hex secret is generated
- The old secret is **immediately invalidated**
- An immutable `ScopedAdminTokenRotationEvent` row is written for audit
- The `keyId`, permissions, and label remain unchanged
- The rotation is performed in a Prisma transaction for atomicity

**Cluster safety:** Because state lives in the database (Postgres/SQLite via
Prisma), every backend replica reads the same revocation and rotation state.
No stale-token windows exist across instances.

### Revocation & Rotation History

```bash
# Revoke a token
curl -X POST http://localhost:3000/admin/scoped-tokens/yv_a1b2c3d4e5f6g7h8/revoke \
  -H "Authorization: ApiKey <super-admin-key>"

# View rotation history (immutable audit trail)
curl http://localhost:3000/admin/scoped-tokens/yv_a1b2c3d4e5f6g7h8/rotations \
  -H "Authorization: ApiKey <super-admin-key>"

# Response
[
  {
    "id": "uuid",
    "keyId": "yv_a1b2c3d4e5f6g7h8",
    "keyFingerprint": "sha256:<first-16-hex>",
    "rotatedBy": "admin@yieldvault.finance",
    "rotatedAt": "2026-07-26T13:00:00.000Z"
  }
]
```

**Note:** Rotation history records only the key fingerprint (first 16 hex chars
of the hash) and the actor identity. **Old secrets are never stored or logged.**

---

## Wallet-Signed Actions

For high-security operations (login, deposits, withdrawals), the backend
supports wallet-signed actions with server-issued nonces.

### Nonce Flow

```
1. Client requests nonce:
   POST /api/v1/auth/nonce
   { "walletAddress": "GABC...", "action": "login" }

2. Server returns:
   {
     "nonce": "<random-nonce>",
     "message": "YieldVault Signed Action\nWallet: GABC...\nAction: login\n...",
     "issuedAt": "2026-07-26T12:00:00.000Z",
     "expiresAt": "2026-07-26T12:05:00.000Z"
   }

3. Client signs the message with wallet private key

4. Client submits:
   POST /api/v1/auth/login
   { "walletAddress": "GABC...", "nonce": "<nonce>", "signature": "<base64-sig>" }
```

**Nonce properties:**
- Single-use: consumed immediately after successful validation
- TTL: 5 minutes (configurable via `WALLET_NONCE_TTL_SECONDS`)
- Max active nonces per wallet: 10 (configurable via `WALLET_NONCE_MAX_ACTIVE_PER_WALLET`)
- Nonce replay returns `401 Nonce Replay` with code `NONCE_REPLAY`
- Allocation and consumption are atomic; concurrent requests cannot consume the
  same nonce or exceed the active nonce cap
- Multi-instance deployments must set `REDIS_URL` so atomic nonce state is
  shared across replicas; the in-memory store protects only a single process

### Signature Modes

| Mode | Env Var | Algorithm | Use |
|------|---------|-----------|-----|
| `stellar` | `WALLET_SIGNATURE_MODE=stellar` | Ed25519 (Stellar keypair) | Production |
| `hmac` | `WALLET_SIGNATURE_MODE=hmac` | HMAC-SHA256 (dev secret) | Development / testing |

**Enforcement levels (via `WALLET_NONCE_ENFORCEMENT`):**
- `off` / `false` — skip signature checks (not recommended for production)
- `strict` / `on` — require valid nonce + signature on every write operation
- Default in `NODE_ENV=production`: `strict`

---

## Transaction Export Access

`GET /api/v1/vault/transactions/export` supports both authentication methods
with different access scoping:

| Auth Method | Wallet Scope | Admin Bypass |
|-------------|-------------|--------------|
| `Bearer <JWT>` | Scoped to the JWT subject (`sub`). `walletAddress` query must match or `403`. | No |
| `ApiKey <key>` (admin+) | `walletAddress` query param **required**. Any wallet allowed. | Yes |

```bash
# User export (own wallet only)
curl "http://localhost:3000/api/v1/vault/transactions/export?format=json" \
  -H "Authorization: Bearer <user-jwt>"

# Admin export (any wallet)
curl "http://localhost:3000/api/v1/vault/transactions/export?format=csv&walletAddress=GDEF..." \
  -H "Authorization: ApiKey <admin-key>"
```

---

## Environment Variables Reference

### JWT Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | `change-me-in-production-...` | HMAC-SHA256 signing secret (min 32 chars, 3+ char classes in prod) |
| `JWT_ACCESS_TTL_SECONDS` | `900` | Access token lifetime (15 minutes) |
| `JWT_REFRESH_TTL_SECONDS` | `604800` | Refresh token lifetime (7 days) |

### API Key Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_API_KEY` | — | Pre-registered admin key for bootstrap (test environments) |

### Wallet Signature Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `WALLET_SIGNATURE_MODE` | `stellar` (prod) / `hmac` (dev) | Signature verification mode |
| `WALLET_NONCE_ENFORCEMENT` | `strict` (prod) | Nonce enforcement strictness |
| `WALLET_NONCE_TTL_SECONDS` | `300` | Nonce timeout in seconds |
| `WALLET_NONCE_MAX_ACTIVE_PER_WALLET` | `10` | Max pending nonces per wallet |
| `WALLET_ACTION_HMAC_SECRET` | Falls back to `JWT_SECRET` | HMAC secret when in `hmac` mode |
| `REDIS_URL` | — | Shared nonce store required for replay protection across backend replicas |

### Refresh Token Store

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | — | Redis connection URL. When set, refresh tokens are persisted in Redis instead of in-memory. Required for multi-instance deployments. |

### Rate Limiting (Auth Tier)

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_AUTH_MAX` | `5` | Max requests per window for `/auth/*` endpoints |
| `RATE_LIMIT_AUTH_WINDOW_MS` | `60000` | Window duration in ms (60 seconds) |

### Payload Limits

| Variable | Default | Description |
|----------|---------|-------------|
| `PAYLOAD_LIMIT_AUTH` | `4kb` | Max body size for auth endpoints |

---

## Security Best Practices

### 1. JWT Secret Management

```
✅ DO:   Use a strong, randomly generated secret ≥ 32 chars
✅ DO:   Rotate the JWT_SECRET on a schedule (invalidates all existing tokens)
✅ DO:   Store JWT_SECRET in a secrets manager (Vault, AWS Secrets Manager, etc.)
❌ DON'T: Hardcode secrets in source code or config files
❌ DON'T: Use the default development secret in production
```

The server performs **startup validation** in production — it will refuse to
start if `JWT_SECRET` is missing, too short, or lacks character-class diversity.

### 2. Access Token Lifetime

- **15 minutes** is the recommended default — short enough to limit blast radius
  of a stolen token, long enough to avoid excessive refresh calls
- If you extend the TTL, consider the trade-off: longer access = larger window
  for token misuse before logout takes effect

### 3. Refresh Token Storage (Client Side)

```
✅ DO:   Store refresh tokens in httpOnly, Secure, SameSite cookies
✅ DO:   Store access tokens in memory (not localStorage)
❌ DON'T: Store refresh tokens in localStorage or sessionStorage
❌ DON'T: Expose refresh tokens in URL parameters or logs
```

### 4. API Key Management

```
✅ DO:   Generate keys with crypto.randomBytes(32).toString('hex')
✅ DO:   Rotate keys every 90 days
✅ DO:   Use the least-privileged role for each integration
✅ DO:   Revoke keys immediately when a team member leaves
❌ DON'T: Share API keys across teams or services
❌ DON'T: Commit API keys to source control
```

### 5. Scoped Admin Tokens

```
✅ DO:   Prefer scoped tokens over long-lived API keys for automated systems
✅ DO:   Set short expiration times for CI/CD tokens (e.g., 1 hour)
✅ DO:   Rotate secrets after incidents or suspicious activity
✅ DO:   Monitor rotation events via the audit trail
❌ DON'T: Grant admin:* unless absolutely necessary
```

### 6. General

- **Redaction**: All sensitive values (passwords, tokens, API keys, secrets) are
  automatically redacted from logs via `auditRedaction.ts` and `redaction.ts`.
- **Correlation IDs**: Every request gets a correlation ID for tracing through
  the auth lifecycle.
- **Rate Limiting**: Auth endpoints are strictly rate-limited (5 req/min) to
  prevent brute-force attacks.
- **Payload Limits**: Auth endpoints enforce a 4 KB body limit to prevent abuse.
- **Timing Attacks**: All secret comparisons use `crypto.timingSafeEqual`.

---

## Token Rotation Schedule

| Token Type | Recommended Rotation | Mechanism | Automation |
|------------|---------------------|-----------|------------|
| **JWT Access Token** | N/A (auto-expires 15 min) | — | Client auto-refresh |
| **JWT Refresh Token** | N/A (auto-rotated each use) | `POST /auth/refresh` | Client SDK |
| **Admin API Key** | Every 90 days | `POST /admin/api-keys/rotate` | Manual or cron |
| **Scoped Admin Token** | Every 30 days (or after incident) | `POST /admin/scoped-tokens/:id/rotate` | CI/CD pipeline |
| **JWT_SECRET** | Every 6 months | Re-deploy with new env var | Manual (invalidates all sessions) |

### Automated Rotation Example (Scoped Token)

```bash
#!/bin/bash
# Rotate a scoped admin token and update CI secrets

KEY_ID="yv_a1b2c3d4e5f6g7h8"
SUPER_ADMIN_KEY="${SUPER_ADMIN_API_KEY}"

RESPONSE=$(curl -s -X POST \
  "http://localhost:3000/admin/scoped-tokens/${KEY_ID}/rotate" \
  -H "Authorization: ApiKey ${SUPER_ADMIN_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"rotatedBy\": \"ci-rotation-bot\"}")

NEW_SECRET=$(echo "$RESPONSE" | jq -r '.newSecret')

# Store new secret in CI variable store
# e.g., gh secret set SCOPED_ADMIN_TOKEN --body "$NEW_SECRET"
echo "Rotated token ${KEY_ID} at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

---

## Common Patterns & Recipes

### User Login (with nonce enforcement)

```typescript
// 1. Get a nonce
const { nonce, message } = await api.post('/auth/nonce', {
  walletAddress: 'GABC...',
  action: 'login',
});

// 2. Sign the message with Stellar wallet
const signature = await wallet.signMessage(message);

// 3. Login with signed payload
const { accessToken, refreshToken, accessTokenExpiresAt } = await api.post('/auth/login', {
  walletAddress: 'GABC...',
  nonce,
  signature,
});

// 4. Store tokens
storeAccessToken(accessToken);
storeRefreshToken(refreshToken);
```

### Token Refresh with Auto-Retry (Replay-Safe)

```typescript
async function refreshAccessToken(): Promise<string> {
  const refreshToken = getStoredRefreshToken();

  try {
    const { accessToken, refreshToken: newRefreshToken } =
      await api.post('/auth/refresh', { refreshToken });

    storeAccessToken(accessToken);
    storeRefreshToken(newRefreshToken);
    return accessToken;
  } catch (error) {
    if (error.response?.data?.sessionRevoked) {
      // Entire session revoked — possible theft detected
      clearAllTokens();
      redirectToLogin();
      throw new Error('Session revoked for security');
    }
    // Token expired (7+ days without use)
    clearAllTokens();
    throw new Error('Refresh token expired');
  }
}
```

### Axios Interceptor with Silent Refresh

```typescript
let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

function onRefreshed(token: string) {
  refreshSubscribers.forEach(cb => cb(token));
  refreshSubscribers = [];
}

api.interceptors.response.use(
  response => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        // Queue this request until refresh completes
        return new Promise(resolve => {
          refreshSubscribers.push((token: string) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(api(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const newToken = await refreshAccessToken();
        onRefreshed(newToken);
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);
```

### API Key Registration Script

```bash
#!/bin/bash
# Register a new admin API key

NEW_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
EXISTING_ADMIN_KEY="${ADMIN_API_KEY}"

curl -X POST http://localhost:3000/admin/api-keys/register \
  -H "Authorization: ApiKey ${EXISTING_ADMIN_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"key\": \"${NEW_KEY}\", \"role\": \"admin\"}"

echo "New key (save this): ${NEW_KEY}"
```

### Verifying a Scoped Token Has Permission

```typescript
// Server-side permission check (in middleware)
if (scopedAdminTokenStore.hasPermission(token, 'read:metrics')) {
  // Allow access to metrics endpoint
}
```

---

## Related Documentation

- [API General Documentation](./README.md)
- [Error Code Catalog](./ERROR_CODE_CATALOG.md)
- [Paginated API Consumer Examples](../examples/api_pagination_consumer.ts)
- [Webhook Integration Guide](../WEBHOOK_INTEGRATION.md)
- [Security Checklist](../SECURITY_CHECKLIST.md)
- [Production Security Checklist](../PRODUCTION_SECURITY_CHECKLIST.md)
- [Threat Model](../THREAT_MODEL.md)
