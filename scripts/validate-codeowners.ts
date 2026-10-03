import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface CodeownersRule {
  lineNumber: number;
  pattern: string;
  owners: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Converts a gitignore/CODEOWNERS pattern to a RegExp.
 */
export function patternToRegex(pattern: string): RegExp {
  let p = pattern.trim();
  const startsWithSlash = p.startsWith('/');
  if (startsWithSlash) {
    p = p.substring(1);
  }

  // Handle trailing slash (matches directory and anything beneath it)
  const endsWithSlash = p.endsWith('/');
  if (endsWithSlash) {
    p = p + '**';
  }

  // Escape special regex characters except * and ?
  let regexStr = p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__DOUBLE_STAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__DOUBLE_STAR__/g, '.*')
    .replace(/\?/g, '[^/]');

  if (startsWithSlash) {
    regexStr = `^${regexStr}(?:/.*)?$`;
  } else {
    // If it doesn't start with slash, it can match anywhere in the path
    regexStr = `(?:^|/)${regexStr}(?:/.*)?$`;
  }

  return new RegExp(regexStr);
}

/**
 * Parses CODEOWNERS file content into structured rules.
 */
export function parseCodeowners(content: string): CodeownersRule[] {
  const lines = content.split('\n');
  const rules: CodeownersRule[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine || rawLine.startsWith('#')) {
      continue;
    }

    const tokens = rawLine.split(/\s+/);
    if (tokens.length >= 2) {
      rules.push({
        lineNumber: i + 1,
        pattern: tokens[0],
        owners: tokens.slice(1),
      });
    }
  }

  return rules;
}

/**
 * Returns all matching rules for a given file path (relative to repo root).
 */
export function getMatchingRules(filePath: string, codeownersContent: string): CodeownersRule[] {
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\//, '');
  const rules = parseCodeowners(codeownersContent);

  return rules.filter((rule) => {
    if (rule.pattern === '*') {
      return true;
    }
    const regex = patternToRegex(rule.pattern);
    return regex.test(normalizedPath);
  });
}

/**
 * Returns all owners requested for a file.
 */
export function getOwnersForFile(filePath: string, codeownersContent: string): string[] {
  const matchingRules = getMatchingRules(filePath, codeownersContent);
  const ownersSet = new Set<string>();
  for (const rule of matchingRules) {
    for (const owner of rule.owners) {
      ownersSet.add(owner);
    }
  }
  return Array.from(ownersSet);
}

/**
 * Simulates a PR touching a list of files and resolves all required codeowners.
 */
export function getReviewersForChangedFiles(
  changedFiles: string[],
  codeownersContent: string
): {
  fileReviewers: Record<string, string[]>;
  allReviewers: string[];
} {
  const fileReviewers: Record<string, string[]> = {};
  const allReviewersSet = new Set<string>();

  for (const file of changedFiles) {
    const owners = getOwnersForFile(file, codeownersContent);
    fileReviewers[file] = owners;
    owners.forEach((o) => allReviewersSet.add(o));
  }

  return {
    fileReviewers,
    allReviewers: Array.from(allReviewersSet),
  };
}

/**
 * Validates CODEOWNERS syntax, completeness, and specific required coverage.
 */
export function validateCodeownersFile(content: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!content || content.trim() === '') {
    errors.push('CODEOWNERS file cannot be empty.');
    return { valid: false, errors, warnings };
  }

  const lines = content.split('\n');
  let ruleCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const tokens = line.split(/\s+/);
    if (tokens.length < 2) {
      errors.push(`Line ${i + 1} in CODEOWNERS is invalid. Rule must specify a pattern and at least one owner.`);
    } else {
      ruleCount++;
      const owners = tokens.slice(1);
      const invalidOwners = owners.filter((owner) => !owner.startsWith('@') && !owner.includes('@'));
      if (invalidOwners.length > 0) {
        warnings.push(`Line ${i + 1} has owners that may be invalid: ${invalidOwners.join(', ')}`);
      }
    }
  }

  if (ruleCount === 0) {
    errors.push('CODEOWNERS contains no active owner rules.');
  }

  // Required coverage checks
  const rules = parseCodeowners(content);

  // 1. Check contracts ownership (/contracts or /contracts/)
  const hasContractsRule = rules.some(
    (r) =>
      (r.pattern === '/contracts' || r.pattern === '/contracts/' || r.pattern.startsWith('/contracts/')) &&
      r.owners.includes('@Junirezz') &&
      r.owners.includes('@contract-reviewers')
  );
  if (!hasContractsRule) {
    errors.push('CODEOWNERS is missing rule "/contracts @Junirezz @contract-reviewers"');
  }

  // 2. Check Rust file ownership (*.rs @rust-reviewers)
  const hasRustRule = rules.some(
    (r) => (r.pattern === '*.rs' || r.pattern === '**/*.rs') && r.owners.includes('@rust-reviewers')
  );
  if (!hasRustRule) {
    errors.push('CODEOWNERS is missing rule "*.rs @rust-reviewers"');
  }

  // 3. Test contracts/src/lib.rs review resolution
  const testLibRsReviewers = getOwnersForFile('contracts/src/lib.rs', content);
  const requiredLibRsReviewers = ['@Junirezz', '@contract-reviewers', '@rust-reviewers'];
  const missingLibRsReviewers = requiredLibRsReviewers.filter((r) => !testLibRsReviewers.includes(r));
  if (missingLibRsReviewers.length > 0) {
    errors.push(
      `PR touching "contracts/src/lib.rs" does not request all required reviewers. Missing: ${missingLibRsReviewers.join(', ')}`
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * CLI runner for CODEOWNERS check in CI.
 */
export function runCodeownersCheck(rootDir: string = process.cwd()): ValidationResult {
  const codeownersPath = resolve(rootDir, '.github/CODEOWNERS');
  if (!existsSync(codeownersPath)) {
    return {
      valid: false,
      errors: [`.github/CODEOWNERS file does not exist at ${codeownersPath}`],
      warnings: [],
    };
  }

  const content = readFileSync(codeownersPath, 'utf8');
  return validateCodeownersFile(content);
}

if (require.main === module) {
  const result = runCodeownersCheck();
  if (!result.valid) {
    console.error('❌ CODEOWNERS validation failed:');
    result.errors.forEach((err) => console.error(`  - ${err}`));
    process.exit(1);
  } else {
    console.log('✅ CODEOWNERS validation passed successfully!');
    if (result.warnings.length > 0) {
      console.warn('⚠️ Warnings:');
      result.warnings.forEach((warn) => console.warn(`  - ${warn}`));
    }
  }
}
