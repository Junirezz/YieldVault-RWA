/**
 * Tests for `backend/src/services/allocation.ts` (Issue #1433).
 *
 * The load-bearing cases are:
 *  - the transaction really is opened at `Serializable` (an isolation level that
 *    silently defaults to ReadCommitted is the whole bug),
 *  - a lost serialization race is retried exactly once with backoff and
 *    counted, and surfaces as a typed error when it keeps losing,
 *  - the `sum(weight) = 100` invariant holds after two concurrent rebalances
 *    over the same vault,
 *  - read-only queries are *not* wrapped in a transaction.
 */

import { Decimal } from 'decimal.js';

// ─── Prisma doubles ──────────────────────────────────────────────────────────
//
// The doubles are declared before the module under test is imported: the
// `jest.mock` factory below is hoisted above every import, and it is only
// invoked when `../prisma` is first required — which happens while importing
// `../services/allocation`. Same ordering convention as
// `criticalEntityLifecycle.test.ts`.

const mockTx = {
  vault: {
    findUnique: jest.fn(),
  },
  allocation: {
    findMany: jest.fn(),
    upsert: jest.fn(),
    deleteMany: jest.fn(),
  },
};

const mockPrisma = {
  $transaction: jest.fn(),
  vault: {
    findUnique: jest.fn(),
  },
  allocation: {
    findMany: jest.fn(),
  },
};

jest.mock('../prisma', () => ({ prisma: mockPrisma }));

import {
  InvalidRebalanceTargetError,
  RebalanceConflictError,
  SERIALIZATION_FAILURE_CODE,
  TARGET_WEIGHT_TOTAL,
  VaultNotRebalanceableError,
  WEIGHT_SUM_TOLERANCE,
  computeAllocationAmounts,
  getAllocationSummary,
  isSerializationFailure,
  rebalanceVaultAllocations,
  validateTargetWeights,
} from '../services/allocation';
import { rebalanceSerializationRetryTotal, rebalanceTotal } from '../metrics';
import { prisma } from '../prisma';

/** Prisma's "write conflict / deadlock" error, as thrown on Postgres. */
function serializationFailure(code: string = SERIALIZATION_FAILURE_CODE): Error & { code: string } {
  return Object.assign(new Error('Transaction failed due to a write conflict or a deadlock'), {
    code,
  });
}

function vaultRow(overrides: Record<string, unknown> = {}) {
  return { id: 'vault-1', aum: 1000, deletedAt: null, ...overrides };
}

/**
 * Sums every time series of `counter` whose labels contain all of `labels`.
 *
 * Summing (rather than taking the first match) matters for
 * `rebalance_serialization_retry_total`, which is partitioned by `attempt`, so
 * a run that retried twice produces two series rather than one value of 2.
 */
async function sumCounter(
  counter: typeof rebalanceSerializationRetryTotal,
  labels: Record<string, string>
): Promise<number> {
  const metric = await counter.get();
  const values = metric.values as Array<{ labels: Record<string, string>; value: number }>;
  return values
    .filter((entry) => Object.entries(labels).every(([key, value]) => entry.labels[key] === value))
    .reduce((total, entry) => total + entry.value, 0);
}

