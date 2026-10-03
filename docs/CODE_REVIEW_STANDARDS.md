# Code Review and Approval Contribution Standards

This document establishes the production-hardened contribution standards, code review principles, approval thresholds, and merge policies for the `YieldVault-RWA` codebase.

---

## 1. Overview & Objectives

High-quality code reviews are critical for maintaining security, reliability, maintainability, and architectural integrity in a decentralized financial application handling real-world assets (RWA). 

All contributors (core team, community members, and external partners) must adhere to these standards when submitting or reviewing Pull Requests (PRs).

---

## 2. Review SLAs & Turnaround Expectations

| Event | Primary Responsibility | Target Response Window |
|---|---|---|
| Initial PR Feedback | Assigned Maintainers / Code Owners | **3 business days** |
| Follow-up Review (after updates) | Original Reviewers | **2 business days** |
| Emergency / P0 Security Review | Security Lead / Tech Lead | **4 hours** |
| Stale PR Warning | Automated / Maintainers | **14 days without activity** |
| Stale PR Closure | Maintainers | **30 days without activity** |

---

## 3. Approval Requirements by Component Criticality

Approval thresholds are governed by the component criticality matrix defined in [`docs/QUALITY_GATES_MATRIX.md`](./QUALITY_GATES_MATRIX.md).

### Tier 1: Core Smart Contracts & Value Transfer
*Scope: Vault contracts, yield strategies, oracle wrappers, access control, token handlers, Rust source files*
- **Minimum Approvals:** **2 approving reviews** from Contract Reviewers (`@Junirezz`, `@contract-reviewers`) and Rust Reviewers (`@rust-reviewers` for `*.rs`).
- **Security Sign-Off:** Mandatory sign-off from Security Lead (`@YieldVault-RWA/security-team`).
- **Required Checks:** 100% test coverage, Slither static analysis with 0 unresolved High/Medium findings, unit + fuzz test pass.

### Tier 2: Backend Services & API Layer
*Scope: Relayers, indexers, webhook processors, authentication, data APIs, database migrations*
- **Minimum Approvals:** **1 approving review** from Backend Maintainers (`@YieldVault-RWA/backend-maintainers`).
- **Domain Owner:** Additional approval if modifying a domain owned by a specific lead (see [`docs/BACKEND_MODULE_OWNERSHIP.md`](./BACKEND_MODULE_OWNERSHIP.md)).
- **Required Checks:** Unit and integration tests passing, OpenAPI spec update verified (`npm run generate:openapi`), schema drift check passing.

### Tier 3: Frontend & User Interfaces
*Scope: Web dashboard, admin panel, state management, UI components, Web3 integrations*
- **Minimum Approvals:** **1 approving review** from Frontend Maintainers (`@YieldVault-RWA/frontend-maintainers`).
- **Required Checks:** Unit & E2E tests passing, internationalization (`i18n`) catalog parity maintained across supported locales, accessibility score > 90.

### Tier 4: Operational Tooling, Scripts & Documentation
*Scope: CI/CD workflows, deployment scripts, governance documentation, runbooks*
- **Minimum Approvals:** **1 approving review** from DevOps or Documentation Maintainers (`@YieldVault-RWA/devops-maintainers` / `@YieldVault-RWA/docs-maintainers`).
- **Required Checks:** Dry-run capability verified for scripts, `shellcheck` passing for bash scripts, doc links valid.

---

## 4. Contributor / Author Guidelines

Before requesting a review, authors **must** perform a thorough self-review:

### Pre-Submission Checklist
1. **Branch Naming**: Follow the strict pattern:
   - `feat/<issue-number>-<short-description>`
   - `fix/<issue-number>-<short-description>`
   - `docs/<issue-number>-<short-description>`
   - `refactor/<issue-number>-<short-description>`
   - `chore/<issue-number>-<short-description>`
2. **PR Title**: Standardized format `<Type>: <Short description>` (e.g., `Fix: Resolve vault deposit rounding edge case`).
3. **PR Description**: Must complete all sections in `.github/PULL_REQUEST_TEMPLATE.md`:
   - `### Goal`: Clear objective and linked issue (`Closes #123`).
   - `### Changes`: Detailed bullet points of exact changes.
   - `### Risk Assessment`: Blast radius, risk tier, and migration impact analysis.
   - `### Rollback Plan`: Rollback strategy, trigger conditions, and step-by-step procedures.
   - `### Performance Impact`: Smart contract gas benchmarks, latency, and resource profiling.
   - `### Testing`: Verification steps, automated test coverage, and local reproduction results.
   - `### Security Review`: Full checklist completed for smart contract or auth changes.
4. **Clean Commits**: Squashed or well-organized commits with informative commit messages following Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`).
5. **No Debug Leftovers**: Remove `console.log`, hardcoded secrets, commented-out dead code, or temporary mock files.

---

## 5. Reviewer Expectations & Feedback Guidelines

Reviewers should aim to help authors deliver secure, performant, and clean code while maintaining a welcoming and collaborative tone.

### Code Review Principles
- **Be Explicit**: Clearly distinguish between mandatory fixes and optional suggestions.
- **Explain the Why**: Always provide technical justification or refer to architecture docs / standards when requesting a change.
- **Focus on High-Impact Areas**: Security, correctness, API stability, performance, test coverage, and maintainability.

### Standardized Comment Prefixes
Reviewers **must** prefix inline comments using the following conventions:

| Prefix | Meaning | Action Required by Author |
|---|---|---|
| `blocking:` | Critical bug, security flaw, or violation of project standards | Must be resolved before merge |
| `security:` | Security weakness, missing access control, or unsafe pattern | Must be addressed with sign-off |
| `suggestion:` | Non-blocking proposal for cleaner, more idiomatic code | Strongly encouraged, author discretion |
| `nit:` | Minor typo, formatting, or minor style issue | Author discretion, no re-review needed |
| `question:` | Clarification request regarding intent or implementation | Author answer required |
| `optional:` | Nice-to-have optimization or future refactoring idea | Can be deferred to follow-up issue |

---

## 6. CODEOWNERS & Automated Approvals

Code ownership is defined in [`.github/CODEOWNERS`](../.github/CODEOWNERS). GitHub automatically requests reviews from designated code owners based on file paths touched in the PR.

- PRs cannot be merged without required approvals from appropriate CODEOWNERS.
- Self-approving PRs is strictly prohibited.
- Authors must not bypass branch protection rules unless authorized by Tech Lead during emergency P0 incidents.

---

## 7. Fast-Track & Emergency Hotfix Policy

In the event of an active P0 production incident or critical security vulnerability:

1. **Security / Hotfix Branching**: Create branch `hotfix/<incident-id>-<description>`.
2. **Fast-Track Approvals**: Requires **1 Tech Lead + 1 Security Lead approval**.
3. **Post-Mortem**: A post-mortem document must be created within 48 hours following [`docs/postmortem-playbook.md`](./postmortem-playbook.md).

---

## 8. Automated Compliance & Governance Verification

Contribution standards are programmatically checked via:
- `scripts/validate-contribution-standards.ts` (`npm run validate:contribution-standards`)
- GitHub Actions CI pipelines (`.github/workflows/`)

Any PR failing automated contribution checks will be blocked until issues are resolved.
