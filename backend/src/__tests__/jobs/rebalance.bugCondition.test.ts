/**
 * @file rebalance.bugCondition.test.ts
 *
 * Bug Condition Exploration Test - Property 1 (Bug Condition)
 * Validates: Requirements 1.1, 1.2, 1.3
 *
 * PURPOSE
 * -------
 * This test encodes the EXPECTED behaviour AFTER the fix. On the UNFIXED code it
 * is expected to FAIL -- that failure is the counterexample that proves the bug
 * exists. Do NOT modify the production code to make this test pass in this task;
 * that is the job of task 3.
 *
 * BUG CONDITION (isBugCondition)
 * --------------------------------
 *   X.transactionOptions.timeout   = undefined   // no explicit timeout at call site
 *   X.transactionOptions.maxWait   = undefined   // no explicit maxWait at call site
 *   X.elapsedTransactionMs > PRISMA_DEFAULT_TX_TIMEOUT_MS  // 5 000 ms
 *
 * The mock below simulates the outcome Prisma produces when this condition is
 * met: a PrismaClientKnownRequestError with code "P2028".
 *
 * ASSERTIONS
 * ----------
 *  A1. runRebalanceJob(payload) does NOT throw (the error is caught and handled).
 *  A2. The thrown error -- if any -- is a PrismaClientKnownRequestError with
 *      code === "P2028" (on unfixed code it propagates unhandled).
 *  A3. jobGovernanceStore.listDeadLetters({ status: 'needs_retry' }).total === 1
 *      (on unfixed code no needs_retry dead-letter is written -- total is 0).
 *  A4. logger.log was called with 'warn' and a message containing "timed out" or
 *      "P2028" (on unfixed code no such log is emitted).
 *
 * ============================================================================
 * CODE ANALYSIS: EXPECTED FAILURES ON UNFIXED CODE (Task 1 Documentation)
 * ============================================================================
 *
 * The following analysis was performed by reading backend/src/jobs/rebalance.ts
 * (the unfixed stub) and confirms the bug exists through static code inspection.
 *
 * UNFIXED CODE EXCERPT (rebalance.ts):
 * ======================================
 *   export async function runRebalanceJob(payload: RebalanceJobPayload): Promise<void> {
 *     // ...
 *     await prisma.$transaction(async (tx) => {    // <-- no { timeout, maxWait } options
 *       for (const entry of planEntries) {
 *         await tx.allocation.upsert({ ... });
 *       }
 *     });
 *     // <-- no try/catch for PrismaClientKnownRequestError { code: "P2028" }
 *   }
 *
 * WHY THE TESTS FAIL ON UNFIXED CODE:
 * =====================================
 *
 *  CE-1 / A1 FAILS -- runRebalanceJob throws PrismaClientKnownRequestError { code: "P2028" }
 *  ==========================================================================================
 *  Root cause: prisma.$transaction is mocked to throw P2028. The unfixed
 *  runRebalanceJob has NO try/catch block around prisma.$transaction, so the
 *  PrismaClientKnownRequestError propagates unhandled to the caller (the test).
 *  The test asserts `resolves.not.toThrow()` but the function rejects, causing
 *  the assertion to fail.
 *
 *  Counterexample:
 *    INPUT:  payload = { planEntries: [{ vaultId: 'vault-001', strategyId: 'strategy-alpha', amount: 1000 }] }
 *            prisma.$transaction.mockRejectedValue(
 *              new PrismaClientKnownRequestError('...timed out...', { code: 'P2028', clientVersion: '5.x' })
 *            )
 *    ACTUAL: runRebalanceJob(payload) => rejects with PrismaClientKnownRequestError { code: "P2028" }
 *    EXPECT: runRebalanceJob(payload) => resolves (error caught and handled internally)
 *
 *  CE-2 / A3 FAILS -- jobGovernanceStore.listDeadLetters({ status: 'needs_retry' }).total === 0
 *  =============================================================================================
 *  Root cause: Because no catch block exists at the job boundary, no code path
 *  ever calls jobGovernanceStore.recordDeadLetter({ ..., status: 'needs_retry' }).
 *  The dead-letter store remains empty after a P2028 error.
 *  Additionally, 'needs_retry' is not even a valid value in the current
 *  DeadLetterStatus union type in jobGovernance.ts (only 'dead-letter',
 *  'processing', 'resolved', 'requeued', 'discarded' are defined).
 *
 *  Counterexample:
 *    INPUT:  prisma.$transaction throws P2028
 *    ACTUAL: jobGovernanceStore.listDeadLetters({ status: 'needs_retry' }).total === 0
 *    EXPECT: jobGovernanceStore.listDeadLetters({ status: 'needs_retry' }).total === 1
 *
 *  CE-3 / A4 FAILS -- no warn-level log with "timed out" or "P2028"
 *  =================================================================
 *  Root cause: Because no catch block exists, logger.log is never called with
 *  'warn' level for the P2028 case. The only logger.log calls in the unfixed
 *  code are at 'info' level for job start/end, which are never reached when
 *  prisma.$transaction throws.
 *
 *  Counterexample:
 *    INPUT:  prisma.$transaction throws P2028
 *    ACTUAL: mockLoggerLog was never called with ('warn', <message containing "timed out">)
 *    EXPECT: mockLoggerLog was called once with ('warn', '...timed out...' or '...P2028...')
 *
 * CONFIRMED ROOT CAUSES (from code analysis):
 * ============================================
 *  1. prisma.$transaction called without { timeout, maxWait } => inherits global 5 000 ms default
 *  2. No try/catch for PrismaClientKnownRequestError code "P2028" in runRebalanceJob
 *  3. DeadLetterStatus type in jobGovernance.ts does not include "needs_retry" (type gap)
 *  4. No warn-level log at the rebalance timeout boundary
 *
 * COUNTEREXAMPLES DOCUMENTED (from static analysis of unfixed code)
 * =================================================================
 *  CE-1: runRebalanceJob(payload) throws PrismaClientKnownRequestError { code: "P2028" }
 *        -- the error escapes the job boundary uncaught. (Violates A1)
 *  CE-2: jobGovernanceStore.listDeadLetters({ status: 'needs_retry' }).total === 0
 *        -- no retryable dead-letter is written; failure invisible to retry scheduler. (Violates A3)
 *  CE-3: logger.log never called with 'warn' + message containing "timed out"
 *        -- no operator-visible log is emitted. (Violates A4)
 */

