/**
 * @file rateLimiter.auth_transfer.test.ts
 * Integration tests for request-level rate limiting on Auth and Transfer APIs (#887).
 */

// This file tests the deposits tier's real, tight default (10 req/min), so it
// must restore that default here — setup.ts globally raises
// DEPOSITS_RATE_LIMIT_MAX for every other integration test file, since most
// of them just exercise deposit/withdrawal routes incidentally and aren't
// testing rate limiting at all. Must run before importing rateLimiter, whose
// singleton limiters read this value once at module-load time.
process.env.DEPOSITS_RATE_LIMIT_MAX = '10';

import request from 'supertest';
import express, { Request, Response } from 'express';
import { authLimiter, depositsLimiter } from '../rateLimiter';

describe('Auth & Transfer Request-Level Rate Limiting (#887)', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    // Mount Auth Endpoints under route matching harness (/auth)
    app.post('/auth', authLimiter, (req: Request, res: Response) => {
      res.status(200).json({ ok: true });
    });

    // Mount Transfer Endpoints
    app.post('/api/v1/vault/deposits', depositsLimiter, (req: Request, res: Response) => {
      res.status(201).json({ txHash: '0x123' });
    });
    app.post('/api/v1/vault/withdrawals', depositsLimiter, (req: Request, res: Response) => {
      res.status(201).json({ txHash: '0x456' });
    });
  });

  describe('Auth Endpoints Rate Limiting', () => {
    it('enforces rate limit on /auth endpoint', async () => {
      const clientIp = '192.168.1.100';
      // Default auth max is 5 requests per window
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post('/auth')
          .set('X-Forwarded-For', clientIp)
          .send({ walletAddress: 'GABC123' });
        expect(res.status).toBe(200);
      }

      const limitedRes = await request(app)
        .post('/auth')
        .set('X-Forwarded-For', clientIp)
        .send({ walletAddress: 'GABC123' });

      expect(limitedRes.status).toBe(429);
      expect(limitedRes.body).toMatchObject({
        error: 'Rate limit exceeded',
        status: 429,
      });
      expect(limitedRes.headers).toHaveProperty('retry-after');
    });
  });

  describe('Transfer Endpoints Rate Limiting', () => {
    it('enforces rate limit on /api/v1/vault/deposits', async () => {
      const wallet = 'GDEPOSITWALLET123456789012345678901234567890123456789';
      // Default deposits max is 10 requests per window
      for (let i = 0; i < 10; i++) {
        const res = await request(app)
          .post('/api/v1/vault/deposits')
          .send({ walletAddress: wallet, amount: '100', asset: 'USDC' });
        expect(res.status).toBe(201);
      }

      const limitedRes = await request(app)
        .post('/api/v1/vault/deposits')
        .send({ walletAddress: wallet, amount: '100', asset: 'USDC' });

      expect(limitedRes.status).toBe(429);
      expect(limitedRes.body).toMatchObject({
        error: 'Rate limit exceeded',
        status: 429,
        retryAfter: expect.any(Number),
      });
      expect(limitedRes.headers).toHaveProperty('retry-after');
    });

    it('enforces rate limit on /api/v1/vault/withdrawals', async () => {
      const wallet = 'GWITHDRAWWALLET123456789012345678901234567890123456789';
      for (let i = 0; i < 10; i++) {
        const res = await request(app)
          .post('/api/v1/vault/withdrawals')
          .send({ walletAddress: wallet, amount: '50', asset: 'USDC' });
        expect(res.status).toBe(201);
      }

      const limitedRes = await request(app)
        .post('/api/v1/vault/withdrawals')
        .send({ walletAddress: wallet, amount: '50', asset: 'USDC' });

      expect(limitedRes.status).toBe(429);
      expect(limitedRes.body.error).toBe('Rate limit exceeded');
    });

    it('isolates rate limits per wallet address across transfer routes', async () => {
      const walletA = 'GWALLET_A_1234567890123456789012345678901234567890123456';
      const walletB = 'GWALLET_B_1234567890123456789012345678901234567890123456';

      // Exhaust walletA
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post('/api/v1/vault/deposits')
          .send({ walletAddress: walletA, amount: '10' });
      }

      const walletALimited = await request(app)
        .post('/api/v1/vault/deposits')
        .send({ walletAddress: walletA, amount: '10' });
      expect(walletALimited.status).toBe(429);

      // Wallet B should still succeed
      const walletBRes = await request(app)
        .post('/api/v1/vault/deposits')
        .send({ walletAddress: walletB, amount: '10' });
      expect(walletBRes.status).toBe(201);
    });
  });
});
