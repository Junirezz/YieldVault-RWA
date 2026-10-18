jest.mock('../redisCache', () => ({
  getFromCache: jest.fn(),
  setInCache: jest.fn(),
  invalidateCachePattern: jest.fn(),
}));

import { getFromCache, setInCache, invalidateCachePattern } from '../redisCache';
import {
  getOrSetVaultSummary,
  getOrSetUserStats,
  invalidateVaultCaches,
  VaultCacheKeys,
} from '../vaultDataCache';

describe('vaultDataCache', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the cached value without calling the fetcher on a hit', async () => {
    (getFromCache as jest.Mock).mockResolvedValue({ data: { tvl: 1 }, expiresAt: Date.now() + 10_000 });
    const fetcher = jest.fn();
    await expect(getOrSetVaultSummary(fetcher)).resolves.toEqual({ data: { tvl: 1 }, cached: true });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fetches and stores on a miss or expired entry', async () => {
    (getFromCache as jest.Mock).mockResolvedValue({ data: 'old', expiresAt: Date.now() - 1 });
    const fetcher = jest.fn().mockResolvedValue({ stats: 2 });
    await expect(getOrSetUserStats('GWALLET', fetcher)).resolves.toEqual({ data: { stats: 2 }, cached: false });
    expect(setInCache).toHaveBeenCalledWith(
      VaultCacheKeys.userStats('GWALLET'),
      expect.objectContaining({ data: { stats: 2 } }),
      expect.any(Number),
    );
  });

  it('invalidates wallet-scoped and summary keys on deposit events', async () => {
    await invalidateVaultCaches('vault.deposit.created', { wallet: 'GWALLET' });
    const patterns = (invalidateCachePattern as jest.Mock).mock.calls.map((c) => c[0]);
    expect(patterns).toEqual(
      expect.arrayContaining(['vault:summary', 'vault:tvl', VaultCacheKeys.userStats('GWALLET')]),
    );
  });

  it('does nothing for unrelated events', async () => {
    await invalidateVaultCaches('unrelated.event');
    expect(invalidateCachePattern).not.toHaveBeenCalled();
  });
});
