import type { Request, Response, NextFunction } from 'express';
import { cacheHitCount, cacheMissCount, cacheEvictionCount } from '../metrics';
import { latencyMonitoringService } from '../latencyMonitoring';
import { getFromCache, setInCache, redisCacheClient } from '../redisCache';

interface CacheEntry {
  data: unknown;
  statusCode: number;
  headers: Record<string, string>;
  expiresAt: number;
  ttl: number; // original ttl in ms, for Cache-Control on miss
  lastUsed: number; // timestamp for LRU eviction
}

// ── LRU Cache Store ──────────────────────────────────────────────────────────

const DEFAULT_MAX_ENTRIES = 500;

function resolveMaxEntries(): number {
  const raw = process.env.CACHE_MAX_ENTRIES;
  if (!raw) return DEFAULT_MAX_ENTRIES;
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) {
    console.warn(
      `[cache] CACHE_MAX_ENTRIES="${raw}" is not a positive integer — falling back to default ${DEFAULT_MAX_ENTRIES}`,
    );
    return DEFAULT_MAX_ENTRIES;
  }
  return n;
}

class LruCacheStore {
  private store = new Map<string, CacheEntry>();
  private maxEntries: number;

  constructor() {
    this.maxEntries = resolveMaxEntries();
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.store.get(key);
    if (entry) {
      entry.lastUsed = Date.now();
    }
    return entry;
  }

  set(key: string, entry: CacheEntry): void {
    const isUpdate = this.store.has(key);

    if (!isUpdate && this.store.size >= this.maxEntries) {
      this._evictLru();
    }

    entry.lastUsed = Date.now();
    this.store.set(key, entry);
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  keys(): IterableIterator<string> {
    return this.store.keys();
  }

  get size(): number {
    return this.store.size;
  }

  private _evictLru(): void {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    for (const [key, entry] of this.store.entries()) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = key;
      }
    }

    if (oldestKey !== undefined) {
      this.store.delete(oldestKey);
      cacheEvictionCount.inc();
    }
  }
}

export const responseCache = new LruCacheStore();

// ── Cache Key ────────────────────────────────────────────────────────────────

/**
 * Build a deterministic cache key from the HTTP method, path, and query params.
 * Query param names and multi-value lists are both sorted alphabetically so that
 * ?a=2&a=1&b=3 and ?b=3&a=2&a=1 yield the same key.
 */
function resolveRequestPath(req: Request): string {
  const baseUrl = req.baseUrl || '';
  const path = req.path || '/';

  if (!baseUrl) {
    return path === '/' ? '/' : path;
  }

  const combined = `${baseUrl}${path === '/' ? '' : path}`;
  return combined === '' ? '/' : combined;
}

export function buildCacheKey(req: Request): string {
  const query = req.query as Record<string, string | string[]>;
  const keys = Object.keys(query).sort();
  const pathname = resolveRequestPath(req);

  if (keys.length === 0) {
    return `${req.method}:${pathname}`;
  }

  const pairs = keys.map((k) => {
    const v = query[k];
    const values = Array.isArray(v) ? [...v].sort() : [v];
    return `${k}=${values.join(',')}`;
  });

  return `${req.method}:${pathname}:${pairs.join('&')}`;
}

// ── Middleware ────────────────────────────────────────────────────────────────

export interface CacheOptions {
  ttl: number; // milliseconds
  /** When true, the middleware caches even when an Authorization header is present */
  sharedCache?: boolean;
}

