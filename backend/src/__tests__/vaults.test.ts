import express from 'express';
import request from 'supertest';
import router from '../routes/vaults';
import { getPrismaClient } from '../prismaClient';
import { prisma as extendedPrisma } from '../prisma';
import { registerApiKey } from '../middleware/apiKeyAuth';
import { vaultCountCache } from '../vaultCountCache';

const app = express();
app.use('/vaults', router);
const prisma = getPrismaClient();
const tenantA = 'fixture-count-cache-a';
const tenantB = 'fixture-count-cache-b';
const auth = 'ApiKey test-admin-key';

describe('GET /vaults', () => {
  beforeAll(() => {
    registerApiKey('vault-viewer-a', { role: 'viewer', tenantId: tenantA });
    registerApiKey('vault-viewer-b', { role: 'viewer', tenantId: tenantB });
    registerApiKey('vault-viewer-unknown', { role: 'viewer' });
  });

  beforeEach(async () => {
    await prisma.vault.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    for (let i = 0; i < 6; i++) {
      await prisma.vault.create({
        data: {
          id: `fixture-count-cache-${i}`,
          tenantId: i < 4 ? tenantA : tenantB,
          aum: i,
          createdAt: new Date('2026-01-01'),
        },
      });
    }
    await prisma.vault.create({
      data: {
        id: 'fixture-count-cache-deleted',
        tenantId: tenantA,
        deletedAt: new Date(),
      },
    });
    vaultCountCache.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    vaultCountCache.clear();
  });
  afterAll(async () => {
    await prisma.vault.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await extendedPrisma.$disconnect();
    await prisma.$disconnect();
  });

  it('returns a database failure without caching it and retries the next count', async () => {
    const count = jest
      .spyOn(prisma.vault, 'count')
      .mockRejectedValueOnce(new Error('count failed'));
    const get = () =>
      request(app).get('/vaults').query({ tenantId: tenantA }).set('Authorization', auth);
    expect((await get()).status).toBe(500);
    const recovered = await get();
    expect(recovered.status).toBe(200);
    expect(recovered.headers['x-cache']).toBe('MISS');
    expect(recovered.body.pagination.total).toBe(4);
    expect(count).toHaveBeenCalledTimes(2);
  });

  it('skips the second count query and still fetches fresh rows', async () => {
    const count = jest.spyOn(prisma.vault, 'count');
    const rows = jest.spyOn(prisma.vault, 'findMany');
    const first = await request(app)
      .get('/vaults')
      .query({ tenantId: tenantA })
      .set('Authorization', auth);
    const second = await request(app)
      .get('/vaults')
      .query({ tenantId: tenantA })
      .set('Authorization', auth);
    expect(first.status).toBe(200);
    expect(first.headers['x-cache']).toBe('MISS');
    expect(second.status).toBe(200);
    expect(second.headers['x-cache']).toBe('HIT');
    expect(second.body.pagination.total).toBe(4);
    expect(count).toHaveBeenCalledTimes(1);
    expect(rows).toHaveBeenCalledTimes(2);
  });

  it('shares totals across pages, limits and sorts with stable ordering and correct metadata', async () => {
    const count = jest.spyOn(prisma.vault, 'count');
    const first = await request(app)
      .get('/vaults')
      .query({ tenantId: tenantA, page: 1, limit: 2 })
      .set('Authorization', auth);
    const second = await request(app)
      .get('/vaults')
      .query({ page: 2, limit: 2, tenantId: tenantA })
      .set('Authorization', auth);
    expect(first.body.pagination).toMatchObject({
      count: 2,
      total: 4,
      totalPages: 2,
      hasNextPage: true,
      hasPrevPage: false,
    });
    expect(second.body.pagination).toMatchObject({
      count: 2,
      total: 4,
      totalPages: 2,
      hasNextPage: false,
      hasPrevPage: true,
    });
    expect(second.body.data.map((v: { id: string }) => v.id)).not.toEqual(
      first.body.data.map((v: { id: string }) => v.id)
    );
    const sorted = await request(app)
      .get('/vaults')
      .query({ tenantId: tenantA, limit: 1, sortBy: 'aum', sortOrder: 'asc' })
      .set('Authorization', auth);
    expect(sorted.body.data[0].aum).toBe(0);
    expect(sorted.headers['x-cache']).toBe('HIT');
    expect(count).toHaveBeenCalledTimes(1);
  });

  it('isolates authenticated tenant filters and rejects cross-tenant access', async () => {
    const count = jest.spyOn(prisma.vault, 'count');
    const a = await request(app).get('/vaults').set('Authorization', 'ApiKey vault-viewer-a');
    const b = await request(app).get('/vaults').set('Authorization', 'ApiKey vault-viewer-b');
    expect(a.body.pagination.total).toBe(4);
    expect(b.body.pagination.total).toBe(2);
    expect(b.headers['x-cache']).toBe('MISS');
    expect(b.body.data.every((v: { tenantId: string }) => v.tenantId === tenantB)).toBe(true);
    expect(count).toHaveBeenCalledTimes(2);
    expect(
      (
        await request(app)
          .get('/vaults')
          .query({ tenantId: tenantB })
          .set('Authorization', 'ApiKey vault-viewer-a')
      ).status
    ).toBe(403);
    expect(
      (await request(app).get('/vaults').set('Authorization', 'ApiKey vault-viewer-unknown')).status
    ).toBe(403);
    expect((await request(app).get('/vaults')).status).toBe(401);
  });

  it.each(['shared', 'extended'])(
    'invalidates after real create/update/delete using the %s Prisma client',
    async (client) => {
      const writer = client === 'shared' ? prisma : extendedPrisma;
      const count = jest.spyOn(prisma.vault, 'count');
      const get = () =>
        request(app).get('/vaults').query({ tenantId: tenantA }).set('Authorization', auth);
      await get();
      await writer.vault.create({ data: { id: 'fixture-count-cache-new', tenantId: tenantA } });
      const created = await get();
      expect(created.headers['x-cache']).toBe('MISS');
      expect(created.body.pagination.total).toBe(5);
      await writer.vault.update({
        where: { id: 'fixture-count-cache-new' },
        data: { tenantId: tenantB },
      });
      expect((await get()).body.pagination.total).toBe(4);
      await writer.vault.delete({ where: { id: 'fixture-count-cache-0' } });
      expect((await get()).body.pagination.total).toBe(3);
      expect(count).toHaveBeenCalledTimes(4);
    }
  );

  it('does not invalidate for a failed vault write', async () => {
    const get = () =>
      request(app).get('/vaults').query({ tenantId: tenantA }).set('Authorization', auth);
    await get();
    await expect(
      prisma.vault.update({ where: { id: 'missing-vault' }, data: { aum: 1 } })
    ).rejects.toThrow();
    expect((await get()).headers['x-cache']).toBe('HIT');
  });

  it('invalidates after soft deletion and excludes deleted vaults from rows and total', async () => {
    const get = () =>
      request(app).get('/vaults').query({ tenantId: tenantA }).set('Authorization', auth);
    await get();
    await prisma.vault.update({
      where: { id: 'fixture-count-cache-0' },
      data: { deletedAt: new Date() },
    });
    const result = await get();
    expect(result.headers['x-cache']).toBe('MISS');
    expect(result.body.pagination.total).toBe(3);
    expect(result.body.data).toHaveLength(3);
  });

  it.each([
    { tenantId: '' },
    { tenantId: ['a', 'b'] },
    { sortBy: 'allocations' },
    { cursor: 'unsupported' },
    { page: '999999999999' },
  ])('rejects invalid query %j before querying vaults', async (query) => {
    const count = jest.spyOn(prisma.vault, 'count');
    expect((await request(app).get('/vaults').query(query).set('Authorization', auth)).status).toBe(
      400
    );
    expect(count).not.toHaveBeenCalled();
  });
});
