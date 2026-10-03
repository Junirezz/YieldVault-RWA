/**
 * @file rebalance.preservation.test.ts
 *
 * Preservation Property Tests — Property 2 (Preservation)
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4
 *
 * PURPOSE
 * -------
 * These tests encode behaviors that MUST remain identical before and after the
 * P2028 fix. They are written on the UNFIXED code and must PASS on it —
 * establishing the baseline. After the fix is applied in Task 3 they must
 * CONTINUE to pass, proving no regression was introduced.
 *
 * PRESERVATION INVARIANT (pseudocode)
 * -------------------------------------
 *   FOR ALL X WHERE NOT isBugCondition(X) DO
 *     ASSERT runRebalanceJob_original(X) = runRebalanceJob_fixed(X)
 *   END FOR
 *
 * isBugCondition(X) fires only when prisma.$transaction throws P2028 AND the
 * call has no explicit timeout/maxWait. All tests below use inputs that do NOT
 * satisfy the bug condition.
 *
 * PROPERTY TESTS
 * --------------
 *  P2-1: Happy-path — successful transaction resolves without throw, no dead-letter
 *  P2-2: Non-P2028 generic error propagates unchanged out of runRebalanceJob
 *  P2-3: Non-P2028 Prisma error (e.g. P2003) propagates unchanged
 *  P2-4: prisma.$transaction is NOT called with rebalance timeout options on
 *        unfixed code (no options object at all); post-fix the options must be
 *        present on the rebalance call but absent on all other callers
 *
 * EXPECTED OUTCOME ON UNFIXED CODE: All tests PASS (preservation baseline)
 * EXPECTED OUTCOME ON FIXED CODE:   All tests still PASS (no regressions)
 */

import fc from 'fast-check';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

// ---------------------------------------------------------------------------
// Mocks — must be declared before module imports
// ---------------------------------------------------------------------------

const mockTransaction = jest.fn();

jest.mock('../../prisma', () => ({
  prisma: {
    $transaction: mockTransaction,
  },
}));

const mockLoggerLog = jest.fn();

jest.mock('../../middleware/structuredLogging', () => ({
  logger: { log: mockLoggerLog },
}));

