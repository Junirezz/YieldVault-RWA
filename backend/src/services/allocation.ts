/**
 * @file services/allocation.ts
 * Strategy allocation rebalancing.
 *
 * Issue #1433 — the rebalance is a read-compute-write over the same set of
 * `Allocation` rows: read the vault's current allocations, compute the target
 * weights, then upsert them. Under Prisma's default `ReadCommitted` isolation
 * a concurrent rebalance over the same vault can insert or change a row
 * between our read and our write, so the second transaction overwrites the
 * first one's weights and the per-vault invariant `sum(weight) = 100` is
 * violated — silently, because nothing downstream checks it.
 *
 * The fix has two parts:
 *
 *  1. **Serializable.** The whole read-compute-write runs inside one
 *     `prisma.$transaction(..., { isolationLevel: 'Serializable' })`. SQLite
 *     (this repo's datasource) only exposes `Serializable` to Prisma, so the
 *     level is also the strongest one Postgres will accept; on Postgres the
 *     concurrent rebalance now aborts with `P2034` instead of interleaving.
 *  2. **Bounded retry.** A serialization failure is a "someone else went
 *     first", not a bug, so it is retried once with exponential backoff and
 *     counted in `rebalance_serialization_retry_total`. Everything else is
 *     surfaced to the caller untouched.
 *
 * Reads that do not mutate (`getAllocationSummary`, and the existing
 * `exposureGuardrails.ts` query paths) are deliberately left outside the
 * transaction — wrapping them would serialise read traffic for no benefit.
 *
 * Callers own their own authorisation and idempotency; this service is the
 * data-integrity boundary only.
 */

import Decimal from 'decimal.js';
import { prisma } from '../prisma';
import { logger } from '../middleware/structuredLogging';
import {
  rebalanceSerializationRetryTotal,
  rebalanceTotal,
} from '../metrics';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A target share of the vault's AUM, as a percentage. */
export interface RebalanceTarget {
  strategyId: string;
  weight: number;
}

export interface RebalanceAllocationResult {
  strategyId: string;
  weight: number;
  amount: number;
}

export interface RebalanceResult {
  vaultId: string;
  /** Weights as persisted, in the order the targets were supplied. */
  weights: RebalanceAllocationResult[];
  /** Sum of the persisted weights. Guaranteed within `WEIGHT_SUM_TOLERANCE` of 100. */
  totalWeight: number;
  /** Number of transaction attempts made (1 = no retry). */
  attempts: number;
  /** True when the first attempt lost a serialization race and was retried. */
  retried: boolean;
}

/** Per-vault allocation state, read outside any write transaction. */
export interface AllocationSummary {
  vaultId: string;
  vaultAum: number;
  allocations: RebalanceAllocationResult[];
  totalWeight: number;
  totalAmount: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** The invariant this service exists to hold, as a percentage of vault AUM. */
export const TARGET_WEIGHT_TOTAL = 100;

/**
 * Tolerance for `sum(weight) == 100`, in percentage points.
 *
 * Weights are stored as `Float` (REAL), so an exact sum cannot be represented
 * for most splits — 33.33 + 33.33 + 33.34 lands a few ULPs off 100. 1e-6 is
 * orders of magnitude below any economically meaningful drift while absorbing
 * that representation error.
 */
export const WEIGHT_SUM_TOLERANCE = 1e-6;

/** Prisma error code for a transaction that lost a serialization race. */
export const SERIALIZATION_FAILURE_CODE = 'P2034';

/** Max attempts (1 = original attempt only, no retry). Default: one retry. */
const DEFAULT_MAX_ATTEMPTS = 2;

/** Base backoff between attempts; attempt N waits `base * 2^(N-1)`. */
const DEFAULT_BASE_BACKOFF_MS = 25;

/** Upper bound on a single backoff wait. */
const DEFAULT_MAX_BACKOFF_MS = 500;

// ─── Errors ──────────────────────────────────────────────────────────────────

/** Thrown when the requested target weights cannot satisfy the invariant. */
export class InvalidRebalanceTargetError extends Error {
  readonly code = 'INVALID_REBALANCE_TARGET';
  readonly reason:
    | 'EMPTY'
    | 'NON_FINITE_WEIGHT'
    | 'NEGATIVE_WEIGHT'
    | 'OVER_ALLOCATED'
    | 'UNDER_ALLOCATED';

