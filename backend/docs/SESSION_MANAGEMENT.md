# Secure Session Management Guide

## Overview

YieldVault implements secure session management with JWT access tokens and opaque refresh tokens, following OAuth 2.0 best practices for authorization code flow with PKCE.

## Token Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│ Access Token (JWT)                                          │
├─────────────────────────────────────────────────────────────┤
│ - Short-lived (default: 15 minutes)                        │
│ - Signed with HMAC-SHA256                                  │
│ - Includes wallet address and token ID (jti)               │
│ - Used for API authentication                              │
│ - Format: Bearer <token>                                   │
└─────────────────────────────────────────────────────────────┘
           ↓ (when expires)
┌─────────────────────────────────────────────────────────────┐
│ Refresh Token (Opaque)                                      │
├─────────────────────────────────────────────────────────────┤
│ - Long-lived (default: 7 days)                             │
│ - Stored securely (HttpOnly cookie or secure storage)      │
│ - Rotated on every use (new refresh token issued)          │
│ - Previous token immediately revoked                       │
│ - Used to obtain new access token                          │
│ - Single-use only                                          │
└─────────────────────────────────────────────────────────────┘
```

## Authentication Flow

### Initial Login (Sign Message)

```
Client                          Backend
  │                               │
  ├─ GET /auth/nonce ────────────→│ (no auth required)
  │                               │ Generate unique nonce
  │                               │
  │ ←────── { nonce, challenge }  │
  │                               │
  ├─ Display to user             │
  ├─ User signs message          │
  │ Message: "YieldVault: {nonce}"│
  │                               │
  ├─ POST /auth/login ───────────→│
  │ {                             │
  │   signature,                  │
  │   publicKey,                  │
  │   message                     │
  │ }                             │
  │                               │ Verify signature
  │                               │ Verify nonce (single-use)
  │                               │ Create session
  │ ←── accessToken, refreshToken │
  │     Set-Cookie: refreshToken  │
  │                               │
```

### Token Refresh (Rotation)

```
Client                          Backend
  │                               │
  ├─ GET /auth/refresh ──────────→│ + Cookie: refreshToken
  │ (old refresh token in cookie)│
  │                               │ Verify token exists
  │                               │ Check not revoked
  │                               │ Verify signature (opaque token)
  │                               │ Check not expired
  │                               │
  │ ←─ newAccessToken            │ Generate new access token
  │     newRefreshToken           │ Generate new refresh token
  │     Set-Cookie: newRefreshToken│ Revoke old refresh token
  │                               │
  │ [old token immediately        │
  │  becomes invalid]             │
  │                               │
```

### Logout (Revocation)

```
Client                          Backend
  │                               │
  ├─ POST /auth/logout ──────────→│ + Authorization: Bearer <token>
  │                               │
  │                               │ Revoke access token
  │                               │ Revoke refresh token
  │                               │ Mark session as ended
  │                               │
  │ ←─ 204 No Content             │ Delete-Cookie: refreshToken
  │     Set-Cookie: expires=0    │
  │                               │
