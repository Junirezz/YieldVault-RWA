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

## Issue Reporting Conventions

When opening a new issue, please use the most appropriate template so the report is actionable for triage:

- **Bug reports**: use the Bug Report template for defects, crashes, regressions, or unexpected behavior.
- **Feature requests**: use the Feature Request template for new capabilities or enhancements.
- **Security concerns**: use the Security Report template or follow the private security policy for sensitive vulnerabilities.

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

## Documentation

- **[Domain Glossary](./docs/GLOSSARY.md)** — Shared definitions for vault shares, APY, strategies, and other project terminology. Please use these terms consistently in code, comments, and documentation.

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

## Internationalization (i18n)

The frontend uses a lightweight custom i18n system located in `frontend/src/i18n/`.

### How it works

- `frontend/src/i18n/index.ts` — exports `t(key)`, `useTranslation()`, `setLocale()`, and `getLocale()`.
- `frontend/src/i18n/locales/en.ts` — English baseline catalog (source of truth).
- `frontend/src/i18n/locales/es.ts` — Spanish catalog (mirrors the same nested key structure).
- All visible UI strings must go through `t("some.key")` — no hardcoded strings in JSX.

### Adding a new locale

1. **Create the catalog file** — copy `frontend/src/i18n/locales/en.ts` to `frontend/src/i18n/locales/<code>.ts` (e.g. `fr.ts`). Translate every leaf string. Keep the same nested key structure; do not add or remove keys.

2. **Register the locale** in `frontend/src/i18n/index.ts`:
   - Import your catalog: `import { fr } from "./locales/fr";`
   - Add it to `catalogs`: `fr: fr as MessageTree,`
   - Extend the `LocaleCode` union: `export type LocaleCode = "en" | "es" | "fr";`
   - Add it to the `setLocale` guard: `if (code === "en" || code === "es" || code === "fr") { ... }`

3. **Add the locale to `LanguageSwitcher`** in `frontend/src/components/LanguageSwitcher.tsx`:
   ```ts
   const LOCALES: { code: LocaleCode; flag: string }[] = [
     { code: "en", flag: "🇺🇸" },
     { code: "es", flag: "🇪🇸" },
     { code: "fr", flag: "🇫🇷" }, // ← add your entry
   ];
   ```

4. **Add display labels** for the new locale in both `en.ts` and your new file:
   ```ts
   // en.ts
   langSwitch: { en: "English", es: "Español", fr: "Français" }

   // fr.ts
   langSwitch: { en: "English", es: "Español", fr: "Français" }
   ```

5. **Verify** by switching to the new locale in Settings → Language & Region → App Language.

### Interpolation

Strings with dynamic values use `{{placeholder}}` syntax. Call `.replace()` at the call site:

```ts
t("session.warning.message").replace("{{minutes}}", String(minutesLeft))
```

### Using translations in components

```tsx
import { useTranslation } from "../i18n";

function MyComponent() {
  const { t, locale, setLocale } = useTranslation();
  return <p>{t("some.key")}</p>;
}
```

For non-React contexts, import the standalone `t` function:

```ts
import { t } from "../i18n";
const label = t("some.key");
```

## Issue Triage, Code Review, and Release Standards

For comprehensive contribution standards on code reviews, approval thresholds, SLAs, reviewer expectations, and release notes:
- **[Code Review and Approval Standards](./docs/CODE_REVIEW_STANDARDS.md)** — Detailed guidelines for PR reviews, approval gates (Tiers 1-4), SLAs, and review comment prefixes (`blocking:`, `nit:`, `security:`).
- **[Sprint Labeling Standards & Triage Conventions](./docs/SPRINT_AND_TRIAGE_CONVENTIONS.md)** — Sprint naming schemes (`sprint: YYYY-WXX`), 2-week sprint lifecycle, and unified issue taxonomy.
- **[Release Notes Playbook](./docs/release-notes-playbook.md)** & **[Release Notes Template](./.github/RELEASE_NOTES_TEMPLATE.md)** — Release notes structure with mandatory Security & Performance highlights.
- **[Non-Functional Requirement Baselines](./docs/NFR_BASELINES.md)** — Production SLOs, SLIs, RTO, and RPO disaster recovery targets.
- **[Code Ownership (.github/CODEOWNERS)](./.github/CODEOWNERS)** — Explicit mapping of file paths to responsible review teams.
- **[Issue Triage & Review Readiness](./TRIAGE_AND_REVIEW.md)** — Triage SLAs, label taxonomies, and merge checklists.

### Automated Contribution, Triage, Release & NFR Validation

To check your branch, PR format, sprint labels, release notes, and NFR baselines before submitting:

```bash
# Run contribution standards validator
npm run validate:contribution-standards

# Run sprint labeling and issue triage validator
npm run validate:sprint-and-triage

# Run release notes template & cliff config validator
npm run validate:release-notes

# Run non-functional requirement baselines (SLO, RTO, RPO) validator
npm run validate:nfr-baselines
```

