# Root Package Scripts Reference

This document lists all scripts in the root `package.json`, what they check or run, and when to use them.

## Installation & Setup

### `pnpm check:pnpm-version`
Verifies that the installed pnpm version matches the required version (≥9.12).
Run before install to ensure package manager compatibility.

### `pnpm prepare`
Sets up Husky git hooks (commit-msg, pre-commit).
Runs automatically after `pnpm install`.

## Build Scripts

### `pnpm build:schemas`
Builds API schema packages used by backend and frontend.
Must run before building backend or frontend.

### `pnpm build`
Full monorepo build: schemas → backend → frontend.
Use before production deployment or release.

### `pnpm typecheck`
Type-checks all TypeScript packages without emitting files.
Use in CI or before committing to catch type errors.

## Development Scripts

### `pnpm dev`
Starts both backend and frontend in parallel using concurrently.
Use for full-stack local development.

### `pnpm dev:backend`
Starts the backend development server with hot reload.
Builds schemas first, waits for database, then starts backend.

### `pnpm dev:frontend`
Starts the frontend development server with hot module replacement.
Builds schemas first, then starts Vite dev server.

### `pnpm wait-for-db`
Blocks until the database is ready.
Used internally by `dev:backend` to prevent startup failures.

## Testing Scripts

### `pnpm test`
Runs backend Jest tests with coverage, frontend Vitest tests, and root script tests.
Use in CI or before committing to ensure all tests pass.

### `pnpm test:backend`
Runs only backend Jest tests with coverage in serial mode.

### `pnpm test:frontend`
Runs only frontend Vitest tests in single-run mode (no watch).

### `pnpm test:root`
Runs root-level script tests using Vitest.

### `pnpm test:scripts`
Alias for `test:root`.

### `pnpm test:all`
Runs all test suites: backend, frontend, and root scripts.
Use as final verification before pushing.

### `pnpm test:flaky`
Runs only flaky backend tests to detect instability.

### `pnpm test:flaky-detector`
Executes backend flaky test detection suite.

### `pnpm test:wait-for-db`
Tests the database wait script functionality.

## Validation Scripts

### `pnpm validate`
Runs all validation scripts in sequence. Fails fast on first error.
Checks contribution standards, testing strategy, sprint/triage conventions, release notes, NFR baselines, CODEOWNERS, PR template, and Renovate config.
**Use before opening a PR or in CI to ensure policy compliance.**

### `pnpm validate:frontend-env`
Validates frontend environment variables against required schema.
Checks `.env.example` and actual `.env` for completeness.

### `pnpm validate:contribution-standards`
Ensures CONTRIBUTING.md matches enforced branch naming and PR conventions.

### `pnpm validate:testing-strategy`
Verifies TESTING_STRATEGY.md covers unit, integration, and E2E guidance.

### `pnpm validate:sprint-and-triage`
Checks sprint label formats and TRIAGE_LABELS.md taxonomy.

### `pnpm validate:release-notes`
Validates release notes template and conventional commit configuration.

### `pnpm validate:nfr-baselines`
Ensures NFR baselines (SLO, RTO, RPO) are documented and meet thresholds.

### `pnpm validate:incident-severity`
Checks incident severity definitions and escalation matrix.

### `pnpm validate:codeowners`
Verifies CODEOWNERS covers every top-level directory and all handles are valid.

### `pnpm validate:pr-template`
Ensures PR template includes all required sections.

### `pnpm validate:renovate`
Validates Renovate configuration for dependency automation.

## License & Compliance

### `pnpm validate:licenses`
Scans dependencies for license compliance violations.
Fails on GPL/AGPL or other restrictive licenses.

### `pnpm check:licenses`
Runs license validation and its test suite.

## Image & Asset Optimization

### `pnpm compress:images`
Compresses PNG images in the repo to reduce size.
Run before committing large image assets.

### `pnpm validate:images`
Checks image file sizes against maximum thresholds.

### `pnpm validate:line-endings`
Ensures generated artifacts have consistent line endings (LF).

## Security & Auditing

### `pnpm audit:pnpm`
Runs pnpm audit with high-severity threshold.
Fails on high or critical vulnerabilities.

### `pnpm check:security-audit`
Runs Renovate validation, tests, and pnpm audit.
Use before releases to catch security issues.

## Linting & Formatting

### `pnpm lint:staged`
Runs lint-staged on staged files (enforced by Husky pre-commit hook).

### `pnpm commitlint`
Validates commit messages against conventional commit format.
Enforced by Husky commit-msg hook.

## Test Coverage Scripts

### `pnpm test:validate-frontend-env`
Tests the frontend environment validator using Vitest.

### `pnpm test:validate-workspace-test-scripts`
Verifies workspace test scripts are correctly configured.

### `pnpm test:validate-codeowners`
Tests CODEOWNERS validation logic.

### `pnpm check:codeowners`
Runs CODEOWNERS validation and its tests.

### `pnpm test:validate-pr-template`
Tests PR template validation.

### `pnpm check:pr-template`
Runs PR template validation and its tests.

### `pnpm test:validate-renovate`
Tests Renovate configuration validation.

### `pnpm test:validate-licenses`
Tests license validation logic.

### `pnpm test:validate-images`
Tests image size validation.

### `pnpm test:validate-line-endings`
Tests line ending validation for generated artifacts.

## When to Run What

| Scenario | Command | Frequency |
|----------|---------|-----------|
| Starting work | `pnpm install` → `pnpm dev` | Once per session |
| Before committing | `pnpm test:all` → `pnpm validate` | Every commit |
| Before opening PR | `pnpm build` → `pnpm test:all` → `pnpm validate` | Every PR |
| After dependency update | `pnpm check:licenses` → `pnpm check:security-audit` | After `pnpm add` |
| Before release | `pnpm build` → `pnpm test:all` → `pnpm validate` → `pnpm check:security-audit` | Every release |
| CI pipeline | `pnpm install` → `pnpm build` → `pnpm test:all` → `pnpm validate` | Every push |
| Debugging flaky tests | `pnpm test:flaky-detector` | As needed |
| After adding images | `pnpm compress:images` → `pnpm validate:images` | Before commit |
