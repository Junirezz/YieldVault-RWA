/**
 * @file redisCache.ts
 * Redis-backed response cache for price and vault summary endpoints.
 *
 * Provides a unified caching interface that:
 *   1. Uses Redis (via ioredis) when REDIS_URL is configured and the connection
 *      is healthy.
 *   2. Falls back transparently to the existing in-memory LRU store when Redis
 *      is not configured or temporarily unreachable (fail-open).
 *
 * Cache keys follow the same deterministic format used by the existing LRU
 * middleware so entries written through either path are interchangeable.
 *
 * Prometheus counters are exported so operators can track Redis vs in-memory
 * hit/miss ratios from the /metrics endpoint.
 *
 * Environment variables:
 *   REDIS_URL                  – Redis connection URL (required to enable Redis)
 *   REDIS_CACHE_KEY_PREFIX     – Key namespace prefix (default: "cache:")
 *   REDIS_CACHE_CONNECT_TIMEOUT_MS – Connection timeout (default: 2000)
 *   REDIS_CACHE_COMMAND_TIMEOUT_MS – Per-command timeout (default: 500)
 *
 * TTL values are always specified in milliseconds by callers; this module
 * converts them to seconds when writing to Redis (Redis TTL is in seconds).
 */

import { Redis } from 'ioredis';
import { Counter, Gauge, register as defaultRegister } from 'prom-client';
import { responseCache } from './middleware/cache';

// ─── Configuration ────────────────────────────────────────────────────────────

const DEFAULT_KEY_PREFIX = 'cache:';
const DEFAULT_CONNECT_TIMEOUT_MS = 2000;
const DEFAULT_COMMAND_TIMEOUT_MS = 500;

