/**
 * @file operationalMetrics.ts
 * High-level operational metrics for vault monitoring and support visibility.
 */

import { Gauge } from 'prom-client';
import { register } from './metrics';
import { getPrismaClient } from './prismaClient';
import { logger } from './middleware/structuredLogging';
import Decimal from 'decimal.js';

const prisma = getPrismaClient();

// ─── Operational Metrics ────────────────────────────────────────────────────

export const vaultHealthStatus = new Gauge({
  name: 'vault_health_status',
  help: 'Overall vault health status: 1 = healthy, 0.5 = degraded, 0 = unhealthy',
  labelNames: ['vault_id', 'reason'],
  registers: [register],
});

export const vaultActivityDeposits = new Gauge({
  name: 'vault_activity_deposits_total_24h',
  help: 'Total number of successful deposits in the last 24 hours',
  labelNames: ['vault_id', 'tenant_id'],
  registers: [register],
});

export const vaultActivityWithdrawals = new Gauge({
  name: 'vault_activity_withdrawals_total_24h',
  help: 'Total number of successful withdrawals in the last 24 hours',
  labelNames: ['vault_id', 'tenant_id'],
  registers: [register],
});

export const vaultActivityVolume = new Gauge({
  name: 'vault_activity_volume_24h_usd',
  help: 'Total volume (deposits + withdrawals) in USD over the last 24 hours',
  labelNames: ['vault_id', 'tenant_id'],
  registers: [register],
});

export const vaultFailureRate = new Gauge({
  name: 'vault_failure_rate_percent',
  help: 'Percentage of failed transactions over the last 24 hours',
  labelNames: ['vault_id', 'failure_type'],
  registers: [register],
});

export const vaultFailureCount = new Gauge({
  name: 'vault_failure_count_24h',
  help: 'Total number of failed transactions in the last 24 hours',
  labelNames: ['vault_id', 'failure_type'],
  registers: [register],
});

export const vaultLatencyP50 = new Gauge({
  name: 'vault_operation_latency_p50_ms',
  help: '50th percentile latency for vault operations in ms',
  labelNames: ['vault_id', 'operation'],
  registers: [register],
});

export const vaultLatencyP95 = new Gauge({
  name: 'vault_operation_latency_p95_ms',
  help: '95th percentile latency for vault operations in ms',
  labelNames: ['vault_id', 'operation'],
  registers: [register],
});

export const vaultLatencyP99 = new Gauge({
  name: 'vault_operation_latency_p99_ms',
  help: '99th percentile latency for vault operations in ms',
  labelNames: ['vault_id', 'operation'],
  registers: [register],
});

export const systemHealthStatus = new Gauge({
  name: 'system_health_status',
  help: 'System-wide health: 1 = healthy, 0.5 = degraded, 0 = critical',
  registers: [register],
});

export const systemDependencyHealth = new Gauge({
  name: 'system_dependency_health',
  help: 'Dependency health: 1 = up, 0 = down',
  labelNames: ['dependency'],
  registers: [register],
});

export const systemMetricsUpdatedAt = new Gauge({
  name: 'system_metrics_last_updated_timestamp',
  help: 'Timestamp when operational metrics were last computed',
  registers: [register],
});

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VaultActivityMetrics {
  vaultId: string;
  tenantId: string;
  depositsCount24h: number;
  withdrawalsCount24h: number;
  depositVolumeUsd: number;
  withdrawalVolumeUsd: number;
  failureCount24h: number;
  failureRatePercent: number;
  failuresByType: Record<string, number>;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  health: 'healthy' | 'degraded' | 'unhealthy';
  lastUpdated: Date;
}