import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

// Mock prisma BEFORE importing the module under test
const mockTransaction = jest.fn();

jest.mock('../../prisma', () => ({
  prisma: {
    $transaction: mockTransaction,
  },
}));

// Mock logger
const mockLoggerLog = jest.fn();

jest.mock('../../middleware/structuredLogging', () => ({
  logger: { log: mockLoggerLog },
}));

// Mock criticalEntityPolicy (required by prisma.ts at module load)
jest.mock('../../criticalEntityPolicy', () => ({
  assertCriticalEntityMutationAllowed: jest.fn(),
}));

// Import SUT and governance store AFTER mocks are in place
import { runRebalanceJob, type RebalanceJobPayload } from '../../jobs/rebalance';
import { jobGovernanceStore, resetJobGovernance } from '../../jobGovernance';

// Test helpers

/** Builds a minimal P2028 error that mirrors what Prisma throws on tx timeout. */
function makeP2028Error(): PrismaClientKnownRequestError {
  return new PrismaClientKnownRequestError(
    "Transaction already closed: Transaction is no longer valid. Last state: 'Expired'.",
    { code: 'P2028', clientVersion: '5.x' },
  );
}

/** A simple one-entry rebalance plan used as the test payload. */
const TEST_PAYLOAD: RebalanceJobPayload = {
  planEntries: [
    { vaultId: 'vault-001', strategyId: 'strategy-alpha', amount: 1000 },
  ],
  attemptCount: 1,
};

// Test setup

beforeEach(() => {
  jest.clearAllMocks();
  resetJobGovernance();
});

// Bug Condition Property Tests

