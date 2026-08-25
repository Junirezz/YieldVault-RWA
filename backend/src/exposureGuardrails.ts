/**
 * Max exposure guardrails for strategy allocation.
 * 
 * Ensures that strategy allocations respect maximum exposure limits
 * to prevent excessive concentration risk and maintain compliance.
 * 
 * Enforces:
 * - Per-vault maximum exposure (% of vault AUM)
 * - Cross-vault maximum exposure (% of total AUM)
 * - Strategy-specific concentration limits
 * - Real-time exposure recalculation
 * 
 * Environment variables:
 *   MAX_SINGLE_VAULT_EXPOSURE_PCT   - Max exposure per vault (default: 30)
 *   MAX_STRATEGY_EXPOSURE_PCT        - Max exposure per strategy (default: 20)
 *   MAX_CROSS_VAULT_EXPOSURE_PCT     - Max cross-vault exposure (default: 50)
 */

import Decimal from 'decimal.js';
import { logger } from './middleware/structuredLogging';
import { prisma } from './prisma';

export type ExposureType = 'notional' | 'risk_weighted' | 'var_based';

export interface ExposureLimits {
  maxPerVaultPct: number;
  maxPerStrategyPct: number;
  maxCrossVaultPct: number;
  exposureType: ExposureType;
}

export interface ExposureCalculation {
  vaultId: string;
  strategyId: string;
  currentExposurePct: number;
  availableCapacityPct: number;
  canAllocate: boolean;
  remainingCapacity: Decimal;
  message?: string;
}

export interface VaultExposureSummary {
  vaultId: string;
  vaultAum: Decimal;
  allocations: Array<{
    strategyId: string;
    exposure: Decimal;
    exposurePct: number;
  }>;
  totalExposure: Decimal;
  totalExposurePct: number;
  headroom: Decimal;
  headroomPct: number;
}

/**
 * Default exposure limits (configurable via environment).
 */
export function getExposureLimits(): ExposureLimits {
  return {
    maxPerVaultPct: parseFloat(process.env.MAX_SINGLE_VAULT_EXPOSURE_PCT || '30'),
    maxPerStrategyPct: parseFloat(process.env.MAX_STRATEGY_EXPOSURE_PCT || '20'),
    maxCrossVaultPct: parseFloat(process.env.MAX_CROSS_VAULT_EXPOSURE_PCT || '50'),
    exposureType: (process.env.EXPOSURE_TYPE || 'notional') as ExposureType,
  };
}

/**
 * Validates whether a new allocation respects exposure limits.
 * 
 * Returns calculation details including whether allocation is permitted
 * and available capacity remaining.
 */
