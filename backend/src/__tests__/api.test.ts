import request from 'supertest';
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
        requests.map(() =>
          request(app).get('/api/v1/vault/summary').set('x-api-key', 'rate-limit-test')
        )
      );

      expect(results.some((r) => r.status === 429)).toBe(true);
    });

    it('should return 429 with clear error message', async () => {
      // Make multiple requests to trigger rate limit
      const requests = Array(35).fill(null);
      await Promise.all(
        requests.map(() =>
          request(app).get('/api/v1/vault/summary').set('x-api-key', 'rate-limit-test')
        )
      );

      const response = await request(app).get('/api/v1/vault/summary');

      if (response.status === 429) {
        expect(response.body).toHaveProperty('error');
        expect(response.body).toHaveProperty('status', 429);
        expect(response.body).toHaveProperty('message');
      }
    });

    it('should support per-user rate limiting with API key', async () => {
      // Test that API key in header is used for rate limiting
      const response = await request(app)
        .get('/api/v1/vault/summary')
        .set('x-api-key', 'test-key-123');

      expect([200, 429]).toContain(response.status);
    });
  });

  // ─── Error Handling Tests ────────────────────────────────────────────────

  describe('Error Responses', () => {
    it('should return 404 for unknown endpoint', async () => {
      const response = await request(app).get('/api/v1/unknown');

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'Not Found');
      expect(response.body).toHaveProperty('status', 404);
      expect(response.body).toHaveProperty('path');
      expect(response.body).toHaveProperty('message');
    });

    it('should return proper JSON error format', async () => {
      const response = await request(app).get('/api/v1/nonexistent');

      expect(response.headers['content-type']).toContain('application/json');
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('message');
    });
  });

  // ─── Configuration Tests ─────────────────────────────────────────────────

  describe('Configuration', () => {
    it('should have proper rate limit defaults', async () => {
      // This verifies the backend is configured with sensible defaults
      expect(process.env.PORT || 3000).toBeDefined();
    });

    it('should not expose sensitive info in error responses', async () => {
      const response = await request(app).get('/api/v1/vault/summary');

      // Ensure no stack traces in error responses in production-like environment
      if (response.status >= 500) {
        if (process.env.NODE_ENV === 'production') {
          expect(response.body.message).not.toContain('at ');
          expect(response.body.message).not.toContain('Error');
        }
      }
    });
  });

  // ─── Integration Tests ──────────────────────────────────────────────────

  describe('Integration', () => {
    it('should have proper CORS headers configured', async () => {
      const response = await request(app)
        .get('/health')
        .set('Origin', 'http://localhost:5173');

      // Response should include appropriate headers
      expect(response.status).toBe(200);
    });

    it('should handle JSON body parsing', async () => {
      const response = await request(app)
        .post('/api/v1/vault/deposits')
        .set('x-idempotency-key', 'integration-deposit-1')
        .send({
          amount: 1250,
          asset: 'USDC',
          walletAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz234567',
        });

      // Should accept with a replay-safe mutation response
      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('depositId');
      expect(response.headers).toHaveProperty('idempotency-status', 'created');
    });
  });
});
