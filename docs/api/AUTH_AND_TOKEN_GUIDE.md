# API Authentication & Token Rotation Guide

This document covers all authentication mechanisms in the YieldVault RWA backend API, including credential management, token lifecycles, rotation procedures, multi-instance deployment considerations, monitoring, and incident response.

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
   - [Prisma-Backed Persistence](#prisma-backed-persistence)
   - [Key Roles & RBAC](#key-roles--rbac)
   - [Creating API Keys](#creating-api-keys)
   - [Rotating API Keys](#rotating-api-keys)
   - [Revoking & Restoring Keys](#revoking--restoring-keys)
   - [API Key Audit Trail](#api-key-audit-trail)
4. [Scoped Admin Tokens](#scoped-admin-tokens)
   - [Permission Model](#permission-model)
   - [Creating Scoped Tokens](#creating-scoped-tokens)
   - [Authenticating with Scoped Tokens](#authenticating-with-scoped-tokens)
   - [Rotating Scoped Token Secrets](#rotating-scoped-token-secrets)
   - [Revocation & Rotation History](#revocation--rotation-history)
5. [Admin Impersonation Sessions](#admin-impersonation-sessions)
6. [Wallet-Signed Actions](#wallet-signed-actions)
   - [Nonce Flow](#nonce-flow)
   - [Signature Modes](#signature-modes)
7. [Transaction Export Access](#transaction-export-access)
8. [Multi-Instance Deployment](#multi-instance-deployment)
9. [Environment Variables Reference](#environment-variables-reference)
10. [Security Best Practices](#security-best-practices)
11. [Token Rotation Schedule](#token-rotation-schedule)
12. [Monitoring & Alerting](#monitoring--alerting)
13. [Incident Response](#incident-response)
14. [Common Patterns & Recipes](#common-patterns--recipes)

---

## Authentication Overview

The backend supports three authentication schemes plus wallet-signed action verification:

| Scheme | Header Format | TTL | Storage | Use Case |
|--------|--------------|-----|---------|----------|
| **JWT Bearer** | `Authorization: Bearer <access-token>` | 15 min (access), 7 days (refresh) | Redis / in-memory | User wallet sessions |
| **API Key** | `Authorization: ApiKey <api-key>` | Indefinite (until revoked) | Prisma (Postgres/SQLite) | Admin operations, system integrations |
| **Scoped Admin Token** | `Authorization: Bearer <scoped-token-secret>` | Configurable (default none) | Prisma (Postgres/SQLite) | CI/CD pipelines, fine-grained admin access |
| **Wallet Signature** | Body: `{ walletAddress, nonce, signature }` | 5 min (nonce) | Redis / in-memory | Login/write actions when enforcement is strict |

The backend inspects the `Authorization` header to determine the scheme:
- `Bearer` prefix with standard JWT format (`header.payload.signature`) → JWT access token via `requireAuth`
- `Bearer` prefix with `yv_`-prefixed keyId → scoped admin token via `scopedAdminTokenStore.authenticate`
- `ApiKey` prefix → validated against the Prisma-backed API key registry via `validateApiKey`

All auth-protected routes return `401 Unauthorized` for missing, malformed, or expired credentials. RBAC violations return `403 Forbidden`.

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

**When wallet signature enforcement is on** (production default), the login flow requires a server-issued nonce first:

```
1. POST /api/v1/auth/nonce  →  { nonce, message, expiresAt }
2. Sign the message with the wallet private key
3. POST /api/v1/auth/login  →  { walletAddress, nonce, signature }
```

All auth endpoints are rate-limited to 5 requests per minute per IP via `authLimiter`.

### Token Structure

**Access Token** — HS256-signed JWT, no external library required:

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
- **Startup validation**: The server fails fast in production if `JWT_SECRET` is absent, too short, or lacks entropy (see `auth.ts:assertJwtSecretValid`)

**Refresh Token** — 80-character hex string (cryptographically random, opaque):

- **TTL**: 7 days (configurable via `JWT_REFRESH_TTL_SECONDS`)
- **Storage**: Redis (multi-instance) or in-memory `Map` (single-instance)
- **Format**: 40 random bytes → hex (no JWT library needed)
- **Hash**: Stored as SHA-256 hash; plaintext returned to client exactly once

### Refresh Token Rotation

The server implements **automatic refresh token rotation**. Every call to `POST /api/v1/auth/refresh` replaces the presented refresh token with a new one:

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

All tokens in a rotation chain share a common **family ID** (UUID). This enables the server to detect stale or replayed tokens across the entire session. The family ID is generated on first login and preserved across all rotations.

**Atomicity**: The old token is marked revoked (`entry.revoked = true`) before the new token is issued. If the server crashes between revocation and issuance, the old token is already marked as used and the client must log in again — no orphan tokens are left valid.

### Replay Detection & Theft Protection

If a refresh token that has **already been used** (revoked) is presented again, the server detects a potential **refresh token theft** and:

1. Immediately invalidates the **entire token family** (all tokens in the rotation chain)
2. Returns `401 Unauthorized` with `sessionRevoked: true`
3. Logs a warning with the family ID and wallet fingerprint
4. Records the event for monitoring and alerting

```json
{
  "error": "Unauthorized",
  "status": 401,
  "message": "Refresh token has already been used. Session revoked for security.",
  "sessionRevoked": true
}
```

**Client-side handling:**

```typescript
if (error.response?.data?.sessionRevoked) {
  // All sessions for this login are now revoked.
  // Redirect user to login, do not retry.
  redirectToLogin();
}
```

**Replay protection across instances**: When Redis is configured, the revoked family ID is stored with a TTL matching the refresh token lifetime. All backend instances share the same Redis, so replay detection works cluster-wide.

### Logout & Session Revocation

| Endpoint | Auth | Effect |
|----------|------|--------|
| `POST /api/v1/auth/logout` | Bearer token | Revokes the current token family (all tokens in the rotation chain) |
| `POST /api/v1/auth/logout-all` | Bearer token | Revokes all known token families for the wallet (in-memory) or current family (Redis) |

**In-memory store**: `logout-all` iterates all stored tokens for the wallet and revokes every family. This is O(n) where n = number of active tokens.

**Redis store**: Full wallet scan requires a secondary index (not currently implemented). `logout-all` revokes the current token's family as a best-effort measure. Individual token families still expire naturally based on the refresh token TTL.

```typescript
// Server-side revocation (auth.ts)
export async function revokeCurrentSession(refreshToken: string): Promise<void> {
  const entry = await refreshTokenStore.get(refreshToken);
  if (!entry) return;
  await refreshTokenStore.revokeFamily(entry.familyId, getRefreshTtl());
  await refreshTokenStore.deleteFamily(entry.familyId);
  await refreshTokenStore.delete(refreshToken);
}
```

---

## API Key Authentication

### Prisma-Backed Persistence

API keys are stored in the `ApiKey` Prisma model (`prisma/schema.prisma`):

```prisma
model ApiKey {
  id         String   @id @default(uuid())
  tenantId   String
  hashedKey  String   @unique
  role       String
  scopes     String[]
  createdAt  DateTime @default(now())
  expiresAt  DateTime?
  isActive   Boolean  @default(true)
  tenant     Tenant   @relation(fields: [tenantId], references: [id])
  @@index([tenantId])
  @@index([role])
}
```

Key properties:
- **Only SHA-256 hashes are stored** — plaintext key values are never persisted
- **Keys are scoped to a Tenant** — multi-tenant isolation is baked in
- **Role and scopes** control access level and granular permissions
- **`isActive` flag** allows soft revocation without data loss
- **`expiresAt`** supports time-bound keys for temporary access

The `validateApiKey` middleware (`middleware/apiKeyAuth.ts`) hashes the provided key and looks it up via Prisma:

```typescript
const hashed = crypto.createHash('sha256').update(providedKey).digest('hex');
const apiKey = await prisma.apiKey.findUnique({ where: { hashedKey: hashed } });
if (!apiKey || !apiKey.isActive) {
  res.status(401).json({ error: 'Unauthorized', message: 'Invalid API key' });
  return;
}
```

### Key Roles & RBAC

| Role | Level | Allowed Operations |
|------|-------|--------------------|
| `viewer` | 0 | Read-only admin endpoints (metrics, health, audit log reads) |
| `operator` | 1 | Viewer + maintenance, cache, allowlist, webhooks, jobs, exports |
| `admin` | 2 | Operator + all admin except impersonation & global idempotency flush |
| `super-admin` | 3 | All operations including impersonation, super-admin key registration, withdrawal limit overrides |

RBAC is enforced by `adminRbacMiddleware` (`middleware/rbac.ts`) which resolves the required permission for each admin route:

```
POST   /admin/api-keys/register           → admin.api_keys.write
POST   /admin/api-keys/rotate             → admin.api_keys.write
POST   /admin/api-keys/revoke             → admin.api_keys.write
POST   /admin/scoped-tokens               → admin.api_keys.super
POST   /admin/scoped-tokens/:id/rotate    → admin.api_keys.super
POST   /admin/impersonate/sessions        → admin.impersonate
```

**Role hierarchy rule**: A key can create another key at its own role level or lower. Only a `super-admin` key can register a new `super-admin` key or create scoped admin tokens.

**Permission resolution for unknown routes**:
- `GET`/`HEAD` on unknown admin routes defaults to `admin.read`
- Mutating methods on unknown admin routes defaults to `admin.api_keys.write`

### Creating API Keys

```bash
# Register a new admin key (requires admin+ or super-admin)
curl -X POST http://localhost:3000/admin/api-keys/register \
  -H "Authorization: ApiKey <existing-admin-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "<new-api-key-value>",
    "role": "admin",
    "tenantId": "<tenant-uuid>",
    "expiresInDays": 90
  }'

# Response (key hash returned, plaintext NOT stored)
{
  "id": "uuid",
  "hashedKey": "<sha256-hash>",
  "role": "admin",
  "tenantId": "<tenant-uuid>",
  "createdAt": "2026-07-26T12:00:00.000Z",
  "expiresAt": "2026-10-24T12:00:00.000Z",
  "isActive": true
}
```

**Key value requirements:**
- Generate with `crypto.randomBytes(32).toString('hex')` — 64 hex characters, 256 bits of entropy
- Must be kept secret — only the SHA-256 hash is stored
- Plaintext is never returned after creation; store immediately in a secrets manager
- Optional `expiresInDays` for time-bound keys

### Rotating API Keys

```bash
# Rotate an existing key (replace old hash with a new one)
curl -X POST http://localhost:3000/admin/api-keys/rotate \
  -H "Authorization: ApiKey <existing-admin-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "<api-key-uuid>",
    "newKey": "<new-api-key-value>"
  }'

# Response
{
  "id": "uuid",
  "hashedKey": "<new-sha256-hash>",
  "role": "admin",
  "rotatedAt": "2026-07-26T13:00:00.000Z"
}
```

**Rotation behavior:**
- The old key hash is replaced with the new hash (same DB record, same `id`)
- `rotatedAt` timestamp is recorded
- Role, tenant, and scopes are preserved
- The old plaintext key is immediately invalidated

**Best practice:** Rotate API keys every 90 days or immediately upon suspected compromise. Use the `apiKeyService.rotateApiKey()` function for programmatic rotation.

### Revoking & Restoring Keys

```bash
# Revoke a key by its ID (soft delete — sets isActive = false)
curl -X POST http://localhost:3000/admin/api-keys/revoke \
  -H "Authorization: ApiKey <admin-key>" \
  -H "Content-Type: application/json" \
  -d '{ "id": "<api-key-uuid>" }'

# Response
{ "success": true, "revokedAt": "2026-07-26T14:00:00.000Z" }
```

**Revocation is persistent** — the `isActive` flag is set to `false` in the database. Unlike the legacy in-memory store, revocation survives server restarts and is visible to all backend instances.

**Restoring** requires direct database manipulation (no admin endpoint currently exposed) — set `isActive = true` and clear `revokedAt`.

### API Key Audit Trail

All API key operations emit immutable audit events via the `ApiKeyAuditEvent` Prisma model:

```prisma
model ApiKeyAuditEvent {
  id             String   @id @default(uuid())
  actor          String
  action         String   // "registered" | "rotated" | "revoked"
  keyFingerprint String   // "sha256:<first-16-hex-chars>"
  createdAt      DateTime @default(now())
}
```

Query audit events:

```bash
curl http://localhost:3000/admin/api-keys/audit-events \
  -H "Authorization: ApiKey <admin-key>"

# Response
[
  {
    "id": "uuid",
    "actor": "apiKey:<hash-fingerprint>",
    "action": "rotated",
    "keyFingerprint": "sha256:a1b2c3d4e5f6g7h8",
    "createdAt": "2026-07-26T13:00:00.000Z"
  }
]
```

---

## Scoped Admin Tokens

Scoped admin tokens provide **fine-grained, permission-scoped** admin access without sharing a global API key. They are ideal for:

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

Tokens are stored in the `ScopedAdminToken` Prisma model with JSON-serialized permissions:

```prisma
model ScopedAdminToken {
  id           String    @id @default(uuid())
  keyId        String    @unique   // yv_<16-hex-chars>
  hashedSecret String              // SHA-256(secret)
  permissions  String              // JSON-serialized AdminPermission[]
  label        String
  createdBy    String
  revoked      Boolean   @default(false)
  revokedBy    String?
  revokedAt    DateTime?
  expiresAt    DateTime?
  createdAt    DateTime  @default(now())
  rotatedAt    DateTime?
}
```

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

**Important:** The `secret` is only returned once at creation time. Store it securely (e.g., in a secrets manager). The server only stores the SHA-256 hash.

### Authenticating with Scoped Tokens

```bash
curl -H "Authorization: Bearer yv_a1b2c3d4e5f6g7h8.<scoped-token-secret>" \
  http://localhost:3000/admin/metrics
```

The server authenticates scoped tokens by:
1. Extracting the `keyId` (prefix before the first `.`)
2. Looking up the corresponding hashed secret via `scopedAdminTokenStore.authenticate()`
3. Comparing secrets using `crypto.timingSafeEqual` to prevent timing attacks
4. Checking `revoked` flag and `expiresAt`

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
- A new 64-char hex secret is generated (`crypto.randomBytes(32)`)
- The old secret is **immediately invalidated** — the SHA-256 hash is replaced in the DB
- An immutable `ScopedAdminTokenRotationEvent` row is written for audit
- The `keyId`, permissions, and label remain unchanged — no downstream config updates needed
- The rotation is performed in a Prisma `$transaction` for atomicity
- Rotation of a revoked or non-existent token returns `null`

**Cluster safety:** Because state lives in the database (Postgres/SQLite via Prisma), every backend replica reads the same revocation and rotation state. No stale-token windows exist across instances.

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

**Note:** Rotation history records only the key fingerprint (first 16 hex chars of the hash) and the actor identity. **Old secrets are never stored or logged.**

---

## Admin Impersonation Sessions

The impersonation system allows super-admin users to act on behalf of a wallet for debugging and support purposes.

**Flow:**
1. Super-admin creates an impersonation session via `POST /admin/impersonate/sessions`
2. The session has a configurable expiry (default 1 hour)
3. All subsequent requests with the impersonation header are tagged in the audit log
4. The session can be explicitly ended via `DELETE /admin/impersonate/sessions/:id`
5. Every action taken during impersonation is recorded in the `AdminImpersonationLedgerEntry` table

**Prisma model:**

```prisma
model AdminImpersonationSession {
  id           String    @id @default(uuid())
  actor        String
  apiKeyHash   String
  targetWallet String
  reason       String    // Required — documented reason for impersonation
  startedAt    DateTime  @default(now())
  expiresAt    DateTime
  endedAt      DateTime?
  status       String    @default("active")
  ipAddress    String
  userAgent    String
}
```

**Security controls:**
- Only `super-admin` role can create impersonation sessions (enforced by `admin.impersonate` permission)
- A `reason` field is required for audit compliance
- Sessions auto-expire; expired sessions cannot be used
- All impersonated actions are logged with the original actor identity

---

## Wallet-Signed Actions

For high-security operations (login, deposits, withdrawals), the backend supports wallet-signed actions with server-issued nonces.

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
- **Single-use**: Consumed atomically immediately after successful validation
- **TTL**: 5 minutes (configurable via `WALLET_NONCE_TTL_SECONDS`)
- **Max active per wallet**: 10 (configurable via `WALLET_NONCE_MAX_ACTIVE_PER_WALLET`)
- **Strict action binding**: A nonce issued for `login` cannot be used for `deposit` or `withdrawal`
- **Wallet binding**: A nonce issued for wallet A cannot be used for wallet B
- **Concurrency safety**: Nonce operations are serialized per-wallet via an async mutex
- **Replay protection**: Returns `401 Nonce Replay` with code `NONCE_REPLAY` if replayed

**Error codes:**

| Error | HTTP Status | Code | Description |
|-------|-------------|------|-------------|
| `NonceNotFoundError` | 401 | `NONCE_NOT_FOUND` | Nonce was never issued |
| `NonceExpiredError` | 401 | `NONCE_EXPIRED` | Nonce TTL has elapsed |
| `NonceReplayError` | 401 | `NONCE_REPLAY` | Nonce already consumed |
| `NonceActionMismatchError` | 401 | `NONCE_ACTION_MISMATCH` | Wrong action type |
| `NonceWalletMismatchError` | 401 | `NONCE_WALLET_MISMATCH` | Wrong wallet address |

### Signature Modes

| Mode | Env Var | Algorithm | Use |
|------|---------|-----------|-----|
| `stellar` | `WALLET_SIGNATURE_MODE=stellar` | Ed25519 (Stellar keypair) | Production |
| `hmac` | `WALLET_SIGNATURE_MODE=hmac` | HMAC-SHA256 (dev secret) | Development / testing |

**Enforcement levels (via `WALLET_NONCE_ENFORCEMENT`):**
- `off` / `false` — skip signature checks (not recommended for production)
- `strict` / `on` — require valid nonce + signature on every write operation
- Default in `NODE_ENV=production`: `strict`

**Canonical payload format:**
```typescript
// Deterministic serialization for wallet message building
YieldVault Signed Action
Wallet: GABC123...
Action: login
Nonce: a1b2c3d4e5f6g7h8...
Issued At: 2026-07-26T12:00:00.000Z
Expires At: 2026-07-26T12:05:00.000Z
```

The message is constructed by `buildWalletSignMessage` in `walletSignature.ts` with deterministic, sorted key ordering to ensure cross-platform compatibility.

---

## Transaction Export Access

`GET /api/v1/vault/transactions/export` supports both authentication methods with different access scoping:

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

## Multi-Instance Deployment

### Token Store Configuration

For production deployments with multiple backend instances, Redis is **required** for:

1. **Refresh token store** (`auth.ts`): Set `REDIS_URL` to a TLS-enabled Redis instance. All instances share the same token state.
2. **Wallet nonce store** (`walletNonce.ts`): Same Redis instance handles nonce deduplication across instances.
3. **Family revocation set**: Revoked token families are globally visible — replay protection works cluster-wide.

**Startup validation**: The production environment should enforce `REDIS_URL` via startup check. Without Redis, each instance has its own in-memory store and cannot see tokens issued by other instances.

**Redis key schema:**

| Key Pattern | Type | TTL | Purpose |
|-------------|------|-----|---------|
| `refresh:<token-hex>` | String (JSON) | `JWT_REFRESH_TTL_SECONDS` | Refresh token entry |
| `refresh:family:revoked:<familyId>` | String | `JWT_REFRESH_TTL_SECONDS` | Revoked family marker |
| `wallet-nonce:<nonce>` | String (JSON) | `WALLET_NONCE_TTL_SECONDS` | Wallet nonce entry |
| `wallet-nonce:active:<wallet>` | Set | `WALLET_NONCE_TTL_SECONDS` | Active nonce index per wallet |

### Session Affinity

JWT access tokens are self-contained (signed with `JWT_SECRET`) — no session affinity needed. Refresh token rotation lookup goes to Redis/DB. No instance-local state is required for auth beyond the shared store.

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
| `ADMIN_API_KEY_ROLE` | `super-admin` | Role for the bootstrap key |

### Wallet Signature Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `WALLET_SIGNATURE_MODE` | `stellar` (prod) / `hmac` (dev) | Signature verification mode |
| `WALLET_NONCE_ENFORCEMENT` | `strict` (prod) | Nonce enforcement strictness |
| `WALLET_NONCE_TTL_SECONDS` | `300` | Nonce timeout in seconds |
| `WALLET_NONCE_MAX_ACTIVE_PER_WALLET` | `10` | Max pending nonces per wallet |
| `WALLET_ACTION_HMAC_SECRET` | Falls back to `JWT_SECRET` | HMAC secret when in `hmac` mode |

### Backend Store Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | — | Redis connection URL. When set, refresh tokens and nonces are persisted in Redis. Required for multi-instance deployments. |
| `DATABASE_URL` | `file:./dev.db` | Prisma database connection string (SQLite in dev, Postgres in prod) |

### Rate Limiting (Auth Tier)

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_AUTH_MAX` | `5` | Max requests per window for `/auth/*` endpoints |
| `RATE_LIMIT_AUTH_WINDOW_MS` | `60000` | Window duration in ms (60 seconds) |
| `RATE_LIMIT_ADMIN_MAX` | `20` | Max requests per window for `/admin/*` routes |
| `RATE_LIMIT_WRITES_MAX` | `10` | Max write requests per window |
| `RATE_LIMIT_READS_MAX` | `60` | Max read requests per window |
| `API_RATE_LIMIT_MAX_REQUESTS` | `30` | Global API rate limit |
| `API_RATE_LIMIT_WINDOW_MS` | `60000` | Global API rate window |

### Payload Limits

| Variable | Default | Description |
|----------|---------|-------------|
| `PAYLOAD_LIMIT_AUTH` | `4kb` | Max body size for auth endpoints |
| `PAYLOAD_LIMIT_ADMIN` | `16kb` | Max body size for admin endpoints |
| `PAYLOAD_LIMIT_WRITES` | `32kb` | Max body size for write endpoints |
| `PAYLOAD_LIMIT_READS` | `2kb` | Max body size for read endpoints |

### Audit & Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_AUDIT_LOG_STORAGE` | `hybrid` | Audit log backend: `db`, `redis`, or `hybrid` |
| `AUDIT_LOG_RETENTION` | `500` | Max audit log entries before rotation |
| `ADMIN_ACTION_RECEIPT_SECRET` | — | Secret for signing admin action receipts |

---

## Security Best Practices

### 1. JWT Secret Management

```
✅ DO:   Use a strong, randomly generated secret ≥ 32 chars with 3+ character classes
✅ DO:   Rotate the JWT_SECRET on a schedule (invalidates all existing tokens)
✅ DO:   Store JWT_SECRET in a secrets manager (Vault, AWS Secrets Manager, etc.)
✅ DO:   Use a different JWT_SECRET per environment (dev/staging/prod)
❌ DON'T: Hardcode secrets in source code or config files
❌ DON'T: Use the default development secret in production
❌ DON'T: Log or expose JWT_SECRET in error messages
```

The server performs **startup validation** in production — it will refuse to start if `JWT_SECRET` is missing, too short, or lacks character-class diversity (`auth.ts:assertJwtSecretValid`).

### 2. Access Token Lifetime

- **15 minutes** is the recommended default — short enough to limit blast radius of a stolen token, long enough to avoid excessive refresh calls
- Extending the TTL increases the window for token misuse before expiry
- Access tokens are **not stored server-side** — they are self-contained JWTs verified by signature

### 3. Refresh Token Storage (Client Side)

```
✅ DO:   Store refresh tokens in httpOnly, Secure, SameSite cookies
✅ DO:   Store access tokens in memory (not localStorage)
❌ DON'T: Store refresh tokens in localStorage or sessionStorage
❌ DON'T: Expose refresh tokens in URL parameters or logs
❌ DON'T: Send refresh tokens in GET requests
```

### 4. API Key Management

```
✅ DO:   Generate keys with crypto.randomBytes(32).toString('hex')
✅ DO:   Rotate keys every 90 days
✅ DO:   Use the least-privileged role for each integration
✅ DO:   Revoke keys immediately when a team member leaves
✅ DO:   Set expiresAt for temporary or trial integrations
✅ DO:   Store keys in a secrets manager at creation time
❌ DON'T: Share API keys across teams or services
❌ DON'T: Commit API keys to source control
❌ DON'T: Log plaintext API keys anywhere
```

### 5. Scoped Admin Tokens

```
✅ DO:   Prefer scoped tokens over long-lived API keys for automated systems
✅ DO:   Set short expiration times for CI/CD tokens (e.g., 1 hour)
✅ DO:   Rotate secrets after incidents or suspicious activity
✅ DO:   Monitor rotation events via the audit trail
✅ DO:   Use descriptive labels for tracking token ownership
❌ DON'T: Grant admin:* unless absolutely necessary
❌ DON'T: Share a single scoped token across multiple pipelines
```

### 6. Multi-Instance Considerations

```
✅ DO:   Set REDIS_URL in production for shared token state
✅ DO:   Use TLS for all Redis connections
✅ DO:   Configure Redis ACLs to restrict key access
✅ DO:   Set appropriate TTLs on Redis keys to avoid stale state
❌ DON'T: Rely on in-memory stores in multi-instance deployments
❌ DON'T: Use the same Redis instance for cache and token state without key prefix isolation
```

### 7. General

- **Redaction**: All sensitive values (passwords, tokens, API keys, secrets) are automatically redacted from logs via `auditRedaction.ts` and `redaction.ts`
- **Correlation IDs**: Every request gets a correlation ID for tracing through the auth lifecycle
- **Rate Limiting**: Auth endpoints are strictly rate-limited (5 req/min) to prevent brute-force attacks
- **Payload Limits**: Auth endpoints enforce a 4 KB body limit to prevent abuse
- **Timing Attacks**: All secret comparisons use `crypto.timingSafeEqual`
- **Wallet Address Normalization**: All addresses are normalized before storage and comparison to prevent malleability attacks
- **Startup Validation**: Critical security configuration is validated at startup — the server fails fast rather than running with insecure defaults

---

## Token Rotation Schedule

| Token Type | Recommended Rotation | Mechanism | Automation |
|------------|---------------------|-----------|------------|
| **JWT Access Token** | N/A (auto-expires 15 min) | — | Client auto-refresh |
| **JWT Refresh Token** | N/A (auto-rotated each use) | `POST /auth/refresh` | Client SDK |
| **Admin API Key** | Every 90 days | `POST /admin/api-keys/rotate` | Cron or CI |
| **Scoped Admin Token** | Every 30 days (or after incident) | `POST /admin/scoped-tokens/:id/rotate` | CI/CD pipeline |
| **JWT_SECRET** | Every 6 months | Re-deploy with new env var | Manual (invalidates all sessions) |
| **WALLET_NONCE_TTL_SECONDS** | N/A (config-driven) | Env var change | Config management |

### Automated Rotation Script — Scoped Token

```bash
#!/bin/bash
# Rotate a scoped admin token and update CI/CD secrets
# Usage: ./rotate-scoped-token.sh <key-id>
#
# Requires: jq, curl, SUPER_ADMIN_API_KEY env var

set -euo pipefail

KEY_ID="${1:?Usage: $0 <key-id>}"
SUPER_ADMIN_API_KEY="${SUPER_ADMIN_API_KEY:?Must set SUPER_ADMIN_API_KEY}"

echo "Rotating scoped token ${KEY_ID}..."

RESPONSE=$(curl -s -X POST \
  "http://localhost:3000/admin/scoped-tokens/${KEY_ID}/rotate" \
  -H "Authorization: ApiKey ${SUPER_ADMIN_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"rotatedBy\": \"ci-rotation-bot\"}")

NEW_SECRET=$(echo "$RESPONSE" | jq -r '.newSecret')

if [ -z "$NEW_SECRET" ] || [ "$NEW_SECRET" = "null" ]; then
  echo "ERROR: Rotation failed. Response:"
  echo "$RESPONSE"
  exit 1
fi

# Store new secret in CI variable store
# Example: GitHub Actions
# gh secret set SCOPED_ADMIN_TOKEN --body "$NEW_SECRET"
# Example: GitLab CI
# glab variable update SCOPED_ADMIN_TOKEN "$NEW_SECRET"

echo "✓ Rotated token ${KEY_ID} at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "ℹ Store the new secret in your secrets manager immediately."
```

### Automated Rotation Script — API Key

```bash
#!/bin/bash
# Rotate an API key and update deployment secrets
# Usage: ./rotate-api-key.sh <key-uuid>
#
# Requires: jq, curl, SUPER_ADMIN_API_KEY env var

set -euo pipefail

KEY_ID="${1:?Usage: $0 <key-uuid>}"
SUPER_ADMIN_API_KEY="${SUPER_ADMIN_API_KEY:?Must set SUPER_ADMIN_API_KEY}"

# Generate a new key
NEW_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

echo "Rotating API key ${KEY_ID}..."

RESPONSE=$(curl -s -X POST \
  "http://localhost:3000/admin/api-keys/rotate" \
  -H "Authorization: ApiKey ${SUPER_ADMIN_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"id\": \"${KEY_ID}\", \"newKey\": \"${NEW_KEY}\"}")

if echo "$RESPONSE" | jq -e '.hashedKey' > /dev/null 2>&1; then
  echo "✓ Rotated API key ${KEY_ID} at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "New key (save this securely): ${NEW_KEY}"
else
  echo "ERROR: Rotation failed:"
  echo "$RESPONSE"
  exit 1
fi
```

---

## Monitoring & Alerting

### Key Metrics

| Metric | Source | Description | Alert Threshold |
|--------|--------|-------------|-----------------|
| `auth.login.success` | Logs | Successful logins | - |
| `auth.login.failure` | Logs | Failed login attempts | Spike > 5x baseline |
| `auth.refresh.rotations` | Logs | Successful token rotations | - |
| `auth.refresh.replay_detected` | Logs | Replay attack detection | **Immediate alert** |
| `auth.session_revoked` | Logs | Sessions revoked due to theft | **Immediate alert** |
| `auth.nonce.issued` | Logs | Nonces issued | - |
| `auth.nonce.replay` | Logs | Nonce replay attempts | Spike > 10x baseline |
| `auth.api_key.rotated` | Audit | API key rotations | - |
| `auth.scoped_token.rotated` | Audit | Scoped token rotations | - |
| `auth.impersonation.created` | Logs | Impersonation sessions | Monitor for abuse |

### Log Patterns

Search for these patterns in your logging system:

```text
# Replay attack detected
"Refresh token replay detected" -> ALERT: possible token theft
"Session revoked for security"  -> ALERT: session compromised

# Rate limit violations
"Rate limit exceeded"           -> WARN: possible brute-force

# Nonce abuse
"NonceReplayError"              -> WARN: API misuse or replay attack
"NONCE_REPLAY"                  -> same as above

# Auth failures
"Invalid JWT signature"         -> INFO: tampered token
"Missing or malformed"          -> INFO: client error
"JWT has expired"               -> DEBUG: stale token

# API key events (audit log)
action: "rotated"               -> INFO: key lifecycle
action: "revoked"               -> INFO: key lifecycle
action: "registered"            -> INFO: key lifecycle
```

### Recommended Alerts

1. **Refresh token replay detected** — Pager-worthy alert. Indicates token theft or client bug.
2. **Nonce replay rate > threshold** — Possible automated attack. Investigate source IP.
3. **Auth endpoint rate limit saturation** — Brute-force attempt or misconfigured client.
4. **Rapid API key rotations (>3 in 5 min)** — Possible compromise response or automated script loop.
5. **Impersonation session creation** — Audit alert for compliance. Track who and why.

---

## Incident Response

### Compromised JWT Secret

1. **Rotate `JWT_SECRET`** immediately — this invalidates all existing access and refresh tokens
2. **Deploy** the new secret across all instances
3. **All users must re-authenticate** — expect a spike in login traffic
4. **Investigate** how the secret was compromised (access logs, secret store audit)
5. **Rotate** any API keys or scoped tokens that may have been exposed alongside the secret

### Compromised API Key

1. **Revoke the key** immediately via `POST /admin/api-keys/revoke`
2. **Generate a new key** and update the affected integration
3. **Check audit events** for unusual activity during the exposure window
4. **Rotate** any other keys that were stored alongside the compromised one

### Compromised Scoped Token

1. **Rotate the token** via `POST /admin/scoped-tokens/:keyId/rotate`
2. **Update** any CI/CD or automation that used the old secret
3. **Check rotation history** via `GET /admin/scoped-tokens/:keyId/rotations`
4. **If the token had `admin:*` permissions**, consider rotating all API keys as a precaution

### Refresh Token Theft Detected

The system **automatically** handles this:
1. The replayed refresh token triggers `SessionRevokedError`
2. The entire token family is revoked
3. The affected user must re-authenticate

**Post-incident:**
1. Identify the affected wallet address from logs
2. Notify the user to re-authenticate
3. Review access logs for unauthorized activity during the window
4. Consider invalidating the user's nonces and forcing fresh wallet signature verification

### Nonce Replay Attack

1. The system rejects nonce replays via `NonceReplayError`
2. Monitor the source IP and wallet address for patterns
3. Rate limiting on `/auth/nonce` and `/auth/login` prevents large-scale attacks
4. If a specific wallet is targeted, the max active nonces limit (10) bounds the attack surface

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

// 4. Store tokens securely
storeAccessToken(accessToken);  // in-memory
storeRefreshToken(refreshToken); // httpOnly cookie
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
  } catch (error: any) {
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
# Usage: ./register-api-key.sh <tenant-id> [role] [expires-in-days]

TENANT_ID="${1:?Usage: $0 <tenant-id> [role] [expires-in-days]}"
ROLE="${2:-admin}"
EXPIRES_IN="${3:-90}"
ADMIN_KEY="${ADMIN_API_KEY:?Must set ADMIN_API_KEY}"

NEW_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

echo "Registering new ${ROLE} API key for tenant ${TENANT_ID}..."

curl -s -X POST http://localhost:3000/admin/api-keys/register \
  -H "Authorization: ApiKey ${ADMIN_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"key\": \"${NEW_KEY}\", \"role\": \"${ROLE}\", \"tenantId\": \"${TENANT_ID}\", \"expiresInDays\": ${EXPIRES_IN}}" | jq .

echo ""
echo "New key (save this securely — it will NOT be shown again):"
echo "${NEW_KEY}"
```

### Scoped Token Permission Verification

```typescript
// Server-side permission check (in middleware)
const token = await scopedAdminTokenStore.authenticate(keyId, secret);
if (!token) {
  // Authentication failed
  return res.status(401).json({ error: 'Unauthorized' });
}

if (!scopedAdminTokenStore.hasPermission(token, 'read:metrics')) {
  return res.status(403).json({ error: 'Forbidden' });
}

// Multi-permission check
if (!scopedAdminTokenStore.hasAnyPermission(token, ['read:metrics', 'read:audit'])) {
  return res.status(403).json({ error: 'Forbidden' });
}
```

### Wallet Nonce Service Usage

```typescript
import { walletNonceService, NonceReplayError } from './walletNonce';

// Issue a nonce for a wallet action
const nonce = await walletNonceService.issue(
  walletAddress,
  'deposit',
  (meta) => buildWalletSignMessage(meta),
);

// Validate and consume (atomically) after signature verification
try {
  await walletNonceService.consume(walletAddress, 'deposit', nonce.nonce);
  // Proceed with the operation
} catch (err) {
  if (err instanceof NonceReplayError) {
    // This nonce was already used — client error or replay attack
  }
}

// Check service metrics
const metrics = walletNonceService.getMetrics();
// { issued: number, consumed: number, replayRejected: number, ... }
```

### Verifying Admin Action is Audit-Logged

```typescript
import { recordAdminAuditLog } from './adminAudit';

// After a sensitive action completes:
void recordAdminAuditLog(req, 'api-key.rotated', 200, {
  keyId: updatedKey.id,
  actor: req.authApiKeyHash,
});
```

---

## Related Documentation

- [API General Documentation](./README.md)
- [Error Code Catalog](./ERROR_CODE_CATALOG.md)
- [Production Security Checklist](../PRODUCTION_SECURITY_CHECKLIST.md)
- [Security Checklist](../SECURITY_CHECKLIST.md)
- [Threat Model](../THREAT_MODEL.md)
- [Environment Variable Matrix](../ENV_VARIABLE_MATRIX.md)
- [Incident Response Runbook](../incident_response_runbook.md)
- [Deployment Checklist](../DEPLOYMENT_CHECKLIST.md)
