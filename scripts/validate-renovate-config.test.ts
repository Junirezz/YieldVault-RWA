import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  validateRenovateConfig,
  validateLodashOverride,
  runRenovateValidation,
} from './validate-renovate-config';

describe('Renovate Configuration & Transitive lodash CVE-2021-23337 Mitigation Tests', () => {
  const repoRoot = resolve(__dirname, '..');
  const renovatePath = resolve(repoRoot, 'renovate.json');
  const packageJsonPath = resolve(repoRoot, 'package.json');

  it('verifies renovate.json exists in root directory', () => {
    expect(existsSync(renovatePath)).toBe(true);
  });

  describe('Acceptance Criteria: renovate.json structure and rules', () => {
    const content = readFileSync(renovatePath, 'utf8');
    const config = JSON.parse(content);

    it('includes extends: ["config:recommended"]', () => {
      expect(config.extends).toContain('config:recommended');
    });

    it('sets schedule before 4am Monday', () => {
      expect(Array.isArray(config.schedule)).toBe(true);
      const hasMondaySchedule = config.schedule.some((s: string) => {
        const lower = s.toLowerCase();
        return lower.includes('4am') && lower.includes('monday');
      });
      expect(hasMondaySchedule).toBe(true);
    });

    it('enables automerge for indirect / transitive dependencies', () => {
      expect(Array.isArray(config.packageRules)).toBe(true);
      const indirectAutomerge = config.packageRules.some((rule: any) => {
        return (
          Array.isArray(rule.matchDepTypes) &&
          rule.matchDepTypes.includes('indirect') &&
          rule.automerge === true
        );
      });
      expect(indirectAutomerge).toBe(true);
    });
  });

  describe('Acceptance Criteria: lodash CVE-2021-23337 mitigation', () => {
    it('overrides lodash to safe version >= 4.17.21 in root package.json', () => {
      const pkgContent = readFileSync(packageJsonPath, 'utf8');
      const pkg = JSON.parse(pkgContent);

      expect(pkg.pnpm?.overrides?.lodash).toBeDefined();
      expect(pkg.pnpm.overrides.lodash).not.toContain('4.17.20');
      expect(pkg.overrides?.lodash).toBeDefined();
    });

    it('passes validateLodashOverride check', () => {
      const pkgContent = readFileSync(packageJsonPath, 'utf8');
      const result = validateLodashOverride(pkgContent);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe('Validation error handling', () => {
    it('rejects invalid renovate config missing config:recommended', () => {
      const invalid = JSON.stringify({ schedule: ['before 4am Monday'], packageRules: [] });
      const result = validateRenovateConfig(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('config:recommended'))).toBe(true);
    });

    it('rejects invalid renovate config missing Monday schedule', () => {
      const invalid = JSON.stringify({
        extends: ['config:recommended'],
        schedule: ['at 10pm Friday'],
        packageRules: [{ matchDepTypes: ['indirect'], automerge: true }],
      });
      const result = validateRenovateConfig(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('before 4am Monday'))).toBe(true);
    });

    it('rejects invalid renovate config missing automerge for indirect', () => {
      const invalid = JSON.stringify({
        extends: ['config:recommended'],
        schedule: ['before 4am Monday'],
        packageRules: [],
      });
      const result = validateRenovateConfig(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('automerge: true'))).toBe(true);
    });
  });

  describe('runRenovateValidation integration check', () => {
    it('passes repository-level validation cleanly', () => {
      const result = runRenovateValidation(repoRoot);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });
});
