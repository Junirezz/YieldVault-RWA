# Dependency Update Policy

> **Related docs:**
> - [Dependency Review Process](./DEPENDENCY_REVIEW_PROCESS.md) — recurring review cadence, ownership, and outcome documentation
> - [Security Scanning Guide](./SECURITY_SCANNING_GUIDE.md) — CVE tooling and scanner configuration
> - [Code Review Standards](./CODE_REVIEW_STANDARDS.md) — general PR review expectations
> - [CODEOWNERS](../.github/CODEOWNERS) — authoritative owner list per surface

This document defines **policy** — the rules governing how dependencies are upgraded across the YieldVault-RWA monorepo. It applies to all three layers: Soroban smart contracts (Rust/Cargo), backend (Node.js/npm), and frontend (Node.js/npm). The companion [Dependency Review Process](./DEPENDENCY_REVIEW_PROCESS.md) covers the recurring review workflow and outcome documentation requirements.

---

## 1. Scope

| Layer | Manifest | Package manager |
|-------|----------|-----------------|
| Contracts | `/Cargo.toml`, `*/Cargo.toml` | Cargo |
| Backend | `backend/package.json` | npm |
| Frontend | `frontend/package.json` | npm |
| Root tooling | `/package.json` | npm |

All four surfaces are in scope. Transitive (indirect) dependencies surfaced by Dependabot alerts or audit tools are subject to the same rules as direct dependencies.

---

## 2. Upgrade Cadence

### 2.1 Automated Dependabot updates

Dependabot is configured for daily runs on all three surfaces. PRs raised automatically by Dependabot follow this merge policy:

| Update type | Target SLA | Who may merge |
|-------------|-----------|---------------|
| **Security patch** (any severity) | ≤ 48 hours | Surface owner (after CI green) |
| **Patch** (non-security) | ≤ 2 weeks | Surface owner (after CI green) |
| **Minor** | Next scheduled sprint | Surface owner with one peer review |
| **Major** | Requires owner sign-off (see §4) | Surface owner + one additional maintainer |

### 2.2 Manual / planned upgrades

