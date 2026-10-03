/**
 * @file jobs/rebalance.ts
 * Vault rebalance background job.
 *
 * FIX for issue #1427
 * -------------------
 * This file fixes the two root causes identified in the bugfix spec
 * (.kiro/specs/prisma-rebalance-timeout/):
 *
 *  1. `prisma.$transaction` now receives an explicit `{ timeout, maxWait }`
 *     options object so the rebalance job is not subject to the global 5 s
 *     Prisma default. The values are env-configurable so operators can tune
 *     them without a code deploy:
 *       REBALANCE_TX_TIMEOUT_MS  — how long Prisma waits for the transaction
 *                                  to complete (default: 15 000 ms)
 *       REBALANCE_TX_MAX_WAIT_MS — how long Prisma waits to acquire a
 *                                  connection from the pool (default: 5 000 ms)
 *
 *  2. A try/catch block now wraps the `$transaction` call. When Prisma throws
 *     `PrismaClientKnownRequestError` with code "P2028" (TransactionTimedOut)
 *     the handler:
 *       a. Lets Prisma's implicit rollback complete (it has already done so
 *          before throwing P2028 — no partial writes are visible).
 *       b. Logs at `warn` level so operators can distinguish transient timeouts
 *          from hard failures without paging.
 *       c. Records a `JobDeadLetter` with `status = "needs_retry"` so the job
 *          scheduler can automatically requeue the attempt.
 *       d. Returns without rethrowing — the error is fully handled.
 *     All other errors are re-thrown unchanged so the job governance retry
 *     loop continues to handle them exactly as before.
 *
 * Preservation
 * ------------
 * Only `backend/src/jobs/rebalance.ts` and `backend/src/jobGovernance.ts` are
 * modified. No other `prisma.$transaction` call site in the codebase is
 * touched. The happy-path (transaction completes within the configured timeout)
 * is entirely unaffected.
 */

import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { prisma } from '../prisma';
import { logger } from '../middleware/structuredLogging';
import { jobGovernanceStore } from '../jobGovernance';

// ---------------------------------------------------------------------------
// Env-configurable transaction timeout options
//
// Why 15 000 / 5 000 ms?
//   - A large rebalance plan (40+ allocation upserts) with an external price
//     fetch can easily exceed Prisma's global default of 5 000 ms under normal
//     load. 15 s gives a realistic upper bound while still failing fast enough
//     for the scheduler to requeue and retry within the same processing window.
//   - maxWait of 5 000 ms matches the global pool-acquisition timeout already
//     used by the rest of the backend, keeping connection-pool pressure uniform.
//   - Both values can be overridden via environment variables so production
//     tuning does not require a code change.
// ---------------------------------------------------------------------------
const REBALANCE_TX_TIMEOUT_MS =
  parseInt(process.env.REBALANCE_TX_TIMEOUT_MS ?? '15000', 10);
const REBALANCE_TX_MAX_WAIT_MS =
  parseInt(process.env.REBALANCE_TX_MAX_WAIT_MS ?? '5000', 10);

export interface RebalancePlanEntry {
  vaultId: string;
  strategyId: string;
  amount: number;
}

export interface RebalanceJobPayload {
  planEntries: RebalancePlanEntry[];
  attemptCount?: number;
}

/**
 * Runs the vault rebalance job.
 *
 * Atomically upserts all allocation rows in a single Prisma interactive
 * transaction. If the transaction times out (P2028) the error is caught,
 * a retryable dead-letter record is written, and the function returns without
 * throwing. All other errors propagate to the caller unchanged.
 */
export async function runRebalanceJob(payload: RebalanceJobPayload): Promise<void> {
  const { planEntries, attemptCount = 1 } = payload;

  logger.log('info', 'Rebalance job started', {
    jobName: 'vaultRebalance',
    attemptCount,
    planSize: planEntries.length,
  });

  try {
    // Pass explicit timeout and maxWait so this job is not subject to the
    // global Prisma interactive-transaction default (5 000 ms). See module
    // header for rationale on the chosen values.
    await prisma.$transaction(
      async (tx) => {
        for (const entry of planEntries) {
          await tx.allocation.upsert({
            where: {
              // Composite unique key: vaultId + strategyId
              id: `${entry.vaultId}_${entry.strategyId}`,
            },
            update: {
              amount: entry.amount,
            },
            create: {
              id: `${entry.vaultId}_${entry.strategyId}`,
              vaultId: entry.vaultId,
              strategyId: entry.strategyId,
              amount: entry.amount,
            },
          });
        }
      },
      {
        timeout: REBALANCE_TX_TIMEOUT_MS,
        maxWait: REBALANCE_TX_MAX_WAIT_MS,
      },
    );
  } catch (err) {
    // Handle TransactionTimedOutError (P2028) specifically.
    //
    // Prisma guarantees that by the time P2028 is thrown the transaction has
    // already been rolled back — no partial allocation writes are visible to
    // readers. We therefore do not need a compensating write; we simply record
    // a retryable dead-letter so the scheduler can requeue the attempt.
    if (
      err instanceof PrismaClientKnownRequestError &&
      err.code === 'P2028'
    ) {
      logger.log(
        'warn',
        'Rebalance transaction timed out; recording retryable dead-letter',
        {
          jobName: 'vaultRebalance',
          attemptCount,
          timeoutMs: REBALANCE_TX_TIMEOUT_MS,
          error: err.message,
        },
      );

      jobGovernanceStore.recordDeadLetter({
        jobName: 'vaultRebalance',
        attempts: attemptCount,
        error: err.message,
        payload,
        failedAt: new Date().toISOString(),
        status: 'needs_retry',
      });

      // Error is fully handled — do not rethrow.
      return;
    }

    // All other errors (constraint violations, network errors, etc.) propagate
    // unchanged so the job governance retry loop handles them as before.
    throw err;
  }

  logger.log('info', 'Rebalance job completed', {
    jobName: 'vaultRebalance',
    attemptCount,
    planSize: planEntries.length,
  });
}