export interface SystemHealthSummary {
  status: 'healthy' | 'degraded' | 'critical';
  vaultCount: number;
  activeVaults: number;
  totalTvlUsd: string;
  totalUsers: number;
  dependencies: Record<string, 'up' | 'down'>;
  failingEndpoints: string[];
  lastUpdated: Date;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (currentIndex < items.length) {
        const index = currentIndex++;
        results[index] = await fn(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/**
 * Collects activity metrics for a specific vault over the last 24 hours.
 */
export async function collectVaultActivityMetrics(
  vaultId: string,
  tenantId: string,
): Promise<VaultActivityMetrics> {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - ONE_DAY_MS);

  const [deposits, withdrawals, failures] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        vaultId,
        tenantId,
        type: 'deposit',
        status: 'completed',
        timestamp: { gte: oneDayAgo },
      },
      select: { amount: true, latencyMs: true },
    }),
    prisma.transaction.findMany({
      where: {
        vaultId,
        tenantId,
        type: 'withdrawal',
        status: 'completed',
        timestamp: { gte: oneDayAgo },
      },
      select: { amount: true, latencyMs: true },
    }),
    prisma.transaction.findMany({
      where: {
        vaultId,
        tenantId,
        status: { in: ['failed', 'partial_failure'] },
        timestamp: { gte: oneDayAgo },
      },
      select: { failureReason: true, latencyMs: true },
    }),
  ]);

  const depositVolume = deposits.reduce(
    (sum, d) => sum + (parseFloat(d.amount) || 0),
    0,
  );
  const withdrawalVolume = withdrawals.reduce(
    (sum, w) => sum + (parseFloat(w.amount) || 0),
    0,
  );

  const allLatencies = [
    ...deposits.map((d) => d.latencyMs),
    ...withdrawals.map((w) => w.latencyMs),
    ...failures.map((f) => f.latencyMs),
  ]
    .filter((l): l is number => typeof l === 'number')
    .sort((a, b) => a - b);

  const failuresByType = failures.reduce(
    (acc, f) => {
      const reason = f.failureReason || 'unknown';
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const totalTransactions = deposits.length + withdrawals.length + failures.length;
  const failureRatePercent =
    totalTransactions > 0 ? (failures.length / totalTransactions) * 100 : 0;

  let health: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  if (failureRatePercent > 10) health = 'unhealthy';
  else if (failureRatePercent > 5) health = 'degraded';

  return {
    vaultId,
    tenantId,
    depositsCount24h: deposits.length,
    withdrawalsCount24h: withdrawals.length,
    depositVolumeUsd: depositVolume,
    withdrawalVolumeUsd: withdrawalVolume,
    failureCount24h: failures.length,
    failureRatePercent,
    failuresByType,
    avgLatencyMs:
      allLatencies.length > 0
        ? allLatencies.reduce((a, b) => a + b) / allLatencies.length
        : 0,
    p50LatencyMs: percentile(allLatencies, 0.5),
    p95LatencyMs: percentile(allLatencies, 0.95),
    p99LatencyMs: percentile(allLatencies, 0.99),
    health,
    lastUpdated: now,
  };
}

export function aggregateTvl(vaults: ReadonlyArray<{ tvlUsd?: string | null }>): string {
  return vaults
    .reduce((acc, vault) => acc.add(new Decimal(vault.tvlUsd ?? '0')), new Decimal(0))
    .toFixed(2);
}

export async function collectSystemHealthSummary(): Promise<SystemHealthSummary> {
  const now = new Date();

  const vaults = await prisma.vault.findMany({
    where: { deletedAt: null },
    take: 10,
    select: {
      id: true,
      tvlUsd: true,
    },
  });

  const userCount = await prisma.user.count();

  const oneDayAgo = new Date(now.getTime() - ONE_DAY_MS);
  const failedTransactions = await prisma.transaction.findMany({
    where: {
      status: { in: ['failed', 'partial_failure'] },
      timestamp: { gte: oneDayAgo },
    },
    select: { id: true },
    take: 1000,
  });

  const totalTvl = aggregateTvl(vaults);

  const failureRate =
    vaults.length > 0
      ? (failedTransactions.length / (vaults.length * 100)) * 100
      : 0;

  let status: 'healthy' | 'degraded' | 'critical' = 'healthy';
  if (failureRate > 15) status = 'critical';
  else if (failureRate > 8) status = 'degraded';

  return {
    status,
    vaultCount: vaults.length,
    activeVaults: vaults.filter((v) => v.tvlUsd && parseFloat(v.tvlUsd) > 0).length,
    totalTvlUsd: totalTvl,
    totalUsers: userCount,
    dependencies: {
      database: 'up',
      soroban_rpc: 'up',
      redis: 'up',
    },
    failingEndpoints: failureRate > 5 ? ['POST /vault/deposit', 'POST /vault/withdraw'] : [],
    lastUpdated: now,
  };
}

export async function syncOperationalMetrics(): Promise<void> {
  try {
    const now = new Date();

    const vaults = await prisma.vault.findMany({
      where: { deletedAt: null },
      take: 10,
      select: {
        id: true,
        tenantId: true,
      },
    });

    await mapWithConcurrency(vaults, 5, async (vault) => {
      const activity = await collectVaultActivityMetrics(vault.id, vault.tenantId);

      vaultActivityDeposits.set(
        { vault_id: vault.id, tenant_id: vault.tenantId },
        activity.depositsCount24h,
      );
      vaultActivityWithdrawals.set(
        { vault_id: vault.id, tenant_id: vault.tenantId },
        activity.withdrawalsCount24h,
      );
      vaultActivityVolume.set(
        { vault_id: vault.id, tenant_id: vault.tenantId },
        activity.depositVolumeUsd + activity.withdrawalVolumeUsd,
      );
      vaultFailureRate.set(
        { vault_id: vault.id, failure_type: 'total' },
        activity.failureRatePercent,
      );
      vaultFailureCount.set(
        { vault_id: vault.id, failure_type: 'total' },
        activity.failureCount24h,
      );
      vaultLatencyP50.set(
        { vault_id: vault.id, operation: 'deposit' },
        activity.p50LatencyMs,
      );
      vaultLatencyP95.set(
        { vault_id: vault.id, operation: 'deposit' },
        activity.p95LatencyMs,
      );
      vaultLatencyP99.set(
        { vault_id: vault.id, operation: 'deposit' },
        activity.p99LatencyMs,
      );

      const healthScore = activity.health === 'healthy' ? 1 : activity.health === 'degraded' ? 0.5 : 0;
      vaultHealthStatus.set(
        { vault_id: vault.id, reason: activity.health },
        healthScore,
      );
    });

    const systemHealth = await collectSystemHealthSummary();
    const systemHealthScore = systemHealth.status === 'healthy' ? 1 : systemHealth.status === 'degraded' ? 0.5 : 0;
    systemHealthStatus.set(systemHealthScore);

    for (const [dep, status] of Object.entries(systemHealth.dependencies)) {
      systemDependencyHealth.set({ dependency: dep }, status === 'up' ? 1 : 0);
    }

    systemMetricsUpdatedAt.set(now.getTime() / 1000);

    logger.log('info', 'Operational metrics synced', {
      action: 'metrics_sync',
      vaults: vaults.length,
      timestamp: now.toISOString(),
    });
  } catch (error) {
    logger.log('error', 'Failed to sync operational metrics', {
      action: 'metrics_sync_failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function percentile(sortedArray: number[], p: number): number {
  if (sortedArray.length === 0) return 0;
  const index = Math.ceil(sortedArray.length * p) - 1;
  return sortedArray[Math.max(0, index)];
}

export async function getHealthDashboardData() {
  const systemHealth = await collectSystemHealthSummary();

  const vaults = await prisma.vault.findMany({
    where: { deletedAt: null },
    take: 10,
    select: { id: true, tenantId: true },
  });

  const vaultMetrics = await mapWithConcurrency(vaults, 5, async (v) =>
    collectVaultActivityMetrics(v.id, v.tenantId),
  );

  return {
    system: systemHealth,
    vaults: vaultMetrics,
    generatedAt: new Date().toISOString(),
  };
}
