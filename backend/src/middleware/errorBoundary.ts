/**
 * @file errorBoundary.ts
 * Typed error boundary middleware for upstream dependency failures.
 *
 * Standardises mapping of Redis, Database, and Soroban RPC failures into
 * typed API errors with stable codes and retry hints.
 *
 * Issue #708
 */

import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { CircuitOpenError } from '../circuitBreaker';
import { SorobanSimulationError } from '../sorobanClient';
import { logger } from './structuredLogging';
import { getCurrentTraceId } from '../tracing';
import type { CorrelationIdRequest } from './correlationId';

// ─── Typed Upstream Error Classes ───────────────────────────────────────────

export class UpstreamError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly retryable: boolean;
  public readonly retryAfterSeconds: number | null;
  public readonly dependency: string;

  constructor(opts: {
    message: string;
    code: string;
    statusCode: number;
    retryable: boolean;
    retryAfterSeconds?: number | null;
    dependency: string;
  }) {
    super(opts.message);
    this.name = 'UpstreamError';
    this.code = opts.code;
    this.statusCode = opts.statusCode;
    this.retryable = opts.retryable;
    this.retryAfterSeconds = opts.retryAfterSeconds ?? null;
    this.dependency = opts.dependency;
  }
}

export class DatabaseError extends UpstreamError {
  constructor(message: string, opts?: { retryable?: boolean; retryAfterSeconds?: number }) {
    super({
      message,
      code: 'DATABASE_ERROR',
      statusCode: 503,
      retryable: opts?.retryable ?? true,
      retryAfterSeconds: opts?.retryAfterSeconds ?? 5,
      dependency: 'database',
    });
    this.name = 'DatabaseError';
  }
}

export class RedisError extends UpstreamError {
  constructor(message: string, opts?: { retryable?: boolean; retryAfterSeconds?: number }) {
    super({
      message,
      code: 'CACHE_ERROR',
      statusCode: 503,
      retryable: opts?.retryable ?? true,
      retryAfterSeconds: opts?.retryAfterSeconds ?? 3,
      dependency: 'redis',
    });
    this.name = 'RedisError';
  }
}

export class RpcError extends UpstreamError {
  constructor(message: string, opts?: { retryable?: boolean; retryAfterSeconds?: number }) {
    super({
      message,
      code: 'RPC_ERROR',
      statusCode: 502,
      retryable: opts?.retryable ?? true,
      retryAfterSeconds: opts?.retryAfterSeconds ?? 10,
      dependency: 'stellar_rpc',
    });
    this.name = 'RpcError';
  }
}

// ─── Error Response Shape ───────────────────────────────────────────────────

interface TypedErrorResponse {
  error: string;
  status: number;
  code: string;
  message: string;
  dependency?: string;
  retryable: boolean;
  retryAfterSeconds?: number | null;
  correlationId?: string;
  traceId?: string;
}

// ─── Classifier ─────────────────────────────────────────────────────────────

function classifyError(err: unknown): TypedErrorResponse | null {
  if (!err || typeof err !== 'object') return null;

  // Already a typed upstream error
  if (err instanceof UpstreamError) {
    return {
      error: err.name,
      status: err.statusCode,
      code: err.code,
      message: err.message,
      dependency: err.dependency,
      retryable: err.retryable,
      retryAfterSeconds: err.retryAfterSeconds,
    };
  }

  // Circuit breaker open
  if (err instanceof CircuitOpenError) {
    const retryAfterSec = Math.ceil(err.retryAfterMs / 1000);
    return {
      error: 'CircuitOpenError',
      status: 503,
      code: 'CIRCUIT_OPEN',
      message: 'Soroban RPC circuit breaker is open. The service is temporarily unavailable.',
      dependency: 'stellar_rpc',
      retryable: true,
      retryAfterSeconds: retryAfterSec,
    };
  }

  // Soroban simulation / submission errors
  if (err instanceof SorobanSimulationError) {
    const retryable = ['RESTORE_REQUIRED', 'RPC_ERROR'].includes(err.code);
    return {
      error: 'SorobanError',
      status: err.statusCode,
      code: err.code,
      message: err.message,
      dependency: 'stellar_rpc',
      retryable,
      retryAfterSeconds: retryable ? 15 : null,
    };
  }

  // Known Prisma request errors: map to client-safe responses. Never expose
  // err.meta, the raw message, or SQL fragments.
  const prismaKnown = classifyPrismaKnownRequestError(err);
  if (prismaKnown) return prismaKnown;

  // Prisma / database errors (detect by error code patterns)
  if (isPrismaError(err)) {
    return {
      error: 'DatabaseError',
      status: 503,
      code: 'DATABASE_ERROR',
      message: 'A database operation failed. Please retry shortly.',
      dependency: 'database',
      retryable: true,
      retryAfterSeconds: 5,
    };
  }

  const errMessage = 'message' in err && typeof (err as { message?: unknown }).message === 'string'
    ? (err as { message: string }).message
    : '';

  // Prisma query timeout
  if (errMessage.includes('Prisma query timed out')) {
    return {
      error: 'DatabaseError',
      status: 503,
      code: 'DATABASE_TIMEOUT',
      message: 'Database query timed out. Please retry with a smaller result set.',
      dependency: 'database',
      retryable: true,
      retryAfterSeconds: 5,
    };
  }

  // Redis / cache errors (detect by common error messages)
  if (isRedisError(err)) {
    return {
      error: 'CacheError',
      status: 503,
      code: 'CACHE_ERROR',
      message: 'Cache service is temporarily unavailable.',
      dependency: 'redis',
      retryable: true,
      retryAfterSeconds: 3,
    };
  }

  // Wallet scope violation from walletQueryGuard
  if (errMessage === 'FORBIDDEN_TENANT_ACCESS' || errMessage === 'WALLET_SCOPE_VIOLATION') {
    return {
      error: 'Forbidden',
      status: 403,
      code: 'WALLET_SCOPE_VIOLATION',
      message: 'You can only access your own wallet data.',
      retryable: false,
    };
  }

  return null;
}

