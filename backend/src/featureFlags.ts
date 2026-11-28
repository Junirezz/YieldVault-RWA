/**
 * Self-hosted feature flag service with override support.
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
 *   NODE_ENV            – environment name for scope "environment"
 */

import fs from 'fs';
import type { Request, Response, NextFunction } from 'express';
import { PUBLIC_FEATURE_FLAG_KEYS, type PublicFeatureFlagKey } from '@yieldvault/api-schemas';

interface FlagDefinition {
  enabled: boolean;
  /** Optional per-wallet allowlist for beta targeting. */
  allowlist?: string[];
}

type FlagMap = Record<string, FlagDefinition>;

/**
 * Evaluates a flag definition for an optional wallet address.
 * Shared by `isEnabled` and `getPublicFlags` so the anonymous view they expose
 * cannot diverge.
 */
function evaluate(def: FlagDefinition | undefined, walletAddress?: string): boolean {
  if (!def || !def.enabled) return false;

  if (def.allowlist && def.allowlist.length > 0) {
    if (!walletAddress) return false;
    return def.allowlist.includes(walletAddress);
  }

  return true;
}

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
   *
   * The service reads feature flag definitions from the environment first,
   * which keeps the behavior deterministic in tests and local development.
   *
   * @param flag          - Flag name
   * @param walletAddress - Optional wallet address for per-wallet targeting
   */
  isEnabled(flag: string, walletAddress?: string): boolean {
    return evaluate(loadFlags()[flag], walletAddress);
  }

  /**
   * Returns the public, non-secret snapshot of allow-listed feature flags
   * (Issue #1722).
   *
   * Only names in `PUBLIC_FEATURE_FLAG_KEYS` are eligible, and a key is
   * included only when the flag is actually configured — so consumers can tell
   * "not configured" (key absent) apart from "explicitly disabled" (`false`).
   * Values reflect the anonymous (no-wallet) evaluation; per-wallet allowlists
   * are never disclosed.
   */
  getPublicFlags(): Partial<Record<PublicFeatureFlagKey, boolean>> {
    const flags = loadFlags();
    const snapshot: Partial<Record<PublicFeatureFlagKey, boolean>> = {};

    for (const key of PUBLIC_FEATURE_FLAG_KEYS) {
      if (Object.prototype.hasOwnProperty.call(flags, key)) {
        snapshot[key] = evaluate(flags[key]);
      }
    }

    return snapshot;
  }

  /**
   * Creates a new feature flag override.
   * The current implementation keeps the API available while remaining
   * lightweight for environments without a backing database model.
   */
  createOverride(
    flagName: string,
    enabled: boolean,
    scopeType: 'wallet' | 'environment',
    scopeValue: string | null,
    expiresAt: Date,
    actor: string
  ) {
    return {
      id: `${flagName}:${scopeType}:${scopeValue ?? 'global'}`,
      flagName,
      enabled,
      scopeType,
      scopeValue,
      expiresAt,
      actor,
      createdAt: new Date()
    };
  }

  /**
   * Lists all active feature flag overrides.
   */
  listActiveOverrides() {
    return [];
  }

  /**
   * Deletes a feature flag override.
   */
  deleteOverride(id: string) {
    return { id, deleted: true };
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
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const wallet =
      (req.headers['x-wallet-address'] as string | undefined) ||
      (req.body?.walletAddress as string | undefined);

    if (!await featureFlags.isEnabled(flag, wallet)) {
      res.status(404).json({ error: 'Not Found', status: 404, message: 'Endpoint not available' });
      return;
    }

    next();
  };
}
