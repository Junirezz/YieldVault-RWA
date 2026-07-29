import request from 'supertest';
import app from '../index';
import { CURRENT_VERSION, LEGACY_SUNSET_DATE, SUPPORTED_VERSIONS } from '../middleware/versionNegotiation';

describe('API Version Negotiation and Deprecation Headers', () => {
  // ── Response version headers ────────────────────────────────────────────────

  describe('response version headers', () => {
    it('sets X-API-Version on every response', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['x-api-version']).toBe(CURRENT_VERSION);
    });

    it('sets X-API-Version-Supported on every response', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['x-api-version-supported']).toBe(SUPPORTED_VERSIONS.join(', '));
    });

    it('returns X-API-Version headers on normal requests (legacy assertions)', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['x-api-version']).toBe('1.0.0');
      expect(res.headers['x-api-version-supported']).toBe('1.0.0');
    });
  });

  // ── Accept-Version negotiation ──────────────────────────────────────────────

  describe('Accept-Version header negotiation', () => {
    it('accepts exact version "1.0.0" via Accept-Version', async () => {
      const res = await request(app).get('/health').set('Accept-Version', '1.0.0');
      expect(res.status).toBe(200);
      expect(res.headers['x-api-version']).toBe('1.0.0');
    });

    it('accepts short form "1" via Accept-Version', async () => {
      const res = await request(app).get('/health').set('Accept-Version', '1');
      expect(res.status).toBe(200);
      expect(res.headers['x-api-version']).toBe(CURRENT_VERSION);
    });

    it('accepts "v1" alias via Accept-Version', async () => {
      const res = await request(app).get('/health').set('Accept-Version', 'v1');
      expect(res.status).toBe(200);
    });

    it('accepts minor/patch variant "1.2.3" via Accept-Version (semver-compatible)', async () => {
      const res = await request(app).get('/health').set('Accept-Version', '1.2.3');
      expect(res.status).toBe(200);
    });

    it('rejects unsupported version "2.0.0" with 406 Not Acceptable', async () => {
      const res = await request(app).get('/health').set('Accept-Version', '2.0.0');
      expect(res.status).toBe(406);
      expect(res.body.error).toBe('Not Acceptable');
      expect(res.body.message).toContain('2.0.0');
    });

    it('includes supportedVersions array in 406 body', async () => {
      const res = await request(app).get('/health').set('Accept-Version', '99.0.0');
      expect(res.status).toBe(406);
      expect(Array.isArray(res.body.supportedVersions)).toBe(true);
      expect(res.body.supportedVersions).toContain('1.0.0');
    });

    it('includes the requested version in the 406 message', async () => {
      const res = await request(app).get('/health').set('Accept-Version', '3.1.0');
      expect(res.body.message).toContain('3.1.0');
    });
  });

  // ── X-API-Version request header (highest priority) ────────────────────────

  describe('X-API-Version request header negotiation', () => {
    it('accepts supported version via X-API-Version header', async () => {
      const res = await request(app).get('/health').set('X-API-Version', '1.0.0');
      expect(res.status).toBe(200);
    });

    it('rejects unsupported version via X-API-Version with 406', async () => {
      const res = await request(app).get('/health').set('X-API-Version', '5.0.0');
      expect(res.status).toBe(406);
      expect(res.body.error).toBe('Not Acceptable');
    });

    it('X-API-Version takes priority over Accept-Version when both are set', async () => {
      // X-API-Version is unsupported, Accept-Version is fine — 406 expected
      const res = await request(app)
        .get('/health')
        .set('X-API-Version', '9.9.9')
        .set('Accept-Version', '1.0.0');
      expect(res.status).toBe(406);
    });
  });

  // ── Accept media-type version parameter ────────────────────────────────────

  describe('Accept media-type version parameter', () => {
    it('accepts version via Accept media-type parameter', async () => {
      const res = await request(app)
        .get('/health')
        .set('Accept', 'application/json;version=1.0.0');
      expect(res.status).toBe(200);
    });

    it('rejects unsupported version in Accept media-type parameter with 406', async () => {
      const res = await request(app)
        .get('/health')
        .set('Accept', 'application/json;version=4.0.0');
      expect(res.status).toBe(406);
      expect(res.body.message).toContain('4.0.0');
    });
  });

  // ── Deprecation headers for legacy unversioned routes ──────────────────────

  describe('deprecation headers on legacy unversioned routes', () => {
    it('adds Deprecation header for /vault/* routes', async () => {
      const res = await request(app).get('/vault/summary');
      expect(res.headers['deprecation']).toBe('true');
    });

    it('adds Sunset header for /vault/* routes', async () => {
      const res = await request(app).get('/vault/summary');
      expect(res.headers['sunset']).toBe(LEGACY_SUNSET_DATE);
    });

    it('adds Link header pointing to successor-version for /vault/*', async () => {
      const res = await request(app).get('/vault/summary');
      expect(res.headers['link']).toContain('successor-version');
      expect(res.headers['link']).toContain('/api/v1/vault/summary');
    });

    it('adds X-API-Deprecation-Info header for /vault/* routes', async () => {
      const res = await request(app).get('/vault/summary');
      expect(res.headers['x-api-deprecation-info']).toBeDefined();
      expect(res.headers['x-api-deprecation-info']).toContain('/api/v1/vault/summary');
    });

    it('adds deprecation headers for /referrals/* routes', async () => {
      const res = await request(app).get('/referrals/GTEST');
      expect(res.headers['deprecation']).toBe('true');
      expect(res.headers['link']).toContain('/api/v1/referrals/GTEST');
    });

    it('adds deprecation headers for /transactions/* routes', async () => {
      const res = await request(app).get('/transactions');
      expect(res.headers['deprecation']).toBe('true');
      expect(res.headers['link']).toContain('/api/v1/transactions');
    });

    it('adds deprecation headers for /portfolio/* routes', async () => {
      const res = await request(app).get('/portfolio/holdings');
      expect(res.headers['deprecation']).toBe('true');
      expect(res.headers['link']).toContain('/api/v1/portfolio/holdings');
    });
  });

  // ── Deprecation headers for legacy /api/* (non-v1) routes ──────────────────

  describe('deprecation headers on legacy /api/* routes', () => {
    it('adds deprecation headers for /api/vault/* (non-v1 prefixed)', async () => {
      const res = await request(app).get('/api/vault/summary');
      expect(res.headers['deprecation']).toBe('true');
      expect(res.headers['link']).toContain('/api/v1/vault/summary');
    });

    it('adds X-API-Deprecation-Info for /api/vault/* routes', async () => {
      const res = await request(app).get('/api/vault/summary');
      expect(res.headers['x-api-deprecation-info']).toContain('/api/v1/vault/summary');
    });
  });

  // ── No deprecation headers on canonical /api/v1/* routes ───────────────────

  describe('no deprecation headers on canonical /api/v1/* routes', () => {
    it('does NOT add Deprecation header on /health', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['deprecation']).toBeUndefined();
    });

    it('does NOT add Deprecation header on /api/v1/vault/summary', async () => {
      const res = await request(app).get('/api/v1/vault/summary');
      expect(res.headers['deprecation']).toBeUndefined();
    });

    it('still sets X-API-Version on canonical routes', async () => {
      const res = await request(app).get('/api/v1/vault/summary');
      expect(res.headers['x-api-version']).toBe(CURRENT_VERSION);
    });
  });

  // ── No version header in request = no rejection ────────────────────────────

  describe('omitting version headers', () => {
    it('allows requests with no version header (defaults to current)', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
    });

    it('responds with current version header even when no version was requested', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['x-api-version']).toBe(CURRENT_VERSION);
    });
  });
});
