/**
 * @file cacheFailover.test.ts
 * Regression tests for issue #1553.
 *
 * Covers the Redis fail-open path:
 *   - fallback reads are reported as stale (header + metadata + metrics)
 *   - stale responses are never cached downstream (`Cache-Control: no-store`)
 *   - `X-Cache-Bypass` / `Cache-Control: no-cache` force a fresh lookup
 */

import { EventEmitter } from 'events';
import type { Request, Response } from 'express';

class FakeRedis extends EventEmitter {
  private store = new Map<string, string>();

  async ping() {
    return 'PONG';
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async setex(key: string, _ttl: number, value: string) {
    this.store.set(key, value);
    return 'OK';
  }

  async del(...keys: string[]) {
    let removed = 0;
    for (const key of keys) if (this.store.delete(key)) removed++;
    return removed;
  }

  async scan(cursor: string): Promise<[string, string[]]> {
    return ['0', cursor === '0' ? [...this.store.keys()] : []];
  }

  async quit() {}
}

import {
  redisCacheClient,
  getFromCache,
  getFromCacheDetailed,
  setInCache,
  redisCacheFallbackCount,
  redisCacheStaleServeCount,
  redisCacheBypassCount,
} from '../redisCache';
import {
  responseCache,
  cacheMiddleware,
  isCacheBypassRequested,
} from '../middleware/cache';

let fakeRedis: FakeRedis;

function makeEntry(data: unknown, ttlMs = 60_000) {
  return {
    data,
    statusCode: 200,
    headers: {} as Record<string, string>,
    expiresAt: Date.now() + ttlMs,
    ttl: ttlMs,
    lastUsed: Date.now(),
  };
}

function makeFakeRequest(
  path: string,
  headers: Record<string, string> = {},
): Partial<Request> {
  return {
    method: 'GET',
    path,
    baseUrl: '',
    query: {},
    headers,
    route: { path },
  } as unknown as Partial<Request>;
}

function makeFakeResponse(): {
  res: Partial<Response>;
  headers: Record<string, string | number>;
  getCaptured: () => unknown;
  getStatus: () => number;
} {
  const headers: Record<string, string | number> = {};
  let captured: unknown;
  let status = 200;

  const res = {
    statusCode: 200,
    setHeader(name: string, value: string | number) {
      headers[name.toLowerCase()] = value;
    },
    status(code: number) {
      status = code;
      (this as any).statusCode = code;
      return this;
    },
    json(data: unknown) {
      captured = data;
      return this;
    },
  } as unknown as Partial<Response>;

  return {
    res,
    headers,
    getCaptured: () => captured,
    getStatus: () => status,
  };
}

async function counterValue(
  counter: import('prom-client').Counter<string>,
  labels: Record<string, string>,
): Promise<number> {
  const values = await counter.get();
  const found = values.values.find((v) =>
    Object.entries(labels).every(([k, val]) => v.labels[k] === val),
  );
  return found?.value ?? 0;
}

beforeEach(() => {
  fakeRedis = new FakeRedis();
  (redisCacheClient as any).client = fakeRedis;
  (redisCacheClient as any)._isReady = true;
  responseCache.clear();
});

afterEach(() => {
  (redisCacheClient as any)._isReady = false;
  responseCache.clear();
});

describe('Redis fail-open staleness (issue #1553)', () => {
  it('marks an LRU hit as stale when Redis is configured but down', async () => {
    responseCache.set('GET:/api/v1/vault/summary', makeEntry({ totalAssets: '10' }));
    (redisCacheClient as any)._isReady = false;

    const result = await getFromCacheDetailed('GET:/api/v1/vault/summary');

    expect(result.entry).not.toBeNull();
    expect(result.backend).toBe('memory');
    expect(result.fromFallback).toBe(true);
    expect(result.stale).toBe(true);
    expect(result.ageMs).not.toBeNull();
  });

  it('does not mark an LRU hit as stale when Redis was never configured', async () => {
    (redisCacheClient as any).client = null;
    (redisCacheClient as any)._isReady = false;
    responseCache.set('GET:/api/v1/vault/summary', makeEntry({ totalAssets: '10' }));

    const result = await getFromCacheDetailed('GET:/api/v1/vault/summary');

    expect(result.entry).not.toBeNull();
    expect(result.fromFallback).toBe(true);
    expect(result.stale).toBe(false);
  });

  it('keeps the backward-compatible getFromCache() return shape', async () => {
    responseCache.set('GET:/api/v1/vault/summary', makeEntry({ totalAssets: '10' }));
    (redisCacheClient as any)._isReady = false;

    const entry = await getFromCache('GET:/api/v1/vault/summary');
    expect((entry?.data as { totalAssets: string }).totalAssets).toBe('10');
  });

  it('increments fallback and stale-serve metrics', async () => {
    const route = 'GET:/api/v1/vault/metrics';
    responseCache.set(route, makeEntry({ apy: '8' }));
    (redisCacheClient as any)._isReady = false;

    const beforeFallback = await counterValue(redisCacheFallbackCount, {
      route,
      reason: 'redis_unavailable',
    });
    const beforeStale = await counterValue(redisCacheStaleServeCount, {
      route,
      backend: 'memory',
    });

    await getFromCacheDetailed(route);

    expect(
      await counterValue(redisCacheFallbackCount, { route, reason: 'redis_unavailable' }),
    ).toBe(beforeFallback + 1);
    expect(
      await counterValue(redisCacheStaleServeCount, { route, backend: 'memory' }),
    ).toBe(beforeStale + 1);
  });

  it('serves fallback hits with staleness headers and no-store', async () => {
    const route = '/api/v1/vault/summary';
    const key = `GET:${route}`;
    responseCache.set(key, makeEntry({ totalAssets: '42' }));
    (redisCacheClient as any)._isReady = false;

    const req = makeFakeRequest(route);
    const { res, headers } = makeFakeResponse();

    await new Promise<void>((resolve) => {
      (res as any).json = function () {
        resolve();
        return res;
      };

      const middleware = cacheMiddleware({ ttl: 60_000 });
      middleware(req as Request, res as Response, () => {
        throw new Error('next() must not be called for a fallback hit');
      });
    });

    expect(headers['x-cache-hit']).toBe('true');
    expect(headers['x-cache-backend']).toBe('memory');
    expect(headers['x-cache-stale']).toBe('true');
    expect(headers['warning']).toContain('110');
    expect(headers['cache-control']).toBe('no-store');
  });

  it('detects bypass requests from either header', () => {
    expect(
      isCacheBypassRequested(makeFakeRequest('/x', { 'x-cache-bypass': 'true' }) as Request),
    ).toBe(true);
    expect(
      isCacheBypassRequested(
        makeFakeRequest('/x', { 'cache-control': 'no-cache, no-store' }) as Request,
      ),
    ).toBe(true);
    expect(
      isCacheBypassRequested(makeFakeRequest('/x', { 'cache-control': 'max-age=60' }) as Request),
    ).toBe(false);
  });

  it('bypasses a warm cache and re-populates it', async () => {
    const route = '/api/v1/vault/summary';
    const key = `GET:${route}`;
    responseCache.set(key, makeEntry({ totalAssets: 'stale' }));

    const req = makeFakeRequest(route, { 'x-cache-bypass': 'true' });
    const { res, headers, getCaptured } = makeFakeResponse();
    const beforeBypass = await counterValue(redisCacheBypassCount, { route: key });

    let nextCalled = false;
    await new Promise<void>((resolve) => {
      (res as any).json = function () {
        resolve();
        return res;
      };

      const middleware = cacheMiddleware({ ttl: 60_000 });
      middleware(req as Request, res as Response, () => {
        nextCalled = true;
        (res as any).json({ totalAssets: 'fresh' });
      });
    });

    expect(nextCalled).toBe(true);
    expect(headers['x-cache-bypass']).toBe('true');
    expect(headers['x-cache-hit']).toBe('false');
    expect((getCaptured() as { totalAssets: string }).totalAssets).toBe('fresh');
    expect(
      await counterValue(redisCacheBypassCount, { route: key }),
    ).toBe(beforeBypass + 1);

    // The fresh response replaced the stale entry.
    expect(
      (responseCache.get(key)?.data as { totalAssets: string }).totalAssets,
    ).toBe('fresh');
  });

  it('reports Redis hits as non-stale', async () => {
    const route = 'GET:/api/v1/vault/summary';
    await setInCache(route, makeEntry({ totalAssets: '99' }), 60_000);

    const result = await getFromCacheDetailed(route);
    expect(result.backend).toBe('redis');
    expect(result.stale).toBe(false);
    expect(result.fromFallback).toBe(false);
  });
});
