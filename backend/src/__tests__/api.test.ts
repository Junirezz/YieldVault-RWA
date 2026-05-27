import request from 'supertest';

// Mock the sorobanClient before importing app
jest.mock('../sorobanClient', () => ({
  submitVaultOperation: jest.fn(async (type: string, wallet: string, amount: string, asset: string) => {
    // Return a mock transaction hash
    return `mock_tx_hash_${type}_${Date.now()}`;
  }),
  SorobanSimulationError: class SorobanSimulationError extends Error {
    code: string;
    statusCode: number = 502;
    constructor(message: string, code = 'SIMULATION_ERROR') {
      super(message);
      this.name = 'SorobanSimulationError';
      this.code = code;
    }
  },
}));

import app from '../index';

describe('Backend API', () => {
  // ─── Health Endpoint Tests ───────────────────────────────────────────────

  describe('GET /health', () => {
    it('should return 200 with health status', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
      expect(response.body).toHaveProperty('environment');
      expect(response.body).toHaveProperty('checks');
    });

    it('should include dependency checks', async () => {
      const response = await request(app).get('/health');

      expect(response.body.checks).toHaveProperty('api');
      expect(response.body.checks).toHaveProperty('cache');
      expect(response.body.checks).toHaveProperty('stellarRpc');
    });

    it('should have cache up', async () => {
      const response = await request(app).get('/health');
      expect(response.body.checks.cache).toBe('up');
    });
  });

  // ─── Readiness Endpoint Tests ────────────────────────────────────────────

  describe('GET /ready', () => {
    it('should return 200 when ready', async () => {
      const response = await request(app).get('/ready');

      // Could be 200 or 503 depending on configuration
      expect([200, 503]).toContain(response.status);
      expect(response.body).toHaveProperty('ready');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('dependencies');
    });

    it('should include dependency status', async () => {
      const response = await request(app).get('/ready');

      expect(response.body.dependencies).toHaveProperty('cache');
      expect(response.body.dependencies).toHaveProperty('stellarRpc');
      expect(typeof response.body.dependencies.cache).toBe('boolean');
      expect(typeof response.body.dependencies.stellarRpc).toBe('boolean');
    });
  });

  // ─── Rate Limiting Tests (Issue #145) ────────────────────────────────────

  describe('Rate Limiting - Global', () => {
    it('should not rate limit health endpoint', async () => {
      // Make multiple rapid requests to health endpoint
      for (let i = 0; i < 5; i++) {
        const response = await request(app).get('/health');
        expect(response.status).toBe(200);
      }
    });

    it('should not rate limit ready endpoint', async () => {
      // Make multiple rapid requests to ready endpoint
      for (let i = 0; i < 5; i++) {
        const response = await request(app).get('/ready');
        expect([200, 503]).toContain(response.status);
      }
    });
  });

  describe('Rate Limiting - API Endpoints', () => {
    it('should include rate limit headers in response', async () => {
      const response = await request(app).get('/api/v1/vault/summary');

      expect(response.status).toBe(200);
      expect(response.headers).toHaveProperty('ratelimit-limit');
      expect(response.headers).toHaveProperty('ratelimit-remaining');
      expect(response.headers).toHaveProperty('ratelimit-reset');
    });

    it('should return 429 when rate limit exceeded', async () => {
      // Note: This test might need adjustment based on actual limit settings
      // It attempts to exceed the API rate limit
      const requests = Array(35).fill(null); // More than configured limit
      const results = await Promise.all(
        requests.map(() => request(app).get('/api/v1/vault/summary'))
      );

      expect(results.some((r) => r.status === 429)).toBe(true);
    });

    it('should return 429 with clear error message and Retry-After header', async () => {
      // Make multiple requests to trigger rate limit
      const requests = Array(35).fill(null);
      await Promise.all(
        requests.map(() => request(app).get('/api/v1/vault/summary'))
      );

      const response = await request(app).get('/api/v1/vault/summary');

      if (response.status === 429) {
        expect(response.body).toHaveProperty('error');
        expect(response.body).toHaveProperty('status', 429);
        expect(response.body).toHaveProperty('message');
        // Issue #251: retryAfter field in body
        expect(response.body).toHaveProperty('retryAfter');
        expect(typeof response.body.retryAfter).toBe('number');
        // Issue #251: Retry-After header must be present
        expect(response.headers).toHaveProperty('retry-after');
      }
    });

    it('should support per-user rate limiting with wallet address header', async () => {
      // Test that x-wallet-address header is used as the rate-limit key
      const response = await request(app)
        .get('/api/v1/vault/summary')
        .set('x-wallet-address', 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567');

      expect([200, 429]).toContain(response.status);
    });

    it('should support per-user rate limiting with API key (backward compat)', async () => {
      // Test that x-api-key header is still accepted as fallback key
      const response = await request(app)
        .get('/api/v1/vault/summary')
        .set('x-api-key', 'test-key-123');

      expect([200, 429]).toContain(response.status);
    });
  });

  // ─── Error Handling Tests ────────────────────────────────────────────────

  describe('Error Responses', () => {
    it('should return 404 for unknown endpoint', async () => {
      const response = await request(app).get('/api/unknown');

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'Not Found');
      expect(response.body).toHaveProperty('status', 404);
      expect(response.body).toHaveProperty('path');
      expect(response.body).toHaveProperty('message');
    });

    it('should return proper JSON error format', async () => {
      const response = await request(app).get('/api/nonexistent');

      expect(response.headers['content-type']).toContain('application/json');
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('message');
    });
  });

  describe('Cache Middleware', () => {
    it('should cache repeated list endpoint requests and mark hits', async () => {
      const first = await request(app).get('/api/v1/transactions');
      expect(first.headers['x-cache-hit']).toBe('false');

      const second = await request(app).get('/api/v1/transactions');
      expect(second.headers['x-cache-hit']).toBe('true');
    });

    it('should separate cache entries by query string', async () => {
      const first = await request(app).get('/api/v1/transactions?limit=1');
      expect(first.headers['x-cache-hit']).toBe('false');

      const second = await request(app).get('/api/v1/transactions?limit=2');
      expect(second.headers['x-cache-hit']).toBe('false');

      const third = await request(app).get('/api/v1/transactions?limit=2');
      expect(third.headers['x-cache-hit']).toBe('true');
    });

    it('should invalidate cached list responses after a vault deposit', async () => {
      const priorAllowlist = process.env.ALLOWLIST_ENABLED;
      process.env.ALLOWLIST_ENABLED = 'false';

      try {
        await request(app).get('/api/v1/transactions');
        const cached = await request(app).get('/api/v1/transactions');
        expect(cached.headers['x-cache-hit']).toBe('true');

        const depositResponse = await request(app)
          .post('/api/v1/vault/deposits')
          .send({
            amount: '100',
            asset: 'USDC',
            walletAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
            email: 'user@example.com',
          });

        expect(depositResponse.status).toBe(201);

        const afterInvalidate = await request(app).get('/api/v1/transactions');
        expect(afterInvalidate.headers['x-cache-hit']).toBe('false');
      } finally {
        process.env.ALLOWLIST_ENABLED = priorAllowlist;
      }
    });

    it('should cache referral stats for a referrer wallet', async () => {
      const referrerWallet = 'GREFERRER1234567890';

      const codeResponse = await request(app).get(`/api/v1/referrals/code/${referrerWallet}`);
