import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import react from 'eslint-plugin-react'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import path from 'node:path'

// Custom inline plugin: reject backup / scratch files that accidentally land in src/.
// Matches: *.bak, *.backup, *.backup2, *_new.ts(x), *_original.ts(x)
const BACKUP_RE = /(\.(bak|backup\d*)$|_(new|original)\.(ts|tsx)$)/

const noBackupFilesPlugin = {
  meta: { name: 'no-backup-files' },
  rules: {
    'no-backup-files': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallow backup / scratch files (*.bak, *.backup*, *_new.tsx, *_original.tsx) inside src/. ' +
            'Delete them or move them outside the repository.',
        },
        schema: [],
        messages: {
          backupFile:
            '"{{ filename }}" looks like a backup or scratch file and must not live in src/. ' +
            'Delete it or move it outside the repository.',
        },
      },
      create(context) {
        const filename = path.basename(context.filename ?? context.getFilename?.() ?? '')
        if (BACKUP_RE.test(filename)) {
          context.report({
            loc: { line: 1, column: 0 },
            messageId: 'backupFile',
            data: { filename },
          })
        }
        return {}
      },
    },
  },
}

// Decision (#1628): e2e/** and cypress/** are intentionally NOT linted by this config.
// They are Playwright/Cypress test harnesses that run in Node/their own runners with
// different globals and conventions, and they never ship in the production bundle.
// The XSS/a11y rules below target the shipped app code under src/.
export default defineConfig([
  globalIgnores(['dist', 'e2e/**', 'playwright-report/**', 'test-results/**', 'cypress/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    plugins: { react },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Security rules to prevent XSS vulnerabilities
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'react/no-danger': 'error',
      // `role` on custom components (e.g. <Navbar role="admin" />) is an app prop, not an ARIA role.
      'jsx-a11y/aria-role': ['error', { ignoreNonDOM: true }],
      // Block direct HTML sinks (innerHTML/outerHTML/insertAdjacentHTML)
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Direct innerHTML assignment is an XSS sink; use React rendering or textContent.' },
        { property: 'outerHTML', message: 'Direct outerHTML assignment is an XSS sink; use React rendering.' },
        { property: 'insertAdjacentHTML', message: 'insertAdjacentHTML is an XSS sink; use React rendering or DOM APIs.' },
      ],

      // Prevent dangerous React patterns
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  // Known a11y debt (#1628): these files predate jsx-a11y and have overlay/backdrop click
  // handlers and similar patterns that need real UX work (roles, keyboard handling), not a
  // lint-only fix. Downgraded to warnings so they stay visible without blocking lint;
  // new files get the full error-level rules. Remove entries as files are fixed.
  {
    files: [
      'src/components/CommandPalette.tsx',
      'src/components/ConfirmationModal.tsx',
      'src/components/Drawer.tsx',
      'src/components/Modal.tsx',
      'src/components/PortfolioOverview.tsx',
      'src/components/TransactionStatusModal.tsx',
      'src/components/VaultDashboard.tsx',
      'src/components/VaultHealthIndicator.tsx',
      'src/components/WithdrawalConfirmationModal.tsx',
      'src/components/ui/Card.tsx',
      'src/components/ui/Popover.tsx',
      'src/pages/Settings.tsx',
    ],
    rules: {
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/no-static-element-interactions': 'warn',
      'jsx-a11y/no-noninteractive-element-interactions': 'warn',
      'jsx-a11y/no-noninteractive-tabindex': 'warn',
      'jsx-a11y/label-has-associated-control': 'warn',
    },
  },
  // Tests may legitimately inspect DOM markup (e.g. container.innerHTML) and render
  // dangerous patterns on purpose to verify sanitisation, so HTML-sink rules are off there.
  {
    files: ['**/*.{test,spec}.{ts,tsx}', 'src/test/**', 'src/**/__tests__/**'],
    rules: {
      'no-restricted-properties': 'off',
      'react/no-danger': 'off',
    },
  },
  // Guard: error if any backup / scratch TypeScript file re-enters src/.
  // Covers: *.bak, *.backup*, Settings_new.tsx, Settings_original.tsx, etc.
  {
    files: ['**/*_new.{ts,tsx}', '**/*_original.{ts,tsx}', '**/*.bak.{ts,tsx}', '**/*.backup*.{ts,tsx}'],
    plugins: { 'no-backup-files': noBackupFilesPlugin },
    rules: {
      'no-backup-files/no-backup-files': 'error',
    },
  },
])
