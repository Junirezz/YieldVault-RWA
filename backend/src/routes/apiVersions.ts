import { Router, Request, Response } from 'express';
import { CURRENT_VERSION, LEGACY_SUNSET_DATE, SUPPORTED_VERSIONS, V2_PREVIEW_VERSION } from '../middleware/versionNegotiation';
import { API_V1_PREFIX, API_V2_PREFIX } from '../middleware/versionRouting';

export const API_VERSION_POLICY = {
  current: CURRENT_VERSION,
  supported: [...SUPPORTED_VERSIONS],
  prefixes: {
    v1: API_V1_PREFIX,
    v2: API_V2_PREFIX,
  },
  negotiation: ['X-API-Version', 'Accept-Version', 'Accept;version='],
  deprecation: {
    sunset: LEGACY_SUNSET_DATE,
    successor: API_V1_PREFIX,
  },
} as const;

/**
 * GET /api/versions
 * Discovery document for URL versioning, header negotiation, and deprecation.
 */
export function versionsDiscoveryHandler(_req: Request, res: Response): void {
  res.status(200).json({
    current: CURRENT_VERSION,
    supported: [...SUPPORTED_VERSIONS],
    versions: [
      {
        id: 'v1',
        status: 'active',
        prefix: API_V1_PREFIX,
        contract: CURRENT_VERSION,
      },
      {
        id: 'v2',
        status: 'preview',
        prefix: API_V2_PREFIX,
        contract: V2_PREVIEW_VERSION,
      },
    ],
    negotiation: {
      headers: ['X-API-Version', 'Accept-Version'],
      acceptParameter: 'version',
    },
    deprecation: {
      sunset: LEGACY_SUNSET_DATE,
      successorPrefix: API_V1_PREFIX,
      policyUrl: '/docs/api/VERSIONING.md',
    },
  });
}

export function createVersionDiscoveryRouter(): Router {
  const router = Router();
  router.get('/versions', versionsDiscoveryHandler);
  return router;
}
