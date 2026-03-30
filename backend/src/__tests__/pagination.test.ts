import request from 'supertest';
import app from '../index';

describe('Pagination', () => {
  // ─── Transactions Endpoint Tests ─────────────────────────────────────────

  describe('GET /api/transactions', () => {
    it('should return paginated transactions with default limit', async () => {
      const response = await request(app).get('/api/transactions');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('pagination');
      expect(response.body).toHaveProperty('timestamp');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeLessThanOrEqual(20);
    });

    it('should respect limit parameter', async () => {
      const response = await request(app).get('/api/transactions?limit=10');

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeLessThanOrEqual(10);
      expect(response.body.pagination.count).toBeLessThanOrEqual(10);
    });

    it('should clamp limit to maximum of 100', async () => {
      const response = await request(app).get('/api/transactions?limit=200');

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeLessThanOrEqual(100);
    });

    it('should support cursor-based pagination', async () => {
      // Get first page
      const firstPage = await request(app).get('/api/transactions?limit=5');
      expect(firstPage.status).toBe(200);
      expect(firstPage.body.pagination.hasNextPage).toBe(true);
      expect(firstPage.body.pagination.nextCursor).toBeDefined();

      // Get second page using cursor
      const secondPage = await request(app).get(
        `/api/transactions?limit=5&cursor=${firstPage.body.pagination.nextCursor}`
      );
      expect(secondPage.status).toBe(200);
      expect(secondPage.body.data.length).toBeGreaterThan(0);

      // Ensure no duplicate items
      const firstPageIds = firstPage.body.data.map((tx: any) => tx.id);
      const secondPageIds = secondPage.body.data.map((tx: any) => tx.id);
      const intersection = firstPageIds.filter((id: string) => secondPageIds.includes(id));
      expect(intersection.length).toBe(0);
    });

    it('should support offset-based pagination', async () => {
      const page1 = await request(app).get('/api/transactions?limit=5&page=1');
      const page2 = await request(app).get('/api/transactions?limit=5&page=2');

      expect(page1.status).toBe(200);
      expect(page2.status).toBe(200);
      expect(page1.body.pagination.currentPage).toBe(1);
      expect(page2.body.pagination.currentPage).toBe(2);

      // Ensure no duplicate items
      const page1Ids = page1.body.data.map((tx: any) => tx.id);
      const page2Ids = page2.body.data.map((tx: any) => tx.id);
      const intersection = page1Ids.filter((id: string) => page2Ids.includes(id));
      expect(intersection.length).toBe(0);
    });

    it('should filter by transaction type', async () => {
      const deposits = await request(app).get('/api/transactions?type=deposit');
      const withdrawals = await request(app).get('/api/transactions?type=withdrawal');

      expect(deposits.status).toBe(200);
      expect(withdrawals.status).toBe(200);

      // All deposits should have type 'deposit'
      deposits.body.data.forEach((tx: any) => {
        expect(tx.type).toBe('deposit');
      });

      // All withdrawals should have type 'withdrawal'
      withdrawals.body.data.forEach((tx: any) => {
        expect(tx.type).toBe('withdrawal');
      });
    });

    it('should sort by timestamp descending by default', async () => {
      const response = await request(app).get('/api/transactions?limit=10');

      expect(response.status).toBe(200);
      const timestamps = response.body.data.map((tx: any) => new Date(tx.timestamp).getTime());
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeLessThanOrEqual(timestamps[i - 1]);
      }
    });

    it('should support ascending sort order', async () => {
      const response = await request(app).get(
        '/api/transactions?limit=10&sortBy=timestamp&sortOrder=asc'
      );

      expect(response.status).toBe(200);
      const timestamps = response.body.data.map((tx: any) => new Date(tx.timestamp).getTime());
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
      }
    });

    it('should include pagination metadata', async () => {
      const response = await request(app).get('/api/transactions?limit=10');

      expect(response.status).toBe(200);
      expect(response.body.pagination).toHaveProperty('count');
      expect(response.body.pagination).toHaveProperty('hasNextPage');
      expect(response.body.pagination).toHaveProperty('hasPrevPage');
      expect(typeof response.body.pagination.hasNextPage).toBe('boolean');
      expect(typeof response.body.pagination.hasPrevPage).toBe('boolean');
    });

    it('should handle empty results', async () => {
      // Use a non-existent wallet address to get empty results
      const response = await request(app).get(
        '/api/transactions?walletAddress=GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
      );

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
      expect(response.body.pagination.count).toBe(0);
      expect(response.body.pagination.hasNextPage).toBe(false);
    });

    it('should handle invalid cursor gracefully', async () => {
      const response = await request(app).get('/api/transactions?cursor=invalid-cursor');

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
      expect(response.body.pagination.hasNextPage).toBe(false);
    });

    it('should handle invalid page number gracefully', async () => {
      const response = await request(app).get('/api/transactions?page=-1');

      expect(response.status).toBe(200);
      expect(response.body.pagination.currentPage).toBe(1);
    });
  });

  // ─── Portfolio Holdings Endpoint Tests ────────────────────────────────────

  describe('GET /api/portfolio/holdings', () => {
    it('should return paginated portfolio holdings', async () => {
      const response = await request(app).get('/api/portfolio/holdings');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('pagination');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should filter by status', async () => {
      const active = await request(app).get('/api/portfolio/holdings?status=active');
      const pending = await request(app).get('/api/portfolio/holdings?status=pending');

      expect(active.status).toBe(200);
      expect(pending.status).toBe(200);

      active.body.data.forEach((holding: any) => {
        expect(holding.status).toBe('active');
      });

      pending.body.data.forEach((holding: any) => {
        expect(holding.status).toBe('pending');
      });
    });

    it('should sort by valueUsd descending by default', async () => {
      const response = await request(app).get('/api/portfolio/holdings?limit=10');

      expect(response.status).toBe(200);
      const values = response.body.data.map((holding: any) => holding.valueUsd);
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeLessThanOrEqual(values[i - 1]);
      }
    });

    it('should support cursor-based pagination', async () => {
      const firstPage = await request(app).get('/api/portfolio/holdings?limit=5');
      expect(firstPage.status).toBe(200);
      expect(firstPage.body.pagination.hasNextPage).toBe(true);

      const secondPage = await request(app).get(
        `/api/portfolio/holdings?limit=5&cursor=${firstPage.body.pagination.nextCursor}`
      );
      expect(secondPage.status).toBe(200);
      expect(secondPage.body.data.length).toBeGreaterThan(0);
    });
  });

  // ─── Vault History Endpoint Tests ─────────────────────────────────────────

  describe('GET /api/vault/history', () => {
    it('should return paginated vault history', async () => {
      const response = await request(app).get('/api/vault/history');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('pagination');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should filter by date range', async () => {
      const response = await request(app).get(
        '/api/vault/history?from=2026-01-01&to=2026-01-31'
      );

      expect(response.status).toBe(200);
      response.body.data.forEach((point: any) => {
        expect(point.date >= '2026-01-01').toBe(true);
        expect(point.date <= '2026-01-31').toBe(true);
      });
    });

    it('should sort by date descending by default', async () => {
      const response = await request(app).get('/api/vault/history?limit=10');

      expect(response.status).toBe(200);
      const dates = response.body.data.map((point: any) => point.date);
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i] <= dates[i - 1]).toBe(true);
      }
    });

    it('should support ascending sort order', async () => {
      const response = await request(app).get(
        '/api/vault/history?limit=10&sortBy=date&sortOrder=asc'
      );

      expect(response.status).toBe(200);
      const dates = response.body.data.map((point: any) => point.date);
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i] >= dates[i - 1]).toBe(true);
      }
    });

    it('should respect limit parameter', async () => {
      const response = await request(app).get('/api/vault/history?limit=5');

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeLessThanOrEqual(5);
    });

    it('should clamp limit to maximum of 365', async () => {
      const response = await request(app).get('/api/vault/history?limit=500');

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeLessThanOrEqual(365);
    });
  });

  // ─── Edge Cases ──────────────────────────────────────────────────────────

  describe('Pagination Edge Cases', () => {
    it('should handle limit of 1', async () => {
      const response = await request(app).get('/api/transactions?limit=1');

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeLessThanOrEqual(1);
      expect(response.body.pagination.count).toBeLessThanOrEqual(1);
    });

    it('should handle very large page numbers', async () => {
      const response = await request(app).get('/api/transactions?page=1000000');

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
      expect(response.body.pagination.hasNextPage).toBe(false);
    });

    it('should handle concurrent pagination requests', async () => {
      const requests = Array.from({ length: 5 }, (_, i) =>
        request(app).get(`/api/transactions?limit=5&page=${i + 1}`)
      );

      const responses = await Promise.all(requests);

      responses.forEach((response) => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('data');
        expect(response.body).toHaveProperty('pagination');
      });
    });

    it('should maintain stable ordering across multiple requests', async () => {
      const page1First = await request(app).get('/api/transactions?limit=5&page=1');
      const page1Second = await request(app).get('/api/transactions?limit=5&page=1');

      expect(page1First.status).toBe(200);
      expect(page1Second.status).toBe(200);

      const idsFirst = page1First.body.data.map((tx: any) => tx.id);
      const idsSecond = page1Second.body.data.map((tx: any) => tx.id);

      expect(idsFirst).toEqual(idsSecond);
    });

    it('should handle invalid sort field gracefully', async () => {
      const response = await request(app).get('/api/transactions?sortBy=invalidField');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
    });

    it('should handle invalid sort order gracefully', async () => {
      const response = await request(app).get('/api/transactions?sortOrder=invalid');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
    });
  });

  // ─── Response Format Tests ───────────────────────────────────────────────

  describe('Response Format', () => {
    it('should include timestamp in ISO 8601 format', async () => {
      const response = await request(app).get('/api/transactions');

      expect(response.status).toBe(200);
      expect(response.body.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/
      );
    });

    it('should include all required pagination fields', async () => {
      const response = await request(app).get('/api/transactions?limit=10');

      expect(response.status).toBe(200);
      const pagination = response.body.pagination;

      expect(pagination).toHaveProperty('count');
      expect(pagination).toHaveProperty('hasNextPage');
      expect(pagination).toHaveProperty('hasPrevPage');
      expect(typeof pagination.count).toBe('number');
      expect(typeof pagination.hasNextPage).toBe('boolean');
      expect(typeof pagination.hasPrevPage).toBe('boolean');
    });

    it('should return consistent data structure', async () => {
      const response = await request(app).get('/api/transactions?limit=1');

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeGreaterThan(0);

      const transaction = response.body.data[0];
      expect(transaction).toHaveProperty('id');
      expect(transaction).toHaveProperty('type');
      expect(transaction).toHaveProperty('amount');
      expect(transaction).toHaveProperty('asset');
      expect(transaction).toHaveProperty('timestamp');
      expect(transaction).toHaveProperty('transactionHash');
      expect(transaction).toHaveProperty('walletAddress');
    });
  });
});
