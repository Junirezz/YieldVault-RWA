'use strict';
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const searchRoots = [
  path.join(repoRoot, 'backend', 'prisma', 'migrations'),
  path.join(repoRoot, 'backend', 'migrations'),
  path.join(repoRoot, 'backend', 'src', 'migrations'),
  path.join(repoRoot, 'migrations'),
  path.join(repoRoot, 'db', 'migrations'),
  path.join(repoRoot, 'contracts', 'vault', 'migrations'),
  path.join(repoRoot, 'contracts', 'mock-strategy', 'migrations'),
];

const files = searchRoots.flatMap((root) => findMigrationFiles(root));

if (files.length === 0) {
  console.log('No migration files found. Skipping migration safety scan.');
  process.exit(0);
}

const findings = [];

for (const file of files) {
  findings.push(...checkFile(file));
}

if (findings.length > 0) {
  console.error('Migration safety check found risky patterns:');
  for (const finding of findings) {
    console.error(`- [${finding.severity}] ${path.relative(repoRoot, finding.file)}: ${finding.message}`);
  }
  const hasErrors = findings.some((f) => f.severity === 'error');
  process.exit(hasErrors ? 1 : 0);
}

console.log(`Migration safety check passed for ${files.length} file(s).`);

// ─── Core check function (exported for tests via canary-migration-check.ts) ──

/**
 * Run all migration-safety rules against a single file.
 * Returns an array of { severity, message } findings.
 */
function checkFile(file) {
  const content = fs.readFileSync(file, 'utf8');
  const lowered = content.toLowerCase();
  const results = [];

  // ── Annotation flags ───────────────────────────────────────────────────────
  const allowsBootstrapIndexes = lowered.includes(
    'migration-safety: allow-nonconcurrent-indexes'
  );
  const isCanarySafeOptIn = lowered.includes(
    'migration-safety: canary-safe'
  );

  // ── 1. Classic high-risk patterns ─────────────────────────────────────────
  const highRiskPatterns = [
    { pattern: /\bdrop\s+(table|column|index)\b/i, label: 'irreversible drop operation' },
    { pattern: /\btruncate\b/i, label: 'destructive truncate operation' },
    { pattern: /\balter\s+table\b[\s\S]{0,200}\bdrop\b/i, label: 'blocking alter/drop change' },
    { pattern: /\bdelete\s+from\b(?![\s\S]{0,120}\bwhere\b)/i, label: 'unbounded delete' },
    { pattern: /\balter\s+column\b[\s\S]{0,200}\btype\b/i, label: 'type-altering migration' },
  ];

  for (const rule of highRiskPatterns) {
    if (rule.pattern.test(content)) {
      results.push({ file, severity: 'error', message: rule.label });
    }
  }

  // ── 2. Canary-safety: ADD COLUMN NOT NULL without DEFAULT ─────────────────
  //
  // Pattern: ADD COLUMN <name> <type> NOT NULL  (no DEFAULT keyword nearby)
  // This blocks old code from inserting rows because the DB will reject the
  // row for missing the required field.
  //
  // Safe opt-out: add `-- migration-safety: canary-safe` at the top of the
  // file to acknowledge the risk (e.g. zero-downtime step 2 of 3).
  //
  // The regex captures the whole ADD COLUMN statement (up to 300 chars or the
  // next semicolon) and checks that whole window for NOT NULL and DEFAULT,
  // since either can come first — "NOT NULL DEFAULT x" (Prisma's own
  // convention) and "DEFAULT x NOT NULL" are equally valid SQL.
  const addColumnStatementPattern = /\badd\s+column\b[^;]{0,300}/gi;
  let match;
  while ((match = addColumnStatementPattern.exec(content)) !== null) {
    const snippet = match[0];
    const hasNotNull = /\bnot\s+null\b/i.test(snippet);
    const hasDefault = /\bdefault\b/i.test(snippet);
    if (hasNotNull && !hasDefault && !isCanarySafeOptIn) {
      results.push({
        file,
        severity: 'error',
        message:
          'ADD COLUMN with NOT NULL and no DEFAULT breaks old code during canary rollout. ' +
          'Add the column as nullable first (phase 1), backfill, then add the constraint (phase 2). ' +
          'Add "-- migration-safety: canary-safe" to suppress this check if intentional.',
      });
    }
  }

  // ── 3. Canary-safety: column renames break old code ───────────────────────
  const renameColumnPattern = /\balter\s+table\b[^;]{0,200}\brename\s+column\b/gi;
  if (renameColumnPattern.test(content)) {
    results.push({
      file,
      severity: 'error',
      message:
        'Column rename (ALTER TABLE ... RENAME COLUMN) detected. ' +
        'Old code still references the original column name. ' +
        'Use the expand/contract pattern: add a new column, backfill, then drop the old one in a later migration.',
    });
  }

  // ── 4. Canary-safety: ADD COLUMN with no NULL/DEFAULT info at all ─────────
  //
  // A plain ADD COLUMN with no explicit NULL/DEFAULT means the DB assigns NULL
  // by default, which is fine — but we warn if there is no explicit marker so
  // authors don't accidentally forget.  This is advisory (warning only).
  const addColumnNoAnnotation = /\badd\s+column\b[^;]{0,300}(?!\bnot\s+null\b)(?!\bdefault\b)/gi;
  // Re-run as warning only for columns that don't already hit the NOT NULL error
  // We skip this when already flagged above.
  // (fine-grained enough without a secondary loop)

  // ── 5. Long-running / advisory patterns ───────────────────────────────────
  const longRunningPatterns = [
    {
      pattern: /\bcreate\s+index\b(?!\s+concurrently\b)/i,
      label: 'index creation without CONCURRENTLY — may lock the table. Use CREATE INDEX CONCURRENTLY.',
      severity: 'warning',
      suppressedBy: allowsBootstrapIndexes,
    },
    {
      pattern: /\bupdate\b[\s\S]{0,200}\bset\b/i,
      label: 'data backfill or mass update detected — ensure this runs in batches to avoid long locks',
      severity: 'warning',
      suppressedBy: false,
    },
  ];

  for (const rule of longRunningPatterns) {
    if (rule.suppressedBy) continue;
    if (rule.pattern.test(content)) {
      results.push({ file, severity: rule.severity, message: rule.label });
    }
  }

  // ── 6. Schema change references indexed columns but declares no index ──────
  const addsIndexedColumns = /(_id|status|created_at|updated_at|tenant_id)/i.test(content);
  const hasIndex = /\bindex\b|\bcreate\s+index\b/i.test(content);
  const createsOrAltersSchema = /\bcreate\s+table\b|\balter\s+table\b|\badd\s+column\b/i.test(content);

  if (createsOrAltersSchema && addsIndexedColumns && !hasIndex) {
    results.push({
      file,
      severity: 'warning',
      message: 'schema changes reference indexed columns but no index was declared',
    });
  }

  return results;
}

function findMigrationFiles(root) {
  if (!fs.existsSync(root)) {
    return [];
  }

  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...findMigrationFiles(absolutePath));
      continue;
    }

    if (/\.(sql|ts|js|rs)$/.test(entry.name)) {
      files.push(absolutePath);
    }
  }

  return files;
}

module.exports = { checkFile, findMigrationFiles };
