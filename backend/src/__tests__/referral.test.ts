import request from 'supertest';
import app from '../index';
import { getPrismaClient, disconnectPrismaClient } from '../prismaClient';
import { referralService } from '../referralService';
import { walletAliasMappingService } from '../walletAliasService';
import { VALID_TEST_WALLET, SECOND_TEST_WALLET, THIRD_TEST_WALLET } from './setup';

// Use the centralized Prisma Client instance
const getPrisma = () => getPrismaClient();

describe('Referral System Integration', () => {
  const referrerWallet = VALID_TEST_WALLET;
  const referredWallet = SECOND_TEST_WALLET;
  const referralCode = 'WELCOME2026';

  beforeAll(async () => {
    // Clear relevant data
    const prisma = getPrisma();
    await prisma.sharePriceSnapshot.deleteMany();
    await prisma.vaultState.deleteMany();
    await prisma.referral.deleteMany();
    await prisma.referralCode.deleteMany();
    await prisma.transaction.deleteMany();
    await walletAliasMappingService.resetForTests();

    // Setup referral code
    await referralService.createReferralCode(referrerWallet, referralCode);
  });

  afterAll(async () => {
    await disconnectPrismaClient();
  });

  describe('POST /api/v1/vault/deposits with referral', () => {
    it('should record referral relationship on first deposit', async () => {
      const response = await request(app)
        .post('/api/v1/vault/deposits')
        .send({
          amount: '1000',
          asset: 'USDC',
          walletAddress: referredWallet,
          referralCode: referralCode,
        });

      expect(response.status).toBe(201);

      // Verify referral record
      const prisma = getPrisma();
      const referral = await prisma.referral.findUnique({
        where: { referredAddress: referredWallet },
      });

      expect(referral).toBeDefined();
      expect(referral?.referrerAddress).toBe(referrerWallet);
      expect(referral?.firstDepositAt).not.toBeNull();
    });

    it('should not update firstDepositAt on subsequent deposits', async () => {
      const prisma = getPrisma();
      const referralBefore = await prisma.referral.findUnique({
        where: { referredAddress: referredWallet },
      });

      // Wait a bit to ensure timestamp would be different
      await new Promise(resolve => setTimeout(resolve, 100));

      await request(app)
        .post('/api/v1/vault/deposits')
        .send({
          amount: '500',
          asset: 'USDC',
          walletAddress: referredWallet,
          referralCode: referralCode,
        });

      const referralAfter = await prisma.referral.findUnique({
        where: { referredAddress: referredWallet },
      });

      expect(referralAfter?.firstDepositAt?.toISOString()).toBe(referralBefore?.firstDepositAt?.toISOString());
    });
  });

  describe('GET /api/v1/referrals/:wallet', () => {
    it('should return referral stats with 6-decimal precision', async () => {
      const prisma = getPrisma();
      await prisma.sharePriceSnapshot.create({
        data: {
          sharePrice: '1.100000',
          totalAssets: '1650.000000',
          totalShares: '1500.000000',
          source: 'test_yield_period_close',
          recordedAt: new Date(Date.now() + 1000),
        },
      });

      const response = await request(app).get(`/api/v1/referrals/${referrerWallet}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('referral_count', 1);
      
      // Shares are minted 1:1 at entry and later valued at share price 1.1:
      // Deposits: 1500 total, shares: 1500, ending value: 1650
      // Net yield: 1650 - 1500 = 150
      // Reward: 150 * 0.05 = 7.5
      expect(response.body.total_reward_earned).toBe('7.500000');
    });

    it('should return 404 for wallet with no referral activity', async () => {
      const response = await request(app).get(`/api/v1/referrals/${THIRD_TEST_WALLET}`);
      expect(response.status).toBe(404);
    });
  });

  describe('Reward Calculation Precision', () => {
    it('should handle small yield values with precision', async () => {
      const prisma = getPrisma();
      await prisma.sharePriceSnapshot.deleteMany();
      await prisma.vaultState.deleteMany();
      await prisma.referral.deleteMany();
      await prisma.referralCode.deleteMany();
      await prisma.transaction.deleteMany();

      const precisionReferrerWallet =
        'G56789ABCDEFGHIJKLMNOPQRSTUVWXYZ56789ABCDEFGHIJKLMNOPQRST';
      const smallReferredWallet = THIRD_TEST_WALLET;
      const precisionReferralCode = 'MICROYLD1';

      await referralService.createReferralCode(
        precisionReferrerWallet,
        precisionReferralCode,
      );
      
      // Record small deposit
      await request(app)
        .post('/api/v1/vault/deposits')
        .send({
          amount: '0.012345',
          asset: 'USDC',
          walletAddress: smallReferredWallet,
          referralCode: precisionReferralCode,
        });

      await prisma.sharePriceSnapshot.create({
        data: {
          sharePrice: '1.001000',
          totalAssets: '0.012357',
          totalShares: '0.012345',
          source: 'test_small_yield_close',
          recordedAt: new Date(Date.now() + 2000),
        },
      });

      const response = await request(app).get(
        `/api/v1/referrals/${precisionReferrerWallet}`,
      );
      
      expect(response.body.total_reward_earned).toBe('0.000001');
      expect(response.body.total_reward_earned).toMatch(/^\d+\.\d{6}$/);
    });
  });

  describe('Persisted wallet alias referral attribution', () => {
    it('uses persisted canonical wallet aliases after cache hydration', async () => {
      const prisma = getPrisma();
      await prisma.referral.deleteMany();
      await prisma.referralCode.deleteMany();
      await prisma.transaction.deleteMany();
      await walletAliasMappingService.resetForTests();

      const persistedReferralCode = 'ALIAS2026';
      await referralService.createReferralCode(referrerWallet, persistedReferralCode);
      await walletAliasMappingService.linkProviderIdentity(
        referredWallet,
        'stellar',
        'wallet-connect-referred',
        'walletconnect',
      );

      await walletAliasMappingService.loadFromDatabase(true);
      await referralService.recordDeposit(referredWallet.toLowerCase(), persistedReferralCode);

      const referral = await prisma.referral.findUnique({
        where: { referredAddress: referredWallet },
      });

      expect(referral).toBeDefined();
      expect(referral?.referrerAddress).toBe(referrerWallet);
      expect(referral?.firstDepositAt).not.toBeNull();
      expect(await walletAliasMappingService.resolveCanonicalWallet('wallet-connect-referred', 'walletconnect')).toBe(
        referredWallet,
      );
    });
  });
});
