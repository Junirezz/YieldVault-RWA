import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseCodeowners,
  patternToRegex,
  getMatchingRules,
  getOwnersForFile,
  getReviewersForChangedFiles,
  validateCodeownersFile,
  runCodeownersCheck,
} from './validate-codeowners';

describe('CODEOWNERS Validation & PR Review Simulation Tests', () => {
  const repoRoot = resolve(__dirname, '..');
  const codeownersPath = resolve(repoRoot, '.github/CODEOWNERS');

  it('verifies .github/CODEOWNERS exists in repository', () => {
    expect(existsSync(codeownersPath)).toBe(true);
  });

  it('parses repository CODEOWNERS rules accurately', () => {
    const content = readFileSync(codeownersPath, 'utf8');
    const rules = parseCodeowners(content);
    expect(rules.length).toBeGreaterThan(0);

    const contractRules = rules.filter((r) => r.pattern.startsWith('/contracts'));
    expect(contractRules.length).toBeGreaterThan(0);

    const rustRules = rules.filter((r) => r.pattern === '*.rs');
    expect(rustRules.length).toBe(1);
    expect(rustRules[0].owners).toContain('@rust-reviewers');
  });

  describe('Acceptance Criteria: PR touching contracts/src/lib.rs', () => {
    it('asserts CODEOWNERS requests review from @Junirezz, @contract-reviewers, and @rust-reviewers', () => {
      const content = readFileSync(codeownersPath, 'utf8');
      const changedFiles = ['contracts/src/lib.rs'];
      const { fileReviewers, allReviewers } = getReviewersForChangedFiles(changedFiles, content);

      expect(fileReviewers['contracts/src/lib.rs']).toContain('@Junirezz');
      expect(fileReviewers['contracts/src/lib.rs']).toContain('@contract-reviewers');
      expect(fileReviewers['contracts/src/lib.rs']).toContain('@rust-reviewers');

      expect(allReviewers).toContain('@Junirezz');
      expect(allReviewers).toContain('@contract-reviewers');
      expect(allReviewers).toContain('@rust-reviewers');
    });

    it('asserts PR touching nested contract rust file (contracts/vault/src/lib.rs) requests all contract & rust reviewers', () => {
      const content = readFileSync(codeownersPath, 'utf8');
      const changedFiles = ['contracts/vault/src/lib.rs'];
      const { fileReviewers } = getReviewersForChangedFiles(changedFiles, content);

      expect(fileReviewers['contracts/vault/src/lib.rs']).toContain('@Junirezz');
      expect(fileReviewers['contracts/vault/src/lib.rs']).toContain('@contract-reviewers');
      expect(fileReviewers['contracts/vault/src/lib.rs']).toContain('@rust-reviewers');
    });

    it('asserts PR touching non-rust contract file (contracts/Cargo.toml) requests contract reviewers', () => {
      const content = readFileSync(codeownersPath, 'utf8');
      const changedFiles = ['contracts/Cargo.toml'];
      const { fileReviewers } = getReviewersForChangedFiles(changedFiles, content);

      expect(fileReviewers['contracts/Cargo.toml']).toContain('@Junirezz');
      expect(fileReviewers['contracts/Cargo.toml']).toContain('@contract-reviewers');
    });
  });

  describe('Pattern Matching Helpers', () => {
    it('matches exact directory patterns', () => {
      const regex = patternToRegex('/contracts/');
      expect(regex.test('contracts/src/lib.rs')).toBe(true);
      expect(regex.test('backend/src/index.ts')).toBe(false);
    });

    it('matches glob extension patterns across subdirectories', () => {
      const regex = patternToRegex('*.rs');
      expect(regex.test('contracts/src/lib.rs')).toBe(true);
      expect(regex.test('contracts/vault/src/state.rs')).toBe(true);
      expect(regex.test('backend/src/index.ts')).toBe(false);
    });
  });

  describe('validateCodeownersFile validation rules', () => {
    it('passes validation for current repository CODEOWNERS', () => {
      const content = readFileSync(codeownersPath, 'utf8');
      const result = validateCodeownersFile(content);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('rejects empty CODEOWNERS content', () => {
      const result = validateCodeownersFile('');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('CODEOWNERS file cannot be empty.');
    });

    it('rejects CODEOWNERS missing /contracts owners', () => {
      const content = `
* @team-core
/backend/ @team-backend
*.rs @rust-reviewers
      `;
      const result = validateCodeownersFile(content);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('missing rule "/contracts @Junirezz @contract-reviewers"'))).toBe(true);
    });

    it('rejects CODEOWNERS missing *.rs owners', () => {
      const content = `
* @team-core
/contracts @Junirezz @contract-reviewers
/backend/ @team-backend
      `;
      const result = validateCodeownersFile(content);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('missing rule "*.rs @rust-reviewers"'))).toBe(true);
    });
  });

  describe('runCodeownersCheck in repository', () => {
    it('passes repository-level check successfully', () => {
      const result = runCodeownersCheck(repoRoot);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });
});
