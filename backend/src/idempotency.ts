/**
 * @file idempotency.ts
 * Idempotency support for mutation endpoints to prevent duplicate state changes.
 *
 * Implements idempotency key tracking for critical mutation endpoints (deposits,
 * withdrawals, transfers). Ensures that retried requests produce the same result
 * without creating duplicate side effects.
 *
 * Acceptance Criteria:
 *   ✓ Accept idempotency keys for critical mutation endpoints
 *   ✓ Reject or reuse repeated submissions safely
 *   ✓ Track pending and completed keys with expiry
 *   ✓ Document API expectations for clients
 *
 * Usage:
 *   POST /v1/vault/deposit
 *   Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
 *   {
 *     "amount": "1000.00",
 *     "walletAddress": "G..."
 *   }
 */

import crypto from 'crypto';
import NodeCache from 'node-cache';
import { prisma } from './prisma';
import { redisClientManager } from './rateLimiter';
import { logger } from './middleware/structuredLogging';
import type { Request, Response, NextFunction } from 'express';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface IdempotencyRecord {
  keyId: string;
  status: 'pending' | 'completed' | 'failed';
  requestHash: string;
  responseHash?: string;
  responseBody?: unknown;
  statusCode?: number;
  createdAt: Date;
  completedAt?: Date;
  expiresAt: Date;
  tenantId: string;
  walletAddress?: string;
  operation: string;
}

