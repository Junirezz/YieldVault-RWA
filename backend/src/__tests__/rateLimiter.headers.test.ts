import express, { Request, Response } from 'express';
import request from 'supertest';
import {
  createLimiter,
  composeLimiters,
  extractRateLimitApiKeyKey,
  extractRateLimitIpKey,
  getRateLimitMonitorSnapshot,
  identityRateLimiter,
  resetRateLimitMonitor,
} from '../rateLimiter';

describe('X-RateLimit headers', () => {
  beforeEach(() => {
    resetRateLimitMonitor();
  });

  it('sets X-RateLimit-Limit, Remaining, and Reset on allowed requests', async () => {
    const app = express();
    app.get(
      '/test',
      createLimiter({ tier: 'reads', max: 5, windowMs: 60000 }),
      (_req: Request, res: Response) => {
        res.json({ ok: true });
      },
    );

    const res = await request(app).get('/test').set('x-api-key', 'header-key');
    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBe('5');
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    expect(res.headers['x-ratelimit-reset']).toBeDefined();
  });

  it('keeps X-RateLimit headers on 429 responses', async () => {
    const app = express();
    app.get(
      '/test',
      createLimiter({ tier: 'reads', max: 1, windowMs: 60000 }),
      (_req: Request, res: Response) => {
        res.json({ ok: true });
      },
    );

    await request(app).get('/test').set('x-api-key', 'limit-key');
    const res = await request(app).get('/test').set('x-api-key', 'limit-key');
    expect(res.status).toBe(429);
    expect(res.headers['x-ratelimit-limit']).toBe('1');
    expect(res.headers['retry-after']).toBeDefined();
  });
});

describe('IP and API-key identity limiting', () => {
  beforeEach(() => {
    resetRateLimitMonitor();
  });

  it('extracts the API key from x-api-key', () => {
    const req = {
      headers: { 'x-api-key': 'vault-key' },
    } as unknown as Request;
    expect(extractRateLimitApiKeyKey(req)).toBe('vault-key');
  });

  it('enforces IP and API-key buckets independently', async () => {
    const app = express();
    app.set('trust proxy', true);
    app.use(identityRateLimiter);
    app.get('/test', (_req: Request, res: Response) => {
      res.json({ ok: true });
    });

    const first = await request(app)
      .get('/test')
      .set('X-Forwarded-For', '10.0.0.8')
      .set('x-api-key', 'partner-a');
    expect(first.status).toBe(200);

    const second = await request(app)
      .get('/test')
      .set('X-Forwarded-For', '10.0.0.9')
      .set('x-api-key', 'partner-b');
    expect(second.status).toBe(200);
  });

  it('rate-limits a shared API key even when the IP changes', async () => {
    const limiter = composeLimiters(
      createLimiter({ tier: 'ip-test', max: 50, windowMs: 60000 }, extractRateLimitIpKey),
      createLimiter({ tier: 'apikey-test', max: 1, windowMs: 60000 }, extractRateLimitApiKeyKey),
    );
    const app = express();
    app.set('trust proxy', true);
    app.use(limiter);
    app.get('/test', (_req: Request, res: Response) => {
      res.json({ ok: true });
    });

    const first = await request(app)
      .get('/test')
      .set('X-Forwarded-For', '10.1.0.1')
      .set('x-api-key', 'shared-partner');
    expect(first.status).toBe(200);

    const limited = await request(app)
      .get('/test')
      .set('X-Forwarded-For', '10.1.0.2')
      .set('x-api-key', 'shared-partner');
    expect(limited.status).toBe(429);
    expect(limited.headers['x-ratelimit-limit']).toBe('1');
  });

  it('records allow and reject events for monitoring', async () => {
    const app = express();
    app.get(
      '/test',
      createLimiter({ tier: 'auth', max: 1, windowMs: 60000 }),
      (_req: Request, res: Response) => {
        res.json({ ok: true });
      },
    );

    await request(app).get('/test').set('x-api-key', 'monitor-key');
    await request(app).get('/test').set('x-api-key', 'monitor-key');

    const snapshot = getRateLimitMonitorSnapshot();
    expect(snapshot.allowed).toBeGreaterThanOrEqual(1);
    expect(snapshot.limited).toBeGreaterThanOrEqual(1);
    expect(snapshot.byTier.auth.limited).toBeGreaterThanOrEqual(1);
  });
});