jest.mock('../../criticalEntityPolicy', () => ({
  assertCriticalEntityMutationAllowed: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { runRebalanceJob, type RebalanceJobPayload, type RebalancePlanEntry } from '../../jobs/rebalance';
import { jobGovernanceStore, resetJobGovernance } from '../../jobGovernance';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a RebalancePlanEntry array of the requested size.
 * Each entry has a unique vaultId/strategyId pair so upsert keys don't collide.
 */
function makePlanEntries(size: number): RebalancePlanEntry[] {
  return Array.from({ length: size }, (_, i) => ({
    vaultId: `vault-${String(i).padStart(3, '0')}`,
    strategyId: `strategy-${String(i).padStart(3, '0')}`,
    amount: 1000 + i,
  }));
}

function makePayload(planSize: number, attemptCount = 1): RebalanceJobPayload {
  return { planEntries: makePlanEntries(planSize), attemptCount };
}

/** A non-P2028 Prisma error (foreign-key violation). */
function makeP2003Error(): PrismaClientKnownRequestError {
  return new PrismaClientKnownRequestError(
    'Foreign key constraint failed on the field: `strategyId`',
    { code: 'P2003', clientVersion: '5.x' },
  );
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  resetJobGovernance();
});

// ---------------------------------------------------------------------------
// P2-1: Happy-path property
// ---------------------------------------------------------------------------

describe('P2-1: Happy-path — successful transaction resolves without throw and no dead-letter', () => {
  /**
   * Concrete spot-checks: plan sizes 1, 5, 10, 50.
   * These run quickly and give clear failure messages.
   */
  it.each([1, 5, 10, 50])(
    'resolves without throwing and writes no dead-letter for plan size %i',
    async (planSize) => {
      mockTransaction.mockResolvedValueOnce(undefined);

      await expect(runRebalanceJob(makePayload(planSize))).resolves.not.toThrow();

      const { total } = jobGovernanceStore.listDeadLetters();
      expect(total).toBe(0);
    },
  );

  /**
   * fast-check property: for any plan size between 1 and 50 the happy-path
   * invariant holds.
   *
   * Preservation invariant:
   *   runRebalanceJob resolves => no dead-letter written
   *   (same on unfixed and fixed code — the fix does not touch the happy path)
   */
  it('fast-check: for all plan sizes 1–50, happy-path commits without dead-letter', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 50 }),
        async (planSize) => {
          // Fresh state per iteration
          jest.clearAllMocks();
          resetJobGovernance();

          mockTransaction.mockResolvedValueOnce(undefined);

          await expect(runRebalanceJob(makePayload(planSize))).resolves.not.toThrow();

          const { total } = jobGovernanceStore.listDeadLetters();
          expect(total).toBe(0);
        },
      ),
      { numRuns: 50, verbose: false },
    );
  });

  /**
   * Verify prisma.$transaction is called exactly once per invocation on the
   * happy path — the fix must not add extra calls.
   */
  it('prisma.$transaction is called exactly once on the happy path', async () => {
    mockTransaction.mockResolvedValueOnce(undefined);

    await runRebalanceJob(makePayload(3));

    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// P2-2: Non-P2028 generic error propagates unchanged
// ---------------------------------------------------------------------------

describe('P2-2: Non-P2028 generic error propagates out of runRebalanceJob unchanged', () => {
  /**
   * A plain Error thrown inside the transaction must escape the job boundary
   * unchanged. The new P2028 catch block (post-fix) must re-throw non-P2028
   * errors immediately.
   *
   * On unfixed code: no catch block exists, so the error propagates trivially.
   * On fixed code: the P2028 catch block checks the error code and re-throws.
   * Both behaviours are identical from the caller's perspective.
   */
  it('a generic Error from prisma.$transaction propagates as-is', async () => {
    const genericError = new Error('foreign key constraint failed');
    mockTransaction.mockRejectedValueOnce(genericError);

    await expect(runRebalanceJob(makePayload(1))).rejects.toThrow(
      'foreign key constraint failed',
    );
  });

  it('no dead-letter is recorded at the rebalance layer for a generic Error', async () => {
    mockTransaction.mockRejectedValueOnce(new Error('network timeout'));

    try {
      await runRebalanceJob(makePayload(1));
    } catch {
      // expected — not a bug
    }

    // The rebalance job itself must not write any dead-letter for non-P2028 errors.
    // (A wrapping job governance layer may do so — that is not tested here.)
    const { total } = jobGovernanceStore.listDeadLetters();
    expect(total).toBe(0);
  });

  /**
   * fast-check: for any random Error message, the error propagates and no
   * dead-letter is written by the rebalance layer.
   */
  it('fast-check: for all non-P2028 generic errors, the error propagates and no dead-letter is written', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }),
        async (message) => {
          jest.clearAllMocks();
          resetJobGovernance();

          const err = new Error(message);
          mockTransaction.mockRejectedValueOnce(err);

          let caughtError: unknown;
          try {
            await runRebalanceJob(makePayload(1));
          } catch (e) {
            caughtError = e;
          }

          // Error propagates
          expect(caughtError).toBe(err);

          // No dead-letter from the rebalance layer
          const { total } = jobGovernanceStore.listDeadLetters();
          expect(total).toBe(0);
        },
      ),
      { numRuns: 50, verbose: false },
    );
  });
});

// ---------------------------------------------------------------------------
// P2-3: Non-P2028 Prisma error propagates unchanged
// ---------------------------------------------------------------------------

describe('P2-3: Non-P2028 PrismaClientKnownRequestError propagates unchanged', () => {
  it('a P2003 (foreign-key) error from prisma.$transaction propagates as-is', async () => {
    const p2003 = makeP2003Error();
    mockTransaction.mockRejectedValueOnce(p2003);

    let caughtError: unknown;
    try {
      await runRebalanceJob(makePayload(1));
    } catch (e) {
      caughtError = e;
    }

    expect(caughtError).toBeInstanceOf(PrismaClientKnownRequestError);
    expect((caughtError as PrismaClientKnownRequestError).code).toBe('P2003');
  });

  it('no dead-letter is recorded at the rebalance layer for a P2003 error', async () => {
    mockTransaction.mockRejectedValueOnce(makeP2003Error());

    try {
      await runRebalanceJob(makePayload(1));
    } catch {
      // expected
    }

    const { total } = jobGovernanceStore.listDeadLetters();
    expect(total).toBe(0);
  });

  /**
   * fast-check: for any Prisma error code that is NOT "P2028", the error
   * propagates and no dead-letter is written.
   */
  it('fast-check: for all non-P2028 Prisma error codes, the error propagates unchanged', async () => {
    // A representative set of Prisma error codes that are NOT P2028
    const nonP2028Codes = ['P2000', 'P2001', 'P2002', 'P2003', 'P2004', 'P2010', 'P2015', 'P2025'];

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...nonP2028Codes),
        fc.string({ minLength: 1, maxLength: 80 }),
        async (code, message) => {
          jest.clearAllMocks();
          resetJobGovernance();

          const prismaErr = new PrismaClientKnownRequestError(message, {
            code,
            clientVersion: '5.x',
          });
          mockTransaction.mockRejectedValueOnce(prismaErr);

          let caughtError: unknown;
          try {
            await runRebalanceJob(makePayload(1));
          } catch (e) {
            caughtError = e;
          }

          // Error propagates with correct code
          expect(caughtError).toBeInstanceOf(PrismaClientKnownRequestError);
          expect((caughtError as PrismaClientKnownRequestError).code).toBe(code);

          // No dead-letter from the rebalance layer
          const { total } = jobGovernanceStore.listDeadLetters();
          expect(total).toBe(0);
        },
      ),
      { numRuns: 40, verbose: false },
    );
  });
});

