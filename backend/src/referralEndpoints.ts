import { Router, Request, Response } from "express";
import { referralService } from "./referralService";
import { logger } from "./middleware/structuredLogging";
import { normalizeWalletAddress } from "./walletUtils";
import { cacheMiddleware } from "./middleware/cache";
import { buildApiErrorBody, type ApiErrorBody } from "./middleware/apiError";
import { tenantGuard } from "./middleware/tenantGuard";
import { Permission } from "./middleware/rbac";
import { Router, Request, Response } from 'express';
import { referralService } from './referralService';
import { logger } from './middleware/structuredLogging';
import { normalizeWalletAddress } from './walletUtils';
import { cacheMiddleware } from './middleware/cache';
import { buildApiErrorBody, type ApiErrorBody, sendApiError } from './middleware/apiError';

const router = Router();
const REFERRAL_CACHE_TTL_MS = parseInt(process.env.CACHE_LIST_ENDPOINTS_TTL_MS || "30000", 10);

const WALLET_REQUIRED_MESSAGE = "Wallet address is required";
const REFERRAL_STATS_NOT_FOUND_MESSAGE = "No referral activity found for this wallet";
const REFERRAL_STATS_ERROR_MESSAGE = "Failed to fetch referral stats";
const REFERRAL_CODE_NOT_FOUND_MESSAGE = "No referral code found for this wallet";
const REFERRAL_CODE_ERROR_MESSAGE = "Failed to get referral code";

export function buildReferralWalletRequiredBody(): ApiErrorBody {
  return buildApiErrorBody({ status: 400, message: WALLET_REQUIRED_MESSAGE });
}

export function buildReferralStatsNotFoundBody(): ApiErrorBody {
  return buildApiErrorBody({ status: 404, message: REFERRAL_STATS_NOT_FOUND_MESSAGE });
}

export function buildReferralStatsErrorBody(): ApiErrorBody {
  return buildApiErrorBody({ status: 500, message: REFERRAL_STATS_ERROR_MESSAGE });
}

export function buildReferralCodeNotFoundBody(): ApiErrorBody {
  return buildApiErrorBody({ status: 404, message: REFERRAL_CODE_NOT_FOUND_MESSAGE });
}

export function buildReferralCodeErrorBody(): ApiErrorBody {
  return buildApiErrorBody({ status: 500, message: REFERRAL_CODE_ERROR_MESSAGE });
}

/**
 * @openapi
 * /api/v1/referrals/{wallet}:
 *   get:
 *     summary: Get referral stats for a wallet
 *     description: Returns referral count and total reward earned for the given wallet address. Requires ownership or admin permissions.
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
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Forbidden - cannot access another wallet's referral data
 *       404:
 *         description: Wallet has no referral activity
 *       500:
 *         description: Internal server error
 */
router.get(
  "/:wallet",
  tenantGuard({
    walletParamPath: "params.wallet",
    allowAdminBypass: true,
    adminBypassPermission: Permission.ADMIN_READ,
    requireAuth: true,
  }),
  cacheMiddleware({ ttl: REFERRAL_CACHE_TTL_MS }),
  async (req: Request, res: Response) => {
    const { wallet } = req.params;

    if (!wallet) {
      return res.status(400).json(buildReferralWalletRequiredBody());
    }

    const normalizedWallet = normalizeWalletAddress(wallet);
  if (!wallet) {
    sendApiError(req, res, { status: 400, code: 'BAD_REQUEST', message: WALLET_REQUIRED_MESSAGE });
    return;
  }

    try {
      const stats = await referralService.getReferralStats(normalizedWallet);

      if (!stats) {
        return res.status(404).json(buildReferralStatsNotFoundBody());
      }

      return res.status(200).json(stats);
    } catch (error) {
      logger.log("error", "Error fetching referral stats", {
        error: error instanceof Error ? error.message : String(error),
        wallet: normalizedWallet,
      });
      return res.status(500).json(buildReferralStatsErrorBody());
    }
    if (!stats) {
      sendApiError(req, res, { status: 404, code: 'NOT_FOUND', message: REFERRAL_STATS_NOT_FOUND_MESSAGE });
      return;
    }

    return res.status(200).json(stats);
  } catch (error) {
    logger.log('error', 'Error fetching referral stats', {
      error: error instanceof Error ? error.message : String(error),
      wallet: normalizedWallet,
    });
    sendApiError(req, res, { status: 500, code: 'INTERNAL_SERVER_ERROR', message: REFERRAL_STATS_ERROR_MESSAGE });
    return;
  }
);

/**
 * @openapi
 * /api/v1/referrals/code/{wallet}:
 *   get:
 *     summary: Get referral code for a wallet
 *     description: Returns the existing referral code for the given wallet address (read-only). Requires ownership or admin permissions.
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
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Forbidden - cannot access another wallet's referral code
 *       404:
 *         description: No referral code found for this wallet
 *       500:
 *         description: Internal server error
 */
router.get(
  "/code/:wallet",
  tenantGuard({
    walletParamPath: "params.wallet",
    allowAdminBypass: true,
    adminBypassPermission: Permission.ADMIN_READ,
    requireAuth: true,
  }),
  cacheMiddleware({ ttl: REFERRAL_CACHE_TTL_MS }),
  async (req: Request, res: Response) => {
    const { wallet } = req.params;

    if (!wallet) {
      return res.status(400).json(buildReferralWalletRequiredBody());
    }

    const normalizedWallet = normalizeWalletAddress(wallet);

    try {
      const code = await referralService.getReferralCode(normalizedWallet);
      if (!code) {
        return res.status(404).json(buildReferralCodeNotFoundBody());
      }
      return res.status(200).json({ code });
    } catch (error) {
      logger.log("error", "Error getting referral code", {
        error: error instanceof Error ? error.message : String(error),
        wallet: normalizedWallet,
      });
      return res.status(500).json(buildReferralCodeErrorBody());
    }
  if (!wallet) {
    sendApiError(req, res, { status: 400, code: 'BAD_REQUEST', message: WALLET_REQUIRED_MESSAGE });
    return;
  }
);

/**
 * @openapi
 * /api/v1/referrals/code/{wallet}:
 *   post:
 *     summary: Create or retrieve referral code for a wallet
 *     description: Creates a referral code for the wallet if one does not exist, or returns the existing one. Requires ownership or admin permissions.
 *     tags: [Referrals]
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema: { type: string }
 *         description: Wallet address to create or get referral code for
 *     responses:
 *       200:
 *         description: Referral code
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code: { type: string }
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Forbidden - cannot create code for another wallet
 *       500:
 *         description: Internal server error
 */
router.post(
  "/code/:wallet",
  tenantGuard({
    walletParamPath: "params.wallet",
    allowAdminBypass: true,
    adminBypassPermission: Permission.ADMIN_READ,
    requireAuth: true,
  }),
  async (req: Request, res: Response) => {
    const { wallet } = req.params;

    if (!wallet) {
      return res.status(400).json(buildReferralWalletRequiredBody());
    }

    const normalizedWallet = normalizeWalletAddress(wallet);

    try {
      const code = await referralService.getOrCreateReferralCode(normalizedWallet);
      return res.status(200).json({ code });
    } catch (error) {
      logger.log("error", "Error creating or getting referral code", {
        error: error instanceof Error ? error.message : String(error),
        wallet: normalizedWallet,
      });
      return res.status(500).json(buildReferralCodeErrorBody());
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
    sendApiError(req, res, { status: 500, code: 'INTERNAL_SERVER_ERROR', message: REFERRAL_CODE_ERROR_MESSAGE });
    return;
  }
);

export default router;