```

## Security Features

### Refresh Token Rotation (Issue #377)

**Why:** Limits the window of opportunity for attackers who compromise a token

**How:**
1. Client receives refresh token
2. Client uses refresh token → new refresh token issued, old one revoked immediately
3. Client stores new refresh token, discards old one
4. If attacker replays old token, it's already revoked → error returned

**Recovery:** New session required (logout and re-authenticate)

### Replay Attack Detection

**Scenario:** Attacker intercepts refresh token and replays it

**Protection:**
1. Token ID (jti) recorded when token created
2. When refresh token used, old token ID marked as revoked
3. If attacker replays old token ID, it's checked against revocation list
4. Old token ID found in revocation list → 401 Unauthorized

**Response:** Session audit event recorded, suspicious activity score increased

### Concurrent Refresh Handling

**Scenario:** Network delay causes client to retry refresh request while first request still processing

**Protection:**
1. Lock acquired on session during refresh
2. Second request waits for lock
3. First request completes, issues new tokens, revokes old
4. Second request reads lock, sees old token was revoked
5. Second request returns 401, prompts re-login

### Token Expiration Handling

**Access Token Expiration:**
- Client receives 401 from API
- Client automatically refreshes token (silent refresh)
- Retries original request
- User unaware of token refresh

**Refresh Token Expiration:**
- Client tries to refresh, receives 401
- No valid refresh token available
- Session ended, user must log in again
- UI prompts "Session expired, please log in again"

## Session Audit Trail

All session events recorded and queryable:

```typescript
GET /api/wallets/{address}/sessions
```

Returns:
```json
{
  "events": [
    {
      "timestamp": "2024-08-25T10:30:00Z",
      "eventType": "created",
      "reason": "login_success",
      "ipAddress": "203.0.113.42",
      "userAgent": "Mozilla/5.0...",
      "sessionId": "session_123"
    },
    {
      "timestamp": "2024-08-25T10:32:15Z",
      "eventType": "refreshed",
      "reason": "refresh_success",
      "ipAddress": "203.0.113.42",
      "sessionId": "session_123"
    }
  ]
}
```

### Suspicious Activity Detection

System automatically analyzes session patterns:

- Multiple failed login attempts (3+ in 24h)
- Activity from multiple IP addresses
- Activity from multiple user agents
- Rapid token refreshes (> 20 in 24h)
- Unusual time-of-day activity

When suspicious activity detected:
1. Recorded in audit log
2. Session marked with risk score (0-1)
3. User notified via email
4. Additional MFA may be required

## Session Recovery

### User Suspects Account Compromise

**Steps:**
1. User navigates to /security/sessions
2. Views session history and active sessions
3. Can revoke any session (logout other devices)
4. Can see suspicious activity warnings

**Backend response:**
- Revokes specified session immediately
- Revocation event logged with reason "user_initiated"
- Email confirmation sent

### Session Recovery After Suspicious Activity

**System detects compromise:**
1. Automatic alerts to ops team
2. Session flagged as compromised
3. User receives email notification
4. Tokens for that session revoked
5. User required to re-authenticate

**Recovery steps:**
1. User clicks "Re-authenticate" link in email
2. Completes wallet signature verification (challenge-response)
3. New clean session established
4. Audit event: "session_created_after_compromise"

### Investigating Session History

**Support workflow:**
```bash
# Get all sessions for wallet
GET /api/admin/wallets/{address}/session-history

# Get details for specific session
GET /api/admin/sessions/{sessionId}

# Export for compliance
GET /api/admin/wallets/{address}/session-export?format=csv
```

## Environment Variables

```bash
# Access token lifetime (seconds, default: 900 = 15 min)
JWT_ACCESS_TTL_SECONDS=900

# Refresh token lifetime (seconds, default: 604800 = 7 days)
JWT_REFRESH_TTL_SECONDS=604800

# JWT signing secret (REQUIRED in production, min 32 chars, 3+ char classes)
JWT_SECRET="your-secure-secret-here-min-32-chars-upper-lower-digits-symbols"

# Token storage backend (memory | redis)
TOKEN_STORE=redis

# Redis connection for distributed deployments
REDIS_URL=redis://localhost:6379

# Session audit log retention (days, default: 90)
SESSION_AUDIT_RETENTION_DAYS=90

# Suspicious activity threshold (0-1, default: 0.4)
SUSPICIOUS_ACTIVITY_THRESHOLD=0.4

