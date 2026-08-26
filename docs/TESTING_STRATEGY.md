# YieldVault-RWA Testing Strategy

This document defines how testing is split across unit, integration, and end-to-end scopes in YieldVault-RWA. It is intended to make ownership, fixture placement, and expected coverage consistent across the frontend, backend, and smart contract layers.

## Principles

- Keep tests close to the code they validate.
- Use the smallest scope that can prove the behavior.
- Promote shared fixtures only when multiple tests in the same layer use them.
- Reserve full user-journey tests for cross-screen or cross-service flows.

## Test Layers

| Layer | Primary purpose | Owned by | Typical locations | Primary commands |
| --- | --- | --- | --- | --- |
| Unit | Pure logic, rendering branches, validation, math, and state reducers/hooks | The feature owner | `frontend/src/**/*.test.ts(x)`, `backend/src/__tests__/**/*.test.ts`, `contracts/vault/src/*_tests.rs`, `contracts/vault/src/test.rs` | `cd frontend && npm run test:run`, `cd backend && npm test`, `cargo test -p vault` |
| Integration | Module-to-module behavior, HTTP handlers, provider wiring, contract scenarios with real Soroban test env | The service or feature owner | `backend/src/__tests__/*.test.ts`, `frontend/src/tests/*.test.tsx`, `frontend/src/components/*.test.tsx`, `frontend/src/pages/*.test.tsx`, `contracts/vault/src/test.rs` | Same commands as unit, plus focused suite runs |
| E2E | Real browser journeys through the running app | The frontend feature owner, with backend support when the journey crosses APIs | `frontend/e2e/*.spec.ts` | `cd frontend && npm run test:e2e` |
| Smoke (Cypress) | Fast critical-path verification in CI before Playwright suite; wallet connect, deposit/withdraw access, transaction history | The frontend feature owner | `frontend/cypress/e2e/*.cy.ts` | `cd frontend && npm run test:cypress` |
| Load | API throughput, latency budgets, and degradation behavior under concurrent traffic | The platform/backend owner | `tests/load/*.test.js` | `k6 run tests/load/vault-load.test.js` (CI: `load-tests.yml`) |
| Contract Fuzz | Invariant-guided random input generation for Soroban contract math and state transitions | The contract feature owner | `contracts/vault/fuzz/`, `contracts/vault/src/fuzz_math.rs`, `contracts/vault/src/deposit_withdraw_props.rs` | `cargo test -p vault`, `cargo fuzz run share_price_math` |

## Ownership Rules

- Frontend unit and component tests are owned by the UI feature owner. They should validate hooks, components, routing branches, and accessibility states.
- Backend tests are owned by the API or platform feature owner. They should validate request handling, middleware, error formatting, and service boundaries.
- Contract tests are owned by the contract feature owner. They should validate Soroban state transitions, authorization, share math, and event emission.
- E2E tests are owned by the product surface owner for the flow being validated. If a journey spans frontend and backend, the frontend owner coordinates the path and the backend owner supplies deterministic API behavior.

## Fixture Strategy

### Frontend

- Keep small test doubles inline when only one test uses them.
- Put repeated browser fixtures in `frontend/e2e/fixtures.ts`.
- Prefer local mock factories in the test file for component and hook suites.
- Use shared mock data only when it keeps multiple specs aligned on the same domain model.

### Backend

- Build request fixtures inside the test file unless they are reused across multiple suites.
- Prefer explicit seed helpers over hidden global state.
- Use `supertest` against the Express app for request/response coverage.
- Mock external services at the boundary and keep the mock shape aligned with the production contract.

### Contracts

- Use `Address::generate` and `setup_vault`-style helpers to create isolated environments.
- Keep contract setup helpers in the test module that owns the behavior.
- Prefer helper functions for repeated token minting, vault setup, and assertion setup.

## Coverage Expectations By Feature Type

