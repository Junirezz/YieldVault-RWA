/**
 * Vault summary, metrics, APY and health endpoints (legacy, v1, v2).
 *
 * Extracted from src/index.ts (issue #1545); mounted by the composition root
 * in the same position the routes were registered, so behaviour is unchanged.
 */
import { Router, Request, Response } from 'express';
import { buildVaultSummaryResponseFromDb, cache } from './shared';
import { cacheMiddleware } from '../middleware/cache';
import { computeVaultApy } from '../services/apy';
import { createTimeoutFor } from '../middleware/timeoutMiddleware';
import { healthProbeService } from '../healthProbe';
import { readsLimiter } from '../rateLimiter';

const cacheVaultMetricsTtl = parseInt(process.env.CACHE_TTL_MS || process.env.CACHE_VAULT_METRICS_TTL_MS || '60000', 10);

type VaultHealthResponse = {
  vaultId: string;
  status: 'healthy' | 'degraded';
  uptimeSeconds: number;
  metrics: {
    totalAssets: string;
    totalShares: string;
    sharePrice: string;
    apy: number;
  };
  dependencies: Record<string, 'up' | 'down' | 'degraded'>;
  cached: boolean;
  timestamp: string;
};

async function buildVaultHealthResponse(vaultId: string): Promise<VaultHealthResponse> {
  const cacheKey = `vault-health:${vaultId}`;
  const cached = cache.get<Omit<VaultHealthResponse, 'cached'>>(cacheKey);
  if (cached) {
    return { ...cached, cached: true };
  }

  const [summary, probes] = await Promise.all([
    buildVaultSummaryResponseFromDb(),
    healthProbeService.checkAll().catch(
      () => ({}) as Record<string, { status: 'up' | 'down' | 'degraded' }>,
    ),
  ]);
  const dependencies = Object.fromEntries(
    Object.entries(probes).map(([name, state]) => [name, state.status]),
  ) as Record<string, 'up' | 'down' | 'degraded'>;
  const degraded = Object.values(dependencies).some((state) => state !== 'up');
  const body = {
    vaultId,
    status: degraded ? 'degraded' as const : 'healthy' as const,
    uptimeSeconds: Math.floor(process.uptime()),
    metrics: {
      totalAssets: summary.totalAssets,
      totalShares: summary.totalShares,
      sharePrice: summary.sharePrice,
      apy: summary.apy,
    },
    dependencies,
    timestamp: new Date().toISOString(),
  };

  cache.set(cacheKey, body, 5);
  return { ...body, cached: false };
}

const router = Router();

// /api/vault/* â†’ /api/v1/vault/*
router.get('/api/vault/summary', (_req: Request, res: Response) => {
  res.setHeader('deprecation', 'true');
  res.redirect(301, '/api/v1/vault/summary');
});

router.get('/api/vault/metrics', (_req: Request, res: Response) => {
  res.redirect(301, '/api/v1/vault/metrics');
});

router.get('/api/vault/apy', (_req: Request, res: Response) => {
  res.redirect(301, '/api/v1/vault/apy');
});

// â”€â”€â”€ Versioned vault summary/metrics/apy endpoints â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * GET /api/v1/vaults/:id/health - monitoring-friendly vault health payload.
 *
 * Kept separate from /health so external monitors can target one vault and
 * receive vault metrics, dependency state, uptime, and cache status. Responses
 * are cached for five seconds to avoid turning health probes into DB pressure.
 */
router.get(
  '/api/v1/vaults/:id/health',
  readsLimiter,
  createTimeoutFor.read({
    timeoutMs: 1500,
    routeName: '/api/v1/vaults/:id/health',
    message: 'Vault health took too long to load',
    fallbackResponse: () => ({
      error: 'Service Unavailable',
      status: 503,
      code: 'VAULT_HEALTH_TIMEOUT',
      message: 'Vault health is temporarily unavailable. Please retry shortly.',
      timestamp: new Date().toISOString(),
    }),
  }),
  async (req: Request, res: Response) => {
    const health = await buildVaultHealthResponse(req.params.id);
    res.status(health.status === 'healthy' ? 200 : 503).json(health);
  },
);

router.get('/api/v2/vaults/:id/health', (req: Request, res: Response) => {
  const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  res.set('X-API-Preview', 'v2');
  res.redirect(307, `/api/v1/vaults/${encodeURIComponent(req.params.id)}/health${qs}`);
});

