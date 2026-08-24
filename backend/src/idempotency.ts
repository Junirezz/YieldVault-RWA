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
import { prisma } from './prisma';
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
