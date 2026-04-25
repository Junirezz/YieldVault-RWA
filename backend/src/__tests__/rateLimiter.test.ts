/**
 * @file rateLimiter.test.ts
 * Unit tests for the Redis-backed rate limiter module.
 */

import express, { Request, Response } from 'express';
import request from 'supertest';

// ─── extractRateLimitKey ─────────────────────────────────────────────────────

describe('extractRateLimitKey', () => {
  let extractRateLimitKey: (req: Request) => string;

  beforeEach(() => {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ extractRateLimitKey } = require('../rateLimiter'));
  });

  const makeReq = (overrides: Partial<{
    body: Record<string, unknown>;
    headers: Record<string, string>;
    ip: string;
  }> = {}): Request => ({
    body: overrides.body ?? {},
    headers: overrides.headers ?? {},
    ip: overrides.ip ?? '',
  } as unknown as Request);

  it('returns walletAddress from body when present', () => {
    const req = makeReq({ body: { walletAddress: 'GABC123' } });
    expect(extractRateLimitKey(req)).toBe('GABC123');
  });

  it('returns x-wallet-address header when body wallet absent', () => {
    const req = makeReq({ headers: { 'x-wallet-address': 'GXYZ789' } });
    expect(extractRateLimitKey(req)).toBe('GXYZ789');
  });

  it('returns x-api-key header when no wallet address', () => {
    const req = makeReq({ headers: { 'x-api-key': 'my-api-key' } });
    expect(extractRateLimitKey(req)).toBe('my-api-key');
  });

  it('returns req.ip when no wallet or api key', () => {
    const req = makeReq({ ip: '192.168.1.1' });
    expect(extractRateLimitKey(req)).toBe('192.168.1.1');
  });

  it("returns 'unknown' when nothing is present", () => {
    const req = makeReq({ ip: '' });
    expect(extractRateLimitKey(req)).toBe('unknown');
  });

  it('body walletAddress takes priority over x-wallet-address header', () => {
    const req = makeReq({
      body: { walletAddress: 'GBODY' },
      headers: { 'x-wallet-address': 'GHEADER' },
    });
    expect(extractRateLimitKey(req)).toBe('GBODY');
  });

  it('x-wallet-address header takes priority over x-api-key', () => {
    const req = makeReq({
      headers: { 'x-wallet-address': 'GWALLET', 'x-api-key': 'apikey' },
    });
    expect(extractRateLimitKey(req)).toBe('GWALLET');
  });
});

// ─── buildRedisKey ───────────────────────────────────────────────────────────

describe('buildRedisKey', () => {
  let buildRedisKey: (routePrefix: string, identifier: string) => string;

  beforeEach(() => {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ buildRedisKey } = require('../rateLimiter'));
  });

  it('returns rl:{prefix}:{identifier} format', () => {
    expect(buildRedisKey('/api/v1/vault/deposits', 'GABC')).toBe(
      'rl:/api/v1/vault/deposits:GABC'
    );
  });

  it('works with various prefixes and identifiers', () => {
    expect(buildRedisKey('/api/v1', '127.0.0.1')).toBe('rl:/api/v1:127.0.0.1');
    expect(buildRedisKey('/api/v1/vault/summary', 'unknown')).toBe(
      'rl:/api/v1/vault/summary:unknown'
    );
  });

  it('contains the prefix as a substring', () => {
    const prefix = '/api/v1/vault/deposits';
    const key = buildRedisKey(prefix, 'GTEST');
    expect(key).toContain(prefix);
  });
});

// ─── loadConfig ──────────────────────────────────────────────────────────────

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    // Clear all rate limit env vars
    delete process.env.DEPOSITS_RATE_LIMIT_MAX;
    delete process.env.DEPOSITS_RATE_LIMIT_WINDOW_MS;
    delete process.env.SUMMARY_RATE_LIMIT_MAX;
    delete process.env.SUMMARY_RATE_LIMIT_WINDOW_MS;
    delete process.env.API_RATE_LIMIT_MAX_REQUESTS;
    delete process.env.API_RATE_LIMIT_WINDOW_MS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns compiled-in defaults when env vars absent', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loadConfig } = require('../rateLimiter');
    const cfg = loadConfig();
    expect(cfg.deposits.max).toBe(10);
    expect(cfg.deposits.windowMs).toBe(60000);
    expect(cfg.summary.max).toBe(30);
    expect(cfg.summary.windowMs).toBe(60000);
    expect(cfg.default.max).toBe(30);
    expect(cfg.default.windowMs).toBe(60000);
  });

  it('reads valid numeric env vars correctly', () => {
    process.env.DEPOSITS_RATE_LIMIT_MAX = '5';
    process.env.SUMMARY_RATE_LIMIT_MAX = '15';
    process.env.API_RATE_LIMIT_MAX_REQUESTS = '20';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loadConfig } = require('../rateLimiter');
    const cfg = loadConfig();
    expect(cfg.deposits.max).toBe(5);
    expect(cfg.summary.max).toBe(15);
    expect(cfg.default.max).toBe(20);
  });

  it('falls back to defaults for non-numeric env vars', () => {
    process.env.DEPOSITS_RATE_LIMIT_MAX = 'abc';
    process.env.SUMMARY_RATE_LIMIT_MAX = 'NaN';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loadConfig } = require('../rateLimiter');
    const cfg = loadConfig();
    expect(cfg.deposits.max).toBe(10);
    expect(cfg.summary.max).toBe(30);
  });
});

