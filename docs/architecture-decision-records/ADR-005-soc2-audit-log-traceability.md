# ADR-005: SOC2 Audit Log Traceability with IP and User-Agent Capture

**Date:** 2026-09-29  
**Status:** Accepted  
**Author:** YieldVault Engineering  
**Reviewers:** Security Team, Compliance Officer  

---

## Context

SOC2 Type II compliance requires detailed audit logs that can answer: "Who performed this action, from where, and using what client?" Currently, the audit log captures only:
- `adminId` (actor)
- `action` (what was done)
- `vaultId` (which resource)
- `timestamp` (when)

Missing fields:
- `ip` (actor's network identity — for incident response and anomaly detection)
- `userAgent` (client identification — browser, CLI tool, API client, etc.)

Without these fields, during a security incident investigation, operators cannot:
- Determine if an action came from an expected IP range
- Identify compromised clients or accounts
- Correlate logs across systems using client fingerprints
- Provide evidence of authorized access to auditors

## Decision

We enhance the audit log system to capture:

1. **IP Address** via `req.ip` (Express automatically resolves `x-forwarded-for`)
2. **User-Agent** via `req.get('user-agent')`
3. **Optional IP Hashing** — when `AUDIT_HASH_IP=true`, IPs are hashed with a daily salt for privacy

The fields are added to:
- **In-memory audit log** (`AuditLogEntry` interface in `auditLog.ts`)
- **Database audit log** (`AdminAuditLog` Prisma model — fields already existed)

Both systems capture these fields consistently; the API response via `GET /admin/audit-logs` includes `ip` and `userAgent`.

### IP Hashing Implementation

When `AUDIT_HASH_IP=true`:
- Daily salt: `audit-ip-YYYY-MM-DD`
- Hash: `SHA-256(ip + ":" + daily_salt)`
- Format: `sha256:[first_16_chars_of_hash]`

**Benefits:**
- Same IP produces same hash on same day (enables correlation)
- Hash changes daily (privacy protection)
- Original IP cannot be recovered without the salt (tamper-resistant)

## Rationale

- **Compliance:** SOC2 Type II explicitly requires actor identification including network context.
- **Security:** IP and user-agent are critical forensic data during incident investigation.
- **Privacy:** Optional hashing balances security audit needs with user privacy.
- **Low overhead:** Minimal performance impact (single field capture per request).
- **Backward compatible:** New fields are optional in storage; existing audit entries unaffected.

## Alternatives Considered

### Alternative 1: Log IPs but never hash
- **Pros:** Simpler; no daily salt rotation needed.
- **Cons:** Privacy concerns; IP addresses are personally identifiable in some jurisdictions.

### Alternative 2: Always hash IPs (no opt-out)
- **Pros:** Maximum privacy by default.
- **Cons:** Reduces usefulness for incident response; loses ability to compare literal IPs.

### Alternative 3: Use third-party geolocation or fingerprinting service
- **Pros:** Richer contextual data (country, ISP, etc.).
- **Cons:** External dependency; latency; compliance concerns with third-party data handling.

## Consequences

### Positive
- **SOC2 compliance:** Audit logs now have actor network identity.
- **Incident response:** Operators can correlate actions by IP or client fingerprint.
- **Privacy option:** IP hashing available for environments with strict data protection policies.
- **Non-invasive:** Captures data available in HTTP headers; no client changes needed.

### Negative
- **Storage impact:** Additional fields increase audit log table size (~50 bytes per entry).
- **Retention compliance:** Organizations using IP hashing must document salt rotation schedule.
- **Client diversity:** User-agent strings are unstructured; parsing requires care to avoid false positives.

## Implementation Notes

- **IP Resolution:** Express `req.ip` automatically respects `x-forwarded-for`, `x-real-ip`, and other proxy headers when `app.set('trust proxy', ...)` is configured.
- **User-Agent Parsing:** No parsing is done; raw header value is stored for maximum flexibility and auditability.
- **Database Migration:** No migration required; `AdminAuditLog` schema already had `ipAddress` and `userAgent` columns.
- **Testing:** Mock `Date.now()` and `req.headers` in tests to verify hashing algorithm and field capture.

## Related Links

- Issue #1454 — Add IP and user-agent to audit logs for SOC2 traceability
- `backend/src/auditLog.ts` — In-memory audit log (userAgent field, IP hashing)
- `backend/src/adminAudit.ts` — Database audit log (IP hashing support)
- `backend/src/__tests__/auditLog.test.ts` — Test coverage for IP and user-agent capture
- `AUDIT_LOG_SOC2_IMPLEMENTATION.md` — Implementation guide