| Feature type | Required coverage | Optional coverage | Notes |
| --- | --- | --- | --- |
| Pure utility or math helper | Unit tests only | Property-based tests when input space is large | Cover normal, edge, and failure cases.
| React hook or presentational component | Unit tests for state and rendering | Integration test when the component depends on a provider or routing context | Verify loading, success, and error states.
| Form or wizard flow | Unit tests for step logic | Integration test for the full local flow | Use E2E only when the journey includes real navigation or wallet/browser behavior.
| Backend route, middleware, or service | Unit tests for validation and branching | Integration tests with `supertest` and seeded state | Cover failure handling and response shape.
| Smart contract behavior | Contract unit tests in Rust | Scenario-style contract integration tests in the same suite | Cover authorization, state transitions, and accounting invariants.
| Cross-screen product journey | E2E | None | Use Playwright for the canonical browser path.

## What Belongs In Each Layer

### Unit

Use unit tests for deterministic behavior that does not need a real browser, RPC server, database, or wallet extension. Examples:

- Formatting helpers, validations, and calculators.
- Hook state transitions and rendering branches.
- Backend sanitizers, rate-limit helpers, and middleware guards.
- Contract arithmetic, access control checks, and invariant math.

### Integration

Use integration tests when more than one local module must cooperate but the full browser journey is still unnecessary. Examples:

- Backend routes that require middleware, request parsing, and seeded state.
- Frontend components that need router, query client, or context providers.
- Contract scenarios that stand up a full Soroban environment and exercise multiple contract calls.

### E2E

Use E2E tests only for user journeys that must prove the app works in a real browser. Examples:

- Wallet connection and reconnect flows.
- Deposit, withdraw, and dashboard journeys that span multiple screens.
- Regression checks for browser-only behavior such as focus handling or browser storage.

## Recommended Commands

- Frontend unit and integration: `cd frontend && npm run test:run`
- Frontend browser journeys: `cd frontend && npm run test:e2e`
- Cypress smoke checks, when specifically needed: `cd frontend && npm run test:cypress`
- Backend tests: `cd backend && npm test`
- Contract tests: `cargo test -p vault`

## Review Checklist

- The test scope matches the behavior under change.
- Fixtures live in the narrowest place that still keeps the tests readable.
- Cross-layer behavior has at least one deterministic integration test.
- Browser-only flows have at least one Playwright test.
- New feature work adds coverage in the layer that owns the behavior, not just in the widest suite.
- New UI components include an `axe-core` accessibility audit in their test suite.
- Security-sensitive changes add or update tests in the relevant security test files.
- Contract math changes include proptest or fuzz coverage for the affected invariants.
- Load test thresholds are reviewed when API contracts change (endpoint shape, latency budgets).

## Repository Enforcement

This strategy is enforced with the repository validator at `npm run validate:testing-strategy`. The command checks that the strategy document still covers the required testing layers, layer-specific guidance, recommended commands, Playwright-based E2E coverage expectations, accessibility testing, security testing, load testing, fuzz/property-based testing, CI pipeline integration, coverage thresholds, and the tools & frameworks overview.

## Core Playwright User Flows

Canonical browser journeys live under `frontend/e2e/` and run with `cd frontend && npm run test:e2e` (CI: `.github/workflows/e2e.yml`).

| Flow | Spec | What it proves |
| --- | --- | --- |
| Dashboard load | `dashboard-load.spec.ts` | Home vault stats, nav, unknown-route redirect |
| Deposit / withdraw | `deposit-withdraw.spec.ts` | Wallet-gated panel, deposit/withdraw wizard with Freighter stubs |
| Deposit journey | `deposit-flow.spec.ts` | Manual connect → deposit happy path |
| Portfolio | `portfolio.spec.ts` | Connect prompt, holdings table, search filters |
| Transaction history | `transaction-history.spec.ts` | Connect prompt, Horizon history, nav deep link |
| Settings | `settings.spec.ts` | Preference surface and theme toggle |

Shared stubs and Freighter mocking belong in `frontend/e2e/fixtures.ts` so every core flow stays deterministic without a live backend.

## Cypress Smoke Suite

Cypress smoke tests (`frontend/cypress/e2e/smoke.cy.ts`) provide a lightweight first-pass verification that critical user journeys are not broken. They run faster than the full Playwright suite and are intended as a CI gate before heavier E2E work.

