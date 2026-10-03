import {
  buildVaultFilterHash,
  invalidateVaultCountAfterMutation,
  VaultCountCache,
  vaultCountCache,
} from '../vaultCountCache';
import { triggerCacheInvalidation } from '../middleware/cache';

describe('vault count cache', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    vaultCountCache.clear();
  });

  it('hashes equivalent nested filters identically and separates different tenants', () => {
    expect(buildVaultFilterHash({ tenantId: 'a', deletedAt: null })).toBe(
      buildVaultFilterHash({ deletedAt: null, tenantId: 'a' })
    );
    expect(buildVaultFilterHash({ AND: [{ aum: { gt: 1, lt: 10 } }] })).toBe(
      buildVaultFilterHash({ AND: [{ aum: { lt: 10, gt: 1 } }] })
    );
    expect(buildVaultFilterHash({ tenantId: 'a' })).not.toBe(
      buildVaultFilterHash({ tenantId: 'b' })
    );
  });

  it('caches zero totals and expires exactly five seconds after loading, without sliding TTL', async () => {
    let now = 1000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const cache = new VaultCountCache();
    const load = jest.fn().mockResolvedValue(0);
    expect(await cache.get('filter', load)).toEqual({ total: 0, status: 'MISS' });
    now += 4999;
    expect(await cache.get('filter', load)).toEqual({ total: 0, status: 'HIT' });
    now++;
    expect(await cache.get('filter', load)).toEqual({ total: 0, status: 'MISS' });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('evicts the least recently used filter at capacity', async () => {
    const cache = new VaultCountCache(2);
    const load = jest.fn().mockResolvedValue(3);
    await cache.get('a', load);
    await cache.get('b', load);
    await cache.get('a', load);
    await cache.get('c', load);
    expect((await cache.get('a', load)).status).toBe('HIT');
    expect((await cache.get('b', load)).status).toBe('MISS');
  });

  it('coalesces concurrent counts and retries after a failed query', async () => {
    const cache = new VaultCountCache();
    const load = jest
      .fn()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValue(5);
    const failed = await Promise.allSettled([cache.get('a', load), cache.get('a', load)]);
    expect(failed.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(load).toHaveBeenCalledTimes(1);
    expect(await cache.get('a', load)).toEqual({ total: 5, status: 'MISS' });
  });

  it('discards counts invalidated while the query was in flight', async () => {
    const cache = new VaultCountCache();
    let resolve!: (count: number) => void;
    const load = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<number>((done) => {
            resolve = done;
          })
      )
      .mockResolvedValue(7);
    const pending = cache.get('a', load);
    await Promise.resolve();
    cache.clear();
    resolve(6);
    expect(await pending).toEqual({ total: 7, status: 'MISS' });
    expect(await cache.get('a', load)).toEqual({ total: 7, status: 'HIT' });
  });

  it.each(['vault.create', 'vault.update', 'vault.delete'])(
    'invalidates all filters on %s',
    async (event) => {
      const load = jest.fn().mockResolvedValue(2);
      await vaultCountCache.get('a', load);
      await vaultCountCache.get('b', load);
      triggerCacheInvalidation(event);
      expect((await vaultCountCache.get('a', load)).status).toBe('MISS');
      expect((await vaultCountCache.get('b', load)).status).toBe('MISS');
    }
  );

  it.each(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'])(
    'routes Vault.%s through invalidation',
    async (operation) => {
      const load = jest.fn().mockResolvedValue(1);
      await vaultCountCache.get('a', load);
      invalidateVaultCountAfterMutation('Vault', operation);
      expect((await vaultCountCache.get('a', load)).status).toBe('MISS');
    }
  );

  it('preserves counts for reads and other models', async () => {
    const load = jest.fn().mockResolvedValue(1);
    await vaultCountCache.get('a', load);
    invalidateVaultCountAfterMutation('Vault', 'findMany');
    invalidateVaultCountAfterMutation('Transaction', 'create');
    triggerCacheInvalidation('unrelated.event');
    expect((await vaultCountCache.get('a', load)).status).toBe('HIT');
  });
});
