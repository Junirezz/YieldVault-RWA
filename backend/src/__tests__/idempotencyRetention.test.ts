import { IdempotencyStore, idempotencyStore } from '../idempotency';
import {
  getIdempotencyRetentionMetrics,
  pruneStaleIdempotencyRecords,
  resetIdempotencyRetentionStateForTests,
} from '../idempotencyRetention';

// In-memory stand-in for the ioredis client; null means Redis is unavailable.
let mockRedis: FakeRedis | null = null;

jest.mock('../rateLimiter', () => ({
  redisClientManager: {
    isReady: () => mockRedis !== null,
    getClient: () => mockRedis,
  },
}));

class FakeRedis {
  readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<'OK'> {
    this.store.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  async ttl(): Promise<number> {
    return 3600;
  }

  async scan(_cursor: string, _match: string, pattern: string): Promise<[string, string[]]> {
    const prefix = pattern.replace(/\*$/, '');
    return ['0', [...this.store.keys()].filter((key) => key.startsWith(prefix))];
  }
}

function entry(createdAt: string) {
  return {
    statusCode: 200,
    body: { ok: true },
    fingerprint: 'fp',
    metadata: {
      createdAt,
      lastAccessedAt: createdAt,
      replayCount: 0,
      status: 'completed',
    },
  };
}

const stale = () => new Date(Date.now() - 10_000).toISOString();
const fresh = () => new Date().toISOString();

describe('idempotencyRetention', () => {
  beforeEach(() => {
    mockRedis = null;
    idempotencyStore.clear();
    resetIdempotencyRetentionStateForTests();
    process.env.IDEMPOTENCY_KEY_TTL_MS = '1000';
    process.env.IDEMPOTENCY_RETENTION_ENABLED = 'true';
  });

  it('reports retention policy and store metrics', () => {
    const metrics = getIdempotencyRetentionMetrics();
    expect(metrics.policy.retentionMs).toBe(1000);
    expect(metrics.storeMetrics).toBeDefined();
  });

  it('prunes stale local idempotency keys', async () => {
    const store = new IdempotencyStore(1000);
    (store as any).localCache.set('stale-key', entry(stale()));

    const result = await store.pruneStaleKeys(1000, false);
    expect(result.localPruned).toBe(1);
    expect(result.pruned).toBe(1);
    expect(result.dryRun).toBe(false);
    expect(store.inspectKeys()).toHaveLength(0);
  });

  it('supports dry-run retention sweeps', async () => {
    const result = await pruneStaleIdempotencyRecords(true);
    expect(result.dryRun).toBe(true);
    expect(result.pruned).toBeGreaterThanOrEqual(0);
  });

  describe('dry-run mode (Issue #1375)', () => {
    it('store dry-run reports stale local keys without deleting them', async () => {
      const store = new IdempotencyStore(1000);
      (store as any).localCache.set('stale-key', entry(stale()));
      (store as any).localCache.set('fresh-key', entry(fresh()));
      const evictionsBefore = store.getMetrics().evictions;

      const result = await store.pruneStaleKeys(1000, true);

      expect(result).toEqual({ pruned: 1, localPruned: 1, redisPruned: 0, dryRun: true });
      expect(store.inspectKeys().map((k) => k.key).sort()).toEqual(['fresh-key', 'stale-key']);
      expect(store.getMetrics().evictions).toBe(evictionsBefore);
    });

    it('store dry-run reports stale Redis keys without deleting them', async () => {
      mockRedis = new FakeRedis();
      mockRedis.store.set('idempotency:stale-redis', JSON.stringify(entry(stale())));
      mockRedis.store.set('idempotency:fresh-redis', JSON.stringify(entry(fresh())));
      const store = new IdempotencyStore(1000);

      const dry = await store.pruneStaleKeys(1000, true);
      expect(dry).toEqual({ pruned: 1, localPruned: 0, redisPruned: 1, dryRun: true });
      expect(mockRedis.store.has('idempotency:stale-redis')).toBe(true);

      const live = await store.pruneStaleKeys(1000, false);
      expect(live).toEqual({ pruned: 1, localPruned: 0, redisPruned: 1, dryRun: false });
      expect(mockRedis.store.has('idempotency:stale-redis')).toBe(false);
      expect(mockRedis.store.has('idempotency:fresh-redis')).toBe(true);
    });

    it('sweep dry-run leaves the store and sweep metrics untouched', async () => {
      (idempotencyStore as any).localCache.set('stale-key', entry(stale()));

      const result = await pruneStaleIdempotencyRecords(true);

      expect(result).toEqual({ pruned: 1, localPruned: 1, redisPruned: 0, dryRun: true });
      expect(idempotencyStore.inspectKeys().map((k) => k.key)).toContain('stale-key');
      const metrics = getIdempotencyRetentionMetrics();
      expect(metrics.lastSweepAt).toBeNull();
      expect(metrics.totalPruned).toBe(0);
      expect(metrics.lastPrunedCount).toBe(0);
    });

    it('a live sweep after a dry-run prunes the same keys and records metrics', async () => {
      (idempotencyStore as any).localCache.set('stale-key', entry(stale()));

      const dry = await pruneStaleIdempotencyRecords(true);
      const live = await pruneStaleIdempotencyRecords(false);

      expect(live).toEqual({ ...dry, dryRun: false });
      expect(idempotencyStore.inspectKeys()).toHaveLength(0);
      const metrics = getIdempotencyRetentionMetrics();
      expect(metrics.lastSweepAt).not.toBeNull();
      expect(metrics.totalPruned).toBe(1);
      expect(metrics.lastPrunedCount).toBe(1);
    });
  });
});
