# Recurring Dependency Review Process and Ownership

> **Policy companion:** See [Dependency Update Policy](./DEPENDENCY_UPDATE_POLICY.md) for the authoritative rules on upgrade cadence, testing gates, high-risk library list, CVE severity SLAs, and major-update owner requirements. This document covers the recurring *workflow* — how reviews are scheduled, executed, and documented.

This document defines a recurring process for reviewing third-party dependencies, assigning accountable owners, tracking outcomes, and keeping updates safe for YieldVault-RWA.

---

## 1) Objectives

- Maintain dependency hygiene (security + stability)
- Establish predictable review cadence
- Ensure every review has accountable owners and a documented outcome
- Minimize disruption by approving updates through a controlled workflow

---

## 2) Scope

Applies to:
- Root-level dependencies (`package.json` / lockfiles)
- Backend (`backend/package.json`)
- Frontend (`frontend/package.json`)
- Contract build tooling where applicable (`Cargo.toml`)

---

## 3) Ownership model

Assign an owner per surface area. The owner is accountable for coordinating the review and ensuring outcomes are documented.

| Surface | Primary owner | Typical collaborators |
|---------|----------------|-------------------------|
| Frontend npm deps | Frontend maintainer | Platform/CI if needed |
| Backend npm deps | Backend maintainer | Platform/CI if needed |
| Root tooling deps | Platform / Release engineer | Backend + Frontend |
| Rust/Cargo deps | Contracts maintainer | Security lead for risk |

If an owner is unavailable, the next team in the triage rotation calendar assumes temporary responsibility.

---

## 4) Cadence

### 4.1 Scheduled reviews
- **Monthly:** npm/JS dependency review for `backend/` and `frontend/`.
- **Quarterly:** root tooling review (any remaining packages).
- **Quarterly:** Rust/Cargo dependency review.

### 4.2 Triggered reviews (event-based)
Any of the following events must start a review within **5 business days**:
- New Dependabot alerts or security advisories
- Critical/high severity dependency vulnerability reported
- Build or CI failures tied to dependency changes

---

## 5) Review workflow (what reviewers must do)

### 5.1 Collect evidence
- Identify the dependency changes to evaluate (from Dependabot PRs or manual bump PRs).
- Check:
  - changelog / release notes for the dependency
  - known breaking changes
  - vulnerability advisories relevant to this repo

### 5.2 Risk assessment
For each candidate update, decide:
- Safe to merge as-is
- Requires tests/validation
- Needs staged rollout or rollback plan

Recommended risk signals:
- Major version bumps
- Changes to transitive dependencies with security impact
- Any dependency touching auth, crypto, request parsing, or webhook/signature handling

### 5.3 Testing/verification expectations
At minimum:
- Frontend: lint + relevant unit/E2E smoke checks
- Backend: lint + unit tests for critical paths
- Contracts: `cargo test` for relevant crates

(Exact commands depend on the repo’s current validation scripts; follow existing CI expectations.)

### 5.4 Outcome documentation (required)
Every dependency review results in a short outcome entry in one of:
- the Dependabot PR description
- a linked tracking issue
- this repo’s `CHANGELOG.md` only if user-visible impact exists

Outcome must include:
- What changed (high level)
- Risk decision (safe / needs validation / defer)
- Tests executed (and where documented)
- Link to PR(s)
- Any follow-up tasks

---

## 6) Approval and merge policy

- Routine patch/minor updates may be merged by the relevant surface owner after CI passes.
- Major updates require:
  - explicit review sign-off from the relevant maintainer
  - additional verification (at least the critical CI suites)
- Security-driven updates must be prioritized (target merge within **48 hours**) unless testing reveals unexpected breakage.

---

## 7) Exception handling

If dependency updates would be destabilizing (e.g., broad lockfile churn during a release freeze):
- Defer non-security updates to the next release train
- Ship only security/critical fixes during freeze
- Record the deferral rationale in the PR/issue

---

## 8) Metrics and reporting

Track these outcomes per month:
- Number of dependency PRs merged
- Number deferred (and why)
- Vulnerabilities resolved via dependency updates
- Incidents caused by dependency upgrades (target: zero)

Report summary quarterly in the relevant governance channel (e.g., team updates or an issues tracker).

---

**Last updated:** 2026-06-27