// ─── maskWalletAddress ───────────────────────────────────────────────────────

describe('maskWalletAddress', () => {
  let maskWalletAddress: (addr: string) => string;
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  it('returns full address in non-production', () => {
    process.env = { ...originalEnv, NODE_ENV: 'test' };
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ maskWalletAddress } = require('../rateLimiter'));
    expect(maskWalletAddress('GABCDEFGHIJKLMNOP')).toBe('GABCDEFGHIJKLMNOP');
  });

  it('truncates address in production (first 4 + ... + last 4)', () => {
    process.env = { ...originalEnv, NODE_ENV: 'production' };
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ maskWalletAddress } = require('../rateLimiter'));
    expect(maskWalletAddress('GABCDEFGHIJKLMNOP')).toBe('GABC...MNOP');
  });

  it('returns short addresses as-is even in production', () => {
    process.env = { ...originalEnv, NODE_ENV: 'production' };
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ maskWalletAddress } = require('../rateLimiter'));
    expect(maskWalletAddress('GABC')).toBe('GABC');
  });
});

// ─── 429 response body and Retry-After header ────────────────────────────────

describe('429 response shape', () => {
  it('returns correct body and Retry-After header when limit exceeded', async () => {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createLimiter } = require('../rateLimiter');

    const app = express();
    app.use(express.json());
    // Limit to 1 request per minute
    app.get('/test', createLimiter({ routePrefix: '/test', max: 1, windowMs: 60000 }), (
      _req: Request,
      res: Response
    ) => {
      res.json({ ok: true });
    });

    // First request — should succeed
    await request(app).get('/test').set('x-api-key', 'wallet-429-test');

    // Second request — should be rate limited
    const res = await request(app).get('/test').set('x-api-key', 'wallet-429-test');

    expect(res.status).toBe(429);
    expect(res.body).toHaveProperty('error', 'Rate limit exceeded');
    expect(res.body).toHaveProperty('status', 429);
    expect(res.body).toHaveProperty('message');
    expect(res.body).toHaveProperty('retryAfter');
    expect(typeof res.body.retryAfter).toBe('number');
    expect(res.headers).toHaveProperty('retry-after');
  });
});

// ─── Fail-open behaviour ─────────────────────────────────────────────────────

describe('fail-open behaviour', () => {
  it('passes requests through when Redis is configured but unavailable', async () => {
    jest.resetModules();

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rateLimiterModule = require('../rateLimiter');
    // Simulate Redis configured but not ready
    jest.spyOn(rateLimiterModule.redisClientManager, 'isReady').mockReturnValue(false);
    jest.spyOn(rateLimiterModule.redisClientManager, 'getClient').mockReturnValue({} as never);

    const limiter = rateLimiterModule.createLimiter({
      routePrefix: '/test-failopen',
      max: 1,
      windowMs: 60000,
    });

    const app = express();
    app.use(express.json());
    app.get('/test', limiter, (_req: Request, res: Response) => {
      res.json({ ok: true });
    });

    // Both requests should pass through (fail-open)
    const res1 = await request(app).get('/test').set('x-api-key', 'failopen-key');
    const res2 = await request(app).get('/test').set('x-api-key', 'failopen-key');

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });
});

// ─── Redis connection log events ─────────────────────────────────────────────

describe('Redis connection log events', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  it('logs redis_not_configured warn when REDIS_URL is absent', () => {
    process.env = { ...originalEnv };
    delete process.env.REDIS_URL;

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../rateLimiter');

    const calls = consoleSpy.mock.calls.map((c) => {
      try { return JSON.parse(c[0] as string); } catch { return null; }
    });
    expect(calls.some((c) => c?.event === 'redis_not_configured' && c?.level === 'warn')).toBe(true);
    consoleSpy.mockRestore();
  });
});
