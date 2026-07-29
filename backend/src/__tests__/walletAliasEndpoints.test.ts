import request from 'supertest';
import app from '../index';
import { registerApiKey } from '../middleware/apiKeyAuth';
import { disconnectPrismaClient } from '../prismaClient';
import { walletAliasMappingService } from '../walletAliasService';
import { VALID_TEST_WALLET, SECOND_TEST_WALLET } from './setup';

describe('Wallet alias API endpoints', () => {
  const stellarWallet = VALID_TEST_WALLET;
  const providerAlias = 'wallet-connect-test-alias';
  const authHeader = { Authorization: `ApiKey ${process.env.ADMIN_API_KEY || 'test-admin-key'}` };

  beforeEach(async () => {
    await walletAliasMappingService.resetForTests();
  });

  afterAll(async () => {
    await disconnectPrismaClient();
  });

  it('POST /api/v1/wallet-aliases/link links provider aliases to a canonical identity', async () => {
    const res = await request(app)
      .post('/api/v1/wallet-aliases/link')
      .send({
        primaryAlias: SECOND_TEST_WALLET,
        primarySource: 'stellar',
        linkedAlias: 'freighter-session-alias',
        linkedSource: 'freighter',
      });

    expect(res.status).toBe(200);
    expect(res.body.canonicalId).toMatch(/^wallet-alias:/);
    expect(res.body.aliases).toEqual(
      expect.arrayContaining([SECOND_TEST_WALLET, 'freighter-session-alias']),
    );
    expect(res.body.canonicalWallet).toBe(SECOND_TEST_WALLET);
  });

  it('GET /api/v1/wallet-aliases/resolve returns canonical linkage for a provider alias', async () => {
    const linked = await request(app)
      .post('/api/v1/wallet-aliases/link')
      .send({
        primaryAlias: stellarWallet,
        primarySource: 'stellar',
        linkedAlias: providerAlias,
        linkedSource: 'walletconnect',
      });

    const res = await request(app)
      .get('/api/v1/wallet-aliases/resolve')
      .query({ alias: providerAlias, source: 'walletconnect' });

    expect(res.status).toBe(200);
    expect(res.body.canonicalId).toBe(linked.body.canonicalId);
    expect(res.body.canonicalWallet).toBe(stellarWallet);
  });

  it('GET /api/v1/wallet-aliases/:canonicalId returns linked aliases', async () => {
    const linked = await request(app)
      .post('/api/v1/wallet-aliases/link')
      .send({
        primaryAlias: stellarWallet,
        primarySource: 'stellar',
        linkedAlias: providerAlias,
        linkedSource: 'walletconnect',
      });

    const res = await request(app).get(`/api/v1/wallet-aliases/${linked.body.canonicalId}`);

    expect(res.status).toBe(200);
    expect(res.body.aliases).toEqual(expect.arrayContaining([stellarWallet, providerAlias]));
    expect(res.body.sources).toEqual(expect.arrayContaining(['stellar', 'walletconnect']));
  });

  it('GET /admin/wallet-aliases lists persisted identity groups', async () => {
    const linked = await request(app)
      .post('/api/v1/wallet-aliases/link')
      .send({
        primaryAlias: stellarWallet,
        primarySource: 'stellar',
        linkedAlias: providerAlias,
        linkedSource: 'walletconnect',
      });

    const res = await request(app).get('/admin/wallet-aliases').set(authHeader);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.groups[0].canonicalId).toBe(linked.body.canonicalId);
    expect(res.body.groups[0].aliases).toEqual(expect.arrayContaining([stellarWallet, providerAlias]));
  });

  it('DELETE /admin/wallet-aliases/:canonicalId deletes an identity group', async () => {
    const linked = await request(app)
      .post('/api/v1/wallet-aliases/link')
      .send({
        primaryAlias: stellarWallet,
        primarySource: 'stellar',
        linkedAlias: providerAlias,
        linkedSource: 'walletconnect',
      });

    const deleted = await request(app)
      .delete(`/admin/wallet-aliases/${linked.body.canonicalId}`)
      .set(authHeader);

    expect(deleted.status).toBe(200);
    expect(deleted.body.aliasesDeleted).toBe(2);

    const resolved = await request(app)
      .get('/api/v1/wallet-aliases/resolve')
      .query({ alias: providerAlias, source: 'walletconnect' });

    expect(resolved.status).toBe(404);
  });

  it('DELETE /admin/wallet-aliases/:canonicalId rejects viewer API keys', async () => {
    registerApiKey('wallet-alias-viewer-key', { role: 'viewer' });
    const linked = await request(app)
      .post('/api/v1/wallet-aliases/link')
      .send({
        primaryAlias: stellarWallet,
        primarySource: 'stellar',
        linkedAlias: providerAlias,
        linkedSource: 'walletconnect',
      });

    const res = await request(app)
      .delete(`/admin/wallet-aliases/${linked.body.canonicalId}`)
      .set('Authorization', 'ApiKey wallet-alias-viewer-key');

    expect(res.status).toBe(403);
  });
});

describe('Auth login wallet alias integration', () => {
  const loginWallet = 'GBJAACGKIIH72M5FOGVJGLARM43HC7JYE5DMMVQWZI5UUCC6YNUA37EH';

  beforeEach(async () => {
    await walletAliasMappingService.resetForTests();
  });

  it('registers provider aliases during login and returns canonical wallet metadata', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        walletAddress: loginWallet,
        source: 'stellar',
        providerAlias: 'lobstr-session-alias',
        providerSource: 'lobstr',
      });

    expect(res.status).toBe(200);
    expect(res.body.canonicalWallet).toBe(loginWallet);
    expect(res.body.canonicalId).toMatch(/^wallet-alias:/);
    expect(res.body.accessToken).toBeDefined();
  });
});
