import express from 'express';
import request from 'supertest';
import healthRouter, { setRedisClient } from '../routes/health';

const mockPing = jest.fn();

beforeEach(() => {
  setRedisClient({ ping: mockPing });
});

afterEach(() => {
  setRedisClient(null);
});

describe('GET /ready', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(healthRouter);
    jest.clearAllMocks();
    mockPing.mockResolvedValue('PONG');
  });

  it('returns 200 when all dependencies are up', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe[200);
    expect(res.body.ready).toBe(true);
    expect(res.body.checks.redis.status).toBe('up');
  });

  it('returns 503 when redis.ping throws', async () => {
    mockPing.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.checks.redis.status).toBe('down');
  });

  it('returns 503 when redis.ping times out', async () => {
    mockPing.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve('PONG'), 1000)));
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.checks.redis.status).toBe('down');
  });
});
