# ADR-007: Monorepo Layout for Contracts, Backend, and Frontend

**Date:** 2026-11-22
**Status:** Accepted
**Author:** YieldVault Contributors
**Reviewers:** N/A

---

## Context

YieldVault is made up of three components that change together on most
features: the Soroban smart contracts (`contracts/vault`,
`contracts/mock-strategy`), the Node/Express backend that indexes contract
events and serves the API (`backend/`), and the React frontend that talks to
both (`frontend/`). A typical feature (e.g. a new vault parameter) touches
the contract, the backend's indexing/validation of it, and the frontend form
that submits it. We needed to decide whether to keep these in one repository
or split them across separate repositories per component.

## Decision

Keep contracts, backend, and frontend in a single monorepo, with a shared
`packages/api-schemas` package that both the backend and frontend consume as
the typed contract for API payloads (see `packages/api-schemas`, referenced
from `backend/package.json` and `frontend/package.json` as
`@yieldvault/api-schemas`). Root-level `package.json` orchestrates
cross-package scripts (`build`, `typecheck`, `test`, `dev`) via pnpm.

## Rationale

- A single PR can land a contract change, the backend code that reads it,
  and the frontend UI for it, reviewed and merged atomically instead of
  coordinated across repos with version pinning.
- The shared `api-schemas` package guarantees the backend and frontend agree
  on request/response shapes at build time rather than at runtime.
- CI (`.github/workflows/`) can run targeted jobs per package
  (`rust-security.yml`, `frontend.yml`, backend governance) from one
  checkout without cross-repo triggers.

## Alternatives Considered

### Alternative 1: Separate repositories per component
- **Pros:** Independent release cadence and access control per component;
  smaller individual checkouts.
- **Cons:** Cross-cutting changes require coordinated PRs and version
  bumps across repos; API contract drift between backend and frontend is
  only caught at integration time instead of at compile time.

### Alternative 2: Monorepo without a shared schema package
- **Pros:** Simpler initial setup, no extra internal package to version.
- **Cons:** Backend and frontend would duplicate request/response types by
  hand, which is exactly the kind of drift the current
  `@yieldvault/api-schemas` package exists to prevent.

## Consequences

### Positive
- One PR, one review, one CI run covers a full-stack change.
- Shared types eliminate an entire class of frontend/backend contract bugs.

### Negative
- A single repository checkout is larger and CI must scope jobs per
  package (via `pnpm --filter`) to avoid rebuilding everything on every
  change.
- Contributors need Node, pnpm, and Rust toolchains installed together
  rather than per-component.

## Related Links
- `pnpm-workspace.yaml`, root `package.json`
- `packages/api-schemas/package.json`
- Issue #1660