describe('Bug Condition: Unhandled P2028 Transaction Timeout (Requirements 1.1, 1.2, 1.3)', () => {
  /**
   * A1 -- runRebalanceJob must NOT throw when P2028 is thrown by prisma.$transaction.
   *
   * EXPECTED ON UNFIXED CODE: FAILS -- the error propagates unhandled to the test
   * boundary, confirming CE-1.
   *
   * Counterexample: runRebalanceJob(payload) rejects with PrismaClientKnownRequestError
   * { code: "P2028" } instead of resolving.
   */
  it('A1: runRebalanceJob resolves without throwing when prisma.$transaction throws P2028', async () => {
    mockTransaction.mockRejectedValueOnce(makeP2028Error());

    // On the fixed code this should resolve. On unfixed code it rejects => FAIL.
    await expect(runRebalanceJob(TEST_PAYLOAD)).resolves.not.toThrow();
  });

  /**
   * A2 -- If the job does throw, the error must be PrismaClientKnownRequestError
   * with code === "P2028" (proving the bug: it propagates unhandled).
   *
   * This assertion documents WHAT propagates on unfixed code.
   * On fixed code, runRebalanceJob does not throw, so caughtError is undefined.
   */
  it('A2: if runRebalanceJob throws, the thrown error is PrismaClientKnownRequestError with code P2028', async () => {
    const p2028 = makeP2028Error();
    mockTransaction.mockRejectedValueOnce(p2028);

    let caughtError: unknown;
    try {
      await runRebalanceJob(TEST_PAYLOAD);
    } catch (err) {
      caughtError = err;
    }

    if (caughtError !== undefined) {
      // Confirms CE-1: the error that escaped is P2028.
      expect(caughtError).toBeInstanceOf(PrismaClientKnownRequestError);
      expect((caughtError as PrismaClientKnownRequestError).code).toBe('P2028');
    }
    // On fixed code: caughtError is undefined (no throw) -- test passes trivially.
  });

  /**
   * A3 -- Exactly one needs_retry dead-letter must be written.
   *
   * EXPECTED ON UNFIXED CODE: FAILS -- no needs_retry dead-letter is recorded,
   * total === 0, confirming CE-2.
   *
   * Counterexample: total === 0 instead of 1.
   */
  it('A3: exactly one needs_retry dead-letter is recorded after a P2028 timeout', async () => {
    mockTransaction.mockRejectedValueOnce(makeP2028Error());

    // We do not care whether the call throws here; we want to inspect the store.
    try {
      await runRebalanceJob(TEST_PAYLOAD);
    } catch {
      // On unfixed code the error escapes -- that is the bug, not a test error.
    }

    const { total } = jobGovernanceStore.listDeadLetters({ status: 'needs_retry' });

    // On unfixed code: total === 0 => FAIL (CE-2 confirmed).
    expect(total).toBe(1);
  });

  /**
   * A3b -- Zero dead-letters with generic 'dead-letter' status must exist after P2028.
   *
   * On fixed code: 0 generic dead-letters (P2028 is classified as needs_retry).
   */
  it('A3b: no generic dead-letter record is written (only needs_retry)', async () => {
    mockTransaction.mockRejectedValueOnce(makeP2028Error());

    try {
      await runRebalanceJob(TEST_PAYLOAD);
    } catch {
      // Swallow -- on unfixed code the error propagates.
    }

    const { total: genericTotal } = jobGovernanceStore.listDeadLetters({ status: 'dead-letter' });

    // On fixed code: 0 generic dead-letters (P2028 is classified as needs_retry).
    expect(genericTotal).toBe(0);
  });

  /**
   * A4 -- logger.log must be called with 'warn' and a message containing
   * "timed out" or "P2028".
   *
   * EXPECTED ON UNFIXED CODE: FAILS -- no warn-level log is emitted, confirming
   * CE-3.
   *
   * Counterexample: warnCalls.length === 0 instead of >= 1.
   */
  it('A4: logger.log is called with "warn" and a message containing "timed out" or "P2028"', async () => {
    mockTransaction.mockRejectedValueOnce(makeP2028Error());

    try {
      await runRebalanceJob(TEST_PAYLOAD);
    } catch {
      // Swallow -- on unfixed code the error propagates.
    }

    const warnCalls = mockLoggerLog.mock.calls.filter(
      ([level, message]: [string, string]) =>
        level === 'warn' &&
        (message.toLowerCase().includes('timed out') || message.includes('P2028')),
    );

    // On unfixed code: warnCalls.length === 0 => FAIL (CE-3 confirmed).
    expect(warnCalls.length).toBeGreaterThanOrEqual(1);
  });

  /**
   * Combined scenario: all four properties checked in a single invocation,
   * providing the clearest single counterexample for documentation purposes.
   *
   * EXPECTED ON UNFIXED CODE: FAILS on the first expect that is violated
   * (typically the resolves check, CE-1).
   */
  it('Combined: P2028 is caught, no unhandled throw, needs_retry dead-letter written, warn log emitted', async () => {
    mockTransaction.mockRejectedValueOnce(makeP2028Error());

    // A1: no unhandled throw
    await expect(runRebalanceJob(TEST_PAYLOAD)).resolves.not.toThrow();

    // A3: exactly one needs_retry dead-letter
    const { total } = jobGovernanceStore.listDeadLetters({ status: 'needs_retry' });
    expect(total).toBe(1);

    // A3b: dead-letter has the correct fields
    const { records } = jobGovernanceStore.listDeadLetters({ status: 'needs_retry' });
    const record = records[0];
    expect(record).toMatchObject({
      jobName: 'vaultRebalance',
      status: 'needs_retry',
    });
    expect(record.error).toBeDefined();
    expect(record.failedAt).toBeDefined();

    // A4: warn log with "timed out" or "P2028"
    const warnCalls = mockLoggerLog.mock.calls.filter(
      ([level, message]: [string, string]) =>
        level === 'warn' &&
        (message.toLowerCase().includes('timed out') || message.includes('P2028')),
    );
    expect(warnCalls.length).toBeGreaterThanOrEqual(1);
  });
});
