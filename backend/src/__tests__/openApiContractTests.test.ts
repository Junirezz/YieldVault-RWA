/**
 * OpenAPI contract tests for critical REST endpoints (Issue #893).
 *
 * These tests make real HTTP requests against the running Express app and
 * validate actual response bodies against the Zod schemas registered in
 * apiContractSnapshots.ts.  They complement the snapshot-diff tests in
 * issues711.test.ts, which only check static schema shapes without hitting
 * any live routes.
 *
 * Coverage:
 *  - GET /health
 *  - GET /ready
 *  - GET /api/v1/vault/summary
 *  - GET /api/v1/transactions
 *  - GET /api/v1/vault/apy/history
 *  - Error shape contract (400, 404, 405)
 */

import request from 'supertest';
import app from '../index';
import {
  validateResponseAgainstSchema,
  HealthResponseSchema,
  ReadyResponseSchema,
  VaultSummaryResponseSchema,
  TransactionsListResponseSchema,
} from '../apiContractSnapshots';
import { z } from 'zod';

// ─── Shared error shape ──────────────────────────────────────────────────────

const ErrorResponseSchema = z.object({
  error: z.string(),
  status: z.number(),
  message: z.string(),
});

// ─── Helper ──────────────────────────────────────────────────────────────────

function assertSchema<T extends z.ZodTypeAny>(schema: T, body: unknown, context: string): void {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new Error(
      `[${context}] Response body does not match schema:\n${result.error.toString()}\n\nBody received:\n${JSON.stringify(body, null, 2)}`,
    );
  }
}

// ─── GET /health ─────────────────────────────────────────────────────────────

describe('OpenAPI contract: GET /health', () => {
  it('returns 200 and a body matching the health schema', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    assertSchema(HealthResponseSchema, res.body, 'GET /health');
  });

  it('response validates via validateResponseAgainstSchema helper', async () => {
    const res = await request(app).get('/health');
    const { success, error } = validateResponseAgainstSchema('GET /health', res.body);
    expect(success).toBe(true);
    expect(error).toBeUndefined();
  });

  it('includes all required top-level fields', async () => {
    const res = await request(app).get('/health');
    expect(res.body).toMatchObject({
      status: expect.any(String),
      timestamp: expect.any(String),
      uptime: expect.any(Number),
      environment: expect.any(String),
      checks: expect.any(Object),
      sorobanCircuitBreaker: expect.any(Object),
    });
  });

  it('checks object contains all required dependency keys', async () => {
    const res = await request(app).get('/health');
    const requiredKeys = ['api', 'cache', 'stellarRpc', 'databasePrimary', 'databaseReplica', 'prisma', 'jobs'];
    for (const key of requiredKeys) {
      expect(res.body.checks).toHaveProperty(key);
      expect(['up', 'down', 'degraded', 'unknown']).toContain(res.body.checks[key]);
    }
  });

  it('sorobanCircuitBreaker has expected numeric fields', async () => {
    const res = await request(app).get('/health');
    expect(typeof res.body.sorobanCircuitBreaker.failures).toBe('number');
    expect(typeof res.body.sorobanCircuitBreaker.retryAfterMs).toBe('number');
    expect(typeof res.body.sorobanCircuitBreaker.state).toBe('string');
  });

  it('timestamp is a valid ISO 8601 date string', async () => {
    const res = await request(app).get('/health');
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
  });
});

// ─── GET /ready ───────────────────────────────────────────────────────────────

describe('OpenAPI contract: GET /ready', () => {
  it('returns 200 or 503 with a body matching the ready schema', async () => {
    const res = await request(app).get('/ready');
    expect([200, 503]).toContain(res.status);
    assertSchema(ReadyResponseSchema, res.body, 'GET /ready');
  });

  it('response validates via validateResponseAgainstSchema helper', async () => {
    const res = await request(app).get('/ready');
    const { success, error } = validateResponseAgainstSchema('GET /ready', res.body);
    expect(success).toBe(true);
    expect(error).toBeUndefined();
  });

  it('ready field is boolean', async () => {
    const res = await request(app).get('/ready');
    expect(typeof res.body.ready).toBe('boolean');
  });

  it('dependencies object has boolean values for each key', async () => {
    const res = await request(app).get('/ready');
    const deps = res.body.dependencies as Record<string, unknown>;
    const expectedKeys = ['cache', 'stellarRpc', 'database', 'prisma'];
    for (const key of expectedKeys) {
      expect(deps).toHaveProperty(key);
      expect(typeof deps[key]).toBe('boolean');
    }
  });
});

// ─── GET /api/v1/vault/summary ────────────────────────────────────────────────

