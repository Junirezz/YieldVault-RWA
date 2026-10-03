# Contributing to YieldVault-RWA

Welcome to the YieldVault-RWA project. This guide outlines how to set up your environment, follow our contribution workflow, and engage with the review process.

## Table of Contents

- [Setup](#setup)
- [Development Workflow](#development-workflow)
- [Branching Strategy](#branching-strategy)
- [Testing Requirements](#testing-requirements)
- [Pull Request Process](#pull-request-process)
- [Review Expectations](#review-expectations)
- [Release Cycle](#release-cycle)

## Setup

### Prerequisites

- Node.js 18+ (for backend)
- Rust 1.70+ (for WASM/contracts)
- Docker (for local database and services)
- Git

### Initial Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/YieldVault-RWA.git
cd YieldVault-RWA

# Install dependencies
pnpm install

# Build shared packages (required before backend type-checking or building)
npm run build:schemas   # Or: cd packages/api-schemas && npm run build
```

> **Important (Build Order):** The `@yieldvault/api-schemas` package must be built prior to running TypeScript (`tsc`), local type-checking, or building the backend. Running `npm run build` or `npm run dev` in the backend will automatically execute `build:schemas` via `prebuild`/`predev` hooks, but manual `tsc --noEmit` invocations require `dist` in `packages/api-schemas` to be generated first.


### Environment Configuration

Copy environment templates and configure for local development:

```bash
# Backend
cp backend/.env.example backend/.env.local
# Edit backend/.env.local with your local settings

# Frontend
cp frontend/.env.example frontend/.env.local
```

See [ENVIRONMENT_VARIABLES.md](./backend/docs/ENVIRONMENT_VARIABLES.md) for detailed configuration.

### Database Setup

```bash
cd backend
npm run prisma:migrate:dev
npm run prisma:seed  # Optional: seed test data
```

### Running Locally

```bash
# Backend (from project root)
npm run dev:backend

# Frontend (from project root)
npm run dev:frontend

# Both (from project root)
npm run dev
```

## Development Workflow

### Before You Start

1. Check the [Roadmap](#roadmap) to understand current priorities
2. Review existing issues and pull requests to avoid duplication
3. Ask in discussions if your feature is significant or aligns with current direction

### Branching Strategy

We follow a modified Git Flow:

- **main**: Production-ready code. Protected branch; all changes via PR.
- **staging**: Pre-production testing. Staging deployments automatically trigger from this branch.
- **feat/\***: Feature branches for new functionality
  - Branch from: `main`
  - Format: `feat/kebab-case-description`
  - Example: `feat/add-withdrawal-orchestration`

- **fix/\***: Bug fix branches
  - Branch from: `main`
  - Format: `fix/kebab-case-description`
  - Example: `fix/referral-accrual-calculation`

- **docs/\***: Documentation-only changes
  - Branch from: `main`
  - Format: `docs/kebab-case-description`
  - Example: `docs/query-optimization-guide`

- **chore/\***: Dependency updates, refactoring, tooling
  - Branch from: `main`
  - Format: `chore/kebab-case-description`
  - Example: `chore/upgrade-prisma`

### Creating Your Branch

```bash
git fetch origin
git checkout -b feat/your-feature-name origin/main
```

## Testing Requirements

### Before Submitting a PR

All code changes require tests. We use:

- **Backend**: Jest for unit and integration tests
- **Frontend**: Vitest for unit tests, Cypress for E2E tests
- **Contracts**: Foundry/Hardhat tests for Solidity code

### Running Tests Locally

YieldVault-RWA is organized as a pnpm workspace monorepo. Tests can be run at the root workspace level or inside individual packages:

#### Monorepo Root Commands: `pnpm test` vs `pnpm -r test`

- **`pnpm test`** (Root Workspace Pipeline): Runs the orchestrated test pipeline across all workspace packages with explicit production flags:
  ```bash
  pnpm test
  # Executes: pnpm --filter backend test -- --runInBand --coverage && pnpm --filter frontend test --run
  ```
  - **Backend**: Runs Jest with `--runInBand` (serial worker execution to prevent concurrency collisions on SQLite) and collects coverage reports in `backend/coverage/`.
  - **Frontend**: Runs Vitest with `--run` in deterministic single-pass mode.

- **`pnpm -r test`** (Recursive Package Run): Executes the `test` lifecycle script defined in each package (`backend`, `frontend`, `packages/api-schemas`) recursively in topological dependency order:
  ```bash
  pnpm -r test
  ```
  Package-level test scripts are aligned so that running recursively executes with the proper flags (`jest --runInBand --coverage` in backend and `vitest run` in frontend), guaranteeing that backend coverage artifacts are generated and frontend tests run non-interactively without hanging.

#### Running Tests in Individual Packages

```bash
# Backend tests (runs Jest with --runInBand and --coverage)
cd backend && pnpm test
# Or from root:
pnpm --filter backend test

# Frontend unit & component tests (runs Vitest in single-run mode)
cd frontend && pnpm test
# Or from root:
pnpm --filter frontend test

# Frontend watch mode (for active local development)
cd frontend && pnpm test:watch

# Frontend E2E tests (Playwright)
cd frontend && pnpm test:e2e

# Cypress smoke tests
cd frontend && pnpm test:cypress

# Soroban smart contract tests
cargo test -p vault
```

### Test Coverage Expectations

- Unit tests: ≥80% line coverage for new code
- Integration tests: Critical paths must be covered
- E2E tests: Happy path and key user workflows

### Linting and Formatting

```bash
# Backend
cd backend && npm run lint
npm run format

# Frontend
cd frontend && npm run lint
npm run format
```

Code must pass linting before PR approval.

### Commit Messages

Commit messages must use [Conventional Commits](https://www.conventionalcommits.org/) with a **lower-case** type drawn from this list:

`fix` · `feat` · `chore` · `docs` · `test` · `refactor`

```bash
# Valid
fix: correct rounding on share price accrual
feat(frontend): add vesting schedule to dashboard

# Rejected — the type must be lower-case
Fix: correct rounding on share price accrual
FEAT: add vesting schedule to dashboard
```

The lower-case requirement is enforced by `commitlint.config.js` through the
`.husky/commit-msg` hook, so an upper-case type is rejected at commit time. It
also keeps the changelog correct: `cliff.toml` sets `conventional_commits = true`
and groups release notes by parsed type, and git-cliff's parser accepts both
cases. Without this rule `Fix:` would be parsed as its own type and split into a
separate changelog group from `fix:`.

To check a message without committing:

```bash
echo "Fix: something" | npx commitlint
```

## Pull Request Process

### Before Opening a PR

1. Ensure your branch is up-to-date with `main`
2. Run all local tests and linting checks
3. Verify your commit messages are clear and descriptive

```bash
git fetch origin
git rebase origin/main
npm run test
npm run lint
```

### Opening a PR

Use our [PR template](./.github/PULL_REQUEST_TEMPLATE.md):

- **Title**: Clear, concise description of the change
  - Format: `[area] description` (e.g., `[api] add withdrawal retry logic`)
- **Description**: Explain what, why, and how
- **Linked Issues**: Reference related issues with "Closes #123"
- **Testing**: Describe test coverage and how to verify locally
- **Screenshots**: Include for UI changes

### PR Expectations

- All CI checks must pass (tests, linting, security scans)
- At least 1 approval from a code owner (see [CODEOWNERS](./.github/CODEOWNERS))
- For sensitive changes (auth, secrets, dependencies): additional review required
- Discussions must be resolved before merging

## Review Expectations

### Who Reviews

- **Code Owners**: Automatically requested (see [CODEOWNERS](./.github/CODEOWNERS))
- **Security**: Triggered for sensitive paths (see [SECURITY_REVIEW.md](./SECURITY_REVIEW.md))
- **Teams**: Additional domain experts may be requested

### Review Timeline

- Standard PRs: Review within 1 business day
- Urgent/hotfixes: Review within 4 hours
- Blocked/waiting PRs: Unblock within 1 business day

### What Reviewers Check

1. **Correctness**: Does the code do what it claims?
2. **Tests**: Is coverage adequate? Do tests pass?
3. **Performance**: Could this impact latency or throughput?
4. **Security**: Does this introduce vulnerabilities? (See [SECURITY_REVIEW.md](./SECURITY_REVIEW.md))
5. **Style**: Does it follow project conventions?
6. **Documentation**: Are API changes documented?

### For Reviewers

- Be constructive and respectful
- Distinguish between blocking and non-blocking feedback
- Approve when satisfied with the quality
- Use "Request Changes" only for critical issues

See [SECURITY_REVIEW.md](./SECURITY_REVIEW.md) for sensitive review guidelines.

## Release Cycle

### Versioning

We use [Semantic Versioning](https://semver.org/):
- MAJOR.MINOR.PATCH (e.g., 1.2.3)
- PATCH: Bug fixes and non-breaking changes
- MINOR: New features, backward compatible
- MAJOR: Breaking changes

### Release Schedule

- **Patch releases**: As needed for critical fixes (any day)
- **Minor releases**: Bi-weekly (every other Thursday)
- **Major releases**: Quarterly or as needed

### Release Process

1. Create a release PR from `main` to `staging`
2. Update version numbers and [CHANGELOG.md](./CHANGELOG.md)
3. Merge to `staging` for pre-production testing
4. Tag release on `main` and create GitHub release
5. Automated deployment follows

See [Release Documentation](./backend/docs/) for detailed procedures.

## Resources

- [Architecture Overview](./ARCHITECTURE_SUMMARY.md)
- [Security Review Guidelines](./SECURITY_REVIEW.md)
- [Roadmap](./ROADMAP.md)
- [API Documentation](./backend/openapi.json)
- [Issue Triage Guidelines](./TRIAGE_LABELS.md)

## Getting Help

- **Questions**: Open a GitHub discussion
- **Bugs**: File an issue with the bug template
- **Ideas**: Start a discussion before opening an issue
- **Chat**: Reach out to maintainers

Thank you for contributing to YieldVault-RWA!
