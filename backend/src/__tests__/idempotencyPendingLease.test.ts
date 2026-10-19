/**
 * @file idempotencyPendingLease.test.ts
 * Regression tests for issue #1556: a hung/crashed worker must not block
 * retries for the full 24h retention TTL.
 */

jest.mock('../prisma', () => ({
  prisma: {
    idempotencyKey: {
      findFirst: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

jest.mock('../middleware/structuredLogging', () => ({
  logger: { log: jest.fn() },
}));

import type { Request, Response } from 'express';
import { prisma } from '../prisma';
import {
  DEFAULT_PROCESSING_LEASE_MS,
  hashRequestBody,
  isProcessingLeaseExpired,
  processingLeaseRemainingSeconds,
  reclaimExpiredIdempotencyRecord,
  reclaimExpiredIdempotencyRecords,
  enforceIdempotency,
} from '../idempotency';

const idempotencyKeyDelegate = prisma.idempotencyKey as unknown as {
  findFirst: jest.Mock;
  deleteMany: jest.Mock;
};

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    keyId: 'a'.repeat(32),
    tenantId: 'tenant-1',
    walletAddress: null,
    operation: 'POST /v1/vault/deposit',
    status: 'pending',
    requestHash: hashRequestBody({ amount: '1000' }),
    responseHash: null,
    responseBody: null,
    statusCode: null,
    createdAt: new Date(),
    completedAt: null,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

function makeReq(body: unknown = { amount: '1000' }): Partial<Request> {
  return {
    get: ((header: string) =>
      header === 'Idempotency-Key' ? 'a'.repeat(32) : undefined) as Request['get'],
    tenantId: 'tenant-1',
    body,
  } as unknown as Partial<Request>;
}

function makeRes() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { res: { status, json } as unknown as Partial<Response>, status, json };
}

const originalLease = process.env.IDEMPOTENCY_PROCESSING_LEASE_MS;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.IDEMPOTENCY_PROCESSING_LEASE_MS = '60000';
});

afterAll(() => {
  if (originalLease === undefined) delete process.env.IDEMPOTENCY_PROCESSING_LEASE_MS;
  else process.env.IDEMPOTENCY_PROCESSING_LEASE_MS = originalLease;
});

describe('processing-lease helpers', () => {
  it('defaults the lease to two minutes', () => {
    delete process.env.IDEMPOTENCY_PROCESSING_LEASE_MS;
    expect(DEFAULT_PROCESSING_LEASE_MS).toBe(2 * 60 * 1000);
  });

  it('treats only old pending records as expired', () => {
    const now = Date.now();
    expect(
      isProcessingLeaseExpired({ status: 'pending', createdAt: new Date(now - 1_000) }, now),
    ).toBe(false);
    expect(
      isProcessingLeaseExpired({ status: 'pending', createdAt: new Date(now - 120_000) }, now),
    ).toBe(true);
    // Completed records are governed by the retention TTL, not the lease.
    expect(
      isProcessingLeaseExpired({ status: 'completed', createdAt: new Date(now - 120_000) }, now),
    ).toBe(false);
  });

  it('reports at least one second remaining for a live lease', () => {
    const now = Date.now();
    expect(
      processingLeaseRemainingSeconds({ createdAt: new Date(now - 1_000) }, now),
    ).toBe(59);
  });
});

describe('reclaimExpiredIdempotencyRecord', () => {
  it('deletes only the guarded stale pending row', async () => {
    idempotencyKeyDelegate.deleteMany.mockResolvedValue({ count: 1 });

    const reclaimed = await reclaimExpiredIdempotencyRecord('key-1', 'tenant-1', Date.now());

    expect(reclaimed).toBe(true);
    expect(idempotencyKeyDelegate.deleteMany).toHaveBeenCalledWith({
      where: {
        keyId: 'key-1',
        tenantId: 'tenant-1',
        status: 'pending',
        createdAt: { lte: expect.any(Date) },
      },
    });
  });

  it('reports false when another worker already completed the key', async () => {
    idempotencyKeyDelegate.deleteMany.mockResolvedValue({ count: 0 });
    await expect(
      reclaimExpiredIdempotencyRecord('key-2', 'tenant-1', Date.now()),
    ).resolves.toBe(false);
  });
});

describe('reclaimExpiredIdempotencyRecords', () => {
  it('reaps all abandoned pending rows in bulk', async () => {
    idempotencyKeyDelegate.deleteMany.mockResolvedValue({ count: 3 });
    await expect(reclaimExpiredIdempotencyRecords(Date.now())).resolves.toBe(3);
    expect(idempotencyKeyDelegate.deleteMany).toHaveBeenCalledWith({
      where: {
        status: 'pending',
        createdAt: { lte: expect.any(Date) },
      },
    });
  });
});

describe('enforceIdempotency hung-key recovery', () => {
  it('reclaims an expired pending lease and lets the retry proceed', async () => {
    idempotencyKeyDelegate.findFirst.mockResolvedValue(
      makeRecord({ createdAt: new Date(Date.now() - 10 * 60 * 1000) }),
    );
    idempotencyKeyDelegate.deleteMany.mockResolvedValue({ count: 1 });

    const next = jest.fn();
    const { res } = makeRes();
    const middleware = enforceIdempotency();

    await middleware(makeReq() as Request, res as Response, next);

    expect(idempotencyKeyDelegate.deleteMany).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('keeps blocking while the lease is still live and reports retryAfter', async () => {
    idempotencyKeyDelegate.findFirst.mockResolvedValue(
      makeRecord({ createdAt: new Date(Date.now() - 5_000) }),
    );

    const next = jest.fn();
    const { res, status } = makeRes();
    const middleware = enforceIdempotency();

    await middleware(makeReq() as Request, res as Response, next);

    expect(idempotencyKeyDelegate.deleteMany).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'IDEMPOTENCY_PENDING',
        retryAfter: expect.any(Number),
      }),
    );
  });

  it('does not reclaim a pending row when the guarded delete matches nothing', async () => {
    idempotencyKeyDelegate.findFirst.mockResolvedValue(
      makeRecord({ createdAt: new Date(Date.now() - 10 * 60 * 1000) }),
    );
    idempotencyKeyDelegate.deleteMany.mockResolvedValue({ count: 0 });

    const next = jest.fn();
    const { res, status } = makeRes();
    const middleware = enforceIdempotency();

    await middleware(makeReq() as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(409);
  });

  it('replays a completed response without touching the lease', async () => {
    idempotencyKeyDelegate.findFirst.mockResolvedValue(
      makeRecord({
        status: 'completed',
        statusCode: 201,
        responseBody: JSON.stringify({ id: 'tx-1' }),
      }),
    );

    const next = jest.fn();
    const { res, status } = makeRes();
    const middleware = enforceIdempotency();

    await middleware(makeReq() as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(idempotencyKeyDelegate.deleteMany).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: 'tx-1' });
  });
});
