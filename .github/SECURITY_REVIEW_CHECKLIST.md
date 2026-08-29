# Security Review Checklist — Secrets, PII & Transport

**Use for:** any PR that adds/changes a data store, secret, credential, external integration, or network-facing endpoint.
**Companion doc:** [`docs/security/encryption-review.md`](../docs/security/encryption-review.md) — full current-state review this checklist enforces going forward.
**Not this checklist:** smart-contract vulnerability classes (reentrancy, access control, gas/DoS) are covered by [`docs/SECURITY_CHECKLIST.md`](../docs/SECURITY_CHECKLIST.md).

---

## 1. Secrets & Credentials

- [ ] No secret, API key, private key, or credential is hardcoded or committed (checked by `gitleaks` in CI, but review the diff yourself too)
- [ ] New secrets are read from `process.env` / GitHub Actions `secrets.*`, never from a config file checked into the repo
- [ ] Any new required secret is documented in [`docs/ENV_VARIABLE_MATRIX.md`](../docs/ENV_VARIABLE_MATRIX.md)
- [ ] Secrets that must exist in production fail startup loudly if missing or weak (follow the pattern in `backend/src/auth.ts`'s `assertJwtSecretValid()`) rather than silently falling back to a dev default
- [ ] Tokens/keys are persisted as one-way hashes (SHA-256/HMAC or stronger), never in plaintext

## 2. Data at Rest

- [ ] New sensitive fields (PII, tokens, wallet-linked identifiers) are added to the correct model with the retention category noted in [`docs/DATA_RETENTION_DELETION_POLICY.md`](../docs/DATA_RETENTION_DELETION_POLICY.md)
- [ ] Any new database, cache, or file-based store this PR introduces is confirmed to write to the *intended* backing store — verify the Prisma datasource / connection string actually points where you think it does (see `docs/security/encryption-review.md` §4 F1 for a real example of this silently going wrong)
- [ ] No secret or PII value is written to logs, error messages, or audit trails in plaintext — check against `backend/src/auditRedaction.ts`'s redaction patterns

## 3. Data in Transit

- [ ] All new outbound calls (webhooks, RPC, third-party APIs) use `https://` / `wss://`, never plaintext `http://`
- [ ] New database or cache connection strings enforce TLS (`sslmode=require` for Postgres, `rediss://` for Redis) where the backing service supports it
- [ ] New cookies (if any) set `Secure`, `HttpOnly`, and an explicit `SameSite` — this repo's auth model currently uses Bearer tokens, not cookies, so introducing a cookie is a deliberate change worth flagging in the PR description
- [ ] CORS changes stay within an explicit origin allowlist — no `*` or broad regex in `CORS_ALLOWED_ORIGINS`

## 4. PII & Sensitive Data Handling

- [ ] User-identifying data (wallet address, email, IP) is only collected/stored where there's a documented purpose in [`docs/DATA_RETENTION_DELETION_POLICY.md`](../docs/DATA_RETENTION_DELETION_POLICY.md)
- [ ] Frontend `localStorage`/`sessionStorage` usage stores no private keys, JWTs, or API keys — only public/non-sensitive values (wallet address, UI prefs, session timestamps)
- [ ] New admin or export endpoints that expose PII/financial data are gated by the correct RBAC role and rate-limited

## 5. If This PR Touches Any of the Findings in `docs/security/encryption-review.md`

- [ ] Confirm which finding (F1–F6) this PR addresses, if any
- [ ] Update the finding's status in `docs/security/encryption-review.md` in the same PR
- [ ] If this PR resolves a finding, note it in the PR description so reviewers can verify against the documented evidence

---

**If any box above cannot be checked**, explain why in the PR description rather than leaving it silently unchecked — a documented exception is reviewable; a missing explanation is not.