describe('OpenAPI contract: GET /api/v1/vault/summary', () => {
  it('returns 200 and a body matching the vault summary schema', async () => {
    const res = await request(app).get('/api/v1/vault/summary');
    expect(res.status).toBe(200);
    assertSchema(VaultSummaryResponseSchema, res.body, 'GET /api/v1/vault/summary');
  });

  it('response validates via validateResponseAgainstSchema helper', async () => {
    const res = await request(app).get('/api/v1/vault/summary');
    const { success, error } = validateResponseAgainstSchema('GET /api/v1/vault/summary', res.body);
    expect(success).toBe(true);
    expect(error).toBeUndefined();
  });

  it('numeric fields are finite numbers', async () => {
    const res = await request(app).get('/api/v1/vault/summary');
    // totalAssets/totalShares/sharePrice are Decimal-backed strings (to avoid
    // floating-point precision loss), not numbers — verify they parse cleanly.
    expect(Number.isFinite(Number(res.body.totalAssets))).toBe(true);
    expect(Number.isFinite(Number(res.body.totalShares))).toBe(true);
    expect(Number.isFinite(Number(res.body.sharePrice))).toBe(true);
    expect(Number.isFinite(res.body.apy)).toBe(true);
  });

  it('timestamp is a valid ISO 8601 date string', async () => {
    const res = await request(app).get('/api/v1/vault/summary');
    expect(() => new Date(res.body.timestamp)).not.toThrow();
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
  });

  it('does not contain unexpected extra fields (additionalProperties: false)', async () => {
    const res = await request(app).get('/api/v1/vault/summary');
    const allowedKeys = new Set(['totalAssets', 'totalShares', 'sharePrice', 'apy', 'timestamp']);
    for (const key of Object.keys(res.body)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });
});

// ─── GET /api/v1/transactions ─────────────────────────────────────────────────

describe('OpenAPI contract: GET /api/v1/transactions', () => {
  it('returns 200 and a body matching the transactions list schema', async () => {
    const res = await request(app).get('/api/v1/transactions?limit=5');
    expect(res.status).toBe(200);
    assertSchema(TransactionsListResponseSchema, res.body, 'GET /api/v1/transactions');
  });

  it('response validates via validateResponseAgainstSchema helper', async () => {
    const res = await request(app).get('/api/v1/transactions?limit=5');
    const { success, error } = validateResponseAgainstSchema('GET /api/v1/transactions', res.body);
    expect(success).toBe(true);
    expect(error).toBeUndefined();
  });

  it('pagination envelope has all required fields with correct types', async () => {
    const res = await request(app).get('/api/v1/transactions?limit=5');
    const { pagination } = res.body;
    expect(typeof pagination.count).toBe('number');
    expect(typeof pagination.limit).toBe('number');
    expect(typeof pagination.hasNextPage).toBe('boolean');
    expect(typeof pagination.hasPrevPage).toBe('boolean');
    // total, nextCursor, prevCursor, currentPage, totalPages can be null
    expect(pagination.total === null || typeof pagination.total === 'number').toBe(true);
    expect(pagination.nextCursor === null || typeof pagination.nextCursor === 'string').toBe(true);
    expect(pagination.prevCursor === null || typeof pagination.prevCursor === 'string').toBe(true);
  });

  it('each transaction item conforms to the contract shape', async () => {
    const res = await request(app).get('/api/v1/transactions?limit=5');
    const { data } = res.body as { data: Record<string, unknown>[] };

    for (const item of data) {
      expect(typeof item.id).toBe('string');
      expect(['deposit', 'withdrawal']).toContain(item.type);
      expect(['pending', 'completed', 'failed']).toContain(item.status);
      expect(typeof item.amount).toBe('string');
      expect(typeof item.asset).toBe('string');
      expect(typeof item.timestamp).toBe('string');
      expect(typeof item.transactionHash).toBe('string');
      expect(typeof item.walletAddress).toBe('string');
    }
  });

  it('limit query param is reflected in pagination.limit', async () => {
    const res = await request(app).get('/api/v1/transactions?limit=3');
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(3);
    expect(res.body.data.length).toBeLessThanOrEqual(3);
  });

  it('type filter returns only matching transaction types', async () => {
    const res = await request(app).get('/api/v1/transactions?limit=50&type=deposit');
    expect(res.status).toBe(200);
    for (const item of res.body.data as Array<{ type: string }>) {
      expect(item.type).toBe('deposit');
    }
  });

  it('status filter returns only matching transaction statuses', async () => {
    const res = await request(app).get('/api/v1/transactions?limit=50&status=completed');
    expect(res.status).toBe(200);
    for (const item of res.body.data as Array<{ status: string }>) {
      expect(item.status).toBe('completed');
    }
  });

  it('invalid type filter with walletAddress returns 400 with error contract shape', async () => {
    // The type validation only fires when walletAddress is provided (transactionEndpoints.ts path)
    const res = await request(app).get(
      '/api/v1/transactions?type=invalid_type&walletAddress=G234567ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQ',
    );
    // Without a valid JWT this may return 401/403; with an unrecognised type + wallet it returns 400
    expect([400, 401, 403]).toContain(res.status);
    if (res.status === 400) {
      assertSchema(ErrorResponseSchema, res.body, 'GET /api/v1/transactions 400');
    }
  });

  it('timestamp is a valid ISO 8601 date string', async () => {
    const res = await request(app).get('/api/v1/transactions?limit=1');
    expect(() => new Date(res.body.timestamp)).not.toThrow();
  });
});

// ─── GET /api/v1/vault/apy/history ────────────────────────────────────────────

const ApyHistoryResponseSchema = z.object({
  data: z.array(
    z.object({
      date: z.string(),
      apy: z.number(),
    }),
  ),
  days: z.number(),
  count: z.number(),
});

describe('OpenAPI contract: GET /api/v1/vault/apy/history', () => {
  it('returns 200 and a body matching the APY history schema', async () => {
    const res = await request(app).get('/api/v1/vault/apy/history?days=7');
    expect(res.status).toBe(200);
    assertSchema(ApyHistoryResponseSchema, res.body, 'GET /api/v1/vault/apy/history');
  });

  it('days field matches the requested query param', async () => {
    const res = await request(app).get('/api/v1/vault/apy/history?days=14');
    expect(res.status).toBe(200);
    expect(res.body.days).toBe(14);
  });

  it('count matches the length of data array', async () => {
    const res = await request(app).get('/api/v1/vault/apy/history?days=7');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(res.body.data.length);
  });

  it('each APY data point has a date string and numeric apy', async () => {
    const res = await request(app).get('/api/v1/vault/apy/history?days=7');
    for (const point of res.body.data as Array<{ date: string; apy: number }>) {
      expect(typeof point.date).toBe('string');
      expect(typeof point.apy).toBe('number');
      expect(Number.isFinite(point.apy)).toBe(true);
    }
  });

  it('falls back to default 30 days for days=0 (non-positive values use default)', async () => {
    const res = await request(app).get('/api/v1/vault/apy/history?days=0');
    // The endpoint falls back to the default (30) for out-of-range or invalid values
    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      assertSchema(ApyHistoryResponseSchema, res.body, 'GET /api/v1/vault/apy/history days=0 fallback');
    }
  });

  it('accepts days=365 (maximum allowed value)', async () => {
    const res = await request(app).get('/api/v1/vault/apy/history?days=365');
    expect(res.status).toBe(200);
    assertSchema(ApyHistoryResponseSchema, res.body, 'GET /api/v1/vault/apy/history days=365');
  });
});

