import request from 'supertest';
import app from '../index';
import { idempotencyStore } from '../idempotency';
import { getJobMetrics, resetJobGovernance, runJobWithRetry } from '../jobGovernance';

describe('Backend governance', () => {
  beforeEach(() => {
    idempotencyStore.clear();
    resetJobGovernance();
  });

  it('redirects unversioned API routes to v1', async () => {
    const response = await request(app).get('/api/vault/summary');

    expect(response.status).toBe(308);
    expect(response.headers.location).toBe('/api/v1/vault/summary');
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
});