/**
 * Concurrency integration test for the allocation rebalance (Issue #1433).
 *
 * Runs against the real SQLite database rather than a Prisma double, because
 * the property under test — two rebalances over the same vault must not
 * interleave into a duplicated or short-weighted allocation set — is a property
 * of the transaction boundary, and a mock cannot observe it.
 *
 * On the retry specifically: SQLite (this repo's datasource) takes a
 * database-wide write lock and Prisma waits on `SQLITE_BUSY` rather than
 * aborting, so a real `P2034` is not reproducible in CI. `retryOnP2034.test.ts`
 * therefore drives the retry path with an injected `P2034` and asserts the
 * counter and the backoff. This file asserts the outcome the retry exists to
 * guarantee: the invariant survives genuine concurrency.
 */

import { prisma } from '../prisma';
import {
  RebalanceConflictError,
  TARGET_WEIGHT_TOTAL,
  rebalanceVaultAllocations,
} from '../services/allocation';
import { rebalanceSerializationRetryTotal } from '../metrics';

const TENANT = 'tenant-1433-rebalance';

interface SeededIds {
  vaultIds: string[];
  strategyIds: string[];
}

async function seedVaults(count: number): Promise<SeededIds> {
  const vaultIds: string[] = [];
  const strategyIds: string[] = [];

  for (let i = 0; i < count; i += 1) {
    const vault = await prisma.vault.create({
      data: { tenantId: TENANT, aum: 1000 + i, tvlUsd: `${1000 + i}.00` },
    });
    vaultIds.push(vault.id);
  }

  for (let i = 0; i < 4; i += 1) {
    const strategy = await prisma.strategy.create({ data: { name: `1433-strategy-${i}` } });
    strategyIds.push(strategy.id);
  }

  return { vaultIds, strategyIds };
}

async function cleanup(): Promise<void> {
  await prisma.allocation.deleteMany({ where: { vault: { tenantId: TENANT } } });
  await prisma.vault.deleteMany({ where: { tenantId: TENANT } });
  await prisma.strategy.deleteMany({ where: { name: { startsWith: '1433-strategy-' } } });
}

/** Sum of the persisted weights for a vault, and how many rows exist. */
async function readWeights(vaultId: string): Promise<{ total: number; rows: number; distinct: number }> {
  const rows = await prisma.allocation.findMany({
    where: { vaultId },
    select: { strategyId: true, weight: true },
  });
  return {
    total: rows.reduce((sum, row) => sum + row.weight, 0),
    rows: rows.length,
    distinct: new Set(rows.map((row) => row.strategyId)).size,
  };
}