  constructor(reason: InvalidRebalanceTargetError['reason'], message: string) {
    super(message);
    this.name = 'InvalidRebalanceTargetError';
    this.reason = reason;
  }
}

/** Thrown when the vault the rebalance targets does not exist or is retired. */
export class VaultNotRebalanceableError extends Error {
  readonly code = 'VAULT_NOT_REBALANCEABLE';

  constructor(vaultId: string) {
    super(`Vault ${vaultId} does not exist or has been retired`);
    this.name = 'VaultNotRebalanceableError';
  }
}

/**
 * Thrown when serialization kept failing after every allowed attempt. Carries
 * the underlying error so callers can inspect it.
 */
export class RebalanceConflictError extends Error {
  readonly code = 'REBALANCE_CONFLICT';
  readonly attempts: number;
  /** The serialization failure from the final attempt, for diagnostics. */
  readonly lastError: unknown;

  constructor(attempts: number, lastError: unknown) {
    super(
      `Allocation rebalance lost ${attempts} serialization races; ` +
        'the vault is being rebalanced too frequently to converge',
    );
    this.name = 'RebalanceConflictError';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function positiveIntFromEnv(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function maxAttempts(): number {
  return positiveIntFromEnv(process.env.REBALANCE_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS);
}

function baseBackoffMs(): number {
  return positiveIntFromEnv(process.env.REBALANCE_BASE_BACKOFF_MS, DEFAULT_BASE_BACKOFF_MS);
}

function maxBackoffMs(): number {
  return positiveIntFromEnv(process.env.REBALANCE_MAX_BACKOFF_MS, DEFAULT_MAX_BACKOFF_MS);
}

/** `base * 2^(attempt-1)`, capped. Attempt 1 is the first *retry*. */
function backoffForAttempt(attempt: number): number {
  return Math.min(maxBackoffMs(), baseBackoffMs() * 2 ** Math.max(0, attempt - 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * True when the failure is a serialization conflict rather than a real error.
 *
 * `P2034` is Prisma's "transaction failed due to a write conflict or a
 * deadlock" — the documented signal for losing a Serializable race. SQLite
 * reports the same condition through `SQLITE_BUSY` / `database is locked`,
 * which Prisma can surface either as `P2034` or as a bare
 * `PrismaClientKnownRequestError` message, so both are matched. `P2028`
 * (transaction API error) is also treated as contention: it is what a
 * transaction aborts with when the underlying conflict is not classified.
 */
export function isSerializationFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as { code?: unknown; message?: unknown };
  if (candidate.code === SERIALIZATION_FAILURE_CODE) return true;
  if (candidate.code === 'P2028') return true;
  const message = typeof candidate.message === 'string' ? candidate.message.toLowerCase() : '';
  return message.includes('database is locked') || message.includes('sqlite_busy');
}

/**
 * Validates the requested target weights against the per-vault invariant.
 *
 * Runs *before* the transaction opens so a malformed request never takes a
 * write lock, and is repeated inside the transaction because the vault AUM the
 * amounts are derived from is only known there.
 */
export function validateTargetWeights(targets: RebalanceTarget[]): Decimal {
  if (targets.length === 0) {
    throw new InvalidRebalanceTargetError(
      'EMPTY',
      'A rebalance must target at least one strategy',
    );
  }

  const seen = new Set<string>();
  let total = new Decimal(0);

  for (const target of targets) {
    if (!target.strategyId || typeof target.strategyId !== 'string') {
      throw new InvalidRebalanceTargetError(
        'EMPTY',
        'Every rebalance target needs a strategyId',
      );
    }
    if (seen.has(target.strategyId)) {
      throw new InvalidRebalanceTargetError(
        'EMPTY',
        `Duplicate strategyId in rebalance targets: ${target.strategyId}`,
      );
    }
    seen.add(target.strategyId);

    if (typeof target.weight !== 'number' || !Number.isFinite(target.weight)) {
      throw new InvalidRebalanceTargetError(
        'NON_FINITE_WEIGHT',
        `Weight for ${target.strategyId} must be a finite number`,
      );
    }
    if (target.weight < 0) {
      throw new InvalidRebalanceTargetError(
        'NEGATIVE_WEIGHT',
        `Weight for ${target.strategyId} must not be negative (got ${target.weight})`,
      );
    }

    total = total.plus(new Decimal(target.weight));
  }

  const tolerance = new Decimal(WEIGHT_SUM_TOLERANCE);
  const target100 = new Decimal(TARGET_WEIGHT_TOTAL);
  if (total.gt(target100.plus(tolerance))) {
    throw new InvalidRebalanceTargetError(
      'OVER_ALLOCATED',
      `Target weights sum to ${total.toFixed(6)}%, which exceeds ${TARGET_WEIGHT_TOTAL}%`,
    );
  }
  if (total.lt(target100.minus(tolerance))) {
    throw new InvalidRebalanceTargetError(
      'UNDER_ALLOCATED',
      `Target weights sum to ${total.toFixed(6)}%, which is below ${TARGET_WEIGHT_TOTAL}%`,
    );
  }

  return total;
}

/**
 * Turns target weights into absolute amounts against the vault's AUM.
 *
 * The residual from rounding is given to the largest-weight target so the
 * amounts sum to exactly the AUM rather than drifting by a few cents.
 */
export function computeAllocationAmounts(
  vaultAum: Decimal,
  targets: RebalanceTarget[]
): Map<string, Decimal> {
  const hundred = new Decimal(TARGET_WEIGHT_TOTAL);
  const amounts = new Map<string, Decimal>();
  let assigned = new Decimal(0);
  let largestStrategyId: string | null = null;
  let largestWeight = new Decimal(-1);

  for (const target of targets) {
    const weight = new Decimal(target.weight);
    const amount = vaultAum.times(weight).div(hundred);
    amounts.set(target.strategyId, amount);
    assigned = assigned.plus(amount);

    if (weight.gt(largestWeight)) {
      largestWeight = weight;
      largestStrategyId = target.strategyId;
    }
  }

  if (largestStrategyId !== null) {
    amounts.set(largestStrategyId, amounts.get(largestStrategyId)!.plus(vaultAum.minus(assigned)));
  }

  return amounts;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Read-only view of a vault's allocations. Deliberately not wrapped in a
 * transaction: it mutates nothing, and a read lock here would serialise the
 * dashboard against every rebalance.
 */
export async function getAllocationSummary(vaultId: string): Promise<AllocationSummary | null> {
  const vault = await prisma.vault.findUnique({
    where: { id: vaultId },
    select: {
      aum: true,
      allocations: {
        select: { strategyId: true, weight: true, amount: true },
        orderBy: { weight: 'desc' },
      },
    },
  });

  if (!vault) return null;

  const allocations = vault.allocations.map((row) => ({
    strategyId: row.strategyId,
    weight: row.weight,
    amount: row.amount,
  }));

  return {
    vaultId,
    vaultAum: vault.aum,
    allocations,
    totalWeight: allocations.reduce((sum, row) => sum + row.weight, 0),
    totalAmount: allocations.reduce((sum, row) => sum + row.amount, 0),
  };
}

/**
 * The read-compute-write body. Runs inside the caller's transaction client and
 * must not open one of its own.
 */
async function applyRebalance(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  vaultId: string,
  targets: RebalanceTarget[]
): Promise<RebalanceResult> {
  // 1. Read. Everything the write depends on is read *inside* the transaction,
  //    so a concurrent commit cannot land between this read and the writes
  //    below. This is the step that was previously vulnerable to a phantom.
  const vault = await tx.vault.findUnique({
    where: { id: vaultId },
    select: { id: true, aum: true, deletedAt: true },
  });

  if (!vault || vault.deletedAt !== null) {
    throw new VaultNotRebalanceableError(vaultId);
  }

  // Re-validate inside the transaction: the caller may have validated a
  // request that was built against a stale vault.
  validateTargetWeights(targets);

  const current = await tx.allocation.findMany({
    where: { vaultId },
    select: { id: true, strategyId: true, amount: true, weight: true },
  });

  const vaultAum = new Decimal(vault.aum || 0);
  const amounts = computeAllocationAmounts(vaultAum, targets);

  // 2. Write. Upsert on the (vaultId, strategyId) unique key so a concurrent
  //    rebalance that already created the row is updated, not duplicated.
  for (const target of targets) {
    const amount = amounts.get(target.strategyId)!;

    await tx.allocation.upsert({
      where: {
        vaultId_strategyId: { vaultId, strategyId: target.strategyId },
      },
      create: {
        vaultId,
        strategyId: target.strategyId,
        amount: amount.toNumber(),
        weight: target.weight,
      },
      update: {
        amount: amount.toNumber(),
        weight: target.weight,
      },
    });
  }

  // 3. Retire allocations that are no longer targeted. Without this, dropping a
  //    strategy from the target list would leave its weight behind and break
  //    sum(weight) = 100 on the next read.
  const targetStrategyIds = targets.map((target) => target.strategyId);
  const stale = current.filter((row) => !targetStrategyIds.includes(row.strategyId));
  if (stale.length > 0) {
    await tx.allocation.deleteMany({
      where: { id: { in: stale.map((row) => row.id) } },
    });
  }

  const weights: RebalanceAllocationResult[] = targets.map((target) => ({
    strategyId: target.strategyId,
    weight: target.weight,
    amount: amounts.get(target.strategyId)!.toNumber(),
  }));

  logger.log('info', 'Vault allocations rebalanced', {
    vaultId,
    targets: weights.length,
    retired: stale.length,
    totalWeight: weights.reduce((sum, row) => sum + row.weight, 0),
  });

  return {
    vaultId,
    weights,
    totalWeight: weights.reduce((sum, row) => sum + row.weight, 0),
    attempts: 1,
    retried: false,
  };
}

/**
 * Rebalances one vault's allocations to the given target weights, atomically.
 *
 * The invariant `sum(weight) = 100` is enforced before the transaction opens,
 * the whole read-compute-write runs at `Serializable`, and a lost race is
 * retried once with exponential backoff.
 *
 * @throws {InvalidRebalanceTargetError} target weights are empty, duplicated,
 *   non-finite, negative, or do not sum to 100
 * @throws {VaultNotRebalanceableError} the vault is missing or soft-deleted
 * @throws {RebalanceConflictError} every allowed attempt lost a serialization race
 */
export async function rebalanceVaultAllocations(
  vaultId: string,
  targets: RebalanceTarget[]
): Promise<RebalanceResult> {
  // Fail fast on a malformed request so it never contends for a write lock.
  validateTargetWeights(targets);

  const limit = maxAttempts();
  let lastError: unknown;

  for (let attempt = 1; attempt <= limit; attempt += 1) {
    try {
      const result = await prisma.$transaction(
        (tx) => applyRebalance(tx, vaultId, targets),
        {
          isolationLevel: 'Serializable',
          maxWait: 5_000,
          timeout: 10_000,
        },
      );

      rebalanceTotal.inc({ operation: 'rebalance', outcome: attempt === 1 ? 'ok' : 'ok_after_retry' });

      return { ...result, attempts: attempt, retried: attempt > 1 };
    } catch (err) {
      if (!isSerializationFailure(err)) {
        rebalanceTotal.inc({ operation: 'rebalance', outcome: 'error' });
        throw err;
      }

      lastError = err;
      logger.log('warn', 'Rebalance lost a serialization race, retrying', {
        vaultId,
        attempt,
        limit,
        code: (err as { code?: string }).code,
      });

      if (attempt < limit) {
        rebalanceSerializationRetryTotal.inc({ operation: 'rebalance', attempt: String(attempt) });
        await sleep(backoffForAttempt(attempt));
      }
    }
  }

  rebalanceTotal.inc({ operation: 'rebalance', outcome: 'conflict' });
  throw new RebalanceConflictError(limit, lastError);
}