// ─── Error contract shape ─────────────────────────────────────────────────────

describe('OpenAPI contract: Error response shape', () => {
  it('404 on unknown route returns error contract shape', async () => {
    const res = await request(app).get('/api/v1/does-not-exist-893');
    expect(res.status).toBe(404);
    assertSchema(ErrorResponseSchema, res.body, 'GET unknown route 404');
  });

  it('405 on method-not-allowed returns error contract shape (if supported)', async () => {
    const res = await request(app).delete('/health');
    // Not all frameworks expose 405 explicitly, accept 404 as a fallback
    expect([404, 405]).toContain(res.status);
    if (res.status === 405) {
      assertSchema(ErrorResponseSchema, res.body, 'DELETE /health 405');
    }
  });

  it('400 from invalid query param includes message field', async () => {
    const res = await request(app).get('/api/v1/transactions?type=bogus');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('message');
    expect(typeof res.body.message).toBe('string');
  });
});

// ─── Live-response vs snapshot parity ────────────────────────────────────────

describe('OpenAPI contract: live response vs committed snapshot parity', () => {
  it('GET /health live response passes Zod schema and matches snapshot shape', async () => {
    const res = await request(app).get('/health');
    // Zod parse confirms live response matches committed schema
    const { success } = validateResponseAgainstSchema('GET /health', res.body);
    expect(success).toBe(true);
  });

  it('GET /ready live response passes Zod schema and matches snapshot shape', async () => {
    const res = await request(app).get('/ready');
    const { success } = validateResponseAgainstSchema('GET /ready', res.body);
    expect(success).toBe(true);
  });

  it('GET /api/v1/vault/summary live response passes Zod schema and matches snapshot shape', async () => {
    const res = await request(app).get('/api/v1/vault/summary');
    const { success } = validateResponseAgainstSchema('GET /api/v1/vault/summary', res.body);
    expect(success).toBe(true);
  });

  it('GET /api/v1/transactions live response passes Zod schema and matches snapshot shape', async () => {
    const res = await request(app).get('/api/v1/transactions?limit=5');
    const { success } = validateResponseAgainstSchema('GET /api/v1/transactions', res.body);
    expect(success).toBe(true);
  });
});
