/**
 * @file services/apy.ts
 * Per-vault APY calculation service (Issue #1456).
 *
 * APY is derived from the two most-recent SharePriceSnapshot rows:
 *   apy = (priceNow - priceLast) / priceLast * 365
 *
 * Guard-rails:
 *   - Returns { apy: null, apyStatus: 'insufficient_data' } when
 *     totalShares === 0 (new vault) or fewer than 2 price snapshots exist.
 *   - Returns { apy: null, apyStatus: 'insufficient_data' } when priceLast
 *     resolves to 0 to prevent a divide-by-zero / Infinity result.
 */

import { Decimal } from 'decimal.js';
import { getPrismaClient } from '../prismaClient';

export type ApyStatus = 'ok' | 'insufficient_data';

export interface VaultApyResult {
  apy: number | null;
  apyStatus: ApyStatus;
}

/**
 * Compute the annualised APY for a vault identified by its numeric state id.
 *
 * @param vaultStateId - The VaultState.id value (almost always 1 in the current
 *                       single-vault design; exposed as a param for future
 *                       multi-vault support).
 */
export async function computeVaultApy(vaultStateId: number = 1): Promise<VaultApyResult> {
  const prisma = getPrismaClient();

  // Check whether the vault has been bootstrapped yet.
  const vaultState = await prisma.vaultState.findUnique({ where: { id: vaultStateId } });

  const totalShares = vaultState ? new Decimal(vaultState.totalShares) : new Decimal(0);
  if (totalShares.isZero()) {
    return { apy: null, apyStatus: 'insufficient_data' };
  }

  // Fetch the two most-recent price snapshots (newest first).
  const snapshots = await prisma.sharePriceSnapshot.findMany({
    orderBy: { recordedAt: 'desc' },
    take: 2,
    select: { sharePrice: true, recordedAt: true },
  });

  if (snapshots.length < 2) {
    return { apy: null, apyStatus: 'insufficient_data' };
  }

  const priceNow = new Decimal(snapshots[0].sharePrice);
  const priceLast = new Decimal(snapshots[1].sharePrice);

  // Guard against a zero baseline price (can happen if a snapshot was persisted
  // during an empty-vault state before this fix landed).
  if (priceLast.isZero()) {
    return { apy: null, apyStatus: 'insufficient_data' };
  }

  // Annualise: daily return × 365.  The two snapshots are assumed to be ~1 day
  // apart; a more precise implementation would weight by actual elapsed days.
  const apy = priceNow.minus(priceLast).div(priceLast).times(365).toNumber();

  return { apy, apyStatus: 'ok' };
}
