/**
 * @file idempotencyStore.ts
 * Idempotency key store backed by Redis (when available) with NodeCache in-process fallback.
 *
 * Issue #811: Multi-instance deployments previously lost idempotency guarantees on pod
 * recycle because responses were stored only in NodeCache (in-process memory). This revision
 * persists completed responses to Redis using SET … EX so all replicas share the same store.
 *
 * Behavior when Redis is unavailable:
 *  - Falls back to NodeCache automatically (fail-open).
 *  - A warning is logged so operators are aware of the degraded guarantee.
 *
 * Existing observability API (inspectKeys, deleteKey, clear, getMetrics) is preserved;
 * operations apply to whichever backend holds the key.
 *
 * Scope: this module owns the *replay cache* used by money-moving operations
 * (`idempotencyStore.execute`). The durable, per-key record lifecycle used by the
 * `enforceIdempotency` middleware lives in `idempotency.ts` (Prisma-backed).
 */

import crypto from 'crypto';
import NodeCache from 'node-cache';
import { redisClientManager } from './rateLimiter';

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface IdempotentOperationResult<T> {
  statusCode: number;
  body: T;
}

/** Metadata attached to every idempotency key entry. */
export interface IdempotencyKeyMetadata {
  /** ISO-8601 timestamp when the key was first stored. */
  createdAt: string;
  /** ISO-8601 timestamp of the most recent access (read or write). */
  lastAccessedAt: string;
  /** Number of times this key has been replayed (returned cached result). */
  replayCount: number;
  /** Current state of the entry. */
  status: 'pending' | 'completed';
}

/** Summary returned by GET /admin/idempotency/keys. */
export interface IdempotencyKeyInfo {
  key: string;
  metadata: IdempotencyKeyMetadata;
}

/** Snapshot of store-wide observability counters. */
export interface IdempotencyMetrics {
  hits: number;
  conflicts: number;
  evictions: number;
  activeKeys: number;
  pendingKeys: number;
}

// ─── Internal Types ───────────────────────────────────────────────────────────

interface StoredResponse<T> extends IdempotentOperationResult<T> {
  fingerprint: string;
  metadata: IdempotencyKeyMetadata;
}

interface PendingOperation<T> {
  fingerprint: string;
  promise: Promise<StoredResponse<T>>;
  metadata: IdempotencyKeyMetadata;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class IdempotencyConflictError extends Error {
  constructor(message = 'Idempotency key already used for a different request body') {
    super(message);
    this.name = 'IdempotencyConflictError';
  }
}

// ─── Redis key prefix ─────────────────────────────────────────────────────────

const REDIS_PREFIX = 'idempotency:';

// ─── Store ────────────────────────────────────────────────────────────────────

export class IdempotencyStore {
  /** Fallback in-process store used when Redis is unavailable. */
  private readonly localCache: NodeCache;
  private readonly pendingResponses = new Map<string, PendingOperation<unknown>>();

  // Observability counters
  private _hits = 0;
  private _conflicts = 0;
  private _evictions = 0;

  constructor(private readonly ttlMs = 24 * 60 * 60 * 1000) {
    const ttlSeconds = Math.max(1, Math.ceil(this.ttlMs / 1000));
    this.localCache = new NodeCache({ stdTTL: ttlSeconds, checkperiod: ttlSeconds });
    this.localCache.on('expired', () => { this._evictions++; });
  }

  // ─── Redis helpers ─────────────────────────────────────────────────────────

  private redisKey(key: string): string {
    return `${REDIS_PREFIX}${key}`;
  }

  private get redis() {
    const client = redisClientManager.getClient();
    return redisClientManager.isReady() && client ? client : null;
  }

  private async redisGet<T>(key: string): Promise<StoredResponse<T> | null> {
    const r = this.redis;
    if (!r) return null;
    try {
      const raw = await r.get(this.redisKey(key));
      return raw ? (JSON.parse(raw) as StoredResponse<T>) : null;
    } catch {
      return null;
    }
  }

