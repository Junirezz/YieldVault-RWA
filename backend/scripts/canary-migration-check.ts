/**
 * Canary-safe migration checker (Issue #958).
 *
 * Validates SQL migration files against rules that ensure backward-compatibility
 * during canary (blue/green) deployments where old and new code run simultaneously
 * against the same database schema.
 *
 * Usage:
 *   npx tsx scripts/canary-migration-check.ts
 *   # or from check:migrations:canary npm script
 *
 * Annotation opt-outs (add as a SQL comment in the migration file):
 *   -- migration-safety: allow-not-null-add
 *   -- migration-safety: allow-nonconcurrent-indexes
 *   -- migration-safety: allow-drop
 */

import fs from 'fs';
import path from 'path';

export interface MigrationIssue {
  severity: 'error' | 'warning';
  rule: string;
  message: string;
  line?: number;
}

export interface MigrationCheckResult {
  safe: boolean;
  issues: MigrationIssue[];
}

// ── Rule helpers ─────────────────────────────────────────────────────────────

function hasAnnotation(content: string, annotation: string): boolean {
  return content.toLowerCase().includes(`-- migration-safety: ${annotation.toLowerCase()}`);
}

function findLineNumber(content: string, matchIndex: number): number {
  return content.slice(0, matchIndex).split('\n').length;
}

// ── Individual rules ─────────────────────────────────────────────────────────

const rules: Array<{
  id: string;
  severity: 'error' | 'warning';
  annotation?: string; // opt-out annotation name
  description: string;
  check: (content: string, lower: string) => Array<{ message: string; index: number }>;
}> = [
  {
    id: 'no-drop-column',
    severity: 'error',
    annotation: 'allow-drop',
    description: 'DROP COLUMN breaks old application code still reading that column.',
    check: (_, lower) => {
      const matches: Array<{ message: string; index: number }> = [];
      const re = /\bdrop\s+column\b/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(lower)) !== null) {
        matches.push({ message: `DROP COLUMN found — old code will break (use expand/contract pattern)`, index: m.index });
      }
      return matches;
    },
  },
  {
    id: 'no-drop-table',
    severity: 'error',
    annotation: 'allow-drop',
    description: 'DROP TABLE is irreversible and breaks old application code.',
    check: (_, lower) => {
      const matches: Array<{ message: string; index: number }> = [];
      const re = /\bdrop\s+table\b/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(lower)) !== null) {
        matches.push({ message: `DROP TABLE found — irreversible destructive operation`, index: m.index });
      }
      return matches;
    },
  },
  {
    id: 'no-rename-column',
    severity: 'error',
    description: 'RENAME COLUMN breaks old application code that references the original name.',
    check: (_, lower) => {
      const matches: Array<{ message: string; index: number }> = [];
      const re = /\brename\s+column\b/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(lower)) !== null) {
        matches.push({ message: `RENAME COLUMN breaks backward-compatibility; add new column + migrate data instead`, index: m.index });
      }
      return matches;
    },
  },
  {
    id: 'no-rename-table',
    severity: 'error',
    description: 'RENAME TABLE breaks old application code that queries the original name.',
    check: (_, lower) => {
      const matches: Array<{ message: string; index: number }> = [];
      const re = /\balter\s+table\b[^;]{0,120}\brename\s+to\b/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(lower)) !== null) {
        matches.push({ message: `Table RENAME TO breaks backward-compatibility`, index: m.index });
      }
      return matches;
    },
  },
  {
    id: 'no-not-null-without-default',
    severity: 'error',
    annotation: 'allow-not-null-add',
    description:
      'ADD COLUMN NOT NULL without a DEFAULT will fail on non-empty tables and breaks old code ' +
      'that inserts without the new column. Use a two-phase approach: add nullable first, then add constraint.',
    check: (_, lower) => {
      const matches: Array<{ message: string; index: number }> = [];
      // Match: ADD COLUMN ... NOT NULL (not followed by DEFAULT before the
      // statement ends). Bounded by the next `;` (or 300 chars, whichever
      // comes first) so this can't bleed into an unrelated CREATE TABLE
      // that happens to follow within the naive lookahead window and has
      // its own NOT NULL columns.
      const re = /\badd\s+column\b/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(lower)) !== null) {
        const statementEnd = lower.indexOf(';', m.index);
        const windowEnd =
          statementEnd === -1 ? m.index + 300 : Math.min(statementEnd, m.index + 300);
        const slice = lower.slice(m.index, windowEnd);
        const hasNotNull = /\bnot\s+null\b/i.test(slice);
        const hasDefault = /\bdefault\b/i.test(slice);
        if (hasNotNull && !hasDefault) {
          matches.push({
            message: `ADD COLUMN NOT NULL without DEFAULT — use nullable column first (phase 1), add constraint later (phase 2)`,
            index: m.index,
          });
        }
      }
      return matches;
    },
  },
  {
    id: 'no-type-change',
    severity: 'error',
    description:
      'ALTER COLUMN TYPE changes may lock the table and break old code reading the original type.',
    check: (_, lower) => {
      const matches: Array<{ message: string; index: number }> = [];
      const re = /\balter\s+column\b[^;]{0,120}\btype\b|\bmodify\s+column\b/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(lower)) !== null) {
        matches.push({ message: `Column type change may lock table and break old code`, index: m.index });
      }
      return matches;
    },
  },
  {
    id: 'no-truncate',
    severity: 'error',
    description: 'TRUNCATE is destructive and irreversible.',
    check: (_, lower) => {
      const matches: Array<{ message: string; index: number }> = [];
      const re = /\btruncate\b/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(lower)) !== null) {
        matches.push({ message: `TRUNCATE is irreversible — use conditional DELETE with WHERE instead`, index: m.index });
      }
      return matches;
    },
  },
  {
    id: 'index-concurrent',
    severity: 'warning',
    annotation: 'allow-nonconcurrent-indexes',
    description: 'CREATE INDEX without CONCURRENTLY locks the table for writes.',
    check: (_, lower) => {
      const matches: Array<{ message: string; index: number }> = [];
      const re = /\bcreate\s+index\b/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(lower)) !== null) {
        const slice = lower.slice(m.index, m.index + 80);
        if (!/\bconcurrently\b/.test(slice)) {
          matches.push({ message: `CREATE INDEX without CONCURRENTLY will lock the table for writes`, index: m.index });
        }
      }
      return matches;
    },
  },
  {
    id: 'mass-update-backfill',
    severity: 'warning',
    description: 'Large UPDATE statements can lock tables and cause timeout in production.',
    check: (_, lower) => {
      const matches: Array<{ message: string; index: number }> = [];
      const re = /\bupdate\b[^;]{0,200}\bset\b/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(lower)) !== null) {
        // Only flag if there is no WHERE clause limiting scope (rough heuristic)
        const slice = lower.slice(m.index, m.index + 300);
        const hasWhere = /\bwhere\b/.test(slice);
        if (!hasWhere) {
          matches.push({ message: `Unbounded UPDATE (no WHERE clause) may lock the table — batch in application code`, index: m.index });
        }
      }
      return matches;
    },
  },
];