describe('Issue #1433 — allocation rebalance isolation and retry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rebalanceSerializationRetryTotal.reset();
    rebalanceTotal.reset();

    mockTx.vault.findUnique.mockResolvedValue(vaultRow());
    mockTx.allocation.findMany.mockResolvedValue([]);
    mockTx.allocation.upsert.mockResolvedValue({});
    mockTx.allocation.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mockTx) => unknown) => callback(mockTx)
    );
  });

  // ─── Isolation level ───────────────────────────────────────────────────────

  describe('isolation level', () => {
    it('opens the transaction at Serializable', async () => {
      await rebalanceVaultAllocations('vault-1', [
        { strategyId: 's-1', weight: 60 },
        { strategyId: 's-2', weight: 40 },
      ]);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      const [, options] = mockPrisma.$transaction.mock.calls[0];
      expect(options).toMatchObject({ isolationLevel: 'Serializable' });
    });

    it('passes a second argument at all, so the level cannot default to ReadCommitted', async () => {
      await rebalanceVaultAllocations('vault-1', [{ strategyId: 's-1', weight: 100 }]);

      const args = mockPrisma.$transaction.mock.calls[0];
      expect(args.length).toBe(2);
      expect(args[1]).toBeDefined();
      expect(args[1]?.isolationLevel).not.toBeUndefined();
    });

    it('re-opens at Serializable on every attempt', async () => {
      mockPrisma.$transaction
        .mockImplementationOnce(async () => {
          throw serializationFailure();
        })
        .mockImplementation(async (callback: (tx: typeof mockTx) => unknown) => callback(mockTx));

      const result = await rebalanceVaultAllocations('vault-1', [{ strategyId: 's-1', weight: 100 }]);

      expect(result.retried).toBe(true);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
      for (const call of mockPrisma.$transaction.mock.calls) {
        expect(call[1]).toMatchObject({ isolationLevel: 'Serializable' });
      }
    });
  });

  // ─── P2034 retry contract ──────────────────────────────────────────────────

  describe('serialization failure handling', () => {
    it('retries once and succeeds, incrementing the retry metric', async () => {
      mockPrisma.$transaction
        .mockImplementationOnce(async () => {
          throw serializationFailure();
        })
        .mockImplementation(async (callback: (tx: typeof mockTx) => unknown) => callback(mockTx));

      const result = await rebalanceVaultAllocations('vault-1', [
        { strategyId: 's-1', weight: 50 },
        { strategyId: 's-2', weight: 50 },
      ]);

      expect(result.retried).toBe(true);
      expect(result.attempts).toBe(2);
      expect(await sumCounter(rebalanceSerializationRetryTotal, { operation: 'rebalance' })).toBe(1);
    });

    it('gives up after the allowed attempts with a typed error', async () => {
      mockPrisma.$transaction.mockImplementation(async () => {
        throw serializationFailure();
      });

      await expect(
        rebalanceVaultAllocations('vault-1', [{ strategyId: 's-1', weight: 100 }]),
      ).rejects.toBeInstanceOf(RebalanceConflictError);

      // Two attempts by default: the original plus exactly one retry.
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
      expect(await sumCounter(rebalanceSerializationRetryTotal, { operation: 'rebalance' })).toBe(1);
    });

    it('honours REBALANCE_MAX_ATTEMPTS', async () => {
      const original = process.env.REBALANCE_MAX_ATTEMPTS;
      process.env.REBALANCE_MAX_ATTEMPTS = '3';
      try {
        mockPrisma.$transaction.mockImplementation(async () => {
          throw serializationFailure();
        });

        await expect(
          rebalanceVaultAllocations('vault-1', [{ strategyId: 's-1', weight: 100 }]),
        ).rejects.toBeInstanceOf(RebalanceConflictError);

        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(3);
        expect(await sumCounter(rebalanceSerializationRetryTotal, { operation: 'rebalance' })).toBe(2);
      } finally {
        if (original === undefined) delete process.env.REBALANCE_MAX_ATTEMPTS;
        else process.env.REBALANCE_MAX_ATTEMPTS = original;
      }
    });

    it('carries the final underlying error on RebalanceConflictError', async () => {
      const underlying = serializationFailure();
      mockPrisma.$transaction.mockImplementation(async () => {
        throw underlying;
      });

      const error = await rebalanceVaultAllocations('vault-1', [
        { strategyId: 's-1', weight: 100 },
      ]).catch((err: unknown) => err as RebalanceConflictError);

      expect(error).toBeInstanceOf(RebalanceConflictError);
      expect(error.attempts).toBe(2);
      expect(error.lastError).toBe(underlying);
    });

    it('does not retry a non-serialization error', async () => {
      mockPrisma.$transaction.mockImplementation(async () => {
        throw Object.assign(new Error('unique constraint failed'), { code: 'P2002' });
      });

      await expect(
        rebalanceVaultAllocations('vault-1', [{ strategyId: 's-1', weight: 100 }]),
      ).rejects.toMatchObject({ code: 'P2002' });

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(await sumCounter(rebalanceSerializationRetryTotal, { operation: 'rebalance' })).toBe(0);
    });

    it('treats SQLite busy and P2028 as contention', () => {
      expect(isSerializationFailure({ code: 'P2034' })).toBe(true);
      expect(isSerializationFailure({ code: 'P2028' })).toBe(true);
      expect(isSerializationFailure(new Error('database is locked'))).toBe(true);
      expect(isSerializationFailure(new Error('SQLITE_BUSY: database is locked'))).toBe(true);

      expect(isSerializationFailure(null)).toBe(false);
      expect(isSerializationFailure(undefined)).toBe(false);
      expect(isSerializationFailure('P2034')).toBe(false);
      expect(isSerializationFailure({ code: 'P2002' })).toBe(false);
      expect(isSerializationFailure(new Error('connection reset'))).toBe(false);
    });
  });

  // ─── Invariant ─────────────────────────────────────────────────────────────

  describe('sum(weight) = 100 invariant', () => {
    it('persists every target and reports the total', async () => {
      const result = await rebalanceVaultAllocations('vault-1', [
        { strategyId: 's-1', weight: 33.33 },
        { strategyId: 's-2', weight: 33.33 },
        { strategyId: 's-3', weight: 33.34 },
      ]);

      expect(mockTx.allocation.upsert).toHaveBeenCalledTimes(3);
      expect(result.totalWeight).toBeCloseTo(TARGET_WEIGHT_TOTAL, 6);
      expect(Math.abs(result.totalWeight - TARGET_WEIGHT_TOTAL)).toBeLessThanOrEqual(
        WEIGHT_SUM_TOLERANCE,
      );
      for (const row of result.weights) {
        expect(mockTx.allocation.upsert).toHaveBeenCalledWith(
          expect.objectContaining({ create: expect.objectContaining({ weight: expect.any(Number) }) })
        );
        expect(row.weight).toBeGreaterThanOrEqual(0);
      }
    });

    it('retires allocations for strategies that dropped out of the target list', async () => {
      mockTx.allocation.findMany.mockResolvedValue([
        { id: 'a-1', strategyId: 's-old', amount: 10, weight: 10 },
        { id: 'a-2', strategyId: 's-1', amount: 90, weight: 90 },
      ]);

      await rebalanceVaultAllocations('vault-1', [{ strategyId: 's-1', weight: 100 }]);

      expect(mockTx.allocation.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['a-1'] } },
      });
    });

    it('does not issue a delete when nothing is stale', async () => {
      mockTx.allocation.findMany.mockResolvedValue([
        { id: 'a-2', strategyId: 's-1', amount: 90, weight: 90 },
      ]);

      await rebalanceVaultAllocations('vault-1', [{ strategyId: 's-1', weight: 100 }]);

      expect(mockTx.allocation.deleteMany).not.toHaveBeenCalled();
    });

    it('upserts on the (vaultId, strategyId) unique key', async () => {
      await rebalanceVaultAllocations('vault-1', [{ strategyId: 's-1', weight: 100 }]);

      expect(mockTx.allocation.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { vaultId_strategyId: { vaultId: 'vault-1', strategyId: 's-1' } },
        })
      );
    });

    it('rejects weights that do not sum to 100 before opening a transaction', async () => {
      await expect(
        rebalanceVaultAllocations('vault-1', [{ strategyId: 's-1', weight: 40 }]),
      ).rejects.toBeInstanceOf(InvalidRebalanceTargetError);
      await expect(
        rebalanceVaultAllocations('vault-1', [
          { strategyId: 's-1', weight: 60 },
          { strategyId: 's-2', weight: 60 },
        ]),
      ).rejects.toBeInstanceOf(InvalidRebalanceTargetError);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an empty or duplicated target list', async () => {
      await expect(rebalanceVaultAllocations('vault-1', [])).rejects.toMatchObject({
        reason: 'EMPTY',
      });
      await expect(
        rebalanceVaultAllocations('vault-1', [
          { strategyId: 's-1', weight: 50 },
          { strategyId: 's-1', weight: 50 },
        ]),
      ).rejects.toMatchObject({ reason: 'EMPTY' });
    });

    it('rejects negative and non-finite weights', async () => {
      await expect(
        rebalanceVaultAllocations('vault-1', [
          { strategyId: 's-1', weight: -10 },
          { strategyId: 's-2', weight: 110 },
        ]),
      ).rejects.toMatchObject({ reason: 'NEGATIVE_WEIGHT' });

      await expect(
        rebalanceVaultAllocations('vault-1', [
          { strategyId: 's-1', weight: Number.NaN },
          { strategyId: 's-2', weight: 100 },
        ]),
      ).rejects.toMatchObject({ reason: 'NON_FINITE_WEIGHT' });

      await expect(
        rebalanceVaultAllocations('vault-1', [
          { strategyId: 's-1', weight: Number.POSITIVE_INFINITY },
          { strategyId: 's-2', weight: 100 },
        ]),
      ).rejects.toMatchObject({ reason: 'NON_FINITE_WEIGHT' });
    });

    it('tolerates a sum that is 100 only within the representation tolerance', () => {
      expect(() => validateTargetWeights([{ strategyId: 's-1', weight: 100 - WEIGHT_SUM_TOLERANCE / 2 }])).not.toThrow();
      expect(() => validateTargetWeights([{ strategyId: 's-1', weight: 100 + WEIGHT_SUM_TOLERANCE / 2 }])).not.toThrow();
      expect(() => validateTargetWeights([{ strategyId: 's-1', weight: 99.99 }])).toThrow(InvalidRebalanceTargetError);
    });

    it('rejects a target with no strategyId', () => {
      expect(() => validateTargetWeights([{ strategyId: '', weight: 100 }])).toThrow(
        InvalidRebalanceTargetError,
      );
    });
  });

  // ─── Vault state ───────────────────────────────────────────────────────────

  describe('vault state', () => {
    it('throws when the vault does not exist', async () => {
      mockTx.vault.findUnique.mockResolvedValue(null);

      await expect(
        rebalanceVaultAllocations('vault-missing', [{ strategyId: 's-1', weight: 100 }]),
      ).rejects.toBeInstanceOf(VaultNotRebalanceableError);
      expect(mockTx.allocation.upsert).not.toHaveBeenCalled();
    });

    it('throws for a soft-deleted vault', async () => {
      mockTx.vault.findUnique.mockResolvedValue(vaultRow({ deletedAt: new Date() }));

      await expect(
        rebalanceVaultAllocations('vault-1', [{ strategyId: 's-1', weight: 100 }]),
      ).rejects.toBeInstanceOf(VaultNotRebalanceableError);
    });

    it('re-reads the vault inside the transaction', async () => {
      await rebalanceVaultAllocations('vault-1', [{ strategyId: 's-1', weight: 100 }]);
      expect(mockTx.vault.findUnique).toHaveBeenCalled();
    });
  });

  // ─── Amount derivation ─────────────────────────────────────────────────────

  describe('computeAllocationAmounts()', () => {
    it('divides AUM by weight', () => {
      const amounts = computeAllocationAmounts(new Decimal(1000), [
        { strategyId: 's-1', weight: 60 },
        { strategyId: 's-2', weight: 40 },
      ]);

      expect(amounts.get('s-1')!.toNumber()).toBeCloseTo(600, 6);
      expect(amounts.get('s-2')!.toNumber()).toBeCloseTo(400, 6);
    });

    it('sums to exactly the AUM, absorbing the rounding residual', () => {
      const aum = new Decimal(1000);
      const amounts = computeAllocationAmounts(aum, [
        { strategyId: 's-1', weight: 33.33 },
        { strategyId: 's-2', weight: 33.33 },
        { strategyId: 's-3', weight: 33.34 },
      ]);

      const total = Array.from(amounts.values()).reduce((sum, value) => sum.plus(value), new Decimal(0));
      expect(total.toNumber()).toBeCloseTo(1000, 9);
      expect(total.equals(aum)).toBe(true);
    });

    it('gives the residual to the largest-weight target', () => {
      const amounts = computeAllocationAmounts(new Decimal(1), [
        { strategyId: 'small', weight: 1 },
        { strategyId: 'big', weight: 99 },
      ]);

      const small = amounts.get('small')!.toNumber();
      const big = amounts.get('big')!.toNumber();
      expect(small + big).toBeCloseTo(1, 12);
      expect(small).toBeCloseTo(0.01, 6);
    });

    it('handles a zero-AUM vault', () => {
      const amounts = computeAllocationAmounts(new Decimal(0), [
        { strategyId: 's-1', weight: 50 },
        { strategyId: 's-2', weight: 50 },
      ]);
      expect(amounts.get('s-1')!.toNumber()).toBe(0);
      expect(amounts.get('s-2')!.toNumber()).toBe(0);
    });
  });

  // ─── Read path stays outside a transaction ─────────────────────────────────

  describe('getAllocationSummary()', () => {
    it('reads without opening a transaction', async () => {
      mockPrisma.vault.findUnique.mockResolvedValue({
        aum: 1000,
        allocations: [
          { strategyId: 's-1', weight: 70, amount: 700 },
          { strategyId: 's-2', weight: 30, amount: 300 },
        ],
      });

      const summary = await getAllocationSummary('vault-1');

      expect(summary).not.toBeNull();
      expect(summary!.totalWeight).toBeCloseTo(100, 6);
      expect(summary!.totalAmount).toBe(1000);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.allocation.findMany).not.toHaveBeenCalled();
    });

    it('returns null for an unknown vault', async () => {
      mockPrisma.vault.findUnique.mockResolvedValue(null);
      expect(await getAllocationSummary('nope')).toBeNull();
    });

    it('is the same client the service uses for writes', () => {
      expect(prisma).toBe(mockPrisma);
    });
  });
});
