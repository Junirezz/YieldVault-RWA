/**
 * Tests for the wallet address allowlist middleware (Issue #375).
 */

import request from 'supertest';
import app from '../index';
import {
  addAddress,
  removeAddress,
  listAddresses,
  isAllowed,
  clearAllowlist,
  allowlistSize,
} from '../middleware/allowlist';

// ─── Store unit tests ────────────────────────────────────────────────────────

describe('Allowlist store', () => {
  beforeEach(() => {
    clearAllowlist();
  });

  it('starts empty after clear', () => {
    expect(allowlistSize()).toBe(0);
  });

  it('adds a wallet address (normalises to upper-case)', () => {
    addAddress('gtest1234');
    expect(isAllowed('GTEST1234')).toBe(true);
  });

  it('is case-insensitive for lookups', () => {
    addAddress('GWALLET1');
    expect(isAllowed('gwallet1')).toBe(true);
    expect(isAllowed('GWALLET1')).toBe(true);
  });

  it('returns false for an address not in the list', () => {
    expect(isAllowed('GUNKNOWN')).toBe(false);
  });

  it('addAddress returns false when already present', () => {
    addAddress('GDUPE');
    expect(addAddress('GDUPE')).toBe(false);
    expect(allowlistSize()).toBe(1);
  });

  it('removeAddress removes an existing address', () => {
    addAddress('GREMOVEME');
    expect(removeAddress('GREMOVEME')).toBe(true);
    expect(isAllowed('GREMOVEME')).toBe(false);
  });

  it('removeAddress returns false for missing address', () => {
    expect(removeAddress('GMISSING')).toBe(false);
  });

  it('listAddresses returns a sorted array', () => {
    addAddress('GZZZ');
    addAddress('GAAA');
    addAddress('GMMM');
    const list = listAddresses();
    expect(list).toEqual(['GAAA', 'GMMM', 'GZZZ']);
  });
});

// ─── Middleware integration tests ────────────────────────────────────────────

describe('allowlistMiddleware – ALLOWLIST_ENABLED=true', () => {
  const ALLOWED_WALLET = 'GTEST_ALLOWED_WALLET_ADDRESS_001';
  const BLOCKED_WALLET = 'GBLOCKED_WALLET_999';

  beforeAll(() => {
    // Ensure feature is enabled
    process.env.ALLOWLIST_ENABLED = 'true';
    clearAllowlist();
    addAddress(ALLOWED_WALLET);
  });

  afterAll(() => {
    delete process.env.ALLOWLIST_ENABLED;
    clearAllowlist();
  });

  it('rejects a non-allowlisted wallet with 403 on POST /deposits', async () => {
    const res = await request(app)
      .post('/api/v1/vault/deposits')
      .send({
        amount: '100',
        asset: 'USDC',
        walletAddress: BLOCKED_WALLET,
      });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
    expect(res.body.message).toMatch(/not approved/i);
  });

  it('rejects a non-allowlisted wallet with 403 on POST /withdrawals', async () => {
    const res = await request(app)
      .post('/api/v1/vault/withdrawals')
      .send({
        amount: '50',
        asset: 'USDC',
        walletAddress: BLOCKED_WALLET,
      });
    expect(res.status).toBe(403);
  });

  it('allows an allowlisted wallet through (receives 201)', async () => {
    const res = await request(app)
      .post('/api/v1/vault/deposits')
      .send({
        amount: '100',
        asset: 'USDC',
        walletAddress: ALLOWED_WALLET,
      });
    // Allowlist passes → business logic runs → expect 201 (success) or 503 (circuit)
    expect([201, 503]).toContain(res.status);
  });

  it('rejects missing walletAddress with 403', async () => {
    const res = await request(app)
      .post('/api/v1/vault/deposits')
      .send({ amount: '10', asset: 'XLM' }); // no walletAddress
    expect(res.status).toBe(403);
  });

  it('accepts wallet from x-wallet-address header', async () => {
    const res = await request(app)
      .post('/api/v1/vault/deposits')
      .set('x-wallet-address', ALLOWED_WALLET)
      .send({ amount: '10', asset: 'XLM', walletAddress: ALLOWED_WALLET });
    expect([201, 503]).toContain(res.status);
  });
});

describe('allowlistMiddleware – ALLOWLIST_ENABLED=false', () => {
  beforeAll(() => {
    process.env.ALLOWLIST_ENABLED = 'false';
    clearAllowlist(); // no addresses at all
  });

  afterAll(() => {
    delete process.env.ALLOWLIST_ENABLED;
  });

  it('allows any wallet when feature is disabled', async () => {
    const res = await request(app)
      .post('/api/v1/vault/deposits')
      .send({
        amount: '100',
        asset: 'USDC',
        walletAddress: 'GANYONE',
      });
    // Feature disabled → allowlist check skipped → business logic runs
    expect([201, 503]).toContain(res.status);
  });
});

// ─── Admin endpoint tests ────────────────────────────────────────────────────

describe('Admin – /admin/allowlist endpoints', () => {
  const ADMIN_KEY = 'test-admin-key';
  const authHeader = `ApiKey ${ADMIN_KEY}`;

  beforeAll(() => {
    process.env.ALLOWLIST_ENABLED = 'true';
    // Register a test API key
    const { registerApiKey } = require('../middleware/apiKeyAuth');
    registerApiKey(ADMIN_KEY);
    clearAllowlist();
  });

  afterAll(() => {
    delete process.env.ALLOWLIST_ENABLED;
    clearAllowlist();
  });

  it('GET /admin/allowlist requires API key', async () => {
    const res = await request(app).get('/admin/allowlist');
    expect(res.status).toBe(401);
  });

  it('GET /admin/allowlist returns address list', async () => {
    addAddress('GLISTED1');
    const res = await request(app)
      .get('/admin/allowlist')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('addresses');
    expect(res.body).toHaveProperty('count');
    expect(res.body.enabled).toBe(true);
  });

  it('POST /admin/allowlist/add adds a wallet', async () => {
    const res = await request(app)
      .post('/admin/allowlist/add')
      .set('Authorization', authHeader)
      .send({ walletAddress: 'GNEWWALLET' });
    expect(res.status).toBe(201);
    expect(res.body.walletAddress).toBe('GNEWWALLET');
  });

  it('POST /admin/allowlist/add returns 200 for duplicate', async () => {
    await request(app)
      .post('/admin/allowlist/add')
      .set('Authorization', authHeader)
      .send({ walletAddress: 'GDUPLICATE' });
    const res = await request(app)
      .post('/admin/allowlist/add')
      .set('Authorization', authHeader)
      .send({ walletAddress: 'GDUPLICATE' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/already in allowlist/i);
  });

  it('DELETE /admin/allowlist/remove removes a wallet', async () => {
    addAddress('GTODELETE');
    const res = await request(app)
      .delete('/admin/allowlist/remove')
      .set('Authorization', authHeader)
      .send({ walletAddress: 'GTODELETE' });
    expect(res.status).toBe(200);
    expect(isAllowed('GTODELETE')).toBe(false);
  });

  it('DELETE /admin/allowlist/remove returns 404 for missing wallet', async () => {
    const res = await request(app)
      .delete('/admin/allowlist/remove')
      .set('Authorization', authHeader)
      .send({ walletAddress: 'GDOESNOTEXIST' });
    expect(res.status).toBe(404);
  });

  it('POST /admin/allowlist/add returns 400 without walletAddress', async () => {
    const res = await request(app)
      .post('/admin/allowlist/add')
      .set('Authorization', authHeader)
      .send({});
    expect(res.status).toBe(400);
  });
});
