import { z } from 'zod';
import {
  ApyBackfillBodySchema,
  MaintenanceToggleSchema,
  PaginationQuerySchema,
  TransactionListQuerySchema,
  WebhookVerifyBodySchema,
  DeadLetterIdsSchema,
} from '../types/validation';
import { WEBHOOK_EVENT_TYPES } from '../types/webhooks';
import { clampLimitNumber, clampPageNumber } from '../pagination';

describe('request validation schemas', () => {
  it('rejects an inverted APY backfill range', () => {
    const result = ApyBackfillBodySchema.safeParse({ start: '2026-08-10', end: '2026-08-01' });
    expect(result.success).toBe(false);
  });

  it('accepts a valid maintenance toggle body', () => {
    const result = MaintenanceToggleSchema.parse({ enabled: true, reason: 'deploy' });
    expect(result.enabled).toBe(true);
  });

  it('accepts an out-of-range pagination limit for the parser to clamp', () => {
    // Contract tests require invalid pagination to resolve gracefully (200) via
    // parsePaginationQuery's clamping, so the schema must not reject it first.
    for (const limit of ['abc', '-1', '0', '100000']) {
      expect(PaginationQuerySchema.safeParse({ limit }).success).toBe(true);
    }
  });

  it('accepts an out-of-range page for the parser to clamp', () => {
    for (const page of ['abc', '-1', '0', '1.5']) {
      expect(PaginationQuerySchema.safeParse({ page }).success).toBe(true);
    }
  });

  it('still rejects a non-string pagination value', () => {
    expect(PaginationQuerySchema.safeParse({ page: ['1', '2'] }).success).toBe(false);
  });

  it('requires a webhook verify secret', () => {
    const result = WebhookVerifyBodySchema.safeParse({ payload: { ok: true } });
    expect(result.success).toBe(false);
  });

  it('requires at least one dead-letter id', () => {
    expect(DeadLetterIdsSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(DeadLetterIdsSchema.parse({ ids: ['dl_1'] }).ids).toEqual(['dl_1']);
  });

  it('exposes the canonical webhook event catalog', () => {
    expect(WEBHOOK_EVENT_TYPES).toContain('vault.deposit.created');
    expect(z.enum(WEBHOOK_EVENT_TYPES).parse('vault.strategy.changed')).toBe(
      'vault.strategy.changed',
    );
  });
});
