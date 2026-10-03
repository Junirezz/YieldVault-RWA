import request from 'supertest';
import app, { shutdownHandler } from '../index';

describe('shutdown gate middleware', () => {
  afterEach(() => {
    // Reach past the public API to reset internal state between tests —
    // isShuttingDown() has no public setter by design (it should only ever
    // flip via a real SIGTERM/SIGINT).
    (shutdownHandler as unknown as { shuttingDown: boolean }).shuttingDown = false;
  });

  it('serves normal routes and returns 200 on /health before shutdown begins', async () => {
    expect(shutdownHandler.isShuttingDown()).toBe(false);

    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    const summary = await request(app).get('/api/v1/vault/summary');
    expect(summary.status).not.toBe(503);
  });

  it('rejects new requests with 503 + Retry-After once shutdown begins, but keeps serving /health', async () => {
    (shutdownHandler as unknown as { shuttingDown: boolean }).shuttingDown = true;

    const summary = await request(app).get('/api/v1/vault/summary');
    expect(summary.status).toBe(503);
    expect(summary.headers['retry-after']).toBe('10');
    expect(summary.body.code).toBe('SHUTTING_DOWN');

    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
  });
});
