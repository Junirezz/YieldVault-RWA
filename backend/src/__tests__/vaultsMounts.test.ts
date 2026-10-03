import request from 'supertest';
import app from '../index';
import { vaultCountCache } from '../vaultCountCache';

describe('vault list application mounts', () => {
  beforeEach(() => vaultCountCache.clear());

  it('serves the versioned route and both aliases with a shared count cache', async () => {
    for (const [index, path] of ['/api/v1/vaults', '/api/vaults', '/vaults'].entries()) {
      const response = await request(app)
        .get(path)
        .query({ tenantId: 'fixture-count-cache-empty' })
        .set('Authorization', 'ApiKey test-admin-key');
      expect(response.status).toBe(200);
      expect(response.headers['x-cache']).toBe(index === 0 ? 'MISS' : 'HIT');
      expect(response.body.pagination.total).toBe(0);
      expect(response.body.data).toEqual([]);
    }
  });
});
