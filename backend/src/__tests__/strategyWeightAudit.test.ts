/**
 * Audit trail for strategy weight changes (#1728): a valid change records the
 * full before/after weight maps; an invalid-sum change is rejected before any
 * write and recorded as a rejection.
 */

const mockTx = {
  vault: { findUnique: jest.fn() },
  allocation: { findMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
};
const mockPrisma = {
  $transaction: jest.fn(),
  vault: { findUnique: jest.fn() },
  allocation: { findMany: jest.fn() },
};

jest.mock('../prisma', () => ({ prisma: mockPrisma }));

import {
  InvalidRebalanceTargetError,
  WEIGHT_CHANGED_AUDIT_ACTION,
  WEIGHT_REJECTED_AUDIT_ACTION,
  rebalanceVaultAllocations,
} from '../services/allocation';
import { getAuditLogs, resetAuditLogs } from '../auditLog';

const AUDIT = { actor: 'admin-1', ip: '10.0.0.1', path: '/admin/vaults/vault-1/allocations' };

describe('strategy weight audit entries (#1728)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetAuditLogs();
    mockTx.vault.findUnique.mockResolvedValue({ id: 'vault-1', aum: 1000, deletedAt: null });
    mockTx.allocation.findMany.mockResolvedValue([
      { id: 'a1', strategyId: 'alpha', amount: 600, weight: 60 },
      { id: 'a2', strategyId: 'beta', amount: 400, weight: 40 },
    ]);
    mockTx.allocation.upsert.mockResolvedValue({});
    mockTx.allocation.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx));
  });

  it('records actor, timestamp, vault id and before/after weight maps for a valid change', async () => {
    const result = await rebalanceVaultAllocations(
      'vault-1',
      [
        { strategyId: 'alpha', weight: 25 },
        { strategyId: 'beta', weight: 50 },
        { strategyId: 'gamma', weight: 25 },
      ],
      AUDIT,
    );

    expect(result.before).toEqual({ alpha: 60, beta: 40 });
    expect(result.after).toEqual({ alpha: 25, beta: 50, gamma: 25 });

    const [entry] = getAuditLogs({ action: WEIGHT_CHANGED_AUDIT_ACTION });
    expect(entry).toBeDefined();
    expect(entry.actor).toBe('admin-1');
    expect(entry.statusCode).toBe(200);
    expect(Number.isNaN(Date.parse(entry.timestamp))).toBe(false);
    expect(entry.metadata).toMatchObject({
      vaultId: 'vault-1',
      before: { alpha: 60, beta: 40 },
      after: { alpha: 25, beta: 50, gamma: 25 },
    });
  });

  it('rejects weights that do not sum to 100 before any write and audits the rejection', async () => {
    await expect(
      rebalanceVaultAllocations(
        'vault-1',
        [
          { strategyId: 'alpha', weight: 60 },
          { strategyId: 'beta', weight: 30 },
        ],
        AUDIT,
      ),
    ).rejects.toBeInstanceOf(InvalidRebalanceTargetError);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockTx.allocation.upsert).not.toHaveBeenCalled();
    expect(getAuditLogs({ action: WEIGHT_CHANGED_AUDIT_ACTION })).toHaveLength(0);

    const [entry] = getAuditLogs({ action: WEIGHT_REJECTED_AUDIT_ACTION });
    expect(entry.statusCode).toBe(400);
    expect(entry.actor).toBe('admin-1');
    expect(entry.metadata).toMatchObject({
      vaultId: 'vault-1',
      requested: { alpha: 60, beta: 30 },
      reason: 'UNDER_ALLOCATED',
    });
  });

  it('does not write audit entries when no audit context is supplied', async () => {
    await rebalanceVaultAllocations('vault-1', [{ strategyId: 'alpha', weight: 100 }]);
    expect(getAuditLogs({})).toHaveLength(0);
  });
});