export async function validateExposure(
  vaultId: string,
  strategyId: string,
  allocationAmount: Decimal,
): Promise<ExposureCalculation> {
  const limits = getExposureLimits();

  try {
    // Fetch vault and strategy data
    const vault = await prisma.vault.findUnique({
      where: { id: vaultId },
      include: {
        allocations: {
          include: { strategy: true },
        },
      },
    });

    if (!vault) {
      return {
        vaultId,
        strategyId,
        currentExposurePct: 0,
        availableCapacityPct: 0,
        canAllocate: false,
        remainingCapacity: new Decimal(0),
        message: 'Vault not found',
      };
    }

    const vaultAum = new Decimal(vault.aum || 0);
    const allocationAmountDec = new Decimal(allocationAmount);

    // Calculate current per-vault exposure
    const currentExposure = vault.allocations.reduce(
      (sum, alloc) => sum.plus(new Decimal(alloc.amount || 0)),
      new Decimal(0),
    );

    const newTotalExposure = currentExposure.plus(allocationAmountDec);
    const newExposurePct = vaultAum.gt(0)
      ? newTotalExposure.div(vaultAum).times(100).toNumber()
      : 0;

    // Check per-vault limit
    if (newExposurePct > limits.maxPerVaultPct) {
      const headroom = vaultAum.times(limits.maxPerVaultPct / 100).minus(currentExposure);
      return {
        vaultId,
        strategyId,
        currentExposurePct: newExposurePct,
        availableCapacityPct: limits.maxPerVaultPct - (currentExposure.div(vaultAum).times(100).toNumber() || 0),
        canAllocate: false,
        remainingCapacity: headroom,
        message: `Allocation exceeds per-vault limit (${newExposurePct.toFixed(2)}% > ${limits.maxPerVaultPct}%)`,
      };
    }

    // Calculate strategy-specific exposure across all vaults
    const strategyAllocations = await prisma.allocation.findMany({
      where: { strategyId },
      include: { vault: true },
    });

    const totalStrategyExposure = strategyAllocations.reduce(
      (sum, alloc) => sum.plus(new Decimal(alloc.amount || 0)),
      new Decimal(0),
    );

    const totalVaultAums = await prisma.vault.aggregate({
      _sum: { aum: true },
    });

    const aggregateAum = new Decimal(totalVaultAums._sum.aum || 0);
    const strategyExposurePct = aggregateAum.gt(0)
      ? totalStrategyExposure.plus(allocationAmountDec).div(aggregateAum).times(100).toNumber()
      : 0;

    if (strategyExposurePct > limits.maxPerStrategyPct) {
      return {
        vaultId,
        strategyId,
        currentExposurePct: strategyExposurePct,
        availableCapacityPct: limits.maxPerStrategyPct,
        canAllocate: false,
        remainingCapacity: aggregateAum.times(limits.maxPerStrategyPct / 100).minus(totalStrategyExposure),
        message: `Allocation exceeds strategy limit (${strategyExposurePct.toFixed(2)}% > ${limits.maxPerStrategyPct}%)`,
      };
    }

    // Calculate cross-vault exposure
    const allAllocations = await prisma.allocation.aggregate({
      _sum: { amount: true },
    });

    const crossVaultExposure = new Decimal(allAllocations._sum.amount || 0).plus(allocationAmountDec);
    const crossVaultExposurePct = aggregateAum.gt(0)
      ? crossVaultExposure.div(aggregateAum).times(100).toNumber()
      : 0;

    if (crossVaultExposurePct > limits.maxCrossVaultPct) {
      return {
        vaultId,
        strategyId,
        currentExposurePct: crossVaultExposurePct,
        availableCapacityPct: limits.maxCrossVaultPct,
        canAllocate: false,
        remainingCapacity: aggregateAum.times(limits.maxCrossVaultPct / 100).minus(crossVaultExposure),
        message: `Allocation exceeds cross-vault limit (${crossVaultExposurePct.toFixed(2)}% > ${limits.maxCrossVaultPct}%)`,
      };
    }

    // All checks passed
    const availableInVault = vaultAum.times(limits.maxPerVaultPct / 100).minus(currentExposure);
    return {
      vaultId,
      strategyId,
      currentExposurePct: newExposurePct,
      availableCapacityPct: Math.min(
        limits.maxPerVaultPct - newExposurePct,
        limits.maxPerStrategyPct,
        limits.maxCrossVaultPct,
      ),
      canAllocate: true,
      remainingCapacity: availableInVault,
      message: 'Allocation permitted',
    };
  } catch (err) {
    logger.error('Error validating exposure', {
      error: err instanceof Error ? err.message : String(err),
      vaultId,
      strategyId,
    });

    return {
      vaultId,
      strategyId,
      currentExposurePct: 0,
      availableCapacityPct: 0,
      canAllocate: false,
      remainingCapacity: new Decimal(0),
      message: 'Error validating exposure limits',
    };
  }
}

/**
 * Gets detailed exposure summary for a vault.
 */
export async function getVaultExposureSummary(vaultId: string): Promise<VaultExposureSummary | null> {
  try {
    const vault = await prisma.vault.findUnique({
      where: { id: vaultId },
      include: {
        allocations: {
          include: { strategy: true },
        },
      },
    });

    if (!vault) return null;

    const vaultAum = new Decimal(vault.aum || 0);
    const allocations = vault.allocations.map(alloc => {
      const exposure = new Decimal(alloc.amount || 0);
      const exposurePct = vaultAum.gt(0) ? exposure.div(vaultAum).times(100).toNumber() : 0;
      return {
        strategyId: alloc.strategyId,
        exposure,
        exposurePct,
      };
    });

    const totalExposure = allocations.reduce((sum, a) => sum.plus(a.exposure), new Decimal(0));
    const totalExposurePct = vaultAum.gt(0) ? totalExposure.div(vaultAum).times(100).toNumber() : 0;
    const headroom = vaultAum.minus(totalExposure);
    const headroomPct = vaultAum.gt(0) ? headroom.div(vaultAum).times(100).toNumber() : 0;

    return {
      vaultId,
      vaultAum,
      allocations,
      totalExposure,
      totalExposurePct,
      headroom,
      headroomPct,
    };
  } catch (err) {
    logger.error('Error getting vault exposure summary', {
      error: err instanceof Error ? err.message : String(err),
      vaultId,
    });
    return null;
  }
}

/**
 * Records exposure limit breach for alerting and compliance.
 */
export async function recordExposureBreach(
  vaultId: string,
  strategyId: string,
  attemptedAmount: Decimal,
  reason: string,
): Promise<void> {
  try {
    await prisma.exposureBreach.create({
      data: {
        vaultId,
        strategyId,
        attemptedAmount: attemptedAmount.toString(),
        reason,
        timestamp: new Date(),
      },
    });

    logger.warn('Exposure limit breach', {
      vaultId,
      strategyId,
      attemptedAmount: attemptedAmount.toString(),
      reason,
    });
  } catch (err) {
    logger.error('Failed to record exposure breach', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