export function cacheMiddleware(options: CacheOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      next();
      return;
    }

    // R10: skip caching for authenticated or identity-scoped requests unless explicitly opted-in.
    // The cache key does not include credentials, so these responses must never be shared.
    if (
      !options.sharedCache &&
      (req.headers['authorization'] || req.headers['x-api-key'] || req.headers['x-wallet-address'])
    ) {
      next();
      return;
    }

    // R10: never cache /admin/audit/* routes
    if (req.path.startsWith('/admin/audit')) {
      next();
      return;
    }

    const route = (req.route?.path as string | undefined) ?? req.path;
    const cacheKey = buildCacheKey(req);

    // ── Redis-aware async path ───────────────────────────────────────────────
    // When Redis is configured we use the async Redis+LRU path; otherwise we
    // fall through to the synchronous in-memory-only path for zero overhead.
    if (redisCacheClient.isConfigured) {
      const hitStart = Date.now();

      getFromCache(cacheKey)
        .then((cached) => {
          if (cached && cached.expiresAt > Date.now()) {
            // Cache HIT (Redis or LRU fallback)
            cacheHitCount.inc({ method: req.method, route });

            const remainingMs = cached.expiresAt - Date.now();
            const remainingSec = Math.ceil(remainingMs / 1000);

            res.setHeader('X-Cache-Hit', 'true');
            res.setHeader('X-Cache-Backend', redisCacheClient.isReady ? 'redis' : 'memory');
            res.setHeader('Cache-Control', `public, max-age=${Math.max(remainingSec, 0)}`);

            for (const [name, value] of Object.entries(cached.headers)) {
              if (name !== 'Cache-Control' && name !== 'X-Cache-Hit' && name !== 'X-Cache-Backend') {
                res.setHeader(name, value);
              }
            }

            res.status(cached.statusCode).json(cached.data);
            latencyMonitoringService.recordLatency(route, Date.now() - hitStart, true);
            return;
          }

          // Cache MISS — intercept response to store it
          const missStart = Date.now();
          cacheMissCount.inc({ method: req.method, route });

          const originalJson = res.json.bind(res);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          res.json = function (data: any) {
            const status = res.statusCode ?? 200;

            if (status >= 200 && status < 300) {
              const maxAgeSec = Math.ceil(options.ttl / 1000);
              res.setHeader('X-Cache-Hit', 'false');
              res.setHeader('X-Cache-Backend', redisCacheClient.isReady ? 'redis' : 'memory');
              res.setHeader('Cache-Control', `public, max-age=${maxAgeSec}`);

              const entry = {
                data,
                statusCode: status,
                headers: {},
                expiresAt: Date.now() + options.ttl,
                ttl: options.ttl,
                lastUsed: Date.now(),
              };

              // Fire-and-forget: write to Redis + LRU asynchronously
              void setInCache(cacheKey, entry, options.ttl).catch(() => {
                // Errors are already logged inside setInCache; do not crash the response
              });
            }

            const result = originalJson(data);
            latencyMonitoringService.recordLatency(route, Date.now() - missStart, false);
            return result;
          } as typeof res.json;

          next();
        })
        .catch(() => {
          // Redis lookup failed entirely — fall through to handler without caching
          next();
        });

      return;
    }

    // ── Synchronous in-memory-only path (Redis not configured) ───────────────
    const cached = responseCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      // Cache HIT
      const hitStart = Date.now();
      cacheHitCount.inc({ method: req.method, route });

      const remainingMs = cached.expiresAt - Date.now();
      const remainingSec = Math.ceil(remainingMs / 1000);

      res.setHeader('X-Cache-Hit', 'true');
      res.setHeader('X-Cache-Backend', 'memory');
      res.setHeader('Cache-Control', `public, max-age=${Math.max(remainingSec, 0)}`);

      // Restore any other cached response headers
      for (const [name, value] of Object.entries(cached.headers)) {
        if (name !== 'Cache-Control' && name !== 'X-Cache-Hit' && name !== 'X-Cache-Backend') {
          res.setHeader(name, value);
        }
      }

      res.status(cached.statusCode).json(cached.data);

      // R9: record cached latency
      latencyMonitoringService.recordLatency(route, Date.now() - hitStart, true);
      return;
    }

    // Cache MISS — intercept the response to store it
    const missStart = Date.now();
    cacheMissCount.inc({ method: req.method, route });

    const originalJson = res.json.bind(res);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res.json = function (data: any) {
      const status = res.statusCode ?? 200;

      // R3 C3: only cache 2xx responses
      if (status >= 200 && status < 300) {
        const maxAgeSec = Math.ceil(options.ttl / 1000);
        res.setHeader('X-Cache-Hit', 'false');
        res.setHeader('X-Cache-Backend', 'memory');
        res.setHeader('Cache-Control', `public, max-age=${maxAgeSec}`);

        responseCache.set(cacheKey, {
          data,
          statusCode: status,
          headers: {},
          expiresAt: Date.now() + options.ttl,
          ttl: options.ttl,
          lastUsed: Date.now(),
        });
      }

      const result = originalJson(data);
      // R9: record uncached latency after response is written
      latencyMonitoringService.recordLatency(route, Date.now() - missStart, false);
      return result;
    } as typeof res.json;

    next();
  };
}

// ── Invalidation ─────────────────────────────────────────────────────────────

type InvalidationHook = (eventType: string, metadata?: Record<string, unknown>) => string[];

const invalidationHooks: InvalidationHook[] = [];

/**
 * Register a hook that returns patterns to invalidate when a write event occurs.
 * Hooks receive the event type and optional metadata and return an array of cache key patterns.
 */
export function registerInvalidationHook(hook: InvalidationHook): void {
  invalidationHooks.push(hook);
}

/**
 * Trigger cache invalidation for a specific event type.
 * All registered hooks are invoked and their returned patterns are invalidated.
 */
export function triggerCacheInvalidation(
  eventType: string,
  metadata?: Record<string, unknown>,
): { patternsInvalidated: string[]; keysRemoved: number } {
  const patterns: string[] = [];

  for (const hook of invalidationHooks) {
    try {
      const hookPatterns = hook(eventType, metadata);
      patterns.push(...hookPatterns);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'invalidation_hook_error',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  let totalRemoved = 0;
  for (const pattern of patterns) {
    totalRemoved += invalidateCache(pattern);
  }

  return { patternsInvalidated: patterns, keysRemoved: totalRemoved };
}

export function invalidateCache(pattern?: string): number {
  if (!pattern) {
    const count = responseCache.size;
    responseCache.clear();
    // Also flush matching Redis keys asynchronously (best-effort)
    void redisCacheClient.invalidatePattern('*').catch(() => {});
    return count;
  }

  const regex = new RegExp(pattern);
  let removed = 0;
  for (const key of Array.from(responseCache.keys())) {
    if (regex.test(key)) {
      responseCache.delete(key);
      removed++;
    }
  }

  // Asynchronously invalidate matching Redis keys (fail-safe; does not block the caller)
  void redisCacheClient.invalidatePattern(pattern).catch(() => {});

  return removed;
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export function getCacheStats(): { size: number; entries: string[] } {
  return {
    size: responseCache.size,
    entries: Array.from(responseCache.keys()),
  };
}
