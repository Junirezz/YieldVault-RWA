import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface RenovateConfig {
  extends?: string[];
  schedule?: string[];
  timezone?: string;
  packageRules?: Array<{
    matchDepTypes?: string[];
    matchPackageNames?: string[];
    matchUpdateTypes?: string[];
    automerge?: boolean;
    automergeType?: string;
  }>;
}

/**
 * Validates the renovate.json configuration against requirements.
 */
export function validateRenovateConfig(jsonContent: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!jsonContent || jsonContent.trim() === '') {
    errors.push('renovate.json cannot be empty.');
    return { valid: false, errors, warnings };
  }

  let config: RenovateConfig;
  try {
    config = JSON.parse(jsonContent);
  } catch (err) {
    errors.push(`renovate.json contains invalid JSON: ${(err as Error).message}`);
    return { valid: false, errors, warnings };
  }

  // 1. Check extends includes config:recommended
  if (!Array.isArray(config.extends) || !config.extends.some((e) => e.includes('config:recommended'))) {
    errors.push('renovate.json must include "config:recommended" in the "extends" array.');
  }

  // 2. Check schedule contains before 4am Monday
  if (!Array.isArray(config.schedule) || config.schedule.length === 0) {
    errors.push('renovate.json must define a "schedule" array.');
  } else {
    const hasMondaySchedule = config.schedule.some((s) => {
      const lower = s.toLowerCase();
      return lower.includes('4am') && lower.includes('monday');
    });
    if (!hasMondaySchedule) {
      errors.push('renovate.json schedule must be scheduled before 4am Monday.');
    }
  }

  // 3. Check automerge for indirect dependencies
  const packageRules = config.packageRules || [];
  const hasIndirectAutomerge = packageRules.some((rule) => {
    const matchesIndirect = Array.isArray(rule.matchDepTypes) && rule.matchDepTypes.includes('indirect');
    return matchesIndirect && rule.automerge === true;
  });

  if (!hasIndirectAutomerge) {
    errors.push('renovate.json must configure "automerge: true" for indirect dependencies in "packageRules".');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validates that lodash is overridden / pinned to >= 4.17.21 in package.json to mitigate CVE-2021-23337.
 */
export function validateLodashOverride(packageJsonContent: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const pkg = JSON.parse(packageJsonContent);
    const pnpmOverrides = pkg.pnpm?.overrides || {};
    const overrides = pkg.overrides || {};
    const resolutions = pkg.resolutions || {};

    const lodashTarget = pnpmOverrides.lodash || overrides.lodash || resolutions.lodash;
    if (!lodashTarget) {
      errors.push('package.json is missing pnpm/npm override for "lodash" (required: ^4.17.21 to fix CVE-2021-23337).');
    } else if (lodashTarget.includes('4.17.20')) {
      errors.push(`lodash is pinned to vulnerable version "${lodashTarget}". Must be >= 4.17.21.`);
    }
  } catch (err) {
    errors.push(`Failed to parse package.json: ${(err as Error).message}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * CLI runner for Renovate & lodash vulnerability validation.
 */
export function runRenovateValidation(rootDir: string = process.cwd()): ValidationResult {
  const allErrors: string[] = [];
  const allWarnings: string[] = [];

  const renovatePath = resolve(rootDir, 'renovate.json');
  if (!existsSync(renovatePath)) {
    allErrors.push(`renovate.json does not exist at ${renovatePath}`);
  } else {
    const content = readFileSync(renovatePath, 'utf8');
    const res = validateRenovateConfig(content);
    allErrors.push(...res.errors);
    allWarnings.push(...res.warnings);
  }

  const packageJsonPath = resolve(rootDir, 'package.json');
  if (existsSync(packageJsonPath)) {
    const pkgContent = readFileSync(packageJsonPath, 'utf8');
    const res = validateLodashOverride(pkgContent);
    allErrors.push(...res.errors);
    allWarnings.push(...res.warnings);
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  };
}

if (require.main === module) {
  const result = runRenovateValidation();
  if (!result.valid) {
    console.error('❌ Renovate / Dependency security validation failed:');
    result.errors.forEach((err) => console.error(`  - ${err}`));
    process.exit(1);
  } else {
    console.log('✅ Renovate configuration and lodash security overrides validated successfully!');
  }
}
