/**
 * Tests for the public `GET /config` endpoint (Issue #1722).
 *
 * The endpoint must expose only allow-listed, non-secret runtime configuration
 * and must stay in sync with the shared `PublicConfigSchema` the frontend uses.
 */

import request from 'supertest';
import app from '../index';
import { PublicConfigSchema } from '@yieldvault/api-schemas';

const originalFlags = process.env.FEATURE_FLAGS;

afterEach(() => {
  if (originalFlags === undefined) {
    delete process.env.FEATURE_FLAGS;
  } else {
    process.env.FEATURE_FLAGS = originalFlags;
  }
});

describe('GET /config', () => {
  it('returns 200 with a payload that satisfies the shared PublicConfig contract', async () => {
    const res = await request(app).get('/config');

    expect(res.status).toBe(200);
    expect(PublicConfigSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.maintenanceMode).toEqual({ enabled: expect.any(Boolean) });
  });

  it('reflects the live feature-flag configuration', async () => {
    process.env.FEATURE_FLAGS = JSON.stringify({
      'deposit-v2': { enabled: true },
      'strategy-selection': { enabled: false },
      'analytics-page': { enabled: true },
    });

    const res = await request(app).get('/config');

    expect(res.body.features).toEqual({
      'deposit-v2': true,
      'strategy-selection': false,
      'analytics-page': true,
    });
  });

  it('omits flags that are not configured instead of defaulting them to false', async () => {
    process.env.FEATURE_FLAGS = JSON.stringify({ 'deposit-v2': { enabled: true } });

    const res = await request(app).get('/config');

    expect(res.body.features).toEqual({ 'deposit-v2': true });
  });

  it('only exposes the allow-listed top-level keys', async () => {
    const res = await request(app).get('/config');

    expect(Object.keys(res.body).sort()).toEqual(['environment', 'features', 'maintenanceMode']);
  });

  it('does not expose non-allow-listed flags or any secret/internal configuration', async () => {
    process.env.FEATURE_FLAGS = JSON.stringify({
      'internal-experiment': { enabled: true, allowlist: ['WALLET_SECRET'] },
    });

    const res = await request(app).get('/config');
    const serialized = JSON.stringify(res.body).toLowerCase();

    expect(res.body.features).toEqual({});
    for (const needle of [
      'database_url',
      'postgres',
      'jwt_secret',
      'redis_url',
      'soroban_rpc_url',
      'stellar_rpc_url',
      'admin_action_receipt_secret',
      'allowlist',
      'wallet_secret',
      'contract_id',
    ]) {
      expect(serialized).not.toContain(needle);
    }
  });
});
