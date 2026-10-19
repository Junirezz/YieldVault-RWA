import { Router, Response } from 'express';
import { WalletAliasConflictError, walletAliasMappingService } from './walletAliasService';
import { validate, WalletAliasLinkSchema, WalletAliasResolveQuerySchema } from './middleware/validate';
import { requireAuth, type AuthenticatedRequest } from './auth';
import { readsLimiter, writesLimiter } from './rateLimiter';
import { isValidStellarAddress, normalizeWalletAddress } from './walletUtils';

const router = Router();

/**
 * POST /api/v1/wallet-aliases/link
 * Links wallet identifiers from different providers to a single canonical identity.
 */
router.post(
  '/link',
  writesLimiter,
  requireAuth,
  validate({ body: WalletAliasLinkSchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    const { primaryAlias, primarySource, linkedAlias, linkedSource } = req.body as {
      primaryAlias: string;
      primarySource: string;
      linkedAlias: string;
      linkedSource: string;
    };

    const authenticatedWallet = req.jwtPayload?.sub;
    const linkedSourceIsStellar =
      linkedSource.trim().toLowerCase().replace(/[^a-z0-9]+/g, '') === 'stellar';
    if (
      !authenticatedWallet ||
      primarySource.toLowerCase() !== 'stellar' ||
      !isValidStellarAddress(primaryAlias) ||
      normalizeWalletAddress(primaryAlias) !== normalizeWalletAddress(authenticatedWallet) ||
      (linkedSourceIsStellar &&
        (!isValidStellarAddress(linkedAlias) ||
          normalizeWalletAddress(linkedAlias) !== normalizeWalletAddress(authenticatedWallet)))
    ) {
      res.status(403).json({
        error: 'Forbidden',
        status: 403,
        message: 'The primary and linked Stellar wallets must belong to the authenticated session',
      });
      return;
    }

    try {
      const [primaryMapping, linkedMapping] = await Promise.all([
        walletAliasMappingService.resolveAlias(primaryAlias, primarySource),
        walletAliasMappingService.resolveAlias(linkedAlias, linkedSource),
      ]);

      if (
        (primaryMapping && !ownsMapping(primaryMapping, authenticatedWallet)) ||
        (linkedMapping && !ownsMapping(linkedMapping, authenticatedWallet)) ||
        (primaryMapping &&
          linkedMapping &&
          primaryMapping.canonicalId !== linkedMapping.canonicalId)
      ) {
        res.status(409).json({
          error: 'Conflict',
          status: 409,
          message: 'The requested aliases are already linked to a different wallet identity',
        });
        return;
      }

      const mapping = await walletAliasMappingService.linkProviderIdentity(
        primaryAlias,
        primarySource,
        linkedAlias,
        linkedSource,
      );
      const canonicalWallet = await walletAliasMappingService.resolveCanonicalWallet(
        linkedAlias,
        linkedSource,
      );

      res.status(200).json({
        canonicalId: mapping.canonicalId,
        aliases: mapping.aliases,
        sources: mapping.sources,
        canonicalWallet,
      });
    } catch (err) {
      if (err instanceof WalletAliasConflictError) {
        res.status(409).json({
          error: 'Conflict',
          status: 409,
          message: err.message,
        });
        return;
      }

      res.status(400).json({
        error: 'Bad Request',
        status: 400,
        message: err instanceof Error ? err.message : 'Failed to link wallet aliases',
      });
    }
  },
);

/**
 * GET /api/v1/wallet-aliases/resolve
 * Resolves a provider-specific alias to its canonical identity linkage.
 */
router.get(
  '/resolve',
  requireAuth,
  readsLimiter,
  validate({ query: WalletAliasResolveQuerySchema }),
  async (req: AuthenticatedRequest, res: Response) => {
    const { alias, source } = req.query as { alias: string; source: string };
    const mapping = await walletAliasMappingService.resolveAlias(alias, source);

    if (!mapping) {
      res.status(404).json({
        error: 'Not Found',
        status: 404,
        message: 'No identity linkage found for the provided alias',
      });
      return;
    }

    const authenticatedWallet = req.jwtPayload?.sub;
    if (!authenticatedWallet || !ownsMapping(mapping, authenticatedWallet)) {
      res.status(404).json({
        error: 'Not Found',
        status: 404,
        message: 'No identity linkage found for the provided alias',
      });
      return;
    }

    res.status(200).json({
      ...mapping,
      canonicalWallet: normalizeWalletAddress(authenticatedWallet),
    });
  },
);

/**
 * GET /api/v1/wallet-aliases/:canonicalId
 * Returns all aliases linked to a canonical identity.
 */
router.get(
  '/:canonicalId',
  requireAuth,
  readsLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    const mapping = await walletAliasMappingService.getIdentityLinks(req.params.canonicalId);

    if (!mapping || !req.jwtPayload?.sub || !ownsMapping(mapping, req.jwtPayload.sub)) {
      res.status(404).json({
        error: 'Not Found',
        status: 404,
        message: 'Canonical identity not found',
      });
      return;
    }

    res.status(200).json(mapping);
  },
);

function ownsMapping(
  mapping: { aliases: string[] },
  walletAddress: string,
): boolean {
  const normalizedWallet = normalizeWalletAddress(walletAddress);
  return mapping.aliases.some(
    (alias) =>
      isValidStellarAddress(alias) &&
      normalizeWalletAddress(alias) === normalizedWallet,
  );
}

export default router;
