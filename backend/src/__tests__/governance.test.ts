import request from 'supertest';
import app from '../index';
import { idempotencyStore } from '../idempotency';
import { getJobMetrics, resetJobGovernance, runJobWithRetry } from '../jobGovernance';
import { clearAdminAuditLogsForTests } from '../adminAudit';
import { registerApiKey } from '../middleware/apiKeyAuth';

describe('Backend governance', () => {
  const adminApiKey = 'admin-test-key';

  beforeEach(() => {
    idempotencyStore.clear();
    resetJobGovernance();
    clearAdminAuditLogsForTests();
    process.env.ADMIN_AUDIT_LOG_STORAGE = 'memory';
    registerApiKey(adminApiKey);
  });

  it('marks unversioned summary route as deprecated while preserving compatibility', async () => {
    const response = await request(app).get('/api/vault/summary');

    expect([200, 429]).toContain(response.status);
    expect(response.headers.deprecation).toBe('true');
  });

  it('replays deposit mutations for the same idempotency key', async () => {
    const payload = {
      amount: 250,
      asset: 'USDC',
      walletAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz234567',
    };

    const first = await request(app)
      .post('/api/v1/vault/deposits')
      .set('x-idempotency-key', 'deposit-key-1')
      .send(payload);

    const second = await request(app)
      .post('/api/v1/vault/deposits')
      .set('x-idempotency-key', 'deposit-key-1')
      .send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotency-status']).toBe('replayed');
  });

  it('rejects conflicting requests that reuse the same idempotency key', async () => {
    const first = await request(app)
      .post('/api/v1/vault/deposits')
      .set('x-idempotency-key', 'deposit-key-2')
      .send({
        amount: 250,
        asset: 'USDC',
        walletAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz234567',
      });

    const second = await request(app)
      .post('/api/v1/vault/deposits')
      .set('x-idempotency-key', 'deposit-key-2')
      .send({
        amount: 300,
        asset: 'USDC',
        walletAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz234567',
      });

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
  });

  it('retries jobs according to policy and dead-letters after exhaustion', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    let attempts = 0;

    await expect(
      runJobWithRetry(
        'priceRefresh',
        async () => {
          attempts += 1;
          throw new Error('boom');
        },
        {
          payload: { jobId: 'job-1' },
          sleep,
        }
      )
    ).rejects.toThrow('boom');

    expect(attempts).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);

    const metrics = getJobMetrics();
    expect(metrics.totalDeadLetters).toBe(1);
    expect(metrics.failureCounts.priceRefresh).toBe(1);
    expect(metrics.deadLetters[0]).toMatchObject({
      jobName: 'priceRefresh',
      attempts: 3,
    });
  });

  it('exposes a background jobs monitoring dashboard for admins', async () => {
    await expect(
      runJobWithRetry(
        'priceRefresh',
        async () => {
          throw new Error('job failed');
        },
        {
          payload: { source: 'test-suite' },
          sleep: async () => undefined,
        }
      )
    ).rejects.toThrow('job failed');

    const response = await request(app)
      .get('/admin/jobs/metrics')
      .set('Authorization', `ApiKey ${adminApiKey}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('summary');
    expect(response.body).toHaveProperty('metrics');
    expect(response.body).toHaveProperty('prisma');
    expect(response.body.metrics.totalDeadLetters).toBeGreaterThanOrEqual(1);
  });

  it('returns admin audit logs for authenticated admins', async () => {
    await request(app)
      .get('/admin/cache/stats')
      .set('Authorization', `ApiKey ${adminApiKey}`)
      .set('x-admin-id', 'ops-user-1');

    const response = await request(app)
      .get('/admin/audit-logs')
      .set('Authorization', `ApiKey ${adminApiKey}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data.length).toBeGreaterThan(0);
    expect(response.body.data[0]).toHaveProperty('action');
    expect(response.body.data[0]).toHaveProperty('method');
    expect(response.body.data[0]).toHaveProperty('statusCode');
  });
});