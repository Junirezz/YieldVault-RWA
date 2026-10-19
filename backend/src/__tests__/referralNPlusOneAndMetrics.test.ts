import { referralService } from '../referralService';
import { getPrismaClient } from '../prismaClient';
import * as operationalMetrics from '../operationalMetrics';

describe('Issue #1616 — N+1 yield calculation and bounded vault metrics', () => {
  const prisma = getPrismaClient();

  beforeEach(() => {
    referralService.clearSnapshotCache();
  });

  it('getReferralStats issues a constant number of queries for 50 referrals', async () => {
    const referrer = 'GREFERRER50CONSTANTQUERIESTEST123456789012345678901234567';
    const fakeReferrals = Array.from({ length: 50 }, (_, i) => ({
      id: `ref-${i}`,
      referrerAddress: referrer,
      referredAddress: `GREFERRED${i.toString().padStart(40, '0')}`,
      firstDepositAt: new Date(),
    }));

    const fakeTransactions = fakeReferrals.map((r, i) => ({
      id: `tx-${i}`,
      user: r.referredAddress,
      amount: '100',
      type: 'deposit',
      status: 'completed',
      timestamp: new Date(),
    }));

    const fakeSnapshots = [
      {
        id: 'snap-1',
        sharePrice: '1.25',
        recordedAt: new Date(),
        createdAt: new Date(),
      },
    ];

    let queryCount = 0;
    const originalReferralFindMany = prisma.referral.findMany;
    const originalTxFindMany = prisma.transaction.findMany;
    const originalSnapFindMany = prisma.sharePriceSnapshot.findMany;

    const spyReferral = jest.spyOn(prisma.referral, 'findMany').mockImplementation(async (...args: any[]) => {
      queryCount++;
      return fakeReferrals as any;
    });

    const spyTx = jest.spyOn(prisma.transaction, 'findMany').mockImplementation(async (...args: any[]) => {
      queryCount++;
      return fakeTransactions as any;
    });

    const spySnap = jest.spyOn(prisma.sharePriceSnapshot, 'findMany').mockImplementation(async (...args: any[]) => {
      queryCount++;
      return fakeSnapshots as any;
    });

    try {
      const stats = await referralService.getReferralStats(referrer);
      expect(stats).not.toBeNull();
      expect(stats?.referral_count).toBe(50);
      // For 50 referrals, Prisma queries must be constant (exactly 3 queries: referral, transactions, snapshots)
      expect(queryCount).toBeLessThanOrEqual(3);
      expect(spyReferral).toHaveBeenCalledTimes(1);
      expect(spyTx).toHaveBeenCalledTimes(1);
      expect(spySnap).toHaveBeenCalledTimes(1);
    } finally {
      spyReferral.mockRestore();
      spyTx.mockRestore();
      spySnap.mockRestore();
    }
  });

  it('sharePriceSnapshot reads are bounded with take or cached', async () => {
    const spySnap = jest.spyOn(prisma.sharePriceSnapshot, 'findMany').mockResolvedValueOnce([
      { sharePrice: '1.10', recordedAt: new Date() } as any,
    ]);

    try {
      const snapshots = await referralService.getSharePriceSnapshots(true);
      expect(spySnap).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 1000,
        }),
      );
      expect(snapshots.length).toBe(1);

      // Calling again uses in-memory cache, no new query
      await referralService.getSharePriceSnapshots();
      expect(spySnap).toHaveBeenCalledTimes(1);
    } finally {
      spySnap.mockRestore();
    }
  });

  it('vault metrics use take: 10 and bounded concurrency', async () => {
    const spyVaultFindMany = jest.spyOn(prisma.vault, 'findMany').mockResolvedValue([
      { id: 'v1', tenantId: 't1' },
      { id: 'v2', tenantId: 't2' },
    ] as any);

    const spyUserCount = jest.spyOn(prisma.user, 'count').mockResolvedValue(10);
    const spyTxFindMany = jest.spyOn(prisma.transaction, 'findMany').mockResolvedValue([]);

    try {
      const data = await operationalMetrics.getHealthDashboardData();
      expect(data).toBeDefined();

      // Ensure prisma.vault.findMany was called with take: 10
      expect(spyVaultFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
        }),
      );
    } finally {
      spyVaultFindMany.mockRestore();
      spyUserCount.mockRestore();
      spyTxFindMany.mockRestore();
    }
  });
});