| Scenario | What it proves |
| --- | --- |
| Wallet connection | The Freighter message protocol stub returns a connected state visible in the UI |
| Deposit navigation | The deposit CTA is reachable from the dashboard |
| Withdrawal navigation | The withdrawal CTA is reachable from the dashboard |
| Transaction history | The `/transactions` route renders a table, empty state, or wallet prompt |

Unlike Playwright, Cypress tests use `cy.intercept()` for API mocking and run inside the same browser event loop. Use Cypress for fast smoke-gating; use Playwright for full multi-tab, multi-origin browser journeys.

## Accessibility Testing

Accessibility tests live in `frontend/src/tests/accessibility.test.tsx` and use `axe-core` to audit rendered component trees for WCAG violations. These tests are part of the frontend unit/integration suite (`cd frontend && npm run test:run`).

- Every new UI component that renders interactive elements must include an `axe-core` audit in its test suite.
- Focus on critical violations (`critical` and `serious` impact levels).
- Use `@testing-library/react` queries that mirror real user interactions (role-based selectors, accessible names).
- The accessibility test suite covers: dashboard, deposit/withdraw forms, transaction history, settings, and navigation.

## Security Testing

Security-focused tests validate defenses against common vulnerability classes:

| Test file | Coverage |
| --- | --- |
| `frontend/src/tests/xss-prevention.test.tsx` | XSS vectors in user-supplied input, URL parameters, and rendered output |
| `frontend/src/lib/security.test.ts` | Input sanitization, CSP header validation, secure storage patterns |
| `frontend/src/lib/maskSensitiveValues.test.ts` | Privacy-preserving display of wallet addresses and balances |
| `contracts/vault/tests/security_tests.rs` | Contract access control, reentrancy guards, overflow protection |
| `contracts/vault/tests/guard_checks_test.rs` | Authorization guard correctness for admin and strategy operations |
| `contracts/vault/tests/access_control_test.rs` | Role-based permission enforcement on vault methods |

Security tests run as part of the standard test suites (`npm run test:run`, `npm test`, `cargo test -p vault`).

## Load & Performance Testing