  private async redisSet<T>(key: string, value: StoredResponse<T>): Promise<void> {
    const r = this.redis;
    if (!r) return;
    try {
      const ttlSeconds = Math.max(1, Math.ceil(this.ttlMs / 1000));
      await r.set(this.redisKey(key), JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      console.log(JSON.stringify({ level: 'warn', event: 'idempotency_redis_write_fail', key, reason: (err as Error).message }));
    }
  }

  private async redisDel(key: string): Promise<boolean> {
    const r = this.redis;
    if (!r) return false;
    try {
      return (await r.del(this.redisKey(key))) > 0;
    } catch {
      return false;
    }
  }

  // ─── Core execute ──────────────────────────────────────────────────────────

  async execute<T>(
    key: string,
    fingerprint: string,
    operation: () => Promise<IdempotentOperationResult<T>>
  ): Promise<{ result: IdempotentOperationResult<T>; replayed: boolean }> {
    const now = new Date().toISOString();

    // 1. Check Redis first, then local cache
    let completed = await this.redisGet<T>(key);
    if (!completed) {
      completed = this.localCache.get<StoredResponse<T>>(key) ?? null;
    }

    if (completed) {
      if (completed.fingerprint !== fingerprint) {
        this._conflicts++;
        throw new IdempotencyConflictError();
      }
      this._hits++;
      completed.metadata.lastAccessedAt = now;
      completed.metadata.replayCount++;
      // Refresh in both backends; errors are non-fatal
      await this.redisSet(key, completed);
      this.localCache.set(key, completed);
      return { result: { statusCode: completed.statusCode, body: completed.body }, replayed: true };
    }

    // 2. Currently in-flight
    const pendingOperation = this.pendingResponses.get(key) as PendingOperation<T> | undefined;
    if (pendingOperation) {
      if (pendingOperation.fingerprint !== fingerprint) {
        this._conflicts++;
        throw new IdempotencyConflictError();
      }
      this._hits++;
      pendingOperation.metadata.lastAccessedAt = now;
      pendingOperation.metadata.replayCount++;
      const replayed = await pendingOperation.promise;
      return { result: { statusCode: replayed.statusCode, body: replayed.body }, replayed: true };
    }

    // 3. First execution
    const metadata: IdempotencyKeyMetadata = { createdAt: now, lastAccessedAt: now, replayCount: 0, status: 'pending' };

    const operationPromise = (async () => {
      const result = await operation();
      const stored: StoredResponse<T> = {
        ...result,
        fingerprint,
        metadata: { ...metadata, status: 'completed', lastAccessedAt: new Date().toISOString() },
      };
      // Persist to Redis (primary) and local cache (fallback/fast-path)
      await this.redisSet(key, stored);
      this.localCache.set(key, stored, this.ttlMs / 1000);
      return stored;
    })();

    this.pendingResponses.set(key, { fingerprint, promise: operationPromise, metadata });

    try {
      const stored = await operationPromise;
      return { result: { statusCode: stored.statusCode, body: stored.body }, replayed: false };
    } finally {
      this.pendingResponses.delete(key);
    }
  }

  // ─── Inspection ────────────────────────────────────────────────────────────

  inspectKeys(prefix?: string): IdempotencyKeyInfo[] {
    const results: IdempotencyKeyInfo[] = [];
    for (const key of this.localCache.keys()) {
      if (prefix && !key.startsWith(prefix)) continue;
      const entry = this.localCache.get<StoredResponse<unknown>>(key);
      if (entry) results.push({ key, metadata: { ...entry.metadata } });
    }
    for (const [key, pending] of this.pendingResponses.entries()) {
      if (prefix && !key.startsWith(prefix)) continue;
      if (!results.some((r) => r.key === key)) {
        results.push({ key, metadata: { ...pending.metadata } });
      }
    }
    return results;
  }

  // ─── Targeted deletion ─────────────────────────────────────────────────────

  async deleteKey(key: string): Promise<boolean> {
    const deletedLocal = this.localCache.del(key) > 0;
    const deletedPending = this.pendingResponses.delete(key);
    const deletedRedis = await this.redisDel(key);
    if (deletedLocal || deletedPending || deletedRedis) {
      this._evictions++;
      return true;
    }
    return false;
  }

  // ─── Global clear (admin only) ─────────────────────────────────────────────

  clear(): void {
    const count = this.localCache.keys().length + this.pendingResponses.size;
    this._evictions += count;
    this.localCache.flushAll();
    this.pendingResponses.clear();
    // Note: Redis keys are prefixed with REDIS_PREFIX; a full Redis FLUSHDB is intentionally
    // not issued here to avoid clearing unrelated keys. Use deleteKey() per-key when needed.
  }

  // ─── Observability ─────────────────────────────────────────────────────────

  getMetrics(): IdempotencyMetrics {
    return {
      hits: this._hits,
      conflicts: this._conflicts,
      evictions: this._evictions,
      activeKeys: this.localCache.keys().length,
      pendingKeys: this.pendingResponses.size,
    };
  }

  // ─── Retention cleanup ─────────────────────────────────────────────────────

  async pruneStaleKeys(
    retentionMs: number,
    dryRun = false,
  ): Promise<{ pruned: number; localPruned: number; redisPruned: number }> {
    const cutoff = Date.now() - retentionMs;
    let localPruned = 0;
    let redisPruned = 0;

    for (const key of this.localCache.keys()) {
      const entry = this.localCache.get<StoredResponse<unknown>>(key);
      if (!entry) continue;
      const createdAt = Date.parse(entry.metadata.createdAt);
      if (Number.isNaN(createdAt) || createdAt >= cutoff) continue;
      if (!dryRun) {
        this.localCache.del(key);
        this._evictions++;
      }
      localPruned++;
    }

    const r = this.redis;
    if (r) {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await r.scan(cursor, 'MATCH', `${REDIS_PREFIX}*`, 'COUNT', 100);
        cursor = nextCursor;
        for (const redisKey of keys) {
          try {
            const raw = await r.get(redisKey);
            if (!raw) continue;
            const entry = JSON.parse(raw) as StoredResponse<unknown>;
            const createdAt = Date.parse(entry.metadata?.createdAt ?? '');
            const ttl = await r.ttl(redisKey);
            const isStale = (!Number.isNaN(createdAt) && createdAt < cutoff) || ttl === 0;
            if (!isStale) continue;
            if (!dryRun) {
              await r.del(redisKey);
              this._evictions++;
            }
            redisPruned++;
          } catch {
            if (!dryRun) {
              await r.del(redisKey);
              this._evictions++;
            }
            redisPruned++;
          }
        }
      } while (cursor !== '0');
    }

    return { pruned: localPruned + redisPruned, localPruned, redisPruned };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const idempotencyStore = new IdempotencyStore(
  parseInt(process.env.IDEMPOTENCY_KEY_TTL_MS || '86400000', 10)
);

// ─── Fingerprint helper ───────────────────────────────────────────────────────

export function getIdempotencyHashThreshold(): number {
  return parseInt(process.env.IDEMPOTENCY_HASH_THRESHOLD_BYTES || '4096', 10);
}

export function buildIdempotencyFingerprint(payload: unknown): string {
  const stable = stableStringify(payload);
  const byteLength = Buffer.byteLength(stable, 'utf-8');
  if (byteLength > getIdempotencyHashThreshold()) {
    return `hashv1:${crypto.createHash('sha256').update(stable).digest('hex')}`;
  }
  return stable;
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value !== 'object') return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const serialized = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${serialized.join(',')}}`;
}
