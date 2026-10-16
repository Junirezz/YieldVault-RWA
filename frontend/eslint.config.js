import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
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

export default defineConfig([
  globalIgnores(['dist', 'e2e/**', 'playwright-report/**', 'test-results/**', 'cypress/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
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
      
      // Prevent dangerous React patterns
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
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
