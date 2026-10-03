/**
 * Policy-driven retention cleanup for stale idempotency records (Issue #716).
 *
 * Complements Redis TTL expiry with scheduled sweeps of local cache and orphaned
 * Redis keys, reporting metrics for governance observability.
 */

import { idempotencyStore } from './idempotency';
import { logger } from './middleware/structuredLogging';

export interface IdempotencyRetentionPolicy {
  retentionMs: number;
  sweepIntervalMs: number;
  enabled: boolean;
}

export interface IdempotencyRetentionMetrics {
  lastSweepAt: string | null;
  lastSweepDurationMs: number | null;
  totalPruned: number;
  lastPrunedCount: number;
  policy: IdempotencyRetentionPolicy;
  storeMetrics: ReturnType<typeof idempotencyStore.getMetrics>;
}

const retentionState = {
  lastSweepAt: null as string | null,
  lastSweepDurationMs: null as number | null,
  totalPruned: 0,
  lastPrunedCount: 0,
};

export function getIdempotencyRetentionPolicy(): IdempotencyRetentionPolicy {
  return {
    retentionMs: parseInt(process.env.IDEMPOTENCY_KEY_TTL_MS || '86400000', 10),
    sweepIntervalMs: parseInt(process.env.IDEMPOTENCY_RETENTION_SWEEP_MS || '3600000', 10),
    enabled: process.env.IDEMPOTENCY_RETENTION_ENABLED !== 'false',
  };
}

export function getIdempotencyRetentionMetrics(): IdempotencyRetentionMetrics {
  return {
    ...retentionState,
    policy: getIdempotencyRetentionPolicy(),
    storeMetrics: idempotencyStore.getMetrics(),
  };
}

export interface IdempotencyRetentionSweepResult {
  /** Total entries pruned (or, in dry-run mode, that would be pruned). */
  pruned: number;
  localPruned: number;
  redisPruned: number;
  dryRun: boolean;
}

/**
 * Runs a retention sweep. With `dryRun`, reports what would be pruned without
 * deleting entries or updating the sweep metrics, so it is safe to rehearse
 * against production.
 */
export async function pruneStaleIdempotencyRecords(
  dryRun = false,
): Promise<IdempotencyRetentionSweepResult> {
  const startedAt = Date.now();
  const policy = getIdempotencyRetentionPolicy();
  const result = await idempotencyStore.pruneStaleKeys(policy.retentionMs, dryRun);

  if (dryRun) {
    logger.log('info', 'Idempotency retention dry-run completed', {
      wouldPrune: result.pruned,
      localPruned: result.localPruned,
      redisPruned: result.redisPruned,
      retentionMs: policy.retentionMs,
    });
  } else {
    retentionState.totalPruned += result.pruned;
    retentionState.lastPrunedCount = result.pruned;
    retentionState.lastSweepAt = new Date().toISOString();
    retentionState.lastSweepDurationMs = Date.now() - startedAt;

    if (result.pruned > 0) {
      logger.log('info', 'Idempotency retention sweep completed', {
        pruned: result.pruned,
        retentionMs: policy.retentionMs,
        durationMs: retentionState.lastSweepDurationMs,
      });
    }
  }

  return {
    pruned: result.pruned,
    localPruned: result.localPruned,
    redisPruned: result.redisPruned,
    dryRun,
  };
}

export function startIdempotencyRetentionScheduler(): () => void {
  const policy = getIdempotencyRetentionPolicy();
  if (!policy.enabled) {
    return () => undefined;
  }

  const intervalMs = Math.max(60_000, policy.sweepIntervalMs);
  const timer = setInterval(() => {
    void pruneStaleIdempotencyRecords(false);
  }, intervalMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return () => clearInterval(timer);
}

export function resetIdempotencyRetentionStateForTests(): void {
  retentionState.lastSweepAt = null;
  retentionState.lastSweepDurationMs = null;
  retentionState.totalPruned = 0;
  retentionState.lastPrunedCount = 0;
}
