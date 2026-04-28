import { Router, Request, Response } from 'express';
import { referralService } from './referralService';
import { logger } from './middleware/structuredLogging';

const router = Router();

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
router.get('/:wallet', async (req: Request, res: Response) => {
  const { wallet } = req.params;

  if (!wallet) {
    return res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'Wallet address is required',
    });
  }

  try {
    const stats = await referralService.getReferralStats(wallet);

    if (!stats) {
      return res.status(404).json({
        error: 'Not Found',
        status: 404,
        message: 'No referral activity found for this wallet',
      });
    }

    return res.status(200).json(stats);
  } catch (error) {
    logger.log('error', 'Error fetching referral stats', {
      error: error instanceof Error ? error.message : String(error),
      wallet,
    });
    return res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: 'Failed to fetch referral stats',
    });
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
router.get('/code/:wallet', async (req: Request, res: Response) => {
  const { wallet } = req.params;

  if (!wallet) {
    return res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'Wallet address is required',
    });
  }

  try {
    const code = await referralService.getOrCreateReferralCode(wallet);
    return res.status(200).json({ code });
  } catch (error) {
    logger.log('error', 'Error getting referral code', {
      error: error instanceof Error ? error.message : String(error),
      wallet,
    });
    return res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: 'Failed to get referral code',
    });
  }
});

export default router;
