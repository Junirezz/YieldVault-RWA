import Decimal from 'decimal.js';
import { getPrismaClient } from './prismaClient';
import { logger } from './middleware/structuredLogging';
import { normalizeWalletAddress } from './walletUtils';
import { walletAliasMappingService } from './walletAliasService';
import { invalidateCache } from './middleware/cache';

// Use the centralized Prisma Client instance
const getPrisma = () => getPrismaClient();

// Configurable reward percentage (default 5% if not set)
const REFERRAL_REWARD_PERCENTAGE = new Decimal(
  process.env.REFERRAL_REWARD_PERCENTAGE || '0.05',
);
const ZERO = new Decimal(0);
const DEFAULT_SHARE_PRICE = new Decimal(1);
const OUTPUT_DECIMAL_PLACES = 6;

export class ReferralService {
  /**
   * Records a referral relationship if it doesn't exist.
   * Updates firstDepositAt if it's the user's first deposit.
   */
  async recordDeposit(walletAddress: string, referralCode?: string): Promise<void> {
    const prisma = getPrisma();
    const normalizedReferred = await walletAliasMappingService.resolveCanonicalWallet(
      walletAddress,
      'stellar',
    );
    try {
      await prisma.$transaction(async (tx) => {
        // 1. If code provided, ensure relationship exists
        if (referralCode) {
          const code = await tx.referralCode.findUnique({
            where: { code: referralCode },
          });

          if (code) {
            const normalizedReferrer = normalizeWalletAddress(code.ownerAddress);
            // Check if user already has a referrer
            const existing = await tx.referral.findUnique({
              where: { referredAddress: normalizedReferred },
            });

            if (!existing) {
              await tx.referral.create({
                data: {
                  referrerAddress: normalizedReferrer,
                  referredAddress: normalizedReferred,
                },
              });
              logger.log('info', 'New referral relationship recorded', {
                referrer: normalizedReferrer,
                referred: normalizedReferred,
              });
            }
          }
        }

        // 2. Check if this is the first deposit
        const referral = await tx.referral.findUnique({
          where: { referredAddress: normalizedReferred },
        });

        if (referral && !referral.firstDepositAt) {
          await tx.referral.update({
            where: { referredAddress: normalizedReferred },
            data: { firstDepositAt: new Date() },
          });
          logger.log('info', 'First deposit timestamp recorded for referral', {
            referred: normalizedReferred,
          });
        }
      });
    } catch (error) {
      logger.log('error', 'Failed to record referral deposit', {
        error: error instanceof Error ? error.message : String(error),
        walletAddress: normalizedReferred,
      });
      // We don't throw here to avoid blocking the main deposit flow
      return;
    }
    // R5: invalidate referral cache entries after a successful deposit
    invalidateCache('GET:/api/v1/referrals');
  }

  /**
   * Calculates total rewards for a referrer.
   * Real-time calculation accurate to 6 decimal places.
   */
  async getReferralStats(referrerAddress: string): Promise<{ referral_count: number; total_reward_earned: string } | null> {
    const prisma = getPrisma();
    const normalizedReferrer = normalizeWalletAddress(referrerAddress);
    const referrals = await prisma.referral.findMany({
      where: {
        referrerAddress: normalizedReferrer,
        firstDepositAt: { not: null },
      },
    });

    if (referrals.length === 0) {
      return null;
    }

    let totalReward = ZERO;

    for (const ref of referrals) {
      const yield_earned = await this.calculateUserYield(normalizeWalletAddress(ref.referredAddress));
      if (yield_earned.greaterThan(ZERO)) {
        const reward = yield_earned.mul(REFERRAL_REWARD_PERCENTAGE);
        totalReward = totalReward.plus(reward);
      }
    }

    return {
      referral_count: referrals.length,
      total_reward_earned: totalReward.toDecimalPlaces(OUTPUT_DECIMAL_PLACES).toFixed(OUTPUT_DECIMAL_PLACES),
    };
  }

