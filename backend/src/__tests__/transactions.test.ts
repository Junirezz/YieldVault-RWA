import request from 'supertest';
import app from '../index';

describe('GET /api/v1/transactions', () => {
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
});
