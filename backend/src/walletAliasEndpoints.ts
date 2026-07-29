import { Router, Request, Response } from 'express';
import { walletAliasMappingService } from './walletAliasService';
import { validate, WalletAliasLinkSchema, WalletAliasResolveQuerySchema } from './middleware/validate';
import { readsLimiter } from './rateLimiter';

const router = Router();

/**
 * POST /api/v1/wallet-aliases/link
 * Links wallet identifiers from different providers to a single canonical identity.
 */
router.post(
  '/link',
  readsLimiter,
  validate({ body: WalletAliasLinkSchema }),
  async (req: Request, res: Response) => {
    const { primaryAlias, primarySource, linkedAlias, linkedSource } = req.body as {
      primaryAlias: string;
      primarySource: string;
      linkedAlias: string;
      linkedSource: string;
    };

    try {
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
  readsLimiter,
  validate({ query: WalletAliasResolveQuerySchema }),
  async (req: Request, res: Response) => {
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

    const canonicalWallet = await walletAliasMappingService.resolveCanonicalWallet(alias, source);

    res.status(200).json({
      ...mapping,
      canonicalWallet,
    });
  },
);

/**
 * GET /api/v1/wallet-aliases/:canonicalId
 * Returns all aliases linked to a canonical identity.
 */
router.get('/:canonicalId', readsLimiter, async (req: Request, res: Response) => {
  const mapping = await walletAliasMappingService.getIdentityLinks(req.params.canonicalId);

  if (!mapping) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'Canonical identity not found',
    });
    return;
  }

  res.status(200).json(mapping);
});

export default router;
