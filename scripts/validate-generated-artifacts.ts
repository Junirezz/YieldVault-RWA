import * as fs from 'fs';
import * as path from 'path';

export interface LineEndingViolation {
  filePath: string;
  crlfCount: number;
}

export interface GeneratedArtifactsReport {
  valid: boolean;
  checkedFiles: string[];
  violations: LineEndingViolation[];
}

/**
 * Committed artifacts that are rewritten by generators. They must be stored
 * with LF-only line endings: on Windows a CRLF working copy produced by an
 * editor or a legacy checkout was previously preserved by regeneration and
 * showed up as a phantom `M` change with an empty diff. See issue #1374.
 */
const GENERATED_ARTIFACT_FILES = ['backend/openapi.json'];

const GENERATED_ARTIFACT_DIRS = ['backend/schema-snapshots', 'docs/schemas/webhooks'];

export function collectGeneratedArtifacts(rootDir = process.cwd()): string[] {
  const files = GENERATED_ARTIFACT_FILES.map((rel) => path.join(rootDir, rel));

  for (const relDir of GENERATED_ARTIFACT_DIRS) {
    const dir = path.join(rootDir, relDir);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (entry.endsWith('.json')) files.push(path.join(dir, entry));
    }
  }

  return files.filter((file) => fs.existsSync(file));
}

export function validateGeneratedArtifactLineEndings(
  rootDir = process.cwd(),
): GeneratedArtifactsReport {
  const files = collectGeneratedArtifacts(rootDir);
  const violations: LineEndingViolation[] = [];

  for (const file of files) {
    const crlfCount = (fs.readFileSync(file, 'utf8').match(/\r\n/g) ?? []).length;
    if (crlfCount > 0) {
      violations.push({ filePath: path.relative(rootDir, file), crlfCount });
    }
  }

  return {
    valid: violations.length === 0,
    checkedFiles: files.map((file) => path.relative(rootDir, file)),
    violations,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Validating line endings of generated artifacts...');
  const report = validateGeneratedArtifactLineEndings();

  console.log(`Checked ${report.checkedFiles.length} generated artifact(s):`);
  for (const file of report.checkedFiles) {
    console.log(`  - ${file}`);
  }

  if (!report.valid) {
    console.error('❌ Generated artifacts contain CRLF line endings:');
    for (const violation of report.violations) {
      console.error(`  - ${violation.filePath} (${violation.crlfCount} CRLF)`);
    }
    console.error("Re-run the generator (e.g. 'npm run generate:openapi') to normalize to LF.");
    process.exit(1);
  }

  console.log('✅ All generated artifacts use LF-only line endings.');
}
