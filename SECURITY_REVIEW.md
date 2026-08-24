# Security Review Guidelines

This document defines the structured security review process for YieldVault-RWA. All code changes must follow these guidelines to ensure sensitive code paths are thoroughly vetted.

## Table of Contents

- [Overview](#overview)
- [Sensitive Code Paths](#sensitive-code-paths)
- [Review Checks](#review-checks)
- [Sign-Off Requirements](#sign-off-requirements)
- [Common Findings and Remediation](#common-findings-and-remediation)
- [Incident Response](#incident-response)
- [Release Coordination](#release-coordination)

## Overview

Security reviews are mandatory for changes that:
- Handle authentication, authorization, or access control
- Process or store secrets and credentials
- Update dependencies (especially transitive dependencies)
- Modify contract code or blockchain interactions
- Handle sensitive user data (PII, financial data)
- Affect rate limiting, DDoS protection, or infrastructure security

The goal is to minimize risk through structured, repeatable review processes while enabling teams to move confidently.

## Sensitive Code Paths

### Authentication & Authorization

**Scope**: User login, token validation, permission checks, session management

**Checklist**:
- [ ] Authentication flow uses industry-standard methods (OAuth 2.0, JWT, etc.)
- [ ] Token generation includes sufficient entropy and expiration
- [ ] Password handling uses proper hashing (bcrypt, argon2, scrypt)
- [ ] Authorization checks are applied consistently
- [ ] No hardcoded credentials or test data in production code
- [ ] Rate limiting prevents brute force attacks
- [ ] Session fixation and CSRF protections are in place

**Example files to review**:
- `backend/src/auth/*`
- `backend/src/middleware/*`
- `frontend/src/auth/*`

**Reviewers**: Lead security engineer + auth domain owner

---

### Secrets Management

**Scope**: API keys, database credentials, private keys, environment-sensitive configuration

**Checklist**:
- [ ] No secrets committed in code (verified by git-hooks and scanning)
- [ ] Secrets are injected via environment variables or secure vaults
- [ ] Rotation procedures are documented
- [ ] Sensitive logs are scrubbed (no secrets in error messages)
- [ ] Secret access is audited where applicable
- [ ] Secrets are never logged, even in debug mode

**Example files to review**:
- `.env*` files (should be in `.gitignore`)
- `backend/src/config/*`
- `backend/src/utils/encryption/*`

**Reviewers**: DevOps/Infrastructure engineer + lead developer

---

### Dependency Updates

**Scope**: Package version changes, new transitive dependencies, security patches

**Checklist**:
- [ ] Update is from a legitimate, verified source
- [ ] No typosquatting (package name is correct)
- [ ] Known vulnerabilities resolved (checked against CVE databases)
- [ ] Breaking changes are understood and handled
- [ ] License compatibility verified (no GPL if proprietary code)
- [ ] Minimal version constraints used (pinned or range)
- [ ] Update included in changelog with reasoning

**Example files to review**:
- `package.json` and `package-lock.json`
- `Cargo.toml` and `Cargo.lock` (Rust contracts)
- `backend/package.json`, `frontend/package.json`

**Reviewers**: Tech lead + security engineer

---

### Contract & Blockchain Interactions

**Scope**: Solidity contract code, transaction construction, state mutations, external calls

**Checklist**:
- [ ] No reentrancy vulnerabilities
- [ ] State mutations are atomic or properly coordinated
- [ ] External calls use safe patterns (checks-effects-interactions)
- [ ] Gas limits and estimation are correct
- [ ] No logic that could be front-run
- [ ] Contract state transitions are validated
- [ ] Events are emitted for all state changes
- [ ] Access controls are properly enforced

**Example files to review**:
- `contracts/src/*.sol`
- `backend/src/blockchain/*`
- Contract interaction layers

**Reviewers**: Smart contract auditor + lead backend engineer

---

### Sensitive Data Handling

**Scope**: PII, financial data, user balances, transaction history

**Checklist**:
- [ ] Data is encrypted at rest if applicable
- [ ] Data is encrypted in transit (TLS/HTTPS)
- [ ] Access is restricted by permission checks
- [ ] Audit logs track access to sensitive data
- [ ] Data retention policies are enforced
- [ ] No unintended data leakage in error messages or logs
- [ ] GDPR/privacy regulations are respected (right to deletion, etc.)

**Example files to review**:
- `backend/src/models/*` (data models)
- `backend/src/api/routes/*` (API endpoints)
- `backend/src/services/*` (business logic)

**Reviewers**: Data privacy officer + backend architect

---

## Review Checks

### Pre-Review Checks (Automated)

1. **Secret Scanning**: Gitleaks scans for leaked credentials
2. **Dependency Audit**: `npm audit`, `cargo audit` for known vulnerabilities
3. **SAST**: Static analysis for common security patterns
4. **Linting**: Code style and security lints

**CI Status**: All must pass before human review

### Code Review Checks (Manual)

1. **Threat Modeling**: Are there new attack vectors?
2. **Data Flow**: How does data move through the system?
3. **Error Handling**: Could exceptions leak sensitive information?
4. **Testing**: Are edge cases and attacks tested?
5. **Documentation**: Are security implications documented?

### Security Sign-Off

For sensitive changes, approval from security-cleared reviewers is required:

```
[Approved for security]
Reviewed: Authentication flow for new OAuth provider
Checked: Token expiration, secret management, rate limiting
Risk: Low - follows existing patterns
```

## Sign-Off Requirements

### Standard Changes
- ✅ 1 approval from code owner
- ✅ All CI checks pass
- ✅ At least 1 test

### Sensitive Changes (Auth, Secrets, Contracts)
- ✅ 2 approvals (code owner + security reviewer)
- ✅ All CI checks pass (including security scans)
- ✅ Security sign-off comment required
- ✅ Comprehensive tests demonstrating secure behavior
- ✅ No "Request Changes" left unresolved

### Critical Infrastructure Changes
- ✅ 3 approvals (code owner + security reviewer + release owner)
- ✅ All CI checks pass
- ✅ Security audit completed (external if needed)
- ✅ Rollback plan documented
- ✅ All stakeholders notified

### Breaking/Removal Changes
- ✅ Security and architecture review
- ✅ Impact analysis on dependent services
- ✅ Deprecation period observed (if applicable)
- ✅ Migration guide provided

## Common Findings and Remediation

### Finding: Hardcoded Secrets

**Risk**: Secrets in code → exposed in repository history, build artifacts, logs

**Remediation**:
1. Remove secret from code
2. Rotate affected credentials immediately
3. Use environment variables or secure vault
4. Add to `.gitignore`
5. Use `git-filter-repo` to purge history (only if not yet public)

```bash
# Example: Move secret to env
- const API_KEY = "sk-123456789";
+ const API_KEY = process.env.API_KEY;
```

---

### Finding: Missing Input Validation

**Risk**: Injection attacks, buffer overflows, DoS

**Remediation**:
1. Validate all user inputs (type, length, format)
2. Use allowlists where possible
3. Sanitize for output context (HTML, SQL, JavaScript)
4. Add tests for invalid inputs

```bash
// ✗ Unsafe
app.get('/user/:id', (req, res) => {
  db.query(`SELECT * FROM users WHERE id = ${req.params.id}`);
});

// ✓ Safe
app.get('/user/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) throw new Error('Invalid ID');
  db.query('SELECT * FROM users WHERE id = ?', [id]);
});
```

---

### Finding: Insufficient Error Handling

**Risk**: Sensitive information in error messages, system crashes

**Remediation**:
1. Catch specific exceptions
2. Log full error internally only
3. Return generic error to user
4. Never expose stack traces in production

```bash
// ✗ Unsafe
try {
  // operation
} catch (e) {
  res.status(500).json({ error: e.message });
}

// ✓ Safe
try {
  // operation
} catch (e) {
  logger.error('Operation failed:', e); // Internal only
  res.status(500).json({ error: 'An error occurred' });
}
```

---

### Finding: Race Condition in State Mutation

**Risk**: Data inconsistency, financial loss, contract exploits

**Remediation**:
1. Use database transactions
2. Use mutex/locks for concurrent access
3. Implement optimistic concurrency control
4. Test with load and concurrent requests

```bash
// ✓ With transaction
db.$transaction(async (tx) => {
  const current = await tx.balance.findUnique({ where: { id } });
  const updated = await tx.balance.update({
    where: { id },
    data: { amount: current.amount - withdrawal }
  });
});
```

---

### Finding: Missing CSRF Protection

**Risk**: Unauthorized state-changing actions on behalf of users

**Remediation**:
1. Use CSRF tokens for state-changing operations (POST, PUT, DELETE)
2. Validate token on every request
3. Use SameSite cookie attribute
4. Implement double-submit cookies if needed

```bash
// ✓ With CSRF protection
app.post('/transfer', csrfProtection, (req, res) => {
  // Token already validated by middleware
  // Process transfer
});
```

---

### Finding: Unencrypted Sensitive Data in Transit

**Risk**: Man-in-the-middle attacks, credential theft

**Remediation**:
1. Enforce HTTPS/TLS everywhere
2. Use HSTS headers
3. Pin certificates for critical connections
4. Use secure WebSocket (wss://)

```nginx
# ✓ In production nginx config
server {
  listen 443 ssl http2;
  ssl_protocols TLSv1.2 TLSv1.3;
  add_header Strict-Transport-Security "max-age=31536000" always;
}
```

---

### Finding: Overly Permissive Access Control

**Risk**: Unauthorized data access, privilege escalation

**Remediation**:
1. Apply principle of least privilege
2. Use role-based access control (RBAC)
3. Add per-resource authorization checks
4. Audit access patterns

```bash
// ✗ Unsafe
app.get('/users/:id', (req, res) => {
  const user = db.getUser(req.params.id);
  res.json(user);
});

// ✓ Safe
app.get('/users/:id', (req, res) => {
  const user = db.getUser(req.params.id);
  if (!canViewUser(req.user, user)) {
    throw new ForbiddenError();
  }
  res.json(user);
});
```

## Incident Response

If a security issue is found during review:

1. **Stop the PR**: Do not merge until resolved
2. **Classify**: Severity level (critical, high, medium, low)
3. **Assign**: Route to appropriate expert
4. **Remediate**: Fix the issue or redesign
5. **Verify**: Re-review to confirm fix
6. **Document**: Add to incident log and use for training

For critical issues in production, follow [Incident Response Plan](./backend/docs/) immediately.

## Release Coordination

### Pre-Release Security Checklist

- [ ] All PRs passed security review
- [ ] No open security findings
- [ ] Dependency audit passed
- [ ] SAST/scanning passed
- [ ] Changelog documents security changes
- [ ] Release notes include security advisories if any

### Security Incident Disclosure

If releasing a security fix:
- Coordinate with security@yieldvault.com
- Prepare security advisory
- Follow responsible disclosure timeline
- Notify customers if data exposed

## Resources

- [CONTRIBUTING.md](./CONTRIBUTING.md) - Contribution workflow
- [ARCHITECTURE_SUMMARY.md](./ARCHITECTURE_SUMMARY.md) - System design
- [Release Documentation](./backend/docs/) - Release processes
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CWE Top 25](https://cwe.mitre.org/top25/)

---

**Last Updated**: August 2026  
**Owned By**: Security Team  
**Review Schedule**: Quarterly
