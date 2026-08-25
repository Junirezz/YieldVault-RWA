/**
 * Tests for Issue #894 – strict input validation and schema versioning for webhooks.
 *
 * Coverage:
 *  - WebhookRegisterSchema (Zod) – all valid/invalid field combinations
 *  - WebhookUpdateSchema (Zod) – all valid/invalid field combinations
 *  - POST /admin/webhooks HTTP route – 400 on bad input, 201 on good input
 *  - PATCH /admin/webhooks/:id HTTP route – 400 on bad input, 200 on good input
 *  - WEBHOOK_SCHEMA_VERSION constant present and stable
 *  - Emitted envelope includes schemaVersion at the correct version
 */

import request from 'supertest';
import app from '../index';
import {
  WebhookRegisterSchema,
  WebhookUpdateSchema,
  WEBHOOK_EVENT_TYPES,
} from '../middleware/validate';
import {
  WEBHOOK_SCHEMA_VERSION,
  registerWebhookEndpoint,
  emitTransactionEvent,
  resetWebhookState,
} from '../webhookDelivery';

const ADMIN_KEY = 'test-admin-key';

// ─── Zod schema unit tests ────────────────────────────────────────────────────

describe('WebhookRegisterSchema – Zod validation', () => {
  // ── happy paths ────────────────────────────────────────────────────────────

  it('accepts a minimal valid payload (url only)', () => {
    const result = WebhookRegisterSchema.safeParse({ url: 'https://example.com/hook' });
    expect(result.success).toBe(true);
  });

  it('accepts all valid optional fields', () => {
    const result = WebhookRegisterSchema.safeParse({
      url: 'https://example.com/hook',
      eventTypes: ['transaction.deposit.created'],
      enabled: false,
      secret: 'my-secret-key-123',
    });
    expect(result.success).toBe(true);
  });

  it('accepts both event types at once', () => {
    const result = WebhookRegisterSchema.safeParse({
      url: 'https://example.com/hook',
      eventTypes: WEBHOOK_EVENT_TYPES.slice(),
    });
    expect(result.success).toBe(true);
  });

  it('accepts http:// as well as https://', () => {
    const result = WebhookRegisterSchema.safeParse({ url: 'http://internal.service/hook' });
    expect(result.success).toBe(true);
  });

  // ── url validation ─────────────────────────────────────────────────────────

  it('rejects a missing url', () => {
    const result = WebhookRegisterSchema.safeParse({ enabled: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i: { path: (string | number)[] }) => i.path.join('.'));
      expect(fields).toContain('url');
    }
  });

  it('rejects an empty string url', () => {
    const result = WebhookRegisterSchema.safeParse({ url: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-URL string', () => {
    const result = WebhookRegisterSchema.safeParse({ url: 'not-a-url' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/valid http or https URL/);
    }
  });

  it('rejects ftp:// protocol', () => {
    const result = WebhookRegisterSchema.safeParse({ url: 'ftp://example.com/hook' });
    expect(result.success).toBe(false);
  });

  it('rejects a url longer than 2048 characters', () => {
    const result = WebhookRegisterSchema.safeParse({ url: 'https://example.com/' + 'a'.repeat(2050) });
    expect(result.success).toBe(false);
  });

  // ── eventTypes validation ──────────────────────────────────────────────────

  it('rejects an empty eventTypes array', () => {
    const result = WebhookRegisterSchema.safeParse({
      url: 'https://example.com/hook',
      eventTypes: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msgs = result.error.issues.map((i: { message: string }) => i.message);
      expect(msgs.some((m: string) => m.includes('at least one'))).toBe(true);
    }
  });

  it('rejects an unknown event type string', () => {
    const result = WebhookRegisterSchema.safeParse({
      url: 'https://example.com/hook',
      eventTypes: ['transaction.unknown.event'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-array eventTypes', () => {
    const result = WebhookRegisterSchema.safeParse({
      url: 'https://example.com/hook',
      eventTypes: 'transaction.deposit.created',
    });
    expect(result.success).toBe(false);
  });

  // ── secret validation ──────────────────────────────────────────────────────

  it('rejects a secret shorter than 8 characters', () => {
    const result = WebhookRegisterSchema.safeParse({
      url: 'https://example.com/hook',
      secret: 'short',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msgs = result.error.issues.map((i: { message: string }) => i.message);
      expect(msgs.some((m: string) => m.includes('at least 8'))).toBe(true);
    }
  });

  it('rejects a secret longer than 256 characters', () => {
    const result = WebhookRegisterSchema.safeParse({
      url: 'https://example.com/hook',
      secret: 'x'.repeat(257),
    });
    expect(result.success).toBe(false);
  });

  it('accepts a secret of exactly 8 characters', () => {
    const result = WebhookRegisterSchema.safeParse({
      url: 'https://example.com/hook',
      secret: '12345678',
    });
    expect(result.success).toBe(true);
  });

  // ── strict mode (no extra fields) ─────────────────────────────────────────

  it('rejects unknown fields (strict mode)', () => {
    const result = WebhookRegisterSchema.safeParse({
      url: 'https://example.com/hook',
      unknownField: 'should-fail',
    });
    expect(result.success).toBe(false);
  });

  // ── enabled validation ─────────────────────────────────────────────────────

  it('rejects a non-boolean enabled value', () => {
    const result = WebhookRegisterSchema.safeParse({
      url: 'https://example.com/hook',
      enabled: 'yes',
    });
    expect(result.success).toBe(false);
  });
});

// ─── WebhookUpdateSchema unit tests ──────────────────────────────────────────

describe('WebhookUpdateSchema – Zod validation', () => {
  it('accepts a single valid field', () => {
    expect(WebhookUpdateSchema.safeParse({ enabled: true }).success).toBe(true);
    expect(WebhookUpdateSchema.safeParse({ enabled: false }).success).toBe(true);
  });

  it('accepts a url update', () => {
    const result = WebhookUpdateSchema.safeParse({ url: 'https://new.example.com/hook' });
    expect(result.success).toBe(true);
  });

  it('accepts a secret update', () => {
    const result = WebhookUpdateSchema.safeParse({ secret: 'new-secret-key' });
    expect(result.success).toBe(true);
  });

  it('accepts an eventTypes update', () => {
    const result = WebhookUpdateSchema.safeParse({
      eventTypes: ['transaction.withdrawal.created'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts multiple fields at once', () => {
    const result = WebhookUpdateSchema.safeParse({
      enabled: true,
      secret: 'new-secret-key',
      eventTypes: ['transaction.deposit.created'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty body (no fields to update)', () => {
    const result = WebhookUpdateSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const msgs = result.error.issues.map((i: { message: string }) => i.message);
      expect(msgs.some((m: string) => m.includes('at least one field'))).toBe(true);
    }
  });

  it('rejects an empty eventTypes array', () => {
    const result = WebhookUpdateSchema.safeParse({ eventTypes: [] });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid event type in eventTypes', () => {
    const result = WebhookUpdateSchema.safeParse({
      eventTypes: ['transaction.bogus.event'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid url', () => {
    const result = WebhookUpdateSchema.safeParse({ url: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('rejects a secret shorter than 8 characters', () => {
    const result = WebhookUpdateSchema.safeParse({ secret: 'abc' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown fields (strict mode)', () => {
    const result = WebhookUpdateSchema.safeParse({
      enabled: true,
      injectedField: 'bad',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-boolean enabled', () => {
    const result = WebhookUpdateSchema.safeParse({ enabled: 1 });
    expect(result.success).toBe(false);
  });
});

// ─── POST /admin/webhooks – HTTP integration ──────────────────────────────────

describe('POST /admin/webhooks – input validation via HTTP', () => {
  it('returns 201 for a minimal valid payload', async () => {
    const res = await request(app)
      .post('/admin/webhooks')
      .set('Authorization', `ApiKey ${ADMIN_KEY}`)
      .send({ url: 'https://example.com/hook' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('endpoint');
    expect(res.body.endpoint).toHaveProperty('id');
    expect(res.body.endpoint).toHaveProperty('url', 'https://example.com/hook');
  });

  it('returns 201 for a full valid payload', async () => {
    const res = await request(app)
      .post('/admin/webhooks')
      .set('Authorization', `ApiKey ${ADMIN_KEY}`)
      .send({
        url: 'https://example.com/hook',
        eventTypes: ['transaction.deposit.created'],
        enabled: false,
        secret: 'supersecret123',
      });

    expect(res.status).toBe(201);
    expect(res.body.endpoint.hasSecret).toBe(true);
    // secret must never be echoed back
    expect(JSON.stringify(res.body)).not.toContain('supersecret123');
  });

  it('returns 400 when url is missing', async () => {
    const res = await request(app)
      .post('/admin/webhooks')
      .set('Authorization', `ApiKey ${ADMIN_KEY}`)
      .send({ enabled: true });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Bad Request');
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(res.body.errors).toBeInstanceOf(Array);
  });

  it('returns 400 when url is not a valid URL', async () => {
    const res = await request(app)
      .post('/admin/webhooks')
      .set('Authorization', `ApiKey ${ADMIN_KEY}`)
      .send({ url: 'not-a-url' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/valid http or https URL/);
  });

  it('returns 400 for an unsupported protocol', async () => {
    const res = await request(app)
      .post('/admin/webhooks')
      .set('Authorization', `ApiKey ${ADMIN_KEY}`)
      .send({ url: 'ftp://example.com/hook' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for an unknown event type', async () => {
    const res = await request(app)
      .post('/admin/webhooks')
      .set('Authorization', `ApiKey ${ADMIN_KEY}`)
      .send({ url: 'https://example.com/hook', eventTypes: ['transaction.unknown'] });

    expect(res.status).toBe(400);
    expect(res.body.errors.some((e: { field: string }) => e.field.startsWith('eventTypes'))).toBe(true);
  });

  it('returns 400 when eventTypes is an empty array', async () => {
    const res = await request(app)
      .post('/admin/webhooks')
      .set('Authorization', `ApiKey ${ADMIN_KEY}`)
      .send({ url: 'https://example.com/hook', eventTypes: [] });

    expect(res.status).toBe(400);
  });

  it('returns 400 when secret is too short', async () => {
    const res = await request(app)
      .post('/admin/webhooks')
      .set('Authorization', `ApiKey ${ADMIN_KEY}`)
      .send({ url: 'https://example.com/hook', secret: 'tiny' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/8 characters/);
  });

  it('returns 400 for unknown extra fields', async () => {
    const res = await request(app)
      .post('/admin/webhooks')
      .set('Authorization', `ApiKey ${ADMIN_KEY}`)
      .send({ url: 'https://example.com/hook', injected: 'bad' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when enabled is not a boolean', async () => {
    const res = await request(app)
      .post('/admin/webhooks')
      .set('Authorization', `ApiKey ${ADMIN_KEY}`)
      .send({ url: 'https://example.com/hook', enabled: 'yes' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when url is a number', async () => {
    const res = await request(app)
      .post('/admin/webhooks')
      .set('Authorization', `ApiKey ${ADMIN_KEY}`)
      .send({ url: 12345 });

    expect(res.status).toBe(400);
  });

  it('includes structured errors array in validation failure response', async () => {
    const res = await request(app)
      .post('/admin/webhooks')
      .set('Authorization', `ApiKey ${ADMIN_KEY}`)
      .send({ enabled: 'bad-value' });

    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.length).toBeGreaterThan(0);
    expect(res.body.errors[0]).toHaveProperty('code');
    expect(res.body.errors[0]).toHaveProperty('field');
    expect(res.body.errors[0]).toHaveProperty('message');
  });
});

// ─── PATCH /admin/webhooks/:id – HTTP integration ─────────────────────────────

describe('PATCH /admin/webhooks/:id – input validation via HTTP', () => {
  let endpointId: string;

  beforeEach(async () => {
    // Create a fresh endpoint to update in each test
    const res = await request(app)
      .post('/admin/webhooks')
      .set('Authorization', `ApiKey ${ADMIN_KEY}`)
      .send({ url: 'https://example.com/hook' });

    endpointId = res.body.endpoint.id as string;
  });

  it('returns 200 for a valid enabled update', async () => {
    const res = await request(app)
      .patch(`/admin/webhooks/${endpointId}`)
      .set('Authorization', `ApiKey ${ADMIN_KEY}`)
      .send({ enabled: false });

    expect(res.status).toBe(200);
    expect(res.body.endpoint.enabled).toBe(false);
  });

  it('returns 200 for a valid eventTypes update', async () => {
    const res = await request(app)
      .patch(`/admin/webhooks/${endpointId}`)
      .set('Authorization', `ApiKey ${ADMIN_KEY}`)
      .send({ eventTypes: ['transaction.deposit.created'] });

    expect(res.status).toBe(200);
    expect(res.body.endpoint.eventTypes).toEqual(['transaction.deposit.created']);
  });

  it('returns 400 for an empty body', async () => {
    const res = await request(app)
      .patch(`/admin/webhooks/${endpointId}`)
      .set('Authorization', `ApiKey ${ADMIN_KEY}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/at least one field/);
  });

  it('returns 400 for an invalid url in update', async () => {
    const res = await request(app)
      .patch(`/admin/webhooks/${endpointId}`)
      .set('Authorization', `ApiKey ${ADMIN_KEY}`)
      .send({ url: 'javascript://xss' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for an empty eventTypes array in update', async () => {
    const res = await request(app)
      .patch(`/admin/webhooks/${endpointId}`)
      .set('Authorization', `ApiKey ${ADMIN_KEY}`)
      .send({ eventTypes: [] });

    expect(res.status).toBe(400);
  });

  it('returns 400 for an unknown event type in update', async () => {
    const res = await request(app)
      .patch(`/admin/webhooks/${endpointId}`)
      .set('Authorization', `ApiKey ${ADMIN_KEY}`)
      .send({ eventTypes: ['transaction.bogus'] });

    expect(res.status).toBe(400);
  });

  it('returns 400 for a secret shorter than 8 chars', async () => {
    const res = await request(app)
      .patch(`/admin/webhooks/${endpointId}`)
      .set('Authorization', `ApiKey ${ADMIN_KEY}`)
      .send({ secret: 'abc' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for unknown extra fields', async () => {
    const res = await request(app)
      .patch(`/admin/webhooks/${endpointId}`)
      .set('Authorization', `ApiKey ${ADMIN_KEY}`)
      .send({ enabled: true, injected: 'bad' });

    expect(res.status).toBe(400);
  });

  it('returns 404 for a non-existent endpoint id', async () => {
    const res = await request(app)
      .patch('/admin/webhooks/wh_nonexistent')
      .set('Authorization', `ApiKey ${ADMIN_KEY}`)
      .send({ enabled: false });

    expect(res.status).toBe(404);
  });

  it('includes structured errors in validation failure response', async () => {
    const res = await request(app)
      .patch(`/admin/webhooks/${endpointId}`)
      .set('Authorization', `ApiKey ${ADMIN_KEY}`)
      .send({ enabled: 'not-a-bool' });

    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.errors)).toBe(true);
  });
});

// ─── Schema versioning ────────────────────────────────────────────────────────

describe('WEBHOOK_SCHEMA_VERSION', () => {
  it('is exported as a positive integer', () => {
    expect(typeof WEBHOOK_SCHEMA_VERSION).toBe('number');
    expect(Number.isInteger(WEBHOOK_SCHEMA_VERSION)).toBe(true);
    expect(WEBHOOK_SCHEMA_VERSION).toBeGreaterThan(0);
  });

  it('is currently at version 1', () => {
    // This test pins the current version — a deliberate bump must update this test too.
    expect(WEBHOOK_SCHEMA_VERSION).toBe(1);
  });
});

describe('Webhook envelope includes schemaVersion', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetWebhookState();
    process.env.WEBHOOK_ALLOW_UNVERIFIED = 'true';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.WEBHOOK_ALLOW_UNVERIFIED;
  });

  it('emitted envelope contains schemaVersion matching WEBHOOK_SCHEMA_VERSION', async () => {
    const capturedBodies: unknown[] = [];

    global.fetch = jest.fn(async (_url, init) => {
      capturedBodies.push(JSON.parse(String(init?.body ?? '{}')));
      return { ok: true, status: 200 } as Response;
    }) as typeof fetch;

    registerWebhookEndpoint({
      url: 'https://example.com/hook',
      enabled: true,
    });

    await emitTransactionEvent('transaction.deposit.created', {
      transactionId: 'tx-versioning-1',
      amount: '100',
      asset: 'USDC',
      walletAddress: `G${'A'.repeat(55)}`,
      transactionHash: '0xabc',
      status: 'pending',
      timestamp: new Date().toISOString(),
    });

    // Allow the async delivery to fire
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(capturedBodies.length).toBeGreaterThanOrEqual(1);
    const envelope = capturedBodies[capturedBodies.length - 1] as Record<string, unknown>;
    expect(envelope).toHaveProperty('schemaVersion', WEBHOOK_SCHEMA_VERSION);
  });

  it('envelope contains the expected top-level fields', async () => {
    const capturedBodies: unknown[] = [];

    global.fetch = jest.fn(async (_url, init) => {
      capturedBodies.push(JSON.parse(String(init?.body ?? '{}')));
      return { ok: true, status: 200 } as Response;
    }) as typeof fetch;

    registerWebhookEndpoint({ url: 'https://example.com/hook', enabled: true });

    await emitTransactionEvent('transaction.withdrawal.created', {
      transactionId: 'tx-shape-1',
      amount: '50',
      asset: 'USDC',
      walletAddress: `G${'B'.repeat(55)}`,
      transactionHash: '0xdef',
      status: 'completed',
      timestamp: new Date().toISOString(),
    });

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const envelope = capturedBodies[capturedBodies.length - 1] as Record<string, unknown>;
    expect(envelope).toHaveProperty('schemaVersion');
    expect(envelope).toHaveProperty('eventType', 'transaction.withdrawal.created');
    expect(envelope).toHaveProperty('sentAt');
    expect(envelope).toHaveProperty('payload');
    expect(typeof (envelope.payload as Record<string, unknown>).transactionId).toBe('string');
  });

  it('schemaVersion is a number (not a string) in the envelope', async () => {
    const capturedBodies: unknown[] = [];

    global.fetch = jest.fn(async (_url, init) => {
      capturedBodies.push(JSON.parse(String(init?.body ?? '{}')));
      return { ok: true, status: 200 } as Response;
    }) as typeof fetch;

    registerWebhookEndpoint({ url: 'https://example.com/hook', enabled: true });

    await emitTransactionEvent('transaction.deposit.created', {
      transactionId: 'tx-type-check-1',
      amount: '10',
      asset: 'USDC',
      walletAddress: `G${'C'.repeat(55)}`,
      transactionHash: '0x123',
      status: 'pending',
      timestamp: new Date().toISOString(),
    });

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const envelope = capturedBodies[capturedBodies.length - 1] as Record<string, unknown>;
    expect(typeof envelope.schemaVersion).toBe('number');
  });
});

// ─── WEBHOOK_EVENT_TYPES constant ─────────────────────────────────────────────

describe('WEBHOOK_EVENT_TYPES', () => {
  it('contains transaction and vault event types', () => {
    expect(WEBHOOK_EVENT_TYPES).toContain('transaction.deposit.created');
    expect(WEBHOOK_EVENT_TYPES).toContain('transaction.withdrawal.created');
    expect(WEBHOOK_EVENT_TYPES).toContain('vault.deposit.created');
    expect(WEBHOOK_EVENT_TYPES).toContain('vault.withdrawal.created');
    expect(WEBHOOK_EVENT_TYPES).toContain('vault.strategy.changed');
  });

  it('has exactly 5 entries (keep this pinned to catch accidental additions)', () => {
    expect(WEBHOOK_EVENT_TYPES).toHaveLength(5);
  });
});
