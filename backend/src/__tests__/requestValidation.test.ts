import express, { Request, Response } from 'express';
import request from 'supertest';
import { z } from 'zod';
import {
  ApyBackfillBodySchema,
  MaintenanceToggleSchema,
  PaginationQuerySchema,
  WebhookVerifyBodySchema,
  DeadLetterIdsSchema,
} from '../types/validation';
import { WEBHOOK_EVENT_TYPES } from '../types/webhooks';
import { validate } from '../middleware/validate';

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

  it('accepts negative page numbers so downstream parser can safely clamp', () => {
    const result = PaginationQuerySchema.safeParse({ page: '-1' });
    expect(result.success).toBe(true);
  });

  it('rejects a non-numeric pagination page', () => {
    const result = PaginationQuerySchema.safeParse({ page: 'abc' });
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

describe('validate middleware error response body', () => {
  const app = express();
  app.use(express.json());

  app.post(
    '/test-validation',
    validate({
      body: z.object({
        url: z.string().url('must be a valid URL'),
        secret: z.string().min(8, 'secret must be at least 8 characters'),
      }),
    }),
    (_req: Request, res: Response) => {
      res.status(200).json({ success: true });
    },
  );

  it('includes both errors and details arrays and a summary field on 400 validation error', async () => {
    const res = await request(app)
      .post('/test-validation')
      .send({ url: 'not-a-url', secret: 'short' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: 'Bad Request',
      status: 400,
      code: 'VALIDATION_ERROR',
      summary: 'Request validation failed',
      retryable: false,
    });

    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.errors).toEqual(res.body.details);
    expect(res.body.errors.length).toBe(2);

    expect(res.body.errors[0]).toHaveProperty('code');
    expect(res.body.errors[0]).toHaveProperty('field');
    expect(res.body.errors[0]).toHaveProperty('message');

    const fields = res.body.errors.map((e: { field: string }) => e.field);
    expect(fields).toContain('url');
    expect(fields).toContain('secret');
  });

  it('passes through to handler when request is valid', async () => {
    const res = await request(app)
      .post('/test-validation')
      .send({ url: 'https://example.com/webhook', secret: 'valid-secret-123' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });
});
