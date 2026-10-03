import { Router, Request, Response } from 'express';
import { referralService } from './referralService';
import { logger } from './middleware/structuredLogging';
import { normalizeWalletAddress } from './walletUtils';
import { cacheMiddleware } from './middleware/cache';
import { buildApiErrorBody, type ApiErrorBody } from './middleware/apiError';

const router = Router();
const REFERRAL_CACHE_TTL_MS = parseInt(process.env.CACHE_LIST_ENDPOINTS_TTL_MS || '30000', 10);

const WALLET_REQUIRED_MESSAGE = 'Wallet address is required';
const REFERRAL_STATS_NOT_FOUND_MESSAGE = 'No referral activity found for this wallet';
const REFERRAL_STATS_ERROR_MESSAGE = 'Failed to fetch referral stats';
const REFERRAL_CODE_ERROR_MESSAGE = 'Failed to get referral code';

export function buildReferralWalletRequiredBody(): ApiErrorBody {
  return buildApiErrorBody({ status: 400, message: WALLET_REQUIRED_MESSAGE });
}

export function buildReferralStatsNotFoundBody(): ApiErrorBody {
  return buildApiErrorBody({ status: 404, message: REFERRAL_STATS_NOT_FOUND_MESSAGE });
}

export function buildReferralStatsErrorBody(): ApiErrorBody {
  return buildApiErrorBody({ status: 500, message: REFERRAL_STATS_ERROR_MESSAGE });
}

export function buildReferralCodeErrorBody(): ApiErrorBody {
  return buildApiErrorBody({ status: 500, message: REFERRAL_CODE_ERROR_MESSAGE });
}

/**
 * @openapi
 * /api/v1/referrals/{wallet}:
 *   get:
 *     summary: Get referral stats for a wallet
 *     description: Returns referral count and total reward earned for the given wallet address.
 *     tags: [Referrals]
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema: { type: string }
 *         description: Wallet address of the referrer
 *     responses:
 *       200:
 *         description: Referral stats
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 referral_count: { type: integer }
 *                 total_reward_earned: { type: string }
 *       404:
 *         description: Wallet has no referral activity
 *       500:
 *         description: Internal server error
 */
router.get('/:wallet', cacheMiddleware({ ttl: REFERRAL_CACHE_TTL_MS }), async (req: Request, res: Response) => {
  const { wallet } = req.params;

  if (!wallet) {
    return res.status(400).json(buildReferralWalletRequiredBody());
  }

  const normalizedWallet = normalizeWalletAddress(wallet);

  try {
    const stats = await referralService.getReferralStats(normalizedWallet);

    if (!stats) {
      return res.status(404).json(buildReferralStatsNotFoundBody());
    }

    return res.status(200).json(stats);
  } catch (error) {
    logger.log('error', 'Error fetching referral stats', {
      error: error instanceof Error ? error.message : String(error),
      wallet: normalizedWallet,
    });
    return res.status(500).json(buildReferralStatsErrorBody());
  }
});

/**
 * @openapi
 * /api/v1/referrals/code/{wallet}:
 *   get:
 *     summary: Get referral code for a wallet
 *     description: Returns the referral code for the given wallet address, creating one if it doesn't exist.
 *     tags: [Referrals]
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema: { type: string }
 *         description: Wallet address to get referral code for
 *     responses:
 *       200:
 *         description: Referral code
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code: { type: string }
 *       500:
 *         description: Internal server error
 */
router.get('/code/:wallet', cacheMiddleware({ ttl: REFERRAL_CACHE_TTL_MS }), async (req: Request, res: Response) => {
  const { wallet } = req.params;

  if (!wallet) {
    return res.status(400).json(buildReferralWalletRequiredBody());
  }

  const normalizedWallet = normalizeWalletAddress(wallet);

  try {
    const code = await referralService.getOrCreateReferralCode(normalizedWallet);
    return res.status(200).json({ code });
  } catch (error) {
    logger.log('error', 'Error getting referral code', {
      error: error instanceof Error ? error.message : String(error),
      wallet: normalizedWallet,
    });
    return res.status(500).json(buildReferralCodeErrorBody());
  }
});

export default router;
