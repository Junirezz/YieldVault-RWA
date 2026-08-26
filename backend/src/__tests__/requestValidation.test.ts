import { z } from 'zod';
import {
  ApyBackfillBodySchema,
  MaintenanceToggleSchema,
  PaginationQuerySchema,
  WebhookVerifyBodySchema,
  DeadLetterIdsSchema,
} from '../types/validation';
import { WEBHOOK_EVENT_TYPES } from '../types/webhooks';

describe('request validation schemas', () => {
  it('rejects an inverted APY backfill range', () => {
    const result = ApyBackfillBodySchema.safeParse({ start: '2026-08-10', end: '2026-08-01' });
    expect(result.success).toBe(false);
  });

  it('accepts a valid maintenance toggle body', () => {
    const result = MaintenanceToggleSchema.parse({ enabled: true, reason: 'deploy' });
    expect(result.enabled).toBe(true);
  });

  it('rejects a non-numeric pagination limit', () => {
    const result = PaginationQuerySchema.safeParse({ limit: 'abc' });
    expect(result.success).toBe(false);
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
