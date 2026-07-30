import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  validateNFRJsonSpec,
  validateNFRDocContent,
  validateApiSlaSloDocContent,
  validateObservabilityAlignment,
  runFullNFRValidation,
} from './validate-nfr-baselines';

describe('NFR Baselines Validator Unit Tests', () => {
  describe('validateNFRJsonSpec', () => {
    it('accepts valid nfr-baselines.json content', () => {
      const json = JSON.stringify({
        version: '1.0.0',
        tiers: [
          { tier: 't1', name: 'T1', slo: { availability_percent: 99.99 }, rto_minutes: 0, rpo_minutes: 0 },
          { tier: 't2', name: 'T2', slo: { availability_percent: 99.9 }, rto_minutes: 60, rpo_minutes: 15 },
          { tier: 't3', name: 'T3', slo: { availability_percent: 99.9 }, rto_minutes: 15, rpo_minutes: 0 },
        ],
        error_budget_policy: {
          fast_burn: { budget_consumed_percent: 2, window_hours: 1 },
          slow_burn: { budget_consumed_percent: 5, window_hours: 6 },
        },
      });
      expect(validateNFRJsonSpec(json).valid).toBe(true);
    });

    it('rejects invalid JSON syntax', () => {
      expect(validateNFRJsonSpec('{ bad json').valid).toBe(false);
    });

    it('rejects NFR spec with out-of-bound availability or latency values', () => {
      const json = JSON.stringify({
        tiers: [
          { tier: 't1', name: 'T1', slo: { availability_percent: 50.0 }, rto_minutes: 9999, rpo_minutes: 0 },
          {
            tier: 't2',
            name: 'T2',
            slo: {
              availability_percent: 99.9,
              latency_p95_read_ms: 1200,
              latency_p99_write_ms: -10,
            },
            rto_minutes: 60,
            rpo_minutes: 15,
          },
          { tier: 't3', name: 'T3', slo: { availability_percent: 99.9 }, rto_minutes: 15, rpo_minutes: 0 },
        ],
        error_budget_policy: { fast_burn: {}, slow_burn: {} },
      });
      const res = validateNFRJsonSpec(json);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('invalid availability SLO'))).toBe(true);
      expect(res.errors.some((e) => e.includes('invalid RTO'))).toBe(true);
      expect(res.errors.some((e) => e.includes('invalid latency_p95_read_ms'))).toBe(true);
      expect(res.errors.some((e) => e.includes('invalid latency_p99_write_ms'))).toBe(true);
    });
  });

  describe('validateNFRDocContent', () => {
    it('validates repository docs/NFR_BASELINES.md file', () => {
      const docPath = resolve(__dirname, '../docs/NFR_BASELINES.md');
      expect(existsSync(docPath)).toBe(true);
      const markdown = readFileSync(docPath, 'utf8');
      expect(validateNFRDocContent(markdown).valid).toBe(true);
    });

    it('rejects empty markdown content', () => {
      expect(validateNFRDocContent('').valid).toBe(false);
    });
  });

  describe('validateApiSlaSloDocContent', () => {
    it('validates repository docs/api/SLA_SLO.md file', () => {
      const docPath = resolve(__dirname, '../docs/api/SLA_SLO.md');
      expect(existsSync(docPath)).toBe(true);
      const markdown = readFileSync(docPath, 'utf8');
      expect(validateApiSlaSloDocContent(markdown).valid).toBe(true);
    });

    it('rejects empty markdown content', () => {
      expect(validateApiSlaSloDocContent('').valid).toBe(false);
    });

    it('rejects markdown content missing required headings', () => {
      expect(validateApiSlaSloDocContent('# API SLA/SLO Targets').valid).toBe(false);
    });
  });

  describe('validateObservabilityAlignment', () => {
    it('passes when observability docs align with NFR latency targets', () => {
      const res = validateObservabilityAlignment('200 ms and 500 ms', '200 ms and 500 ms');
      expect(res.valid).toBe(true);
    });
  });

  describe('runFullNFRValidation', () => {
    it('passes full repository verification on actual codebase files', () => {
      const rootDir = resolve(__dirname, '..');
      const result = runFullNFRValidation(rootDir);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });
});
