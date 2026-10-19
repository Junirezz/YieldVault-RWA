import express from 'express';
import request from 'supertest';
import auditLogRouter from '../auditLogEndpoints';

const app = express();
app.use('/audit-logs', auditLogRouter);

describe('GET /audit-logs', () => {
  it('returns entries with pagination metadata', async () => {
    const res = await request(app).get('/audit-logs');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(4);
    expect(res.body.pagination).toMatchObject({ count: 4, limit: 20, total: 4 });
  });

  it('filters by operation and actor (case-insensitive)', async () => {
    const byOp = await request(app).get('/audit-logs').query({ operation: 'deposit' });
    expect(byOp.body.data.map((e: any) => e.operation)).toEqual(['deposit']);

    const byActor = await request(app).get('/audit-logs').query({ actor: 'gdef' });
    expect(byActor.body.data).toHaveLength(2);
  });

  it('caps limit at 100 and honours smaller limits', async () => {
    const res = await request(app).get('/audit-logs').query({ limit: 2 });
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.hasNextPage).toBe(true);

    const big = await request(app).get('/audit-logs').query({ limit: 9999 });
    expect(big.body.pagination.limit).toBe(100);
  });
});
