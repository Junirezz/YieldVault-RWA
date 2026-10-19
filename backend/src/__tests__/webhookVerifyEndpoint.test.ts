import request from 'supertest';
import app from '../index';
import { registerApiKey } from '../middleware/apiKeyAuth';
import { logger } from '../middleware/structuredLogging';

describe('POST /webhooks/verify and /api/v1/webhooks/verify (Issue #1608)', () => {
  const adminKey = 'webhook-verify-admin-key';
  const authHeader = { Authorization: `ApiKey ${adminKey}` };

  beforeAll(() => {
    registerApiKey(adminKey, { role: 'admin', scopes: ['webhooks', 'admin'] });
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res1 = await request(app)
      .post('/webhooks/verify')
      .send({ secret: 'my-secret', payload: { event: 'test' } });

    expect(res1.status).toBe(401);

    const res2 = await request(app)
      .post('/api/v1/webhooks/verify')
      .send({ secret: 'my-secret', payload: { event: 'test' } });

    expect(res2.status).toBe(401);
  });

  it('computes HMAC signature and verifies correctly for authenticated admin', async () => {
    const secret = 'super-secret-hmac-key';
    const payload = { event: 'deposit.completed', amount: '100' };

    const res = await request(app)
      .post('/api/v1/webhooks/verify')
      .set(authHeader)
      .send({ secret, payload });

    expect(res.status).toBe(200);
    expect(res.body.algorithm).toBe('HMAC-SHA256');
    expect(res.body.signature).toBeDefined();
    expect(typeof res.body.signature).toBe('string');
  });

  it('collapses into single handler with identical behavior across both paths', async () => {
    const secret = 'shared-secret-123';
    const payload = { action: 'ping' };

    const resUnversioned = await request(app)
      .post('/webhooks/verify')
      .set(authHeader)
      .send({ secret, payload });

    const resVersioned = await request(app)
      .post('/api/v1/webhooks/verify')
      .set(authHeader)
      .send({ secret, payload });

    expect(resUnversioned.status).toBe(200);
    expect(resVersioned.status).toBe(200);
    expect(resUnversioned.body.signature).toBe(resVersioned.body.signature);
  });

  it('never leaks caller-supplied secret into logs', async () => {
    const secret = 'secret-canary-never-log-this-value-xyz987';
    const payload = { canary: true };

    const logSpy = jest.spyOn(logger, 'log');
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await request(app)
      .post('/api/v1/webhooks/verify')
      .set(authHeader)
      .send({ secret, payload });

    for (const call of logSpy.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain(secret);
    }

    for (const call of consoleSpy.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain(secret);
    }

    logSpy.mockRestore();
    consoleSpy.mockRestore();
  });
});
