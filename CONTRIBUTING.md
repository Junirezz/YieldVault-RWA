# Contributing to YieldVault-RWA

First off, thank you for considering contributing to YieldVault-RWA! It's people like you that make this project great.

## Secret Scanning & Prevention

This repository uses **gitleaks** to prevent accidental commits of secrets (API keys, private keys, passwords, etc.).

### Pre-commit Hook

A pre-commit hook runs automatically before each `git commit` to scan for secrets in staged files. If secrets are detected, the commit will be blocked.

#### Installation

The pre-commit hook is already configured via **Husky**. When you clone the repository:

```bash
# Install dependencies (includes husky setup)
npm install
```

The hook is located at `.husky/pre-commit` and runs `scripts/secrets-check.js`.

#### Manual Setup (if needed)

```bash
# Install husky
npm install husky --save-dev

# Initialize husky
npx husky init

# Create the pre-commit hook
echo 'node scripts/secrets-check.js' > .husky/pre-commit

# Configure git to use husky hooks
git config core.hooksPath .husky
```

#### Bypassing the Hook (Use with Caution)

If you encounter a false positive, you can bypass the hook:
```bash
git commit --no-verify -m "Your commit message"
```

**⚠️ Never bypass the hook for actual secrets!**

#### What the Hook Detects

The hook scans for common secret patterns including:
- AWS Access Keys and Secret Keys
- GitHub Personal Access Tokens
- Private Keys (RSA, EC, DSA)
- API Keys and Secret Tokens
- Passwords in code
- Bearer Tokens and JWTs
- Stripe API Keys
- Slack Tokens
- Database connection strings

### GitHub Secret Scanning

GitHub's built-in secret scanning is enabled on this repository. When secrets are pushed to the repository:

1. GitHub will alert you via the Security tab
2. Alerts are routed to the security team based on repository settings
3. Push protection blocks commits containing known secret patterns

To configure secret scanning alerts:
1. Go to **Repository Settings** → **Security** → **Secret scanning**
2. Review and configure alert notifications

## Branch Naming Convention

To keep our repository organized, we follow a strict branch naming convention. Please name your branch according to the type of work you are doing:

- **Features**: `feat/<issue-number>-<short-description>`
  - Example: `feat/349-add-user-login`
- **Bug Fixes**: `fix/<issue-number>-<short-description>`
  - Example: `fix/350-resolve-auth-crash`

## Pull Request Conventions

When submitting a Pull Request, please ensure the title is descriptive and follows the format of the issue. The PR body **must** include the following sections:

### PR Title Format
`<Type>: <Short description>`
Examples:
- `Feature: Add user login flow`
- `Fix: Resolve authentication crash on mobile`

### Required PR Sections

Please use the following template for your PR description:

```markdown
### Goal
[Describe the goal of this PR and the problem it solves. Link to the relevant issue, e.g., "Closes #349".]

### Changes
- [List out the specific changes made in this PR]
- [Keep it concise but detailed enough for reviewers to understand the scope]

### Testing
- [Explain how the changes were tested]
- [Include steps for reviewers to verify the fix/feature locally]
```

## Local Development Setup

YieldVault-RWA is composed of three main packages: Frontend, Backend, and Contracts. Follow the steps below to set up your local development environment end-to-end.

### Prerequisites
- Node.js (v18+)
- npm, pnpm, or yarn
- Rust and Cargo (for contracts)

### 1. Contracts Setup
The smart contracts are written in Rust.
```bash
cd contracts
# Install dependencies and build contracts
cargo build

# Run contract tests
cargo test
```

### 2. Backend Setup
The backend handles API requests and application logic.
```bash
cd backend
# Install dependencies
npm install

# Set up your environment variables
cp .env.example .env

# Start the backend development server
npm run dev
```

### 3. Frontend Setup
The frontend contains the user interface.
```bash
cd frontend
# Install dependencies
npm install

# Set up your environment variables
cp .env.example .env

# Start the frontend development server
npm run dev
```

Thank you for your contributions!
