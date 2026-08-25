import request from 'supertest';
import app from '../index';
import { registerApiKey } from '../middleware/apiKeyAuth';
import { VALID_TEST_WALLET, SECOND_TEST_WALLET, ensurePaginationFixtureTransactions } from './setup';

const DEFAULT_WALLET = VALID_TEST_WALLET;

async function issueAccessToken(walletAddress: string): Promise<string> {
  const response = await request(app).post('/api/v1/auth/login').send({ walletAddress });
  expect(response.status).toBe(200);
  return response.body.accessToken as string;
}

describe('GET /api/v1/transactions', () => {
  beforeAll(async () => {
    await ensurePaginationFixtureTransactions('fixture-pagination', 30);
  });

  it('returns total count with cursor-based pagination and no duplicate results across pages', async () => {
    const firstPage = await request(app).get('/api/v1/transactions?limit=10');

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.pagination.total).toBeGreaterThan(10);
    expect(firstPage.body.pagination.nextCursor).toBeDefined();
    expect(firstPage.body.data).toHaveLength(10);

    const secondPage = await request(app).get(
      `/api/v1/transactions?limit=10&cursor=${firstPage.body.pagination.nextCursor}`
    );

    expect(secondPage.status).toBe(200);
    expect(secondPage.body.pagination.total).toBe(firstPage.body.pagination.total);

    const firstPageIds = firstPage.body.data.map((transaction: { id: string }) => transaction.id);
    const secondPageIds = secondPage.body.data.map((transaction: { id: string }) => transaction.id);
    const duplicateIds = firstPageIds.filter((id: string) => secondPageIds.includes(id));

    expect(duplicateIds).toEqual([]);
  });

  it('filters transactions by type accurately', async () => {
    const response = await request(app).get('/api/v1/transactions?limit=100&type=deposit');

    expect(response.status).toBe(200);
    expect(response.body.pagination.total).toBe(response.body.data.length);
    response.body.data.forEach((transaction: { type: string }) => {
      expect(transaction.type).toBe('deposit');
    });
  });

  it('filters transactions by status accurately', async () => {
    const response = await request(app).get('/api/v1/transactions?limit=100&status=completed');

    expect(response.status).toBe(200);
    expect(response.body.pagination.total).toBe(response.body.data.length);
    response.body.data.forEach((transaction: { status: string }) => {
      expect(transaction.status).toBe('completed');
    });
  });

  it('filters transactions by inclusive date range accurately', async () => {
    const fullResponse = await request(app).get(
      '/api/v1/transactions?limit=100&sortBy=timestamp&sortOrder=desc'
    );

    expect(fullResponse.status).toBe(200);
    expect(fullResponse.body.data.length).toBeGreaterThan(20);

    const from = fullResponse.body.data[20].timestamp;
    const to = fullResponse.body.data[10].timestamp;
    const expectedIds = fullResponse.body.data
      .filter(
        (transaction: { timestamp: string }) =>
          transaction.timestamp >= from && transaction.timestamp <= to
      )
      .map((transaction: { id: string }) => transaction.id)
      .sort();

    const rangedResponse = await request(app).get(
      `/api/v1/transactions?limit=100&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    );

    expect(rangedResponse.status).toBe(200);
    expect(rangedResponse.body.pagination.total).toBe(expectedIds.length);

    const actualIds = rangedResponse.body.data
      .map((transaction: { id: string }) => transaction.id)
      .sort();

    expect(actualIds).toEqual(expectedIds);
  });

  it('exports transactions as JSON with authenticated user scope', async () => {
    const token = await issueAccessToken(DEFAULT_WALLET);
    const response = await request(app)
      .get('/api/v1/vault/transactions/export?format=json')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['content-disposition']).toContain('attachment; filename=');
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data.length).toBeGreaterThan(0);
    response.body.data.forEach((transaction: { walletAddress: string }) => {
      expect(transaction.walletAddress).toBe(DEFAULT_WALLET);
    });
  });

  it('exports transactions as RFC4180 CSV with header row', async () => {
    const token = await issueAccessToken(DEFAULT_WALLET);
    const response = await request(app)
      .get('/api/v1/vault/transactions/export?format=csv')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');

    const lines = response.text.trim().split('\r\n');
    expect(lines[0]).toBe('id,type,status,amount,asset,timestamp,transactionHash,walletAddress');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[1]).toContain('"tx-');
  });

  it('rejects export when authenticated user tries to export another wallet', async () => {
    const token = await issueAccessToken(SECOND_TEST_WALLET);
    const response = await request(app)
      .get(`/api/v1/vault/transactions/export?format=json&walletAddress=${encodeURIComponent(DEFAULT_WALLET)}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });

  it('supports startDate and endDate filtering on exports', async () => {
    const token = await issueAccessToken(DEFAULT_WALLET);
    const full = await request(app)
      .get('/api/v1/transactions?limit=100&sortBy=timestamp&sortOrder=desc');
    expect(full.status).toBe(200);

    const startDate = full.body.data[20].timestamp;
    const endDate = full.body.data[10].timestamp;

    const response = await request(app)
      .get(
        `/api/v1/vault/transactions/export?format=json&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`
      )
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    response.body.data.forEach((transaction: { timestamp: string }) => {
      expect(transaction.timestamp >= startDate).toBe(true);
      expect(transaction.timestamp <= endDate).toBe(true);
    });
  });
});

describe('GET /api/v1/vault/transactions/export', () => {
  it('exports the authenticated user transaction history as JSON', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({
      walletAddress: VALID_TEST_WALLET,
    });

    const response = await request(app)
      .get('/api/v1/vault/transactions/export?format=json')
      .set('Authorization', `Bearer ${login.body.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['content-disposition']).toContain('attachment; filename="transaction-history-');
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data.length).toBeGreaterThan(0);
    response.body.data.forEach((transaction: { walletAddress: string }) => {
      expect(transaction.walletAddress).toBe(VALID_TEST_WALLET);
    });
  });

  it('rejects exporting a different wallet for a bearer-authenticated user', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({
      walletAddress: VALID_TEST_WALLET,
    });

    const response = await request(app)
      .get(`/api/v1/vault/transactions/export?format=json&walletAddress=${encodeURIComponent(SECOND_TEST_WALLET)}`)
      .set('Authorization', `Bearer ${login.body.accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('own wallet');
  });

  it('exports CSV for admin API keys with date scoping', async () => {
    const apiKey = 'export-admin-key';
    registerApiKey(apiKey, { role: 'admin' });

    const fullResponse = await request(app).get('/api/v1/transactions?limit=100&sortBy=timestamp&sortOrder=desc');
    const startDate = fullResponse.body.data[15].timestamp;
    const endDate = fullResponse.body.data[5].timestamp;

    const response = await request(app)
      .get(
        `/api/v1/vault/transactions/export?format=csv&walletAddress=${encodeURIComponent(VALID_TEST_WALLET)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`
      )
      .set('Authorization', `ApiKey ${apiKey}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('.csv"');

    const lines = response.text.trim().split('\r\n');
    expect(lines[0]).toBe('id,type,status,amount,asset,timestamp,transactionHash,walletAddress');
    expect(lines.length).toBeGreaterThan(1);
  });
});