Outside Dependabot, dependency upgrades are permitted only via a `chore/*` branch (see [CONTRIBUTING.md](../CONTRIBUTING.md#branching-strategy)). Examples:

```
chore/upgrade-prisma-6
chore/bump-stellar-sdk-minor
chore/rust-soroban-sdk-2
```

Manual upgrades follow the same review criteria as automated ones but require the author to explicitly document the reason in the PR description.

### 2.3 Layer-specific cadence

| Layer | Patch | Minor | Major |
|-------|-------|-------|-------|
| **Frontend** (user-facing) | As PRs arrive (≤ 2 weeks) | Sprint boundary | Planned release only |
| **Backend** (API/services) | As PRs arrive (≤ 2 weeks) | Sprint boundary | Planned release only |
| **Contracts** (on-chain Rust) | As PRs arrive (≤ 2 weeks) | Sprint boundary | Security audit gate required |
| **Root tooling** | As PRs arrive (≤ 1 month) | Quarterly | Quarterly |

Contract-layer major upgrades require a security audit checkpoint before merging. See §4.

---

## 3. Testing Gates

All dependency update PRs must pass the following CI gates before merge. A PR with failing gates **must not** be merged, even for security patches — fix the breakage first.

### 3.1 Minimum gates (all layers)

- [ ] Linting passes (`npm run lint` / `cargo fmt --check`)
- [ ] Unit tests pass (`npm test` / `cargo test`)
- [ ] Build succeeds (`npm run build` / `cargo build --release`)

### 3.2 Extended gates (required for minor and major updates)

| Layer | Additional gate |
|-------|----------------|
| **Frontend** | Vitest unit suite + Cypress E2E smoke (`npm run test:e2e`) |
| **Backend** | Jest integration tests (`npm run test:integration`) |
| **Contracts** | Full `cargo test` including mock-strategy and oracle crates |

### 3.3 Gate bypass

No bypass is permitted for security patches unless:
1. The breakage is isolated to a test fixture unrelated to the vulnerability fix, **and**
2. A follow-up issue is filed within 24 hours to restore the test.

Bypasses require explicit written approval from the relevant surface owner and must be documented in the PR.

---

## 4. Major Update Owner Requirements

A major version bump (semver `X.0.0` where `X` increases) triggers the following additional requirements:

1. **Designated owner.** The owner defined in [CODEOWNERS](../.github/CODEOWNERS) for that surface must approve the PR. Approval from a different team member is insufficient.

2. **Changelog review.** The PR description must include a summary of breaking changes extracted from the upstream changelog or migration guide, with explicit notes on how each breaking change is handled.

3. **Migration plan.** If the upgrade requires code changes (API renames, removed exports, config changes), those changes must be included in the same PR or a linked PR that merges simultaneously.

4. **Staging validation.** Major updates to backend or frontend must be validated in the staging environment before merge to `main`. Contract major upgrades require testnet deployment validation.

5. **Contract layer additional gate.** Major Rust/Soroban SDK upgrades require:
   - Sign-off from `@YieldVault-RWA/contracts-maintainers` **and** `@YieldVault-RWA/security-team`
   - A security audit checkpoint or a scoped internal audit of changed surfaces
   - Testnet deployment and smoke test prior to merge

6. **Announcement.** Post a summary in the team's governance/update channel at least 24 hours before merging a major update, to allow any last-minute objections.

---

## 5. High-Risk Library List

The following libraries have elevated risk due to their role in security, cryptography, or protocol correctness. Updates to these packages require explicit review by the security team (`@YieldVault-RWA/security-team`) regardless of whether the update is patch, minor, or major.

### 5.1 Contracts (Rust/Cargo)

| Crate | Risk reason |
|-------|-------------|
| `soroban-sdk` | Core on-chain execution environment |
| `soroban-auth` | Authentication primitives |
| `stellar-xdr` | Ledger XDR encoding — any change can affect fund transfers |
| Any crate touching `i128` fixed-point arithmetic | Yield and share calculation correctness |

### 5.2 Backend (npm)

| Package | Risk reason |
|---------|-------------|
| `@stellar/stellar-sdk` | Signs and submits on-chain transactions |
| `@prisma/client` / `prisma` | Database ORM; schema migration risk |
| `jsonwebtoken` / `jose` | Auth token signing and verification |
| `express` / `fastify` | Core HTTP server; security surface |
| `helmet` | Security headers |
| `bcrypt` / `argon2` | Password hashing |
| Any HMAC/webhook-signing library | Webhook signature integrity |

### 5.3 Frontend (npm)

| Package | Risk reason |
|---------|-------------|
| `@stellar/freighter-api` | Wallet connection and transaction signing |
| `@stellar/stellar-sdk` | On-chain data parsing and XDR handling |
| Any content-security-policy or sanitization library | XSS risk |

### 5.4 Review requirements for high-risk libraries

- One additional approver from `@YieldVault-RWA/security-team` required (all update types).
- PR description must explicitly state: "High-risk library update — security review required."
- If the update is patch-only and purely a CVE fix with no API changes, the security team approver may fast-track within 24 hours.

---

## 6. CVE and Security Advisory Review Criteria

When a CVE or GitHub Security Advisory (GHSA) is raised against a dependency, use the following criteria to determine required action.

### 6.1 Severity tiers

| CVSS Score | Severity | Required action | SLA |
|------------|----------|----------------|-----|
| 9.0–10.0 | Critical | Upgrade or mitigate immediately; block release if unresolved | 24 hours |
| 7.0–8.9 | High | Upgrade in current sprint; must be resolved before next release | 72 hours |
| 4.0–6.9 | Medium | Upgrade in next sprint unless mitigation is in place | 2 weeks |
| 0.1–3.9 | Low | Upgrade at next scheduled review | Next review cycle |

### 6.2 Exploitability assessment

Before escalating a CVE, assess:

1. **Is the vulnerable code path reachable?** (e.g., a server-side vulnerability in a browser-only package is irrelevant)
2. **Is the affected feature used by YieldVault?** Check the relevant surface's imports.
3. **Does a patched version exist?** If not, document a mitigation plan (e.g., WAF rule, feature flag, code-level guard).
4. **Is this a false positive?** Consult [False Positive Handling](./FALSE_POSITIVE_HANDLING.md) before dismissing.

### 6.3 Breaking changes in security fixes

If a security patch introduces a breaking API change (uncommon but possible), the update is treated as a **major update** (see §4) with a fast-track SLA applied based on severity.

### 6.4 No-fix advisories

If no upstream fix exists within the SLA window:
- Document the CVE and mitigation in the tracking issue.
- Evaluate replacing the dependency with an alternative.
- Escalate to `@YieldVault-RWA/security-team` for risk acceptance sign-off.
- Record the risk-acceptance decision in the relevant PR or tracking issue.

---

## 7. Dependency Freeze During Release Windows

During release freezes (see [Release Train Cadence](./RELEASE_TRAIN_CADENCE_AND_FREEZE_POLICY.md)):

- Non-security dependency updates are **deferred** until the freeze lifts.
- Security patches classified High or Critical **may** be merged during a freeze with explicit approval from the release engineer.
- Any merge during a freeze requires a fast-follow patch release plan if it introduces unexpected breakage.

---

## 8. Dependency Addition Policy

Adding a **new** dependency (not an upgrade) follows stricter rules than updating an existing one:

1. **Necessity check.** Can the need be met with an existing dependency or standard library? If yes, prefer that.
2. **Maintenance health.** Check:
   - Last release date (reject if >18 months with no activity, unless intentionally stable)
   - Number of maintainers (flag if single-maintainer)
   - Open critical CVEs
3. **Pinned version.** New dependencies must use an exact version in the manifest (no `^` or `~` ranges for production deps in contracts and backend). Frontend may use `^` for minor ranges on non-security-sensitive packages.
4. **License compatibility.** Confirm the license is compatible with YieldVault's distribution terms. Flag any GPL/AGPL-licensed package for legal review before adding.
5. **Tree-shaking and bundle size.** For frontend additions, check the bundle size impact. Packages adding >20 KB gzipped to the main bundle require explicit justification.
6. **Review requirement.** New dependency additions require one additional reviewer beyond the standard code owner, regardless of surface.

---

## 9. Exceptions and Waivers

Any deviation from this policy requires:

1. A written rationale in the PR description or a linked issue.
2. Explicit approval from the relevant surface owner and one core maintainer.
3. A follow-up issue filed to resolve the exception (with a due date).

Repeated exceptions for the same dependency or surface should trigger a policy review.

---

## 10. Policy Ownership and Review

| Role | Responsibility |
|------|---------------|
| `@YieldVault-RWA/core-maintainers` | Policy owner; approve material changes to this document |
| `@YieldVault-RWA/security-team` | CVE criteria and high-risk library list |
| `@YieldVault-RWA/contracts-maintainers` | Cargo/Soroban-specific rules |
| `@YieldVault-RWA/devops-maintainers` | Dependabot config and CI gate enforcement |

This policy is reviewed **quarterly** alongside the dependency review metrics (see §8 of [Dependency Review Process](./DEPENDENCY_REVIEW_PROCESS.md)).

---

**Last updated:** 2026-08-25  
**Issue:** [#1151](https://github.com/Junirezz/YieldVault-RWA/issues/1151)
