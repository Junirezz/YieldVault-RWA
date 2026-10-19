/**
 * Helpers and state shared by src/index.ts and the feature routers in
 * src/routes/ (issue #1545).
 */
import NodeCache from 'node-cache';
import { Request, Response } from 'express';
import { createPaginatedResponse } from '../pagination';
import { getPrismaClient } from '../prismaClient';
import { normalizeWalletAddress } from '../walletUtils';

// Health check cache to track dependency status
export const cache = new NodeCache({ stdTTL: 30 });

/**
 * Reads the vault summary from the VaultState table and the most recent
 * SharePriceSnapshot for the share price. Falls back to zeroed values when
 * the database is unavailable (e.g., during startup or in tests).
 */
export async function buildVaultSummaryResponseFromDb(): Promise<{
  totalAssets: string;
  totalShares: string;
  sharePrice: string;
  apy: number;
  timestamp: string;
}> {
  try {
    const prismaClient = getPrismaClient();
    const [vaultState, latestSnapshot] = await Promise.all([
      prismaClient.vaultState.findUnique({ where: { id: 1 } }),
      prismaClient.sharePriceSnapshot
        .findFirst({ orderBy: { recordedAt: 'desc' } })
        .catch(() => null),
    ]);

    const totalAssets = vaultState?.totalAssets ?? '0';
    const totalShares = vaultState?.totalShares ?? '0';
    const sharePrice = latestSnapshot?.sharePrice ?? '1.000000';

    return {
      totalAssets,
      totalShares,
      sharePrice,
      apy: 0, // APY is computed by the nightly snapshot job; placeholder until first run
      timestamp: new Date().toISOString(),
    };
  } catch {
    // Fail-open: return safe zero values so the endpoint never 500s
    return {
      totalAssets: '0',
      totalShares: '0',
      sharePrice: '1.000000',
      apy: 0,
      timestamp: new Date().toISOString(),
    };
  }
}

export function resolveActingAdminAddress(req: Request): string {
  const address =
    req.get('x-admin-address') ||
    req.get('x-admin-id') ||
    req.get('x-wallet-address') ||
    'unknown';
  return address === 'unknown' ? address : normalizeWalletAddress(address);
}

export function parseLimited(v: unknown, fallback: number, min: number, max: number): number {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isNaN(n) ? fallback : Math.min(Math.max(n, min), max);
}

export function isDryRunRequest(req: Request): boolean {
  const value = req.body?.dryRun ?? req.query.dryRun;
  return value === true || value === 'true' || value === '1';
}

export function paginateByLimit<T>(rows: T[], limit: number): { data: T[]; hasNextPage: boolean } {
  const hasNextPage = rows.length > limit;
  return {
    data: hasNextPage ? rows.slice(0, limit) : rows,
    hasNextPage,
  };
}

export function sendStandardListEnvelope<T>(
  res: Response,
  input: {
    data: T[];
    limit: number;
    hasNextPage?: boolean;
    hasPrevPage?: boolean;
    nextCursor?: string;
    total?: number;
    statusCode?: number;
    extras?: Record<string, unknown>;
  },
): void {
  const payload = createPaginatedResponse(input.data, {
    count: input.data.length,
    total: input.total ?? input.data.length,
    nextCursor: input.nextCursor ?? null,
    prevCursor: null,
    currentPage: null,
    totalPages: null,
    hasNextPage: input.hasNextPage ?? false,
    hasPrevPage: input.hasPrevPage ?? false,
    limit: input.limit,
  });

  res.status(input.statusCode ?? 200).json({
    ...payload,
    ...(input.extras || {}),
  });
}
