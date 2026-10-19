import { EventPollingService } from '../eventPollingService';
import { getPrismaClient } from '../prismaClient';

global.fetch = jest.fn();

describe('Issue #1615 — Event poller RPC error handling and pagination', () => {
  const prisma = getPrismaClient();
  let service: EventPollingService;

  const mockConfig = {
    rpcUrl: 'http://localhost:8000/soroban/rpc',
    contractId: 'CA3D5KRYMCMCZKPOJG7PYHHQH3IFLLEOZCNGMFUHNL5O32CSK2OACUs6',
    pollIntervalMs: 5000,
    batchSize: 100,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EventPollingService(mockConfig);
  });

  afterEach(async () => {
    await service.stop();
  });

  it('increments consecutivePollFailures and leaves cursor unchanged on non-OK response', async () => {
    jest.spyOn(prisma.eventCursor, 'findUnique').mockResolvedValue({
      id: 1,
      lastLedgerSeq: 1000,
    } as any);

    const spyUpsert = jest.spyOn(prisma.eventCursor, 'upsert').mockResolvedValue({} as any);

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({}),
    });

    await service.pollEvents();

    const health = service.getHealth();
    expect(health.consecutiveFailures).toBe(1);
    expect(health.lastError).toMatch(/status 503/);
    expect(spyUpsert).not.toHaveBeenCalled();

    spyUpsert.mockRestore();
  });

  it('increments consecutivePollFailures and leaves cursor unchanged on JSON-RPC error', async () => {
    jest.spyOn(prisma.eventCursor, 'findUnique').mockResolvedValue({
      id: 1,
      lastLedgerSeq: 1000,
    } as any);

    const spyUpsert = jest.spyOn(prisma.eventCursor, 'upsert').mockResolvedValue({} as any);

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32603, message: 'Internal RPC error' },
      }),
    });

    await service.pollEvents();

    const health = service.getHealth();
    expect(health.consecutiveFailures).toBe(1);
    expect(health.lastError).toMatch(/Internal RPC error/);
    expect(spyUpsert).not.toHaveBeenCalled();

    spyUpsert.mockRestore();
  });

  it('fails safely and does not record success when latest ledger is null/missing', async () => {
    jest.spyOn(prisma.eventCursor, 'findUnique').mockResolvedValue({
      id: 1,
      lastLedgerSeq: 1000,
    } as any);

    const spyUpsert = jest.spyOn(prisma.eventCursor, 'upsert').mockResolvedValue({} as any);

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: null,
      }),
    });

    await service.pollEvents();

    const health = service.getHealth();
    expect(health.consecutiveFailures).toBe(1);
    expect(health.lastError).toMatch(/missing valid sequence number/);
    expect(health.lastSuccessfulPollAt).toBeNull();
    expect(spyUpsert).not.toHaveBeenCalled();

    spyUpsert.mockRestore();
  });

  it('pages events until range is exhausted with 2,500 events', async () => {
    jest.spyOn(prisma.eventCursor, 'findUnique').mockResolvedValue({
      id: 1,
      lastLedgerSeq: 1000,
    } as any);

    jest.spyOn(prisma.processedEvent, 'findUnique').mockResolvedValue(null);
    jest.spyOn(prisma.processedEvent, 'upsert').mockResolvedValue({} as any);
    const spyUpsertCursor = jest.spyOn(prisma.eventCursor, 'upsert').mockResolvedValue({} as any);

    // Mock getCurrentLedger returning 1005
    // Page 1: 1000 events, cursor: 'token-1000'
    // Page 2: 1000 events, cursor: 'token-2000'
    // Page 3: 500 events, no more pages
    (fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: { sequence: 1005 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            cursor: 'token-1000',
            events: Array.from({ length: 1000 }, (_, i) => ({
              id: `evt-${i}`,
              ledger: 1001,
              pagingToken: `token-${i + 1}`,
              contractId: mockConfig.contractId,
            })),
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            cursor: 'token-2000',
            events: Array.from({ length: 1000 }, (_, i) => ({
              id: `evt-${1000 + i}`,
              ledger: 1002,
              pagingToken: `token-${1000 + i + 1}`,
              contractId: mockConfig.contractId,
            })),
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            cursor: 'token-2500',
            events: Array.from({ length: 500 }, (_, i) => ({
              id: `evt-${2000 + i}`,
              ledger: 1003,
              pagingToken: `token-${2000 + i + 1}`,
              contractId: mockConfig.contractId,
            })),
          },
        }),
      });

    await service.pollEvents();

    const health = service.getHealth();
    expect(health.consecutiveFailures).toBe(0);
    expect(health.lastSuccessfulPollAt).not.toBeNull();
    expect(spyUpsertCursor).toHaveBeenCalledWith({
      where: { id: 1 },
      update: { lastLedgerSeq: 1005 },
      create: { id: 1, lastLedgerSeq: 1005 },
    });

    // Verify 4 fetch calls occurred (1 for latestLedger, 3 for getEvents)
    expect(fetch).toHaveBeenCalledTimes(4);

    spyUpsertCursor.mockRestore();
  });
});
