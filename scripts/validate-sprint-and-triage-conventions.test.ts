import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  validateSprintLabel,
  validateIssueTaxonomyLabel,
  validateIssueTemplate,
  validateSprintAndTriageDocs,
  runFullSprintAndTriageValidation,
  VALID_TYPES,
  VALID_SCOPES,
  VALID_PRIORITIES,
  VALID_STATUSES,
} from './validate-sprint-and-triage-conventions';

describe('Sprint & Triage Conventions Validator Unit Tests', () => {
  describe('validateSprintLabel', () => {
    it('accepts valid sprint label formats', () => {
      expect(validateSprintLabel('sprint: 2026-W30').valid).toBe(true);
      expect(validateSprintLabel('sprint: 2026-W52').valid).toBe(true);
      expect(validateSprintLabel('sprint: current').valid).toBe(true);
      expect(validateSprintLabel('sprint: next').valid).toBe(true);
      expect(validateSprintLabel('sprint: backlog').valid).toBe(true);
    });

    it('rejects invalid sprint label formats', () => {
      expect(validateSprintLabel('sprint-2026').valid).toBe(false);
      expect(validateSprintLabel('sprint: 26-W30').valid).toBe(false);
      expect(validateSprintLabel('sprint: invalid').valid).toBe(false);
      expect(validateSprintLabel('').valid).toBe(false);
    });
  });

  describe('validateIssueTaxonomyLabel', () => {
    it('accepts valid taxonomy labels across types, scopes, priorities, and statuses', () => {
      expect(validateIssueTaxonomyLabel('type: feature').valid).toBe(true);
      expect(validateIssueTaxonomyLabel('scope: contracts').valid).toBe(true);
      expect(validateIssueTaxonomyLabel('priority: p0-critical').valid).toBe(true);
      expect(validateIssueTaxonomyLabel('status: needs-triage').valid).toBe(true);
      expect(validateIssueTaxonomyLabel('sprint: 2026-W30').valid).toBe(true);
      expect(validateIssueTaxonomyLabel('epic: vault-v2').valid).toBe(true);
    });

    it('rejects invalid prefixed taxonomy labels', () => {
      expect(validateIssueTaxonomyLabel('type: invalid-type').valid).toBe(false);
      expect(validateIssueTaxonomyLabel('scope: invalid-scope').valid).toBe(false);
      expect(validateIssueTaxonomyLabel('priority: p99-urgent').valid).toBe(false);
      expect(validateIssueTaxonomyLabel('status: invalid-status').valid).toBe(false);
    });

    it('warns on uncategorized labels', () => {
      const res = validateIssueTaxonomyLabel('random-custom-label');
      expect(res.valid).toBe(true);
      expect(res.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('validateIssueTemplate', () => {
    it('accepts valid issue template format with frontmatter', () => {
      const markdown = `---
name: Bug Report
about: Report a bug
title: 'Fix: [Short description]'
---
## Description
      `;
      expect(validateIssueTemplate(markdown, 'bug_report.md').valid).toBe(true);
    });

    it('rejects issue templates missing frontmatter or required metadata', () => {
      const noFrontmatter = '## Description without frontmatter';
      expect(validateIssueTemplate(noFrontmatter, 'bug_report.md').valid).toBe(false);
    });
  });

  describe('validateSprintAndTriageDocs', () => {
    it('validates repository docs/SPRINT_AND_TRIAGE_CONVENTIONS.md file', () => {
      const docPath = resolve(__dirname, '../docs/SPRINT_AND_TRIAGE_CONVENTIONS.md');
      expect(existsSync(docPath)).toBe(true);
      const markdown = readFileSync(docPath, 'utf8');
      expect(validateSprintAndTriageDocs(markdown).valid).toBe(true);
    });
  });

  describe('Performance Regression Template Validation', () => {
    const templatePath = resolve(__dirname, '../.github/ISSUE_TEMPLATE/perf_regression.md');

    it('ensures perf_regression.md exists', () => {
      expect(existsSync(templatePath)).toBe(true);
    });

    it('validates perf_regression.md has valid frontmatter, perf label, and backend team assignment', () => {
      const content = readFileSync(templatePath, 'utf8');
      const validation = validateIssueTemplate(content, 'perf_regression.md');
      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);

      // Check frontmatter attributes
      expect(content).toMatch(/name:\s*Performance Regression/i);
      expect(content).toMatch(/labels:\s*.*type:\s*perf/i);
      expect(content).toMatch(/assignees:\s*.*backend/i);
    });

    it('asserts that the performance regression template body contains all required fields', () => {
      const content = readFileSync(templatePath, 'utf8');

      // Check required fields from acceptance criteria
      expect(content).toMatch(/Endpoint/i);
      expect(content).toMatch(/p95\s+(before\/after|Before)/i);
      expect(content).toMatch(/QPS/i);
      expect(content).toMatch(/DB\s+query\s+plan/i);
      expect(content).toMatch(/Repro\s+steps/i);
      expect(content).toMatch(/Expected\s+SLO/i);
    });
  });

  describe('Existing Issue Templates Validation', () => {
    const existingTemplates = [
      'bug_report.md',
      'feature_request.md',
      'perf_regression.md',
      'security_report.md',
      'task_or_chore.md',
    ];

    it.each(existingTemplates)('renders and validates %s without errors', (templateFile) => {
      const tPath = resolve(__dirname, '../.github/ISSUE_TEMPLATE', templateFile);
      expect(existsSync(tPath)).toBe(true);
      const content = readFileSync(tPath, 'utf8');
      const res = validateIssueTemplate(content, templateFile);
      expect(res.valid).toBe(true);
      expect(res.errors).toEqual([]);
    });
  });

  describe('runFullSprintAndTriageValidation', () => {
    it('passes full repository verification on actual codebase files', () => {
      const rootDir = resolve(__dirname, '..');
      const result = runFullSprintAndTriageValidation(rootDir);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });
});

