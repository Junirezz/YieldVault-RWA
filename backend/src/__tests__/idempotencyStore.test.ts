/**
 * Unit tests for the idempotency replay cache (`idempotencyStore.ts`).
 *
 * `transferOrchestrator.test.ts` already exercises the happy path end to end.
 * What it cannot reach is the Redis branch: with no `REDIS_URL` the
 * `redisClientManager` never reports ready, so `IdempotencyStore.redis`
 * returns `null` and every Redis helper is skipped. These tests drive the
 * store through a stub client so the Redis code path — and, more importantly,
 * its *fallback* when Redis errors — is actually executed.
 */

import {
  IdempotencyStore,
  IdempotencyConflictError,
  buildIdempotencyFingerprint,
  getIdempotencyHashThreshold,
  idempotencyStore,
} from '../idempotencyStore';

type RedisStub = Record<string, jest.Mock>;

function createRedisStub(overrides: Partial<RedisStub> = {}): RedisStub {
  const store = new Map<string, string>();

  const base: RedisStub = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    exists: jest.fn(async (key: string) => (store.has(key) ? 1 : 0)),
    scan: jest.fn(async () => ['0', [] as string[]]),
    ttl: jest.fn(async () => -1),
  };

  return { ...base, ...overrides };
}

/** Points the module's `redisClientManager` at `client` for the test's duration. */
async function withRedisClient<T>(client: unknown, fn: () => Promise<T>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const rateLimiter = require('../rateLimiter') as typeof import('../rateLimiter');
  const manager = rateLimiter.redisClientManager as unknown as {
    getClient: () => unknown;
    isReady: () => boolean;
  };
  const originalGetClient = manager.getClient;
  const originalIsReady = manager.isReady;

  manager.getClient = () => client;
  manager.isReady = () => true;

  try {
    return await fn();
  } finally {
    manager.getClient = originalGetClient;
    manager.isReady = originalIsReady;
  }
}

