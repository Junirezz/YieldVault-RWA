import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  validateSeverityLevels,
  validateRunbookHeadingConsistency,
  runFullIncidentSeverityValidation,
  SEVERITY_LEVELS,
  SeverityLevel,
} from './validate-incident-severity';

describe('Incident Severity Validator', () => {
  describe('validateSeverityLevels', () => {
    it('accepts valid severity level definitions', () => {
      const result = validateSeverityLevels(SEVERITY_LEVELS);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('rejects empty array', () => {
      expect(validateSeverityLevels([]).valid).toBe(false);
    });

    it('rejects duplicate severity IDs', () => {
      const dupes: SeverityLevel[] = [
        { id: 'Sev0', name: 'Critical', responseSlaMinutes: 5, targetMitigationMinutes: null, requiresPostmortem: true },
        { id: 'Sev0', name: 'Critical Dupe', responseSlaMinutes: 10, targetMitigationMinutes: null, requiresPostmortem: true },
      ];
      const result = validateSeverityLevels(dupes);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Duplicate'))).toBe(true);
    });

    it('rejects levels with invalid response SLA', () => {
      const invalid: SeverityLevel[] = [
        { id: 'SevX', name: 'Invalid', responseSlaMinutes: -1, targetMitigationMinutes: null, requiresPostmortem: false },
      ];
      const result = validateSeverityLevels(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('invalid responseSlaMinutes'))).toBe(true);
    });

    it('warns when levels are not sorted by SLA', () => {
      const unsorted: SeverityLevel[] = [
        { id: 'Sev1', name: 'High', responseSlaMinutes: 15, targetMitigationMinutes: null, requiresPostmortem: true },
        { id: 'Sev0', name: 'Critical', responseSlaMinutes: 5, targetMitigationMinutes: null, requiresPostmortem: true },
      ];
      const result = validateSeverityLevels(unsorted);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('validateRunbookHeadingConsistency', () => {
    it('validates the actual docs/incident-runbook.md file', () => {
      const runbookPath = resolve(__dirname, '../docs/incident-runbook.md');
      expect(existsSync(runbookPath)).toBe(true);
      const content = readFileSync(runbookPath, 'utf8');
      expect(validateRunbookHeadingConsistency(content).valid).toBe(true);
    });

    it('rejects empty content', () => {
      expect(validateRunbookHeadingConsistency('').valid).toBe(false);
    });

    it('rejects content missing required sections', () => {
      const result = validateRunbookHeadingConsistency('# Just a heading\nNo sections here.');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('runFullIncidentSeverityValidation', () => {
    it('passes full repository verification', () => {
      const rootDir = resolve(__dirname, '..');
      const result = runFullIncidentSeverityValidation(rootDir);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });
});