Load tests use [k6](https://k6.io) and target the staging backend. They validate latency budgets and error rates under concurrent traffic.

| File | Target | Scenarios |
| --- | --- | --- |
| `tests/load/vault-load.test.js` | Backend deposit/withdrawal endpoints | 200 VU ramp-up over 2 min, sustained for 5 min |

**Thresholds:**
- `http_req_duration`: p95 < 500 ms
- `http_req_failed`: rate < 0.1%

**Execution:**
- Scheduled: Mondays at 03:00 UTC (`.github/workflows/load-tests.yml`)
- Manual: `workflow_dispatch` trigger in the Actions tab
- Run locally: `k6 run tests/load/vault-load.test.js`

Load tests use idempotency keys to allow safe re-runs and target the staging environment only — never production.

## Fuzz & Property-Based Testing (Contracts)

### Cargo-Fuzz (Coverage-Guided Fuzzing)

Coverage-guided fuzz targets live under `contracts/vault/fuzz/fuzz_targets/` and use `cargo-fuzz` (libFuzzer).

| Target | What it exercises |
| --- | --- |
| `share_price_math` | Deposit, withdraw, yield accrual, and fee extraction with random inputs |

Run with:
```bash
cargo fuzz run share_price_math
```

Seed fixtures in `contracts/vault/fuzz/seed_fixtures/` bootstrap the fuzzer with known-interesting inputs.

### Proptest (Property-Based Testing)

Property-based tests use the `proptest` crate and are co-located with contract source files.

| File | What it covers |
| --- | --- |
| `contracts/vault/src/fuzz_math.rs` | Arithmetic invariants: deposit/withdraw round-trips, share price monotonicity, fee bounds |
| `contracts/vault/src/deposit_withdraw_props.rs` | Multi-user share sums, yield accrual monotonicity, cooldown enforcement, batch vs individual deposit equivalence |

Proptest regression files are checked into `contracts/vault/proptest-regressions/` so that discovered failures are never silently lost.

## CI Pipeline Integration

| Workflow | Trigger | What runs |
| --- | --- | --- |
| PR checks (implicit) | Every PR | Frontend unit + integration (`npm run test:run`), Backend tests (`npm test`), Contract tests (`cargo test -p vault`) |
| `.github/workflows/e2e.yml` | PRs touching `frontend/**`, pushes to `main` | Playwright E2E suite (Chromium) |
| `.github/workflows/load-tests.yml` | Weekly schedule (Mon 03:00 UTC) + manual dispatch | k6 load tests against staging |
| `.github/workflows/nightly-benchmarks.yml` | Nightly 02:00 UTC + manual dispatch | Contract CPU/memory for deposit, withdraw, invest, switch strategy; posts GitHub Issue |

All CI workflows upload failure artifacts (screenshots, videos, traces) for post-mortem analysis.

## Coverage Thresholds

Coverage is enforced at the CI level for backend and tracked for frontend:

| Layer | Tool | Threshold | Config |
| --- | --- | --- | --- |
| Backend | Jest (`--coverage`) | 50% branches, functions, lines, statements | `backend/jest.config.js` → `coverageThreshold` |
| Frontend | Vitest (`@vitest/coverage-v8`) | Tracked, not yet enforced | `cd frontend && npm run test:run -- --coverage` |
| Contracts | Not yet instrumented globally | Oracle modules targeted at 90% via `cargo test -p vault oracle` | See `docs/ORACLE_FAILURE_HANDLING.md` |

## Tools & Frameworks Overview

| Tool | Layer(s) | Purpose |
| --- | --- | --- |
| [Vitest](https://vitest.dev) | Frontend unit/integration | Component, hook, utility, and page-level tests; jsdom environment |
| [Testing Library](https://testing-library.com) | Frontend unit/integration | DOM queries and user-event simulation |
| [Playwright](https://playwright.dev) | Frontend E2E | Real browser automation with trace, video, and screenshot capture |
| [Cypress](https://cypress.io) | Frontend smoke | Fast smoke-gating of critical paths in CI |
| [Jest](https://jestjs.io) | Backend unit/integration | Service, middleware, and route tests with `supertest` |
| [k6](https://k6.io) | Backend load | Concurrent traffic simulation with latency/error budgets |
| [proptest](https://docs.rs/proptest) | Contracts | Randomized property-based testing for arithmetic invariants |
| [cargo-fuzz](https://rust-fuzz.github.io) | Contracts | Coverage-guided fuzzing via libFuzzer |
| [axe-core](https://github.com/dequelabs/axe-core) | Frontend accessibility | WCAG violation detection in component render trees |
| [fast-check](https://fast-check.dev) | Frontend/Backend | Property-based testing for TypeScript logic |

---

## Property-Based Tests for Deposit/Withdraw Math (Issue #962)

File: `contracts/vault/src/deposit_withdraw_props.rs`

These proptest suites extend the existing `fuzz_math.rs` coverage with higher-level vault invariants:

| Property | What it verifies |
|---|---|
| `prop_two_user_deposit_share_sum` | `sum(user_shares) == total_shares` after two deposits |
| `prop_three_user_share_sum` | Individual balances sum to `total_shares` for three users |
| `prop_partial_withdrawal_shares_consistent` | Remaining shares == deposited - withdrawn, never negative |
| `prop_yield_accrual_monotone_share_price` | `share_price` never decreases after `accrue_yield` |
| `prop_share_price_positive_after_deposit` | `share_price > 0` after any deposit |
| `prop_fee_extraction_does_not_touch_principal` | `treasury_balance <= expected_fee`, resets to 0 after `claim_fees` |
| `prop_batch_deposit_matches_individual_deposits` | Batch deposit produces same shares as individual deposits |
| `prop_withdrawal_cooldown_enforced` | Withdrawal within cooldown window returns `WithdrawalCooldownActive` |

Run with:

```bash
cargo test deposit_withdraw_props -- --nocapture
```