describe('IdempotencyStore', () => {
  describe('execute() with the in-process cache', () => {
    it('runs the operation once and replays the stored result afterwards', async () => {
      const store = new IdempotencyStore(60_000);
      const operation = jest.fn(async () => ({ statusCode: 201, body: { hash: 'abc' } }));

      const first = await store.execute('key-1', 'fp-1', operation);
      const second = await store.execute('key-1', 'fp-1', operation);

      expect(first).toEqual({ result: { statusCode: 201, body: { hash: 'abc' } }, replayed: false });
      expect(second.replayed).toBe(true);
      expect(second.result).toEqual(first.result);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('throws IdempotencyConflictError when the body changed for the same key', async () => {
      const store = new IdempotencyStore(60_000);
      await store.execute('key-2', 'fp-1', async () => ({ statusCode: 200, body: 'a' }));

      await expect(
        store.execute('key-2', 'fp-2', async () => ({ statusCode: 200, body: 'b' })),
      ).rejects.toBeInstanceOf(IdempotencyConflictError);
    });

    it('coalesces concurrent calls into a single operation', async () => {
      const store = new IdempotencyStore(60_000);
      let resolveOperation: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        resolveOperation = resolve;
      });
      const operation = jest.fn(async () => {
        await gate;
        return { statusCode: 200, body: 'once' };
      });

      const inflight = Promise.all([
        store.execute('key-3', 'fp', operation),
        store.execute('key-3', 'fp', operation),
      ]);
      resolveOperation!();
      const [a, b] = await inflight;

      expect(operation).toHaveBeenCalledTimes(1);
      expect([a.replayed, b.replayed].filter(Boolean)).toHaveLength(1);
    });

    it('rejects a concurrent call with a different fingerprint', async () => {
      const store = new IdempotencyStore(60_000);
      let resolveOperation: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        resolveOperation = resolve;
      });

      const inflight = store.execute('key-4', 'fp-a', async () => {
        await gate;
        return { statusCode: 200, body: 'a' };
      });
      const conflicting = store.execute('key-4', 'fp-b', async () => ({ statusCode: 200, body: 'b' }));

      resolveOperation!();
      await inflight;
      await expect(conflicting).rejects.toBeInstanceOf(IdempotencyConflictError);
    });

    it('does not leave a key pending after the operation rejects', async () => {
      const store = new IdempotencyStore(60_000);
      await expect(
        store.execute('key-5', 'fp', async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      // The pending slot must be free, so a retry runs the operation again.
      const retry = await store.execute('key-5', 'fp', async () => ({ statusCode: 200, body: 'ok' }));
      expect(retry.replayed).toBe(false);
    });
  });

  describe('observability and maintenance', () => {
    it('reports hits, conflicts and active keys', async () => {
      const store = new IdempotencyStore(60_000);
      await store.execute('m-1', 'fp', async () => ({ statusCode: 200, body: 1 }));
      await store.execute('m-1', 'fp', async () => ({ statusCode: 200, body: 1 }));
      await expect(
        store.execute('m-2', 'other', async () => ({ statusCode: 200, body: 2 })),
      ).resolves.toBeDefined();

      const metrics = store.getMetrics();
      expect(metrics.hits).toBe(1);
      expect(metrics.activeKeys).toBe(2);
      expect(metrics.pendingKeys).toBe(0);
    });

    it('counts a conflict', async () => {
      const store = new IdempotencyStore(60_000);
      await store.execute('m-3', 'fp', async () => ({ statusCode: 200, body: 1 }));
      await expect(
        store.execute('m-3', 'fp-different', async () => ({ statusCode: 200, body: 2 })),
      ).rejects.toBeInstanceOf(IdempotencyConflictError);

      expect(store.getMetrics().conflicts).toBe(1);
    });

    it('lists stored keys, optionally filtered by prefix', async () => {
      const store = new IdempotencyStore(60_000);
      await store.execute('alpha-1', 'fp', async () => ({ statusCode: 200, body: 1 }));
      await store.execute('beta-1', 'fp', async () => ({ statusCode: 200, body: 2 }));

      expect(store.inspectKeys().map((entry) => entry.key).sort()).toEqual(['alpha-1', 'beta-1']);
      expect(store.inspectKeys('alpha').map((entry) => entry.key)).toEqual(['alpha-1']);
      expect(store.inspectKeys('alpha')[0].metadata.status).toBe('completed');
    });

    it('deletes a single key and reports whether anything was removed', async () => {
      const store = new IdempotencyStore(60_000);
      await store.execute('d-1', 'fp', async () => ({ statusCode: 200, body: 1 }));

      expect(await store.deleteKey('d-1')).toBe(true);
      expect(await store.deleteKey('d-1')).toBe(false);
      expect(store.inspectKeys()).toHaveLength(0);
    });

    it('clear() empties the store and counts the evictions', async () => {
      const store = new IdempotencyStore(60_000);
      await store.execute('c-1', 'fp', async () => ({ statusCode: 200, body: 1 }));
      await store.execute('c-2', 'fp', async () => ({ statusCode: 200, body: 2 }));

      const before = store.getMetrics().evictions;
      store.clear();

      expect(store.inspectKeys()).toHaveLength(0);
      expect(store.getMetrics().evictions).toBe(before + 2);
    });

    it('prunes entries older than the retention window and honours dryRun', async () => {
      const store = new IdempotencyStore(60_000);
      await store.execute('p-1', 'fp', async () => ({ statusCode: 200, body: 1 }));
      await store.execute('p-2', 'fp', async () => ({ statusCode: 200, body: 2 }));

      // A retention of -1 puts the cutoff in the future, so everything
      // currently stored counts as stale.
      const dry = await store.pruneStaleKeys(-1, true);
      expect(dry.localPruned).toBe(2);
      expect(dry.redisPruned).toBe(0);
      expect(store.inspectKeys()).toHaveLength(2);

      const applied = await store.pruneStaleKeys(-1, false);
      expect(applied.localPruned).toBe(2);
      expect(applied.pruned).toBe(2);
      expect(store.inspectKeys()).toHaveLength(0);
    });

    it('keeps entries that are newer than the retention window', async () => {
      const store = new IdempotencyStore(60_000);
      await store.execute('p-3', 'fp', async () => ({ statusCode: 200, body: 1 }));

      const result = await store.pruneStaleKeys(60_000, false);
      expect(result.localPruned).toBe(0);
      expect(store.inspectKeys()).toHaveLength(1);
    });
  });

  describe('Redis path', () => {
    it('reads and writes through Redis when it is available', async () => {
      const redis = createRedisStub();

      await withRedisClient(redis, async () => {
        const store = new IdempotencyStore(60_000);
        const first = await store.execute('r-1', 'fp', async () => ({ statusCode: 200, body: 'v' }));
        expect(first.replayed).toBe(false);
        expect(redis.set).toHaveBeenCalled();

        // A fresh store shares no local cache, so only Redis can serve the replay.
        const other = new IdempotencyStore(60_000);
        const second = await other.execute('r-1', 'fp', async () => ({ statusCode: 200, body: 'v' }));
        expect(second.replayed).toBe(true);
        expect(redis.get).toHaveBeenCalled();
      });
    });

    it('detects a conflicting body via Redis', async () => {
      const redis = createRedisStub();

      await withRedisClient(redis, async () => {
        const store = new IdempotencyStore(60_000);
        await store.execute('r-2', 'fp', async () => ({ statusCode: 200, body: 'v' }));

        await expect(
          store.execute('r-2', 'different', async () => ({ statusCode: 200, body: 'v' })),
        ).rejects.toBeInstanceOf(IdempotencyConflictError);
      });
    });

    it('deletes via Redis and reports a removal', async () => {
      const redis = createRedisStub();

      await withRedisClient(redis, async () => {
        const store = new IdempotencyStore(60_000);
        await store.execute('r-3', 'fp', async () => ({ statusCode: 200, body: 'v' }));

        expect(await store.deleteKey('r-3')).toBe(true);
        expect(redis.del).toHaveBeenCalled();
        expect(await store.deleteKey('never-stored')).toBe(false);
      });
    });

    it('survives Redis write failures by falling back to the local cache', async () => {
      const redis = createRedisStub({ set: jest.fn(async () => { throw new Error('write fail'); }) });

      await withRedisClient(redis, async () => {
        const store = new IdempotencyStore(60_000);
        const first = await store.execute('r-4', 'fp', async () => ({ statusCode: 200, body: 'v' }));
        const second = await store.execute('r-4', 'fp', async () => ({ statusCode: 200, body: 'v' }));

        expect(first.replayed).toBe(false);
        expect(second.replayed).toBe(true);
      });
    });

    it('survives Redis read failures', async () => {
      const redis = createRedisStub({ get: jest.fn(async () => { throw new Error('read fail'); }) });

      await withRedisClient(redis, async () => {
        const store = new IdempotencyStore(60_000);
        const first = await store.execute('r-5', 'fp', async () => ({ statusCode: 200, body: 'v' }));
        const second = await store.execute('r-5', 'fp', async () => ({ statusCode: 200, body: 'v' }));

        expect(first.replayed).toBe(false);
        expect(second.replayed).toBe(true);
      });
    });

    it('survives Redis delete failures', async () => {
      const redis = createRedisStub({ del: jest.fn(async () => { throw new Error('del fail'); }) });

      await withRedisClient(redis, async () => {
        const store = new IdempotencyStore(60_000);
        await store.execute('r-6', 'fp', async () => ({ statusCode: 200, body: 'v' }));

        // The local entry is still removed, so the key is gone either way.
        expect(await store.deleteKey('r-6')).toBe(true);
      });
    });

    it('prunes stale Redis keys, honouring dryRun', async () => {
      const keys = new Map<string, string>();
      const redis = createRedisStub({
        scan: jest.fn(async () => ['0', ['idempotency:r-7']]),
        get: jest.fn(async (key: string) => {
          if (key !== 'idempotency:r-7') return null;
          return (
            keys.get(key) ??
            JSON.stringify({
              statusCode: 200,
              body: 'v',
              fingerprint: 'fp',
              metadata: {
                createdAt: new Date(Date.now() - 120_000).toISOString(),
                lastAccessedAt: new Date().toISOString(),
                replayCount: 0,
                status: 'completed',
              },
            })
          );
        }),
        ttl: jest.fn(async () => -1),
      });

      await withRedisClient(redis, async () => {
        const store = new IdempotencyStore(60_000);

        const dry = await store.pruneStaleKeys(60_000, true);
        expect(dry.redisPruned).toBe(1);
        expect(redis.del).not.toHaveBeenCalled();

        const applied = await store.pruneStaleKeys(60_000, false);
        expect(applied.redisPruned).toBe(1);
        expect(redis.del).toHaveBeenCalledWith('idempotency:r-7');
      });
    });

    it('prunes a Redis key whose TTL has run out', async () => {
      const redis = createRedisStub({
        scan: jest.fn(async () => ['0', ['idempotency:r-8']]),
        get: jest.fn(async () =>
          JSON.stringify({
            statusCode: 200,
            body: 'v',
            fingerprint: 'fp',
            metadata: {
              createdAt: new Date().toISOString(),
              lastAccessedAt: new Date().toISOString(),
              replayCount: 0,
              status: 'completed',
            },
          }),
        ),
        ttl: jest.fn(async () => 0),
      });

      await withRedisClient(redis, async () => {
        const store = new IdempotencyStore(60_000);
        const result = await store.pruneStaleKeys(60_000, false);
        expect(result.redisPruned).toBe(1);
      });
    });

    it('prunes a Redis key that cannot be parsed', async () => {
      const redis = createRedisStub({
        scan: jest.fn(async () => ['0', ['idempotency:r-9']]),
        get: jest.fn(async () => 'not json'),
      });

      await withRedisClient(redis, async () => {
        const store = new IdempotencyStore(60_000);
        const result = await store.pruneStaleKeys(60_000, false);
        expect(result.redisPruned).toBe(1);
        expect(redis.del).toHaveBeenCalledWith('idempotency:r-9');
      });
    });
  });

  describe('buildIdempotencyFingerprint()', () => {
    it('is stable regardless of key order', () => {
      expect(buildIdempotencyFingerprint({ a: 1, b: 2 })).toBe(
        buildIdempotencyFingerprint({ b: 2, a: 1 }),
      );
    });

    it('handles nested objects, arrays, dates and null', () => {
      const date = new Date('2026-01-01T00:00:00.000Z');
      const fingerprint = buildIdempotencyFingerprint({ z: [1, { y: 2 }], d: date, n: null });

      expect(fingerprint).toContain('2026-01-01T00:00:00.000Z');
      expect(fingerprint).toContain('null');
      expect(buildIdempotencyFingerprint({ z: [1, { y: 2 }], d: date, n: null })).toBe(fingerprint);
    });

    it('hashes payloads larger than the configured threshold', () => {
      const oversized = { blob: 'x'.repeat(getIdempotencyHashThreshold() + 10) };
      const fingerprint = buildIdempotencyFingerprint(oversized);

      expect(fingerprint.startsWith('hashv1:')).toBe(true);
      expect(fingerprint).toHaveLength('hashv1:'.length + 64);
    });

    it('does not hash payloads within the threshold', () => {
      expect(buildIdempotencyFingerprint({ blob: 'small' })).not.toMatch(/^hashv1:/);
    });
  });

  it('exposes a module-level singleton', () => {
    expect(idempotencyStore).toBeInstanceOf(IdempotencyStore);
    expect(typeof idempotencyStore.getMetrics().activeKeys).toBe('number');
  });
});