function classifyPrismaKnownRequestError(err: unknown): TypedErrorResponse | null {
  if (!err || typeof err !== 'object') return null;
  const name = (err as { constructor?: { name?: string } }).constructor?.name;
  if (name !== 'PrismaClientKnownRequestError') return null;

  switch ((err as { code?: unknown }).code) {
    case 'P2002':
      return {
        error: 'ConflictError',
        status: 409,
        code: 'CONFLICT',
        message: 'Resource already exists',
        retryable: false,
      };
    case 'P2003':
      return {
        error: 'InvalidReferenceError',
        status: 400,
        code: 'INVALID_REFERENCE',
        message: 'Referenced resource does not exist',
        retryable: false,
      };
    case 'P2025':
      return {
        error: 'NotFoundError',
        status: 404,
        code: 'NOT_FOUND',
        message: 'Resource not found',
        retryable: false,
      };
    default:
      return null;
  }
}

function isPrismaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { constructor?: { name?: string } }).constructor?.name ?? '';
  if (name.startsWith('Prisma')) return true;
  if ('code' in err && typeof (err as { code?: unknown }).code === 'string') {
    const code = (err as { code: string }).code;
    // Prisma error codes start with P
    if (/^P\d{4}$/.test(code)) return true;
  }
  return false;
}

function isRedisError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const msg = 'message' in err && typeof (err as { message?: unknown }).message === 'string'
    ? (err as { message: string }).message.toLowerCase()
    : '';
  const name = (err as { constructor?: { name?: string } }).constructor?.name ?? '';
  return (
    msg.includes('redis') ||
    (msg.includes('econnrefused') && msg.includes('6379')) ||
    name === 'ReplyError' ||
    name === 'AbortError'
  );
}

// ─── Middleware ──────────────────────────────────────────────────────────────

/**
 * Error boundary middleware that catches upstream dependency failures and
 * returns typed JSON responses with stable error codes and retry hints.
 *
 * Mount BEFORE the catch-all error handler so it gets first crack at errors.
 */
export const errorBoundaryMiddleware: ErrorRequestHandler = (
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const classified = classifyError(err);

  if (!classified) {
    // Not an upstream dependency error — pass to default error handler
    next(err);
    return;
  }

  const correlationId = (req as CorrelationIdRequest).correlationId;
  const traceId = getCurrentTraceId();

  logger.log('warn', `Upstream dependency failure: ${classified.code}`, {
    code: classified.code,
    dependency: classified.dependency,
    statusCode: classified.status,
    retryable: classified.retryable,
    correlationId,
    traceId,
    originalError: err instanceof Error ? err.message : String(err),
  });

  const body: TypedErrorResponse = {
    ...classified,
    correlationId,
    traceId,
  };

  if (classified.retryAfterSeconds && classified.retryAfterSeconds > 0) {
    res.setHeader('Retry-After', String(classified.retryAfterSeconds));
  }

  res.status(classified.status).json(body);
};