# Enable session management features
SESSION_MANAGEMENT_ENABLED=true
```

## API Endpoints

### `/auth/nonce` - GET
Get challenge for wallet signature

**Response:**
```json
{
  "nonce": "abc-123-def-456",
  "challenge": "abc-123-def-456",
  "expiresAt": "2024-08-25T10:05:00Z"
}
```

### `/auth/login` - POST
Authenticate with signed message

**Request:**
```json
{
  "signature": "...",
  "publicKey": "...",
  "message": "..."
}
```

**Response:**
```json
{
  "accessToken": "eyJhbGc...",
  "refreshToken": "ref_...",
  "expiresIn": 900,
  "tokenType": "Bearer"
}
```

### `/auth/refresh` - POST
Get new access token using refresh token

**Request:**
```json
{
  "refreshToken": "ref_..."
}
```

**Response:**
```json
{
  "accessToken": "eyJhbGc...",
  "refreshToken": "ref_...",
  "expiresIn": 900
}
```

### `/auth/logout` - POST
End session and revoke tokens

**Request:** Authorization header required
```
Authorization: Bearer <accessToken>
```

**Response:** 204 No Content

### `/wallets/{address}/sessions` - GET
Get session history for wallet

**Response:**
```json
{
  "sessions": [
    {
      "id": "session_123",
      "createdAt": "2024-08-25T10:00:00Z",
      "lastActive": "2024-08-25T10:30:00Z",
      "ipAddress": "203.0.113.42",
      "userAgent": "Mozilla/5.0...",
      "riskScore": 0.1
    }
  ]
}
```

### `/wallets/{address}/sessions/{id}/revoke` - POST
Revoke specific session

**Response:** 200 OK

## Client Implementation

### Browser-based Client

```typescript
// Store refresh token in HttpOnly cookie (set by server)
// Store access token in memory only (cleared on page reload)

async function makeAuthenticatedRequest(url: string) {
  let response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: 'include', // Include cookies (refresh token)
  });

  if (response.status === 401) {
    // Access token expired, refresh
    const refreshResponse = await fetch('/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });

    if (refreshResponse.ok) {
      const { accessToken: newToken } = await refreshResponse.json();
      accessToken = newToken;

      // Retry original request
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: 'include',
      });
    } else {
      // Refresh failed, must log in again
      redirectToLogin();
    }
  }

  return response;
}
```

### Mobile Client (Native App)

```typescript
// Store both tokens securely in platform keychain
// Access token: short-lived in memory
// Refresh token: persisted in secure storage

async function makeAuthenticatedRequest(url: string) {
  let response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 401) {
    // Try to refresh
    const newTokens = await refreshAccessToken();
    if (newTokens) {
      accessToken = newTokens.accessToken;
      await saveToKeychain('refreshToken', newTokens.refreshToken);

      // Retry original request
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } else {
      // Refresh failed, prompt login
      showLoginScreen();
    }
  }

  return response;
}
```

## Troubleshooting

### "Invalid refresh token" Error

**Causes:**
1. Token already rotated (another request used it first)
2. Token expired (7 days passed)
3. User logged out (token revoked)
4. Session compromised (token revoked by system)

**Solution:**
- Clear stored tokens
- Redirect to login
- User must re-authenticate

### "Session already in use" (Concurrent Refresh)

**Cause:** Multiple refresh requests in rapid succession

**Solution:**
- Automatically handled by backend (returns same new tokens)
- Client implementation should retry with new token

### "Suspicious activity detected"

**Cause:** System detected unusual pattern

**Solution:**
1. Check email for notification
2. Review session history at `/security/sessions`
3. Revoke suspicious sessions
4. Re-authenticate to create new clean session

## Compliance & Audit

- All session events logged with timestamp and context
- Audit log retention: 90 days (configurable)
- GDPR: Users can export their session history
- SOC2: Session audit logs available for compliance audits
- Suspicious activity alerts available via API

## References

- [RFC 6234 - US Secure Hash Algorithms](https://tools.ietf.org/html/rfc6234)
- [RFC 7519 - JSON Web Token (JWT)](https://tools.ietf.org/html/rfc7519)
- [OAuth 2.0 Security Best Practices](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