  /**
   * Calculates user net yield from transaction history and persisted share price snapshots.
   * Uses share-balance accounting so deposits and withdrawals across multiple periods
   * are valued at the snapshot price in effect at the time of each transaction.
   */
  async calculateUserYield(walletAddress: string): Promise<Decimal> {
    const prisma = getPrisma();
    const normalizedWallet = normalizeWalletAddress(walletAddress);
    const [transactions, snapshots] = await Promise.all([
      prisma.transaction.findMany({
        where: {
          user: normalizedWallet,
          type: { in: ['deposit', 'withdrawal'] },
          OR: [{ status: null }, { status: 'completed' }, { status: 'pending' }],
        },
        orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
      }),
      prisma.sharePriceSnapshot.findMany({
        orderBy: [{ recordedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);

    if (transactions.length === 0) {
      this.logYieldCalculation(normalizedWallet, {
        transactionCount: 0,
        snapshotCount: snapshots.length,
        totalDeposited: ZERO,
        totalWithdrawn: ZERO,
        endingShares: ZERO,
        endingSharePrice: DEFAULT_SHARE_PRICE,
        endingValue: ZERO,
        netYield: ZERO,
      });
      return ZERO;
    }

    let totalDeposited = ZERO;
    let totalWithdrawn = ZERO;
    let sharesOwned = ZERO;

    for (const tx of transactions) {
      const amount = this.parseDecimal(tx.amount);
      if (amount.lte(ZERO)) {
        continue;
      }

      const sharePrice = this.resolveSharePriceForTimestamp(
        snapshots,
        tx.timestamp,
      );

      if (tx.type === 'deposit') {
        totalDeposited = totalDeposited.plus(amount);
        sharesOwned = sharesOwned.plus(amount.div(sharePrice));
        continue;
      }

      const sharesToBurn = amount.div(sharePrice);
      totalWithdrawn = totalWithdrawn.plus(amount);
      sharesOwned = Decimal.max(ZERO, sharesOwned.minus(sharesToBurn));
    }

    const endingSharePrice = this.resolveLatestSharePrice(snapshots);
    const endingValue = sharesOwned.mul(endingSharePrice);
    const netYield = endingValue.plus(totalWithdrawn).minus(totalDeposited);
    const nonNegativeNetYield = Decimal.max(ZERO, netYield);

    this.logYieldCalculation(normalizedWallet, {
      transactionCount: transactions.length,
      snapshotCount: snapshots.length,
      totalDeposited,
      totalWithdrawn,
      endingShares: sharesOwned,
      endingSharePrice,
      endingValue,
      netYield: nonNegativeNetYield,
    });

    return nonNegativeNetYield.toDecimalPlaces(OUTPUT_DECIMAL_PLACES);
  }

  /**
   * Get or create a referral code for a wallet address.
   * Generates a unique 8-character alphanumeric code if one doesn't exist.
   */
  async getOrCreateReferralCode(ownerAddress: string): Promise<string> {
    const prisma = getPrisma();
    const normalizedOwner = normalizeWalletAddress(ownerAddress);

    // Check if code already exists
    const existing = await prisma.referralCode.findFirst({
      where: { ownerAddress: normalizedOwner },
    });

    if (existing) {
      return existing.code;
    }

    // Generate unique code
    let code: string;
    let attempts = 0;
    do {
      code = this.generateReferralCode();
      attempts++;
      if (attempts > 10) {
        throw new Error("Failed to generate unique referral code after 10 attempts");
      }
    } while (await prisma.referralCode.findUnique({ where: { code } }));

    // Create new code
    await prisma.referralCode.create({
      data: { code, ownerAddress: normalizedOwner },
    });

    return code;
  }

  /**
   * Generate a random 8-character alphanumeric referral code.
   */
  private generateReferralCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Create a referral code for a wallet (helper for testing/bootstrapping).
   */
  async createReferralCode(ownerAddress: string, code: string): Promise<void> {
    const prisma = getPrisma();
    await prisma.referralCode.create({
      data: { code, ownerAddress: normalizeWalletAddress(ownerAddress) },
    });
  }

  private parseDecimal(value: string): Decimal {
    try {
      return new Decimal(value || '0');
    } catch {
      return ZERO;
    }
  }

  private resolveLatestSharePrice(
    snapshots: Array<{ sharePrice: string }>,
  ): Decimal {
    if (snapshots.length === 0) {
      return DEFAULT_SHARE_PRICE;
    }

    return Decimal.max(
      DEFAULT_SHARE_PRICE,
      this.parseDecimal(snapshots[snapshots.length - 1].sharePrice),
    );
  }

  private resolveSharePriceForTimestamp(
    snapshots: Array<{ sharePrice: string; recordedAt: Date }>,
    timestamp: Date,
  ): Decimal {
    const beforeOrAt = snapshots.filter(
      (snapshot) => snapshot.recordedAt.getTime() <= timestamp.getTime(),
    );

    if (beforeOrAt.length > 0) {
      return Decimal.max(
        DEFAULT_SHARE_PRICE,
        this.parseDecimal(beforeOrAt[beforeOrAt.length - 1].sharePrice),
      );
    }

    if (snapshots.length > 0) {
      return Decimal.max(
        DEFAULT_SHARE_PRICE,
        this.parseDecimal(snapshots[0].sharePrice),
      );
    }

    return DEFAULT_SHARE_PRICE;
  }

  private logYieldCalculation(
    normalizedWallet: string,
    details: {
      transactionCount: number;
      snapshotCount: number;
      totalDeposited: Decimal;
      totalWithdrawn: Decimal;
      endingShares: Decimal;
      endingSharePrice: Decimal;
      endingValue: Decimal;
      netYield: Decimal;
    },
  ): void {
    logger.log('info', 'Referral yield calculated', {
      walletSuffix: normalizedWallet.slice(-6),
      transactionCount: details.transactionCount,
      snapshotCount: details.snapshotCount,
      totalDeposited: details.totalDeposited.toFixed(OUTPUT_DECIMAL_PLACES),
      totalWithdrawn: details.totalWithdrawn.toFixed(OUTPUT_DECIMAL_PLACES),
      endingShares: details.endingShares.toFixed(OUTPUT_DECIMAL_PLACES),
      endingSharePrice: details.endingSharePrice.toFixed(
        OUTPUT_DECIMAL_PLACES,
      ),
      endingValue: details.endingValue.toFixed(OUTPUT_DECIMAL_PLACES),
      netYield: details.netYield.toFixed(OUTPUT_DECIMAL_PLACES),
    });
  }
}

export const referralService = new ReferralService();
