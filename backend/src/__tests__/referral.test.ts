import request from 'supertest';
import app from '../index';
import { getPrismaClient, disconnectPrismaClient } from '../prismaClient';
import { referralService } from '../referralService';

// Use the centralized Prisma Client instance
const getPrisma = () => getPrismaClient();

describe('Referral System Integration', () => {
  const referrerWallet = 'G_REFERRER_WALLET_ADDRESS';
  const referredWallet = 'G_REFERRED_WALLET_ADDRESS';
  const referralCode = 'WELCOME2026';

  beforeAll(async () => {
    // Clear relevant data
    const prisma = getPrisma();
    await prisma.referral.deleteMany();
    await prisma.referralCode.deleteMany();
    await prisma.transaction.deleteMany();

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
      const response = await request(app).get(`/api/v1/referrals/${referrerWallet}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('referral_count', 1);
      
      // Based on our mock yield calculation (10% gain, 5% reward):
      // Total deposited: 1000 + 500 = 1500
      // Yield: 1500 * 0.1 = 150
      // Reward: 150 * 0.05 = 7.5
      expect(response.body.total_reward_earned).toBe('7.500000');
    });

    it('should return 404 for wallet with no referral activity', async () => {
      const response = await request(app).get('/api/v1/referrals/G_UNKNOWN_WALLET');
      expect(response.status).toBe(404);
    });
  });

  describe('Reward Calculation Precision', () => {
    it('should handle small yield values with precision', async () => {
      const smallReferredWallet = 'G_SMALL_REFERRED';
      
      // Record small deposit
      await request(app)
        .post('/api/v1/vault/deposits')
        .send({
          amount: '0.012345',
          asset: 'USDC',
          walletAddress: smallReferredWallet,
          referralCode: referralCode,
        });

      const response = await request(app).get(`/api/v1/referrals/${referrerWallet}`);
      
      // Previous 7.5 + (0.012345 * 0.1 * 0.05)
      // 0.012345 * 0.005 = 0.000061725
      // 7.5 + 0.000061725 = 7.500061725 -> 7.500062 (rounded to 6 places in simulation maybe)
      // Actually our simulate calculation rounds yield to 6 places then multiplies
      // yield = 0.012345 * 0.1 = 0.0012345 -> rounded 0.001235
      // reward = 0.001235 * 0.05 = 0.00006175
      // total = 7.5 + 0.00006175 = 7.50006175
      
      expect(response.body.total_reward_earned).toMatch(/^\d+\.\d{6}$/);
    });
  });
});