// ── Main checker ─────────────────────────────────────────────────────────────

/**
 * Check a single SQL migration file for canary-safety issues.
 *
 * @param filePath Absolute or relative path to the migration SQL file.
 * @returns `{ safe: boolean, issues: MigrationIssue[] }`
 */
export function checkMigrationFile(filePath: string): MigrationCheckResult {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return {
      safe: false,
      issues: [
        {
          severity: 'error',
          rule: 'io-error',
          message: `Cannot read file: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }

  const lower = content.toLowerCase();
  const issues: MigrationIssue[] = [];

  for (const rule of rules) {
    // Check annotation opt-out
    if (rule.annotation && hasAnnotation(content, rule.annotation)) {
      continue;
    }

    const findings = rule.check(content, lower);
    for (const finding of findings) {
      issues.push({
        severity: rule.severity,
        rule: rule.id,
        message: finding.message,
        line: findLineNumber(content, finding.index),
      });
    }
  }

  const hasErrors = issues.some((i) => i.severity === 'error');
  return { safe: !hasErrors, issues };
}

// ── CLI entry point ───────────────────────────────────────────────────────────

function findSqlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findSqlFiles(full));
    } else if (entry.name.endsWith('.sql')) {
      files.push(full);
    }
  }
  return files;
}

function main(): void {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const migrationsDir = path.join(repoRoot, 'backend', 'prisma', 'migrations');
  const legacyDir = path.join(repoRoot, 'backend', 'migrations');

  const files = [...findSqlFiles(migrationsDir), ...findSqlFiles(legacyDir)];

  if (files.length === 0) {
    console.log('canary-migration-check: no .sql migration files found — skipping.');
    process.exit(0);
  }

  let hasErrors = false;
  for (const file of files) {
    const rel = path.relative(repoRoot, file);
    const result = checkMigrationFile(file);

    if (result.issues.length === 0) {
      console.log(`✓  ${rel}`);
      continue;
    }

    for (const issue of result.issues) {
      const location = issue.line ? `:${issue.line}` : '';
      const prefix = issue.severity === 'error' ? '✗  [ERROR]' : '⚠  [WARN] ';
      console.log(`${prefix} ${rel}${location} — [${issue.rule}] ${issue.message}`);
    }

    if (!result.safe) hasErrors = true;
  }

  if (hasErrors) {
    console.error(
      '\nCanary migration check FAILED — fix errors or add opt-out annotations (see docs/CANARY_MIGRATION_STRATEGY.md).',
    );
    process.exit(1);
  }

  console.log('\nCanary migration check passed.');
}

if (require.main === module) {
  main();
}