describe('Issue #1433 — concurrent allocation rebalance', () => {
  const seeded: SeededIds = { vaultIds: [], strategyIds: [] };

  beforeAll(async () => {
    await cleanup();
    Object.assign(seeded, await seedVaults(3));
  });

  afterAll(async () => {
    await cleanup();
  });

  beforeEach(() => {
    rebalanceSerializationRetryTotal.reset();
  });

  it('holds sum(weight) = 100 when two rebalances race on the same vault', async () => {
    const [vaultA, vaultB] = seeded.vaultIds;
    const [s1, s2, s3] = seeded.strategyIds;

    const settled = await Promise.allSettled([
      rebalanceVaultAllocations(vaultA, [
        { strategyId: s1, weight: 50 },
        { strategyId: s2, weight: 50 },
      ]),
      rebalanceVaultAllocations(vaultA, [
        { strategyId: s2, weight: 60 },
        { strategyId: s3, weight: 40 },
      ]),
    ]);

    // Both callers get a definite answer: applied, or a typed conflict.
    for (const outcome of settled) {
      if (outcome.status === 'rejected') {
        expect(outcome.reason).toBeInstanceOf(RebalanceConflictError);
      } else {
        expect(outcome.value.totalWeight).toBeCloseTo(TARGET_WEIGHT_TOTAL, 6);
      }
    }

    const persisted = await readWeights(vaultA);

    // The invariant is what the isolation level buys us: whichever rebalance
    // won, the vault is left fully and exactly weighted.
    expect(persisted.total).toBeCloseTo(TARGET_WEIGHT_TOTAL, 6);
    expect(Math.abs(persisted.total - TARGET_WEIGHT_TOTAL)).toBeLessThan(1e-6);

    // And the loser did not leave a phantom row behind — one row per strategy.
    expect(persisted.rows).toBe(persisted.distinct);
    expect(persisted.rows).toBeLessThanOrEqual(3);
  });

  it('holds the invariant across many concurrent rebalances of the same vault', async () => {
    const vault = seeded.vaultIds[0];
    const [s1, s2, s3] = seeded.strategyIds;

    const targets = [
      [
        { strategyId: s1, weight: 100 },
      ],
      [
        { strategyId: s1, weight: 34 },
        { strategyId: s2, weight: 33 },
        { strategyId: s3, weight: 33 },
      ],
      [
        { strategyId: s2, weight: 25 },
        { strategyId: s3, weight: 75 },
      ],
    ];

    await Promise.allSettled(targets.map((t) => rebalanceVaultAllocations(vault, t)));

    const persisted = await readWeights(vault);
    expect(persisted.total).toBeCloseTo(TARGET_WEIGHT_TOTAL, 6);
    expect(persisted.rows).toBe(persisted.distinct);
  });

  it('isolates vaults from each other', async () => {
    const [vaultA, vaultB, vaultC] = seeded.vaultIds;
    const [s1, s2, s3] = seeded.strategyIds;

    await Promise.allSettled([
      rebalanceVaultAllocations(vaultA, [{ strategyId: s1, weight: 100 }]),
      rebalanceVaultAllocations(vaultB, [
        { strategyId: s2, weight: 70 },
        { strategyId: s3, weight: 30 },
      ]),
      rebalanceVaultAllocations(vaultC, [
        { strategyId: s1, weight: 20 },
        { strategyId: s2, weight: 20 },
        { strategyId: s3, weight: 60 },
      ]),
    ]);

    for (const vaultId of [vaultA, vaultB, vaultC]) {
      const persisted = await readWeights(vaultId);
      expect(persisted.total).toBeCloseTo(TARGET_WEIGHT_TOTAL, 6);
      expect(persisted.rows).toBe(persisted.distinct);
    }
  });

  it('rejects a concurrent rebalance whose weights do not sum to 100 without writing', async () => {
    const vault = seeded.vaultIds[0];
    const [s1] = seeded.strategyIds;

    await rebalanceVaultAllocations(vault, [{ strategyId: s1, weight: 100 }]);
    const before = await readWeights(vault);

    await expect(
      rebalanceVaultAllocations(vault, [
        { strategyId: s1, weight: 40 },
        { strategyId: seeded.strategyIds[1], weight: 40 },
      ]),
    ).rejects.toThrow();

    const after = await readWeights(vault);
    expect(after.total).toBe(before.total);
    expect(after.rows).toBe(before.rows);
  });

  it('replaces a previous allocation set rather than accumulating weights', async () => {
    const vault = seeded.vaultIds[0];
    const [s1, s2, s3] = seeded.strategyIds;

    await rebalanceVaultAllocations(vault, [
      { strategyId: s1, weight: 20 },
      { strategyId: s2, weight: 20 },
      { strategyId: s3, weight: 60 },
    ]);
    expect((await readWeights(vault)).total).toBeCloseTo(TARGET_WEIGHT_TOTAL, 6);

    // Drop a strategy: its weight must go with it, or the invariant breaks.
    await rebalanceVaultAllocations(vault, [{ strategyId: s1, weight: 100 }]);

    const persisted = await readWeights(vault);
    expect(persisted.total).toBeCloseTo(TARGET_WEIGHT_TOTAL, 6);
    expect(persisted.rows).toBe(1);
    expect(persisted.distinct).toBe(1);
  });

  it('retries exactly one of two concurrent rebalances that collide', async () => {
    const vault = seeded.vaultIds[2];
    const [s1, s2] = seeded.strategyIds;

    await rebalanceVaultAllocations(vault, [{ strategyId: s1, weight: 100 }]);

    // Fault-inject a serialization failure into the *first* attempt only, so the
    // two real transactions genuinely race and exactly one of them has to retry.
    // (SQLite never aborts a writer with P2034 on its own — it waits on
    // SQLITE_BUSY — so the collision has to be provoked to be observable.)
    const realTransaction = prisma.$transaction.bind(prisma);
    let injected = false;
    const spy = jest
      .spyOn(prisma, '$transaction')
      .mockImplementation(((...args: unknown[]) => {
        if (!injected) {
          injected = true;
          return Promise.reject(
            Object.assign(
              new Error('Transaction failed due to a write conflict or a deadlock'),
              { code: 'P2034' },
            ),
          );
        }
        return (realTransaction as (...a: unknown[]) => unknown)(...args);
      }) as typeof prisma.$transaction);

    try {
      const settled = await Promise.allSettled([
        rebalanceVaultAllocations(vault, [
          { strategyId: s1, weight: 70 },
          { strategyId: s2, weight: 30 },
        ]),
        rebalanceVaultAllocations(vault, [
          { strategyId: s1, weight: 40 },
          { strategyId: s2, weight: 60 },
        ]),
      ]);

      const applied = settled.filter((o) => o.status === 'fulfilled');
      const retried = applied.filter((o) => o.status === 'fulfilled' && o.value.retried);

      // Exactly one transaction lost the race and came back on its retry.
      expect(retried).toHaveLength(1);
      expect(spy).toHaveBeenCalledTimes(3);

      const metric = await rebalanceSerializationRetryTotal.get();
      const retries = (metric.values as Array<{ labels: Record<string, string>; value: number }>)
        .filter((entry) => entry.labels.operation === 'rebalance')
        .reduce((total, entry) => total + entry.value, 0);
      expect(retries).toBe(1);

      const persisted = await readWeights(vault);
      expect(persisted.total).toBeCloseTo(TARGET_WEIGHT_TOTAL, 6);
      expect(persisted.rows).toBe(persisted.distinct);
    } finally {
      spy.mockRestore();
    }
  });

  it('derives amounts that sum to the vault AUM', async () => {
    const vault = seeded.vaultIds[1];
    const [s1, s2, s3] = seeded.strategyIds;

    await rebalanceVaultAllocations(vault, [
      { strategyId: s1, weight: 33.33 },
      { strategyId: s2, weight: 33.33 },
      { strategyId: s3, weight: 33.34 },
    ]);

    const vaultRow = await prisma.vault.findUnique({ where: { id: vault }, select: { aum: true } });
    const rows = await prisma.allocation.findMany({ where: { vaultId: vault }, select: { amount: true } });
    const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);

    expect(totalAmount).toBeCloseTo(vaultRow!.aum, 6);
  });
});