function resolveEnvInt(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

const KEY_PREFIX = process.env.REDIS_CACHE_KEY_PREFIX ?? DEFAULT_KEY_PREFIX;
const CONNECT_TIMEOUT_MS = resolveEnvInt(
  'REDIS_CACHE_CONNECT_TIMEOUT_MS',
  DEFAULT_CONNECT_TIMEOUT_MS,
);
const COMMAND_TIMEOUT_MS = resolveEnvInt(
  'REDIS_CACHE_COMMAND_TIMEOUT_MS',
  DEFAULT_COMMAND_TIMEOUT_MS,
);

// ─── Prometheus Metrics ───────────────────────────────────────────────────────

function createOrGet<T>(
  factory: () => T,
  name: string,
): T {
  const existing = defaultRegister.getSingleMetric(name);
  if (existing) return existing as unknown as T;
  return factory();
}

export const redisCacheHitCount = createOrGet(
  () =>
    new Counter({
      name: 'redis_cache_hit_total',
      help: 'Total Redis cache hits for response caching',
      labelNames: ['route'] as const,
      registers: [defaultRegister],
    }),
  'redis_cache_hit_total',
);

export const redisCacheMissCount = createOrGet(
  () =>
    new Counter({
      name: 'redis_cache_miss_total',
      help: 'Total Redis cache misses for response caching',
      labelNames: ['route'] as const,
      registers: [defaultRegister],
    }),
  'redis_cache_miss_total',
);

export const redisCacheErrorCount = createOrGet(
  () =>
    new Counter({
      name: 'redis_cache_error_total',
      help: 'Total Redis errors encountered during response caching operations',
      labelNames: ['operation'] as const,
      registers: [defaultRegister],
    }),
  'redis_cache_error_total',
);

export const redisCacheConnectionStatus = createOrGet(
  () =>
    new Gauge({
      name: 'redis_cache_connection_status',
      help: 'Redis cache connection status: 1 = connected, 0 = disconnected',
      registers: [defaultRegister],
    }),
  'redis_cache_connection_status',
);

// ─── Redis Client ─────────────────────────────────────────────────────────────

/**
 * Serialised cache entry stored in Redis.
 * All fields are preserved so a Redis-sourced hit behaves identically to
 * a hit served from the in-memory LRU store.
 */
export interface RedisCacheEntry {
  data: unknown;
  statusCode: number;
  headers: Record<string, string>;
  expiresAt: number;
  ttl: number;
  lastUsed: number;
}

class RedisCacheClient {
  private client: Redis | null = null;
  private _isReady: boolean = false;
  private readonly redisUrl: string | undefined;

  constructor() {
    this.redisUrl = process.env.REDIS_URL;
    if (!this.redisUrl) {
      this._log('warn', 'redis_cache_not_configured', {
        message:
          'REDIS_URL not set; vault summary/price cache will use in-memory LRU fallback',
      });
      return;
    }

    this.client = new Redis(this.redisUrl, {
      lazyConnect: true,
      connectTimeout: CONNECT_TIMEOUT_MS,
      commandTimeout: COMMAND_TIMEOUT_MS,
      // Prevent Node process from being kept alive solely by this client
      maxRetriesPerRequest: 1,
    });

    const parsed = new URL(this.redisUrl);
    const host = parsed.hostname;
    const port = parseInt(parsed.port || '6379', 10);

    this.client.on('connect', () => {
      this._isReady = true;
      redisCacheConnectionStatus.set(1);
      this._log('info', 'redis_cache_connected', { host, port });
    });

    this.client.on('ready', () => {
      this._isReady = true;
      redisCacheConnectionStatus.set(1);
    });

    this.client.on('reconnecting', () => {
      this._log('info', 'redis_cache_reconnecting', { host, port });
    });

    this.client.on('error', (err: Error) => {
      this._isReady = false;
      redisCacheConnectionStatus.set(0);
      this._log('error', 'redis_cache_error', {
        host,
        port,
        reason: err.message,
      });
    });

    this.client.on('close', () => {
      this._isReady = false;
      redisCacheConnectionStatus.set(0);
    });
  }

  /** Whether Redis is configured and the connection is currently healthy. */
  get isReady(): boolean {
    return this._isReady;
  }

  /** Whether REDIS_URL is set (client was configured, regardless of health). */
  get isConfigured(): boolean {
    return this.client !== null;
  }

  /** Underlying ioredis client – primarily for testing. */
  getClient(): Redis | null {
    return this.client;
  }

  // ─── Cache Operations ─────────────────────────────────────────────────────

  /**
   * Retrieve a cache entry by key.
   * Returns `null` when the key is absent, Redis is unavailable, or JSON
   * parsing fails.
   */
  async get(key: string): Promise<RedisCacheEntry | null> {
    if (!this._isReady || !this.client) {
      return null;
    }

    try {
      const raw = await this.client.get(this._prefixed(key));
      if (!raw) return null;
      const entry = JSON.parse(raw) as RedisCacheEntry;
      return entry;
    } catch (err) {
      redisCacheErrorCount.inc({ operation: 'get' });
      this._log('error', 'redis_cache_get_error', {
        key,
        reason: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Store a cache entry with an explicit TTL (in milliseconds).
   * Silently no-ops when Redis is unavailable.
   */
  async set(key: string, entry: RedisCacheEntry, ttlMs: number): Promise<void> {
    if (!this._isReady || !this.client) {
      return;
    }

    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    try {
      await this.client.setex(this._prefixed(key), ttlSeconds, JSON.stringify(entry));
    } catch (err) {
      redisCacheErrorCount.inc({ operation: 'set' });
      this._log('error', 'redis_cache_set_error', {
        key,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Delete a single cache key.
   */
  async del(key: string): Promise<void> {
    if (!this._isReady || !this.client) return;

    try {
      await this.client.del(this._prefixed(key));
    } catch (err) {
      redisCacheErrorCount.inc({ operation: 'del' });
      this._log('error', 'redis_cache_del_error', {
        key,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Delete all keys matching a glob pattern.
   * Uses SCAN to avoid blocking the server.
   *
   * @param pattern – Redis glob-style pattern applied AFTER the key prefix,
   *                  e.g. `"GET:/api/v1/vault*"` clears all vault cache keys.
   */
  async invalidatePattern(pattern: string): Promise<number> {
    if (!this._isReady || !this.client) return 0;

    const fullPattern = `${KEY_PREFIX}${pattern}`;
    let cursor = '0';
    let totalDeleted = 0;

    try {
      do {
        const [nextCursor, keys] = await this.client.scan(
          cursor,
          'MATCH',
          fullPattern,
          'COUNT',
          100,
        );
        cursor = nextCursor;

        if (keys.length > 0) {
          await this.client.del(...keys);
          totalDeleted += keys.length;
        }
      } while (cursor !== '0');
    } catch (err) {
      redisCacheErrorCount.inc({ operation: 'invalidate' });
      this._log('error', 'redis_cache_invalidate_error', {
        pattern,
        reason: err instanceof Error ? err.message : String(err),
      });
    }

    return totalDeleted;
  }

  /**
   * Ping the Redis server and return its response.
   * Used by the health check subsystem.
   */
  async ping(): Promise<string | null> {
    if (!this._isReady || !this.client) return null;

    try {
      return await this.client.ping();
    } catch {
      return null;
    }
  }

  /**
   * Ping the Redis server with a hard timeout.
   * Returns 'PONG' when Redis responds in time, otherwise null.
   * Used by the /ready health check to fail fast when Redis is unreachable.
   */
  async pingWithTimeout(timeoutMs: number): Promise<string | null> {
    if (!this.client) return null;

    let timer: NodeJS.Timeout | undefined;
    try {
      const pingPromise = this.client.ping();
      const timeoutPromise = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      });
      const result = await Promise.race([pingPromise, timeoutPromise]);
      return result;
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Gracefully close the Redis connection.
   * Called during graceful shutdown.
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.quit().catch(() => {
        /* ignore close errors */
      });
      this._isReady = false;
      redisCacheConnectionStatus.set(0);
    }
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private _prefixed(key: string): string {
    return `${KEY_PREFIX}${key}`;
  }

  private _log(
    level: 'info' | 'warn' | 'error',
    event: string,
    extra: Record<string, unknown>,
  ): void {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ level, event, ...extra }));
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const redisCacheClient = new RedisCacheClient();

// ─── High-level Cache Operations ─────────────────────────────────────────────

/**
 * Read a cache entry by key, consulting Redis first then falling back to the
 * in-memory LRU store.
 *
 * Returns `null` when neither source has a valid (non-expired) entry.
 */
export async function getFromCache(key: string): Promise<RedisCacheEntry | null> {
  // Try Redis first
  if (redisCacheClient.isReady) {
    const entry = await redisCacheClient.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      redisCacheHitCount.inc({ route: key });
      return entry;
    }
    if (entry) {
      // Stale entry – Redis should have expired it but hadn't yet; treat as miss
      redisCacheMissCount.inc({ route: key });
      return null;
    }
    redisCacheMissCount.inc({ route: key });
    return null;
  }

  // Fall back to in-memory LRU
  const lruEntry = responseCache.get(key);
  if (lruEntry && lruEntry.expiresAt > Date.now()) {
    return lruEntry as RedisCacheEntry;
  }

  return null;
}

/**
 * Write a cache entry, persisting to Redis (with TTL) and/or the in-memory
 * LRU store depending on availability.
 */
export async function setInCache(
  key: string,
  entry: RedisCacheEntry,
  ttlMs: number,
): Promise<void> {
  // Always update the in-memory LRU (cheap; serves as fallback and local read-through)
  responseCache.set(key, {
    ...entry,
    lastUsed: Date.now(),
  });

  // Persist to Redis when available
  if (redisCacheClient.isReady) {
    await redisCacheClient.set(key, entry, ttlMs);
  }
}

/**
 * Invalidate all cache entries whose keys match a pattern.
 * Clears both the Redis keyspace and the in-memory LRU simultaneously.
 *
 * The `pattern` uses:
 *   - Redis glob syntax for the Redis scan (e.g. `"GET:/api/v1/vault*"`)
 *   - JavaScript RegExp syntax for the in-memory LRU (same string, treated as
 *     a regex; simple glob patterns like `"GET:/api/v1/vault*"` are also valid
 *     regex with `.` treated as any char which is conservative but safe)
 */
export async function invalidateCachePattern(pattern: string): Promise<number> {
  let totalRemoved = 0;

  // Invalidate in Redis
  if (redisCacheClient.isReady) {
    totalRemoved += await redisCacheClient.invalidatePattern(pattern);
  }

  // Invalidate in-memory LRU using the existing helper
  const { invalidateCache } = await import('./middleware/cache');
  totalRemoved += invalidateCache(pattern);

  return totalRemoved;
}

/**
 * Health check for the Redis cache layer.
 * Returns 'up' when Redis is configured and responding to PING.
 * Returns 'degraded' when Redis is configured but unreachable (in-memory fallback active).
 * Returns 'up' when Redis is not configured (in-memory LRU is sole store — always available).
 */
export async function getRedisCacheHealth(): Promise<'up' | 'degraded'> {
  if (!redisCacheClient.isConfigured) {
    // No Redis configured; in-memory LRU is always healthy
    return 'up';
  }

  const pong = await redisCacheClient.ping();
  return pong === 'PONG' ? 'up' : 'degraded';
}

/**
 * Health check for the Redis cache layer, suitable for the /ready endpoint.
 *
 * Returns an object describing the Redis check:
 *   - When REDIS_URL is not configured: { status: 'up', optional: true }
 *   - When Redis responds to PING within the timeout: { status: 'up' }
 *   - When Redis is configured but unreachable / times out:
 *       { status: 'down' }
 *
 * The default timeout is 500ms per the /ready acceptance criteria.
 */
export async function getRedisReadyCheck(
  timeoutMs: number = 500,
): Promise<{ status: 'up' | 'down'; optional?: boolean }> {
  if (!redisCacheClient.isConfigured) {
    return { status: 'up', optional: true };
  }

  const pong = await redisCacheClient.pingWithTimeout(timeoutMs);
  return pong === 'PONG' ? { status: 'up' } : { status: 'down' };
}
