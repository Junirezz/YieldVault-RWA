import { EventPollingService } from '../eventPollingService';
import { getPrismaClient } from '../prismaClient';
import {
  register,
  computeEventPollerLag,
  recordEventPollerLedgers,
  recordEventPollerSuccess,
  resetEventPollerMetrics,
} from '../metrics';

global.fetch = jest.fn();

const LAG = 'event_poller_lag_ledgers';
const PROCESSED = 'event_poller_last_processed_ledger';
const LAST_SUCCESS = 'event_poller_last_successful_poll_timestamp_seconds';

async function series(name: string) {
  const metric = register.getSingleMetric(name);
  if (!metric) throw new Error(`metric ${name} is not registered`);
  return (await metric.get()).values;
}

async function value(name: string): Promise<number | undefined> {
  const values = await series(name);
  return values.length === 0 ? undefined : values[0].value;
}

describe('Issue #1726 — event poller lag and last-processed-ledger metrics', () => {
  const prisma = getPrismaClient();
  let service: EventPollingService;

  const config = {
    rpcUrl: 'http://localhost:8000/soroban/rpc',
    contractId: 'CA3D5KRYMCMCZKPOJG7PYHHQH3IFLLEOZCNGMFUHNL5O32CSK2OACUs6',
    pollIntervalMs: 5000,
    batchSize: 100,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    resetEventPollerMetrics();
    service = new EventPollingService(config);
  });

  afterEach(async () => {
    await service.stop();
    jest.restoreAllMocks();
  });

  describe('computeEventPollerLag', () => {
    it('is latest minus processed', () => {
      expect(computeEventPollerLag(1050, 1000)).toBe(50);
    });

    it('is 0 when caught up', () => {
      expect(computeEventPollerLag(1000, 1000)).toBe(0);
    });

    it('never goes negative when the cursor is ahead of a lagging RPC node', () => {
      expect(computeEventPollerLag(990, 1000)).toBe(0);
    });
  });

  describe('naming and cardinality', () => {
    it('registers the three gauges under stable names', () => {
      for (const name of [LAG, PROCESSED, LAST_SUCCESS]) {
        const metric = register.getSingleMetric(name);
        expect(metric).toBeDefined();
        expect((metric as any).help).toBeTruthy();
      }
    });

    it('only ever labels series with the constant poller label (no per-vault cardinality)', async () => {
      recordEventPollerLedgers(1050, 1000);
      recordEventPollerSuccess();
      // Repeated updates must not create additional series.
      recordEventPollerLedgers(1060, 1010);
      recordEventPollerLedgers(1070, 1020);

      for (const name of [LAG, PROCESSED, LAST_SUCCESS]) {
        const values = await series(name);
        expect(values).toHaveLength(1);
        expect(Object.keys(values[0].labels)).toEqual(['poller']);
        expect(values[0].labels.poller).toBe('event');
      }
    });
  });

  describe('restart and reset behaviour', () => {
    it('exports no series until something has been observed, instead of a misleading 0', async () => {
      expect(await series(LAG)).toHaveLength(0);
      expect(await series(PROCESSED)).toHaveLength(0);
      expect(await series(LAST_SUCCESS)).toHaveLength(0);
    });

    it('leaves gauges untouched for values that have not been observed yet', async () => {
      recordEventPollerLedgers(null, null);
      expect(await series(PROCESSED)).toHaveLength(0);

      // Latest ledger alone is not enough to publish lag or processed.
      recordEventPollerLedgers(1050, null);
      expect(await series(LAG)).toHaveLength(0);
      expect(await series(PROCESSED)).toHaveLength(0);

      // Processed alone publishes processed but cannot derive lag.
      recordEventPollerLedgers(null, 1000);
      expect(await value(PROCESSED)).toBe(1000);
      expect(await series(LAG)).toHaveLength(0);
    });

    it('resetEventPollerMetrics removes every poller series', async () => {
      recordEventPollerLedgers(1050, 1000);
      recordEventPollerSuccess();

      resetEventPollerMetrics();

      expect(await series(LAG)).toHaveLength(0);
      expect(await series(PROCESSED)).toHaveLength(0);
      expect(await series(LAST_SUCCESS)).toHaveLength(0);
    });
  });

  describe('instrumented poller', () => {
    it('reports zero lag, the new cursor and a success timestamp after catching up', async () => {
      jest.spyOn(prisma.eventCursor, 'findUnique').mockResolvedValue({
        id: 1,
        lastLedgerSeq: 1000,
      } as any);
      jest.spyOn(prisma.eventCursor, 'upsert').mockResolvedValue({} as any);

      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: { sequence: 1005 } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: { events: [] } }),
        });

      const before = Date.now() / 1000;
      await service.pollEvents();
      const after = Date.now() / 1000;

      expect(await value(PROCESSED)).toBe(1005);
      expect(await value(LAG)).toBe(0);
      const ts = (await value(LAST_SUCCESS)) as number;
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it('derives lag from latest observed ledger vs last processed ledger when processing fails', async () => {
      jest.spyOn(prisma.eventCursor, 'findUnique').mockResolvedValue({
        id: 1,
        lastLedgerSeq: 1000,
      } as any);
      const upsert = jest.spyOn(prisma.eventCursor, 'upsert').mockResolvedValue({} as any);

      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: { sequence: 1050 } }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          json: async () => ({}),
        });

      await service.pollEvents();

      // Cursor did not move, so lag is visible and grows with the chain.
      expect(upsert).not.toHaveBeenCalled();
      expect(await value(PROCESSED)).toBe(1000);
      expect(await value(LAG)).toBe(50);
      // A failed poll must not refresh the success timestamp.
      expect(await series(LAST_SUCCESS)).toHaveLength(0);
    });

    it('reports zero lag when the cursor is already at or ahead of the chain head', async () => {
      jest.spyOn(prisma.eventCursor, 'findUnique').mockResolvedValue({
        id: 1,
        lastLedgerSeq: 1000,
      } as any);

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { sequence: 1000 } }),
      });

      await service.pollEvents();

      expect(await value(PROCESSED)).toBe(1000);
      expect(await value(LAG)).toBe(0);
      expect(await series(LAST_SUCCESS)).toHaveLength(1);
    });

    it('does not update the success timestamp when the RPC itself is unreachable', async () => {
      jest.spyOn(prisma.eventCursor, 'findUnique').mockResolvedValue({
        id: 1,
        lastLedgerSeq: 1000,
      } as any);

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({}),
      });

      await service.pollEvents();

      // Cursor is known, latest ledger is not: processed is exported, lag is not.
      expect(await value(PROCESSED)).toBe(1000);
      expect(await series(LAG)).toHaveLength(0);
      expect(await series(LAST_SUCCESS)).toHaveLength(0);
    });
  });
});
