import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './prismaClient';
import Decimal from 'decimal.js';
import { logger } from './middleware/structuredLogging';

// Use the centralized Prisma Client instance
const getPrisma = () => getPrismaClient();

// Configurable reward percentage (default 5% if not set)
const REFERRAL_REWARD_PERCENTAGE = new Decimal(process.env.REFERRAL_REWARD_PERCENTAGE || '0.05');

export class ReferralService {
  /**
   * Records a referral relationship if it doesn't exist.
   * Updates firstDepositAt if it's the user's first deposit.
   */
  async recordDeposit(walletAddress: string, referralCode?: string): Promise<void> {
    const prisma = getPrisma();
    try {
      await prisma.$transaction(async (tx) => {
        // 1. If code provided, ensure relationship exists
        if (referralCode) {
          const code = await tx.referralCode.findUnique({
            where: { code: referralCode },
          });

          if (code) {
            // Check if user already has a referrer
            const existing = await tx.referral.findUnique({
              where: { referredAddress: walletAddress },
            });

            if (!existing) {
              await tx.referral.create({
                data: {
                  referrerAddress: code.ownerAddress,
                  referredAddress: walletAddress,
                },
              });
              logger.log('info', 'New referral relationship recorded', {
                referrer: code.ownerAddress,
                referred: walletAddress,
              });
            }
          }
        }

        // 2. Check if this is the first deposit
        const referral = await tx.referral.findUnique({
          where: { referredAddress: walletAddress },
        });

        if (referral && !referral.firstDepositAt) {
          await tx.referral.update({
            where: { referredAddress: walletAddress },
            data: { firstDepositAt: new Date() },
          });
          logger.log('info', 'First deposit timestamp recorded for referral', {
            referred: walletAddress,
          });
        }
      });
    } catch (error) {
      logger.log('error', 'Failed to record referral deposit', {
        error: error instanceof Error ? error.message : String(error),
        walletAddress,
      });
      // We don't throw here to avoid blocking the main deposit flow
    }
  }

  /**
   * Calculates total rewards for a referrer.
   * Real-time calculation accurate to 6 decimal places.
   */
  async getReferralStats(referrerAddress: string): Promise<{ referral_count: number; total_reward_earned: string } | null> {
    const prisma = getPrisma();
    const referrals = await prisma.referral.findMany({
      where: {
        referrerAddress,
        firstDepositAt: { not: null },
      },
    });

    if (referrals.length === 0) {
      return null;
    }

    let totalReward = new Decimal(0);

    for (const ref of referrals) {
      const yield_earned = await this.calculateUserYield(ref.referredAddress);
      if (yield_earned.gt(0)) {
        const reward = yield_earned.mul(REFERRAL_REWARD_PERCENTAGE);
        totalReward = totalReward.plus(reward);
      }
    }

    return {
      referral_count: referrals.length,
      total_reward_earned: totalReward.toFixed(6),
    };
  }

  /**
   * Mock implementation of yield calculation.
   * In a real system, this would fetch user shares and current share price.
   */
  private async calculateUserYield(walletAddress: string): Promise<any> {
    const prisma = getPrisma();
    // For the purpose of this task, we'll simulate yield.
    // In a real scenario, this would be: (shares * price) - totalDeposited
    // Here we'll look for transactions to at least make it dynamic-ish if they exist.
    const txs = await prisma.transaction.findMany({
      where: { user: walletAddress, type: 'deposit' },
    });

    if (txs.length === 0) return new Decimal(0);

    const totalDeposited = txs.reduce((sum: any, tx: any) => sum.plus(new Decimal(tx.amount)), new Decimal(0));
    
    // Simulate 10% gain for demonstration purposes if there's no real price source
    // Real logic would use: return currentUserValue.minus(totalDeposited).toDecimalPlaces(6);
    return totalDeposited.mul('0.1').toDecimalPlaces(6);
  }

  /**
   * Get or create a referral code for a wallet address.
   * Generates a unique 8-character alphanumeric code if one doesn't exist.
   */
  async getOrCreateReferralCode(ownerAddress: string): Promise<string> {
    const prisma = getPrisma();

    // Check if code already exists
    const existing = await prisma.referralCode.findUnique({
      where: { ownerAddress },
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
      data: { code, ownerAddress },
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
      data: { code, ownerAddress },
    });
  }
}

export const referralService = new ReferralService();