/**
 * GET /api/v1/vaults/:id/apy
 *
 * Returns the annualised APY for the vault.  Returns `apy: null` with
 * `apyStatus: 'insufficient_data'` for new vaults that have zero shares or
 * fewer than 2 price snapshots, preventing Infinity / NaN from reaching the
 * frontend (Issue #1456).
 */
router.get(
  '/api/v1/vaults/:id/apy',
  readsLimiter,
  cacheMiddleware({ ttl: cacheVaultMetricsTtl }),
  createTimeoutFor.read({
    timeoutMs: 1500,
    routeName: '/api/v1/vaults/:id/apy',
    message: 'Vault APY took too long to load',
    fallbackResponse: () => ({
      error: 'Service Unavailable',
      status: 503,
      code: 'VAULT_APY_TIMEOUT',
      message: 'Vault APY is temporarily unavailable. Please try again shortly.',
      timestamp: new Date().toISOString(),
    }),
  }),
  async (_req: Request, res: Response) => {
    const result = await computeVaultApy();
    res.json({
      ...result,
      timestamp: new Date().toISOString(),
    });
  },
);

/**
 * @openapi
 * /vault/summary:
 *   get:
 *     summary: Vault summary
 *     description: Returns high-level vault metrics including total assets, shares, and APY.
 *     tags: [Vault]
 *     responses:
 *       200:
 *         description: Vault summary metrics
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VaultSummary'
 */
/**
 * GET /api/v1/vault/summary – read-only summary; relaxed rate limit.
 * Data is sourced from VaultState + SharePriceSnapshot (DB) and cached via
 * the Redis-backed response cache.
 */
router.get(
  '/api/v1/vault/summary',
  readsLimiter,
  cacheMiddleware({ ttl: cacheVaultMetricsTtl }),
  createTimeoutFor.read({
    timeoutMs: 1500,
    routeName: '/api/v1/vault/summary',
    message: 'Vault summary took too long to load',
    fallbackResponse: () => ({
      error: 'Service Unavailable',
      status: 503,
      code: 'VAULT_SUMMARY_TIMEOUT',
      message: 'Vault summary is temporarily unavailable. Please refresh in a moment.',
      stale: true,
      data: {
        totalAssets: '0',
        totalShares: '0',
        sharePrice: '1.000000',
        apy: 0,
        timestamp: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    }),
  }),
  async (_req: Request, res: Response) => {
    const summary = await buildVaultSummaryResponseFromDb();
    res.json(summary);
  },
);

/**
 * GET /api/v1/vault/metrics - Cache with configurable TTL
 */
router.get(
  '/api/v1/vault/metrics',
  cacheMiddleware({ ttl: cacheVaultMetricsTtl }),
  createTimeoutFor.read({
    timeoutMs: 2000,
    routeName: '/api/v1/vault/metrics',
    message: 'Vault metrics took too long to load',
    fallbackResponse: () => ({
      error: 'Service Unavailable',
      status: 503,
      code: 'VAULT_METRICS_TIMEOUT',
      message: 'Vault metrics are temporarily unavailable. Showing the last known state.',
      stale: true,
      timestamp: new Date().toISOString(),
    }),
  }),
  (_req: Request, res: Response) => {
    res.json({
      message: 'Vault metrics',
      timestamp: new Date().toISOString(),
    });
  },
);

/**
 * GET /api/v1/vault/apy - Cache with configurable TTL
 */
router.get(
  '/api/v1/vault/apy',
  cacheMiddleware({ ttl: cacheVaultMetricsTtl }),
  createTimeoutFor.read({
    timeoutMs: 1200,
    routeName: '/api/v1/vault/apy',
    message: 'Vault APY took too long to load',
    fallbackResponse: () => ({
      error: 'Service Unavailable',
      status: 503,
      code: 'VAULT_APY_TIMEOUT',
      message: 'Vault APY is temporarily unavailable. Please try again shortly.',
      stale: true,
      timestamp: new Date().toISOString(),
    }),
  }),
  (_req: Request, res: Response) => {
    res.json({
      message: 'Vault APY',
      timestamp: new Date().toISOString(),
    });
  },
);

export default router;
