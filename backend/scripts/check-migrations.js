const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const searchRoots = [
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
  const content = fs.readFileSync(file, 'utf8');
  const lowered = content.toLowerCase();

  const highRiskPatterns = [
    { pattern: /\bdrop\s+(table|column|index)\b/, label: 'irreversible drop operation' },
    { pattern: /\btruncate\b/, label: 'destructive truncate operation' },
    { pattern: /\balter\s+table\b[\s\S]{0,200}\bdrop\b/, label: 'blocking alter/drop change' },
    { pattern: /\bdelete\s+from\b(?![\s\S]{0,120}\bwhere\b)/, label: 'unbounded delete' },
    { pattern: /\balter\s+column\b[\s\S]{0,200}\btype\b/, label: 'type-altering migration' },
  ];

  for (const rule of highRiskPatterns) {
    if (rule.pattern.test(lowered)) {
      findings.push({ file, severity: 'error', message: rule.label });
    }
  }

  const longRunningPatterns = [
    { pattern: /\bcreate\s+index\b(?![\s\S]{0,120}\bconcurrently\b)/, label: 'index creation without concurrent mode' },
    { pattern: /\bupdate\b[\s\S]{0,200}\bset\b/, label: 'data backfill or mass update detected' },
  ];

  for (const rule of longRunningPatterns) {
    if (rule.pattern.test(lowered)) {
      findings.push({ file, severity: 'warning', message: rule.label });
    }
  }

  const addsIndexedColumns = /(_id|status|created_at|updated_at|tenant_id)/.test(lowered);
  const hasIndex = /\bindex\b|\bcreate\s+index\b/.test(lowered);
  const createsOrAltersSchema = /\bcreate\s+table\b|\balter\s+table\b|\badd\s+column\b/.test(lowered);

  if (createsOrAltersSchema && addsIndexedColumns && !hasIndex) {
    findings.push({
      file,
      severity: 'warning',
      message: 'schema changes reference indexed columns but no index was declared',
    });
  }
}

if (findings.length > 0) {
  console.error('Migration safety check found risky patterns:');
  for (const finding of findings) {
    console.error(`- [${finding.severity}] ${path.relative(repoRoot, finding.file)}: ${finding.message}`);
  }
  process.exit(1);
}

console.log(`Migration safety check passed for ${files.length} file(s).`);

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