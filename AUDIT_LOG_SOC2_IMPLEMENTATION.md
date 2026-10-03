# Audit Log SOC2 Implementation (Issue #1454)

## Overview

This implementation addresses SOC2 traceability requirements for admin actions by ensuring audit logs capture both IP addresses and user-agent strings for all admin actions.

## Changes Made

### 1. **Updated `backend/src/auditLog.ts`**:

- Added `userAgent?: string` field to `AuditLogEntry` interface
- Modified `createAdminAuditMiddleware()` to capture `req.get('user-agent')`
- Implemented IP hashing with daily salt when `AUDIT_HASH_IP=true` environment variable is set

### 2. **Updated `backend/src/adminAudit.ts`**:

- Added IP hashing function for consistency with the in-memory audit log
- Updated `recordAdminAuditLog()` to use hashed IP addresses when `AUDIT_HASH_IP=true`

### 3. **Created Test Suite `backend/src/__tests__/auditLog.test.ts`**:

- Tests IP address capture with and without hashing
- Tests user-agent capture
- Verifies functionality persists through the `/admin/audit-logs` endpoint
- Tests edge cases (missing headers, forwarded IPs, etc.)

## IP Hashing Implementation

When `AUDIT_HASH_IP=true` is set in the environment:

1. **Privacy Protection**: IP addresses are hashed using SHA-256 with a daily salt
2. **Traceability**: Same IP produces same hash on the same day, enabling correlation
3. **Format**: Hashed IPs follow format `sha256:[first_16_chars_of_hash]`

### Hashing Details:
```javascript
function hashIpIfNeeded(ip) {
  if (AUDIT_HASH_IP !== 'true') return ip;
  
  const today = new Date().toISOString().split('T')[0];
  const salt = `audit-ip-${today}`;
  const hash = crypto.createHash('sha256').update(`${ip}:${salt}`).digest('hex');
  return `sha256:${hash.slice(0, 16)}`;
}
```

## Database Schema

The `AdminAuditLog` Prisma model already includes the required fields:
- `ipAddress` (String)
- `userAgent` (String)

No database migration was needed as the schema already supported these fields.

## Acceptance Criteria Verification

### ✅ **Add `ip: req.ip` and `userAgent: req.headers['user-agent']` to auditLog**
- ✅ Added to in-memory audit log (`auditLog.ts`)
- ✅ Added to database audit log (`adminAudit.ts`)
- ✅ Both capture IP from `req.ip` and user-agent from `req.get('user-agent')`

### ✅ **Hash IP with daily salt for privacy if `AUDIT_HASH_IP=true`**
- ✅ Implemented in both audit log systems
- ✅ Uses daily salt that changes every 24 hours
- ✅ Same IP produces same hash on same day for correlation

### ✅ **Test: call admin endpoint and assert audit log has IP and userAgent**
- ✅ Created comprehensive test suite
- ✅ Tests capture with and without IP hashing
- ✅ Tests edge cases (missing headers, forwarded IPs)
- ✅ Verifies data appears in `/admin/audit-logs` response

## Testing

Run the audit log tests:
```bash
cd backend
npm test auditLog.test.ts
```

Or run all tests:
```bash
cd backend
npm test
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AUDIT_HASH_IP` | `false` | When `true`, IP addresses are hashed with daily salt for privacy |
| `AUDIT_LOG_RETENTION` | `500` | Maximum number of in-memory audit log entries to retain |
| `ADMIN_AUDIT_LOG_STORAGE` | `hybrid` | Storage mode: `memory`, `prisma`, or `hybrid` |

## SOC2 Compliance Notes

1. **Traceability**: All admin actions now include network identity (IP) and client identification (user-agent)
2. **Privacy**: Optional IP hashing protects user privacy while maintaining audit trail
3. **Tamper Resistance**: Hashed IPs cannot be reversed to original IPs without the daily salt
4. **Correlation**: Same IP produces same hash on same day, enabling incident investigation
5. **Retention**: Audit logs are retained per `AUDIT_LOG_RETENTION` setting

## Files Modified

1. `backend/src/auditLog.ts` - In-memory audit log with IP/user-agent
2. `backend/src/adminAudit.ts` - Database audit log with IP hashing
3. `backend/src/__tests__/auditLog.test.ts` - Comprehensive test suite
4. `AUDIT_LOG_SOC2_IMPLEMENTATION.md` - This documentation file