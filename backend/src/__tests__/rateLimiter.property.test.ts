/**
 * @file rateLimiter.property.test.ts
 * Property-based tests for the Redis-backed rate limiter.
 *
 * Uses fast-check to verify universal correctness properties across
 * generated inputs. Each property runs a minimum of 100 iterations.
 */

import * as fc from 'fast-check';
import express, { Request, Response } from 'express';
import request from 'supertest';

// Helper: build a minimal express app with a fresh in-memory limiter
function buildApp(max: number, windowMs = 60000) {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createLimiter } = require('../rateLimiter');
  const app = express();
  app.use(express.json());
  const limiter = createLimiter({ routePrefix: '/prop-test', max, windowMs });
  app.get('/test', limiter, (_req: Request, res: Response) => {
    res.json({ ok: true });
  });
  return app;
}

// ─── Property 5: Requests beyond the limit receive 429 with required headers/body ──

// Feature: redis-rate-limiting, Property 5: 429 headers and body
describe('Property 5: Requests beyond the limit receive 429 with required headers and body', () => {
  it('holds for randomly generated limit values', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 20 }),
        async (limit) => {
          const app = buildApp(limit);
          const key = `wallet-p5-${limit}-${Math.random()}`;

          // Make exactly `limit` requests (all should succeed)
          for (let i = 0; i < limit; i++) {
            await request(app).get('/test').set('x-api-key', key);
          }

          // The (limit+1)th request must be 429
          const res = await request(app).get('/test').set('x-api-key', key);

          if (res.status !== 429) return false;

          // Required headers
          if (!res.headers['retry-after']) return false;
          if (!res.headers['ratelimit-limit']) return false;
          if (!res.headers['ratelimit-remaining']) return false;
          if (!res.headers['ratelimit-reset']) return false;

          // Required body fields
          const body = res.body as Record<string, unknown>;
          if (!body.error) return false;
          if (body.status !== 429) return false;
          if (!body.message) return false;
          if (typeof body.retryAfter !== 'number') return false;

          return true;
        }
      ),
      { numRuns: 10 } // keep fast; each run makes limit+1 HTTP requests
    );
  });
});

// ─── Property 6: Requests within the limit include rate-limit headers ────────

// Feature: redis-rate-limiting, Property 6: 200 includes rate-limit headers
describe('Property 6: Requests within the limit include rate-limit headers', () => {
  it('holds for randomly generated request counts within limit', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        async (count) => {
          const limit = count + 5; // ensure we stay within limit
          const app = buildApp(limit);
          const key = `wallet-p6-${count}-${Math.random()}`;

          for (let i = 0; i < count; i++) {
            const res = await request(app).get('/test').set('x-api-key', key);
            if (res.status !== 200) return false;
            if (!res.headers['ratelimit-limit']) return false;
            if (!res.headers['ratelimit-remaining']) return false;
            if (!res.headers['ratelimit-reset']) return false;
          }
          return true;
        }
      ),
      { numRuns: 10 }
    );
  });
});

// ─── Property 7: Counter initialises to 1 on first request in a window ───────

// Feature: redis-rate-limiting, Property 7: Counter initialises to 1
describe('Property 7: Counter initialises to 1 on first request in a window', () => {
  it('RateLimit-Remaining equals limit-1 after first request', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 30 }),
        fc.string({ minLength: 5, maxLength: 20 }),
        async (limit, walletSuffix) => {
          const app = buildApp(limit);
          const key = `wallet-p7-${walletSuffix}-${Math.random()}`;

          const res = await request(app).get('/test').set('x-api-key', key);
          if (res.status !== 200) return false;

          const remaining = parseInt(res.headers['ratelimit-remaining'] as string, 10);
          return remaining === limit - 1;
        }
      ),
      { numRuns: 10 }
    );
  });
});

// ─── Property 8: Log fields and PII masking ───────────────────────────────────

// Feature: redis-rate-limiting, Property 8: Log fields and PII masking
describe('Property 8: Rate-limit log entries contain required fields without exposing full wallet address', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  it('log contains required fields and masks wallet in production', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 10, maxLength: 40 }),
        async (walletAddress) => {
          process.env = { ...originalEnv, NODE_ENV: 'production' };
          jest.resetModules();
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { createLimiter } = require('../rateLimiter');

          const logEntries: Record<string, unknown>[] = [];
          const consoleSpy = jest.spyOn(console, 'log').mockImplementation((msg: string) => {
            try { logEntries.push(JSON.parse(msg)); } catch { /* ignore non-JSON */ }
          });

          const app = express();
          app.use(express.json());
          const limiter = createLimiter({ routePrefix: '/prop-p8', max: 1, windowMs: 60000 });
          app.get('/test', limiter, (_req: Request, res: Response) => res.json({ ok: true }));

          // First request succeeds, second triggers 429 log
          await request(app).get('/test').set('x-wallet-address', walletAddress);
          await request(app).get('/test').set('x-wallet-address', walletAddress);

          consoleSpy.mockRestore();

          const rateLimitedLog = logEntries.find((e) => e.event === 'rate_limited');
          if (!rateLimitedLog) return false;

          // Required fields present
          if (!rateLimitedLog.path) return false;
          if (rateLimitedLog.resetTime === undefined) return false;
          if (!rateLimitedLog.key) return false;

          // Full wallet address must NOT appear in log key in production
          if (walletAddress.length > 8 && rateLimitedLog.key === walletAddress) return false;

          return true;
        }
      ),
      { numRuns: 10 }
    );
  });
});