export interface IdempotencyKeyMetadata {
  keyId: string;
  keyFormat: 'uuid' | 'nonce' | 'custom';
  maxAge: number;
  hint?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default idempotency key TTL: 24 hours */
export const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Minimum idempotency key length to prevent brute-force */
export const MIN_KEY_LENGTH = 16;

/** Maximum idempotency key length */
export const MAX_KEY_LENGTH = 256;

/** Endpoints that require idempotency support */
export const IDEMPOTENT_ENDPOINTS = [
  'POST /v1/vault/deposit',
  'POST /v1/vault/withdrawal',
  'POST /v1/transfers/initiate',
  'POST /admin/webhooks',
  'POST /admin/allowlist/add',
  'DELETE /admin/allowlist/remove',
] as const;

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Validates the format of an idempotency key.
 * Accepts UUID v4, custom nonces, or other deterministic values.
 */
export function validateIdempotencyKey(key: string): boolean {
  if (!key || typeof key !== 'string') return false;
  if (key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH) return false;

  // Allow UUID v4 format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(key)) return true;

  // Allow hex-encoded nonces
  const hexRegex = /^[0-9a-f]{32,}$/i;
  if (hexRegex.test(key)) return true;

  // Allow alphanumeric with dashes/underscores
  const customRegex = /^[a-z0-9_-]{16,}$/i;
  return customRegex.test(key);
}

/**
 * Generates a deterministic hash of the request body for duplicate detection.
 * Ensures the same request body always produces the same hash.
 */
export function hashRequestBody(body: unknown): string {
  const normalized = typeof body === 'object' ? JSON.stringify(body) : String(body);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Generates a deterministic hash of the response for caching.
 */
export function hashResponseBody(body: unknown): string {
  const normalized = JSON.stringify(body);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

// ─── Core Idempotency Logic ─────────────────────────────────────────────────

/**
 * Retrieves an existing idempotency record if present.
 */
export async function getIdempotencyRecord(
  keyId: string,
  tenantId: string
): Promise<IdempotencyRecord | null> {
  const record = await prisma.idempotencyKey.findFirst({
    where: {
      keyId,
      tenantId,
      expiresAt: { gt: new Date() }, // Not expired
    },
  });

  if (!record) return null;

  return {
    keyId: record.keyId,
    status: record.status as 'pending' | 'completed' | 'failed',
    requestHash: record.requestHash,
    responseHash: record.responseHash || undefined,
    responseBody: record.responseBody ? JSON.parse(record.responseBody) : undefined,
    statusCode: record.statusCode || undefined,
    createdAt: record.createdAt,
    completedAt: record.completedAt || undefined,
    expiresAt: record.expiresAt,
    tenantId: record.tenantId,
    walletAddress: record.walletAddress || undefined,
    operation: record.operation,
  };
}

/**
 * Creates a new idempotency record.
 */
export async function createIdempotencyRecord(
  keyId: string,
  tenantId: string,
  walletAddress: string | undefined,
  operation: string,
  requestBody: unknown,
  ttlMs = DEFAULT_IDEMPOTENCY_TTL_MS
): Promise<IdempotencyRecord> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  const requestHash = hashRequestBody(requestBody);

  const record = await prisma.idempotencyKey.create({
    data: {
      keyId,
      tenantId,
      walletAddress,
      operation,
      status: 'pending',
      requestHash,
      createdAt: now,
      expiresAt,
    },
  });

  return {
    keyId: record.keyId,
    status: 'pending',
    requestHash,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    tenantId: record.tenantId,
    walletAddress: record.walletAddress || undefined,
    operation: record.operation,
  };
}

/**
 * Marks an idempotency record as completed with the response.
 */
export async function completeIdempotencyRecord(
  keyId: string,
  tenantId: string,
  statusCode: number,
  responseBody: unknown
): Promise<IdempotencyRecord> {
  const now = new Date();
  const responseHash = hashResponseBody(responseBody);

  const updated = await prisma.idempotencyKey.updateMany({
    where: {
      keyId,
      tenantId,
      status: 'pending',
    },
    data: {
      status: 'completed',
      statusCode,
      responseBody: JSON.stringify(responseBody),
      responseHash,
      completedAt: now,
    },
  });

  if (updated.count === 0) {
    throw new Error(`Idempotency key not found or not in pending state: ${keyId}`);
  }

  const record = await getIdempotencyRecord(keyId, tenantId);
  if (!record) {
    throw new Error(`Failed to retrieve completed idempotency record: ${keyId}`);
  }

  return record;
}

/**
 * Marks an idempotency record as failed.
 */
export async function failIdempotencyRecord(
  keyId: string,
  tenantId: string,
  statusCode: number,
  errorBody: unknown
): Promise<IdempotencyRecord> {
  const now = new Date();

  const updated = await prisma.idempotencyKey.updateMany({
    where: {
      keyId,
      tenantId,
      status: 'pending',
    },
    data: {
      status: 'failed',
      statusCode,
      responseBody: JSON.stringify(errorBody),
      completedAt: now,
    },
  });

  if (updated.count === 0) {
    throw new Error(`Idempotency key not found or not in pending state: ${keyId}`);
  }

  const record = await getIdempotencyRecord(keyId, tenantId);
  if (!record) {
    throw new Error(`Failed to retrieve failed idempotency record: ${keyId}`);
  }

  return record;
}

// ─── Middleware ─────────────────────────────────────────────────────────────

/**
 * Middleware to enforce idempotency for mutation endpoints.
 * Checks for Idempotency-Key header and prevents duplicate submissions.
 *
 * Usage:
 *   router.post('/vault/deposit', enforceIdempotency(), handler)
 *
 * Returns:
 *   - 400 if Idempotency-Key is missing or invalid
 *   - 409 if request is different from pending submission
 *   - Same response if resubmitting identical request
 */
export function enforceIdempotency(options: { optional?: boolean } = {}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const idempotencyKey = req.get('Idempotency-Key');

    if (!idempotencyKey) {
      if (options.optional) {
        // Generate server-side key if not provided and optional
        req.idempotencyKey = crypto.randomBytes(16).toString('hex');
        next();
        return;
      }

      res.status(400).json({
        error: 'Bad Request',
        message:
          'Idempotency-Key header is required for mutation operations. ' +
          'Provide a unique UUID or nonce to prevent duplicate submissions.',
        code: 'MISSING_IDEMPOTENCY_KEY',
        documentation: 'https://docs.yieldvault.com/api/idempotency',
      });
      return;
    }

    if (!validateIdempotencyKey(idempotencyKey)) {
      res.status(400).json({
        error: 'Bad Request',
        message:
          `Invalid Idempotency-Key format. ` +
          `Minimum length: ${MIN_KEY_LENGTH} chars, maximum: ${MAX_KEY_LENGTH} chars. ` +
          `Use UUID v4, hex nonce, or alphanumeric identifier.`,
        code: 'INVALID_IDEMPOTENCY_KEY_FORMAT',
      });
      return;
    }

    req.idempotencyKey = idempotencyKey;

    // Check for existing idempotency record
    const existingRecord = await getIdempotencyRecord(
      idempotencyKey,
      req.tenantId || ''
    ).catch(() => null);

    if (existingRecord) {
      const requestHash = hashRequestBody(req.body);

      // Same request being retried - return cached response
      if (existingRecord.requestHash === requestHash) {
        if (existingRecord.status === 'completed') {
          res.status(existingRecord.statusCode || 200).json(existingRecord.responseBody);
          return;
        }

        if (existingRecord.status === 'failed') {
          res.status(existingRecord.statusCode || 500).json(existingRecord.responseBody);
          return;
        }

        // Still pending - return 409 Conflict
        res.status(409).json({
          error: 'Conflict',
          message: 'Request is still being processed. Please wait or retry with a new Idempotency-Key.',
          code: 'IDEMPOTENCY_PENDING',
          retryAfter: 30,
        });
        return;
      }

      // Different request with same key - reject
      logger.log('warn', 'Idempotency key collision detected', {
        action: 'idempotency_collision',
        keyId: idempotencyKey,
        tenantId: req.tenantId,
      });

      res.status(409).json({
        error: 'Conflict',
        message:
          'Idempotency key has already been used for a different request. ' +
          'Use a new Idempotency-Key for this submission.',
        code: 'IDEMPOTENCY_KEY_COLLISION',
      });
      return;
    }

    next();
  };
}

/**
 * Express Request extension for idempotency support.
 */
declare global {
  namespace Express {
    interface Request {
      idempotencyKey?: string;
    }
  }
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

/**
 * Periodic cleanup task to remove expired idempotency records.
 * Should be scheduled to run regularly (e.g., hourly or daily).
 */
export async function cleanupExpiredIdempotencyKeys(): Promise<number> {
  const now = new Date();

  const result = await prisma.idempotencyKey.deleteMany({
    where: {
      expiresAt: { lt: now },
    },
  });

  if (result.count > 0) {
    logger.log('info', 'Cleaned up expired idempotency keys', {
      action: 'idempotency_cleanup',
      deletedCount: result.count,
    });
  }

  return result.count;
}

/**
 * Starts a periodic cleanup task for expired idempotency keys.
 */
export function startIdempotencyCleanupTask(intervalMs = 3600000): NodeJS.Timer {
  logger.log('info', 'Starting idempotency cleanup task', {
    action: 'idempotency_cleanup_start',
    intervalMs,
  });

  return setInterval(() => {
    cleanupExpiredIdempotencyKeys().catch((error) => {
      logger.log('error', 'Idempotency cleanup failed', {
        action: 'idempotency_cleanup_error',
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, intervalMs);
}

// ─── Response Store (Redis + NodeCache) ─────────────────────────────────────
//
// Shared response store used by vault endpoints and the transfer orchestrator.
// Completed responses are persisted to Redis (when available) with a NodeCache
// in-process fallback. Retention sweeps live in idempotencyRetention.ts.

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface IdempotentOperationResult<T> {
  statusCode: number;
  body: T;
}

/** Metadata attached to every idempotency key entry. */
export interface IdempotencyStoreKeyMetadata {
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
  metadata: IdempotencyStoreKeyMetadata;
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
  metadata: IdempotencyStoreKeyMetadata;
}

interface PendingOperation<T> {
  fingerprint: string;
  promise: Promise<StoredResponse<T>>;
  metadata: IdempotencyStoreKeyMetadata;
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
    const metadata: IdempotencyStoreKeyMetadata = { createdAt: now, lastAccessedAt: now, replayCount: 0, status: 'pending' };

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

  /**
   * Removes entries older than `retentionMs` from the local cache and Redis.
   * With `dryRun`, only counts the entries that would be removed: nothing is
   * deleted and the eviction counter is left untouched (Issue #1375).
   */

  async pruneStaleKeys(
    retentionMs: number,
    dryRun = false,
  ): Promise<{ pruned: number; localPruned: number; redisPruned: number; dryRun: boolean }> {
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

    return { pruned: localPruned + redisPruned, localPruned, redisPruned, dryRun };
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

