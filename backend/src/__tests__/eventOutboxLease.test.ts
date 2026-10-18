/**
 * @file eventOutboxLease.test.ts
 * Regression tests for issue #1557: crashed relay workers must not strand
 * outbox rows, and a worker whose lease expired must not overwrite a newer
 * claim (fencing).
 */

jest.mock('../webhookDelivery', () => ({
  emitTransactionEvent: jest.fn(async () => 1),
}));

import { prisma } from '../prisma';
import {
  eventOutboxService,
  buildOutboxLeaseToken,
  getOutboxLeaseMs,
} from '../eventOutbox';
import { emitTransactionEvent } from '../webhookDelivery';

const emitMock = emitTransactionEvent as unknown as jest.Mock;

const originalLease = process.env.OUTBOX_LOCK_TIMEOUT_MS;

function payload() {
  return {
    transactionId: 'tx-lease-1',
    amount: '100',
    asset: 'USDC',
    walletAddress: `G${'A'.repeat(55)}`,
    transactionHash: '0xabc',
    status: 'completed',
    timestamp: new Date().toISOString(),
  };
}

async function seed(overrides: Record<string, unknown> = {}) {
  return prisma.eventOutbox.create({
    data: {
      id: `obx-${Math.random().toString(36).slice(2, 10)}`,
      eventType: 'transaction.deposit.created',
      payload: JSON.stringify(payload()),
      status: 'pending',
      aggregateType: 'transaction',
      aggregateId: 'tx-lease-1',
      vaultId: 'vault-lease-1',
      sequence: 1,
      attemptCount: 0,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    },
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  emitMock.mockResolvedValue(1);
  process.env.OUTBOX_LOCK_TIMEOUT_MS = '60000';
  await prisma.eventOutbox.deleteMany({});
});

afterAll(() => {
  if (originalLease === undefined) delete process.env.OUTBOX_LOCK_TIMEOUT_MS;
  else process.env.OUTBOX_LOCK_TIMEOUT_MS = originalLease;
});

describe('outbox lease configuration', () => {
  it('defaults to a 60s lease and honours the env override', () => {
    delete process.env.OUTBOX_LOCK_TIMEOUT_MS;
    expect(getOutboxLeaseMs()).toBe(60_000);
    process.env.OUTBOX_LOCK_TIMEOUT_MS = '1234';
    expect(getOutboxLeaseMs()).toBe(1234);
  });

  it('derives a fencing token that changes on every re-claim', () => {
    expect(buildOutboxLeaseToken(null, null)).toBeNull();
    const first = buildOutboxLeaseToken('worker-a', new Date(1000));
    const second = buildOutboxLeaseToken('worker-a', new Date(2000));
    expect(first).toBe('worker-a:1000');
    expect(second).toBe('worker-a:2000');
    expect(first).not.toBe(second);
  });
});

describe('reapStuckRelays', () => {
  it('releases only expired leases and leaves active leases alone', async () => {
    const stale = await seed({
      id: 'obx-stale',
      lockedAt: new Date(Date.now() - 10 * 60 * 1000),
      lockedBy: 'crashed-worker',
    });
    const active = await seed({
      id: 'obx-active',
      vaultId: 'vault-lease-2',
      lockedAt: new Date(),
      lockedBy: 'live-worker',
    });

    const released = await eventOutboxService.reapStuckRelays();

    expect(released).toBe(1);
    const staleRow = await prisma.eventOutbox.findUnique({ where: { id: stale.id } });
    const activeRow = await prisma.eventOutbox.findUnique({ where: { id: active.id } });
    expect(staleRow?.lockedAt).toBeNull();
    expect(staleRow?.lockedBy).toBeNull();
    expect(activeRow?.lockedBy).toBe('live-worker');
  });

  it('recovers a crashed relay so the next cycle delivers it', async () => {
    const crashed = await seed({
      id: 'obx-crashed',
      lockedAt: new Date(Date.now() - 10 * 60 * 1000),
      lockedBy: 'crashed-worker',
    });

    const result = await eventOutboxService.processOutbox(10);

    expect(result.relayed).toBe(1);
    expect(emitMock).toHaveBeenCalledTimes(1);
    const row = await prisma.eventOutbox.findUnique({ where: { id: crashed.id } });
    expect(row?.status).toBe('relayed');
    expect(row?.lockedAt).toBeNull();
  });
});

describe('lease fencing', () => {
  it('does not let a stale worker overwrite a row re-claimed mid-delivery', async () => {
    const row = await seed({ id: 'obx-fenced' });

    // Simulate another worker re-claiming the row while this worker is
    // delivering the event. The claim timestamp changes, invalidating the
    // original fencing token.
    emitMock.mockImplementationOnce(async () => {
      await prisma.eventOutbox.update({
        where: { id: row.id },
        data: {
          lockedAt: new Date(Date.now() + 5_000),
          lockedBy: 'other-worker',
        },
      });
      return 1;
    });

    const result = await eventOutboxService.processOutbox(10);

    // The stale worker must discard its result instead of marking the row.
    expect(result.relayed).toBe(0);
    const after = await prisma.eventOutbox.findUnique({ where: { id: row.id } });
    expect(after?.status).toBe('pending');
    expect(after?.lockedBy).toBe('other-worker');
  });
});