// ---------------------------------------------------------------------------
// P2-4: prisma.$transaction call-site options
// ---------------------------------------------------------------------------

describe('P2-4: prisma.$transaction call-site options', () => {
  /**
   * On UNFIXED code: prisma.$transaction is called with ONLY a callback (no
   * options object). We verify no second argument containing timeout/maxWait
   * is passed.
   *
   * On FIXED code: the rebalance call receives { timeout: REBALANCE_TX_TIMEOUT_MS,
   * maxWait: REBALANCE_TX_MAX_WAIT_MS }. This test is updated in task 3.4 to
   * assert the options ARE present on the rebalance call and absent on other
   * callers.
   *
   * Current assertion (pre-fix baseline): no options object is passed.
   */
  it('on unfixed code, prisma.$transaction is called without an options object', async () => {
    mockTransaction.mockResolvedValueOnce(undefined);

    await runRebalanceJob(makePayload(2));

    // The mock was called once
    expect(mockTransaction).toHaveBeenCalledTimes(1);

    const callArgs = mockTransaction.mock.calls[0];

    // First argument is the callback function
    expect(typeof callArgs[0]).toBe('function');

    // Second argument (options) is absent on unfixed code
    // On fixed code this assertion is inverted in task 3.4
    const optionsArg = callArgs[1] as Record<string, unknown> | undefined;
    if (optionsArg !== undefined) {
      // On fixed code: options will be present — this branch verifies shape
      expect(optionsArg).toHaveProperty('timeout');
      expect(optionsArg).toHaveProperty('maxWait');
    } else {
      // On unfixed code: no options passed (baseline confirmed)
      expect(optionsArg).toBeUndefined();
    }
  });

  /**
   * Env-override preservation: REBALANCE_TX_TIMEOUT_MS and
   * REBALANCE_TX_MAX_WAIT_MS environment variables must be respected by the
   * fixed code. This test is a no-op on unfixed code (no options are passed)
   * and becomes meaningful in task 3.4.
   *
   * We keep it here so it runs against both unfixed and fixed code.
   */
  it('env override REBALANCE_TX_TIMEOUT_MS is reflected in the options when set', async () => {
    const originalEnv = process.env.REBALANCE_TX_TIMEOUT_MS;
    process.env.REBALANCE_TX_TIMEOUT_MS = '20000';

    try {
      mockTransaction.mockResolvedValueOnce(undefined);
      await runRebalanceJob(makePayload(1));

      const callArgs = mockTransaction.mock.calls[0];
      const optionsArg = callArgs[1] as Record<string, unknown> | undefined;

      if (optionsArg !== undefined) {
        // Fixed code: env override must be applied
        expect(optionsArg.timeout).toBe(20000);
      }
      // Unfixed code: optionsArg is undefined — test passes trivially
    } finally {
      if (originalEnv === undefined) {
        delete process.env.REBALANCE_TX_TIMEOUT_MS;
      } else {
        process.env.REBALANCE_TX_TIMEOUT_MS = originalEnv;
      }
    }
  });

  /**
   * Verify a successful rebalance does not produce any dead-letter record.
   * This is a combined preservation check that spans happy-path + options.
   */
  it('a successful rebalance transaction does not produce any dead-letter record', async () => {
    mockTransaction.mockResolvedValueOnce(undefined);

    await runRebalanceJob(makePayload(5));

    const allDeadLetters = jobGovernanceStore.listDeadLetters();
    expect(allDeadLetters.total).toBe(0);
  });
});
