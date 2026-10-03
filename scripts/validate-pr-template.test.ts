import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  validatePrTemplate,
  simulatePROpening,
  extractSection,
  runPrTemplateCheck,
} from './validate-pr-template';

describe('Pull Request Template Validation & Wave Submission Checklist Tests', () => {
  const repoRoot = resolve(__dirname, '..');
  const templatePath = resolve(repoRoot, '.github/PULL_REQUEST_TEMPLATE.md');

  it('verifies .github/PULL_REQUEST_TEMPLATE.md exists in repository', () => {
    expect(existsSync(templatePath)).toBe(true);
  });

  describe('Acceptance Criteria: PR Template Checklist Sections', () => {
    const templateContent = readFileSync(templatePath, 'utf8');

    it('contains Risk Assessment section with checkboxes', () => {
      const risk = extractSection(templateContent, ['Risk Assessment', 'Risk']);
      expect(risk.hasHeading).toBe(true);
      expect(risk.checkboxCount).toBeGreaterThanOrEqual(4);
    });

    it('contains Rollback Plan section with checkboxes', () => {
      const rollback = extractSection(templateContent, ['Rollback Plan', 'Rollback']);
      expect(rollback.hasHeading).toBe(true);
      expect(rollback.checkboxCount).toBeGreaterThanOrEqual(3);
    });

    it('contains Performance Impact section with checkboxes', () => {
      const perf = extractSection(templateContent, ['Performance Impact', 'Performance']);
      expect(perf.hasHeading).toBe(true);
      expect(perf.checkboxCount).toBeGreaterThanOrEqual(3);
    });

    it('includes Wave submission and contract migration type of change option', () => {
      expect(templateContent).toContain('Wave submission');
    });

    it('covers blast radius items for smart contract storage migrations', () => {
      expect(templateContent).toContain('Contract storage layout / data key migration');
      expect(templateContent).toContain('Value transfer');
    });
  });

  describe('Test: open PR via template and assert checklist appears', () => {
    it('simulates opening PR with template and verifies all required checklists appear', () => {
      const templateContent = readFileSync(templatePath, 'utf8');
      const simulation = simulatePROpening(templateContent);

      expect(simulation.hasRiskSection).toBe(true);
      expect(simulation.hasRollbackSection).toBe(true);
      expect(simulation.hasPerformanceSection).toBe(true);
      expect(simulation.riskCheckboxesPresent).toBe(true);
      expect(simulation.rollbackCheckboxesPresent).toBe(true);
      expect(simulation.performanceCheckboxesPresent).toBe(true);
      expect(simulation.allChecklistsPresent).toBe(true);
    });
  });

  describe('validatePrTemplate schema validation', () => {
    it('passes validation on repository PR template', () => {
      const templateContent = readFileSync(templatePath, 'utf8');
      const result = validatePrTemplate(templateContent);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('rejects PR template missing Risk section', () => {
      const invalidTemplate = `
# PR Template
## Description
Goal
## Testing
- [ ] Unit tests
## Rollback Plan
- [ ] Revert git
## Performance Impact
- [ ] Gas checked
      `;
      const result = validatePrTemplate(invalidTemplate);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Risk Assessment'))).toBe(true);
    });

    it('rejects PR template missing Rollback Plan section', () => {
      const invalidTemplate = `
# PR Template
## Description
Goal
## Testing
- [ ] Unit tests
## Risk Assessment
- [ ] Low
- [ ] Medium
- [ ] High
- [ ] Critical
## Performance Impact
- [ ] Gas checked
      `;
      const result = validatePrTemplate(invalidTemplate);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Rollback Plan'))).toBe(true);
    });

    it('rejects PR template missing Performance Impact section', () => {
      const invalidTemplate = `
# PR Template
## Description
Goal
## Testing
- [ ] Unit tests
## Risk Assessment
- [ ] Low
- [ ] Medium
- [ ] High
- [ ] Critical
## Rollback Plan
- [ ] Revert git
- [ ] Pause contract
- [ ] Down migration
      `;
      const result = validatePrTemplate(invalidTemplate);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Performance Impact'))).toBe(true);
    });
  });

  describe('runPrTemplateCheck CLI runner', () => {
    it('runs repository-level PR template check successfully', () => {
      const result = runPrTemplateCheck(repoRoot);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });
});
