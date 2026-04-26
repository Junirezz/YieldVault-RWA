/**
 * Self-hosted feature flag service.
 *
 * Flags are loaded from FEATURE_FLAGS_PATH (JSON file) or from the
 * FEATURE_FLAGS env var (inline JSON). The file is re-read on every
 * evaluation so flags can be toggled without a code deployment.
 *
 * Flag definition schema (JSON):
 * {
 *   "flag-name": {
 *     "enabled": true,
 *     "allowlist": ["WALLET_ADDRESS_1", "WALLET_ADDRESS_2"]   // optional per-wallet targeting
 *   }
 * }
 *
 * Environment variables:
 *   FEATURE_FLAGS_PATH  – path to the JSON flags file
 *   FEATURE_FLAGS       – inline JSON (used when no file path is set)
 */

import fs from 'fs';
import type { Request, Response, NextFunction } from 'express';

interface FlagDefinition {
  enabled: boolean;
  /** Optional per-wallet allowlist for beta targeting. */
  allowlist?: string[];
}

type FlagMap = Record<string, FlagDefinition>;

function loadFlags(): FlagMap {
  const filePath = process.env.FEATURE_FLAGS_PATH;
  if (filePath) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as FlagMap;
    } catch {
      // Fall through to inline env var
    }
  }

  const inline = process.env.FEATURE_FLAGS;
  if (inline) {
    try {
      return JSON.parse(inline) as FlagMap;
    } catch {
      // Return empty map on parse error
    }
  }

  return {};
}

export class FeatureFlagService {
  /**
   * Evaluates a flag for an optional wallet address.
   * Evaluation time is O(allowlist size) and typically < 1 ms.
   *
   * @param flag          - Flag name
   * @param walletAddress - Optional wallet address for per-wallet targeting
   */
  isEnabled(flag: string, walletAddress?: string): boolean {
    const flags = loadFlags();
    const def = flags[flag];
    if (!def || !def.enabled) return false;

    // If an allowlist is defined, the wallet must be in it
    if (def.allowlist && def.allowlist.length > 0) {
      if (!walletAddress) return false;
      return def.allowlist.includes(walletAddress);
    }

    return true;
  }
}

export const featureFlags = new FeatureFlagService();

/**
 * Express middleware factory.
 * Gates a route behind a feature flag; returns 404 when the flag is off.
 *
 * Usage:
 *   router.post('/deposits/v2', requireFlag('deposit-v2'), handler)
 *
 * The wallet address is read from req.body.walletAddress or
 * the x-wallet-address header for per-wallet targeting.
 */
export function requireFlag(flag: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const wallet =
      (req.headers['x-wallet-address'] as string | undefined) ||
      (req.body?.walletAddress as string | undefined);

    if (!featureFlags.isEnabled(flag, wallet)) {
      res.status(404).json({ error: 'Not Found', status: 404, message: 'Endpoint not available' });
      return;
    }

    next();
  };
}
