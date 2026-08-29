import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { CorrelationIdRequest } from '../middleware/correlationId';
import { logger } from '../middleware/structuredLogging';
import { getCurrentTraceId } from '../tracing';
import { httpErrorCount } from '../metrics';

/**
 * Base class for all application errors.
 *
 * Every error the API can raise carries an HTTP `statusCode`, a stable machine
 * readable `code` (used by clients and the standard error envelope), and an
 * operational flag. Operational errors are expected, recoverable conditions
 * (validation, auth, not found); non-operational errors are unexpected bugs
 * that should never be leaked verbatim to clients.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    isOperational = true,
    details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    this.details = details;
    // Restore the prototype chain (TS targeting ES5/ES2015 + extending Error).
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Returns a copy of this error with `details` attached (for error context). */
  withDetails(details: unknown): this {
    const copy = new (this.constructor as new (...args: unknown[]) => this)(
      this.message,
      this.statusCode,
      this.code,
      this.isOperational,
      details,
    );
    return copy;
  }
}

/** 400 — request body/params failed validation. */
export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', true, details);
  }
}

/** 401 — missing or invalid authentication. */
export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHENTICATED', true);
  }
}

/** 403 — authenticated but not permitted. */
export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(message, 403, 'FORBIDDEN', true);
  }
}

/** 404 — resource not found. */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND', true);
  }
}

/** 409 — conflict with current state (e.g. duplicate, stale version). */
export class ConflictError extends AppError {
  constructor(message = 'Conflict with current state') {
    super(message, 409, 'CONFLICT', true);
  }
}

/** 429 — rate limited. */
export class RateLimitError extends AppError {
  constructor(message = 'Too many requests, please try again later') {
    super(message, 429, 'RATE_LIMITED', true);
  }
}

/** 500 — unexpected internal failure. */
export class InternalError extends AppError {
  constructor(message = 'Internal server error') {
    super(message, 500, 'INTERNAL_ERROR', false);
  }
}

/** 503 — dependency (db, rpc, cache) unavailable. */
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super(message, 503, 'SERVICE_UNAVAILABLE', true);
  }
}

/** 451 — request blocked by geofencing / legal restrictions. */
export class GeolocationBlockedError extends AppError {
  constructor(message = 'Unavailable For Legal Reasons') {
    super(message, 451, 'GEO_BLOCKED', true);
  }
}

/** User-friendly messages for known error codes, used as a safe fallback. */
const USER_FRIENDLY_MESSAGES: Record<string, string> = {
  VALIDATION_ERROR: 'Some of the information you provided is invalid. Please check and try again.',
  UNAUTHENTICATED: 'Please sign in to continue.',
  FORBIDDEN: 'You do not have access to this action.',
  NOT_FOUND: 'We could not find what you were looking for.',
  CONFLICT: 'This action conflicts with the current state. Please refresh and try again.',
  RATE_LIMITED: 'You are doing that too often. Please wait a moment and try again.',
  INTERNAL_ERROR: 'Something went wrong on our side. Our team has been notified.',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable. Please try again shortly.',
};

/**
 * Normalises an arbitrary thrown value into an {@link AppError}.
 *
 * Known `AppError` instances pass through untouched. Well-known infrastructure
 * errors (Prisma, JWT) are mapped to the closest operational equivalent so the
 * client receives a consistent, safe response and we never leak raw DB/stack
 * internals.
 */
export function classifyError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    const name = error.name;
    const message = error.message.toLowerCase();

    if (name === 'PrismaClientKnownRequestError' || name === 'PrismaClientValidationError') {
      if (message.includes('unique constraint') || message.includes('unique violation')) {
        return new ConflictError('A record with this value already exists.');
      }
      return new ValidationError('The request could not be processed due to invalid data.');
    }

    if (
      name === 'PrismaClientInitializationError' ||
      name === 'PrismaClientRustPanicError'
    ) {
      return new ServiceUnavailableError('The database is currently unavailable.');
    }

    if (name === 'JsonWebTokenError' || name === 'TokenExpiredError' || name === 'NotBeforeError') {
      return new AuthenticationError('Your session is invalid or has expired. Please sign in again.');
    }

    if (name === 'ZodError' || message.includes('validation')) {
      return new ValidationError('Validation failed.');
    }

    if (message.includes('timeout') || message.includes('etimedout')) {
      return new ServiceUnavailableError('An upstream service timed out.');
    }

    if (message.includes('econnrefused') || message.includes('enotfound')) {
      return new ServiceUnavailableError('A required dependency could not be reached.');
    }
  }

  return new InternalError();
}

/**
 * Standard error envelope returned to clients. Keeps the shape identical for
 * every failure so integrators can parse errors uniformly.
 *
 * The envelope nests a machine-readable `error` object (with `code`, `message`,
 * `correlationId`) for new clients, while also keeping `status` and `message`
 * at the top level so legacy clients that read `res.body.error` / `res.body.message`
 * continue to work.
 */
export interface ErrorEnvelope {
  status: number;
  message: string;
  error: {
    code: string;
    message: string;
    correlationId?: string;
    details?: unknown;
  };
}

function buildEnvelope(error: AppError, correlationId: string | undefined): ErrorEnvelope {
  const message = error.isOperational
    ? error.message
    : USER_FRIENDLY_MESSAGES[error.code] ?? 'An unexpected error occurred.';

  return {
    status: error.statusCode,
    message,
    error: {
      code: error.code,
      message,
      ...(correlationId ? { correlationId } : {}),
      ...(error.details !== undefined ? { details: error.details } : {}),
    },
  };
}

/**
 * Centralised Express error-handling middleware.
 *
 * Responsibilities:
 *  - normalise any thrown value via {@link classifyError}
 *  - log the failure with correlation id + trace id and error classification
 *  - increment the 5xx alert metric for critical errors
 *  - respond with the standard {@link ErrorEnvelope}
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next): void => {
  const appError = classifyError(err);
  const correlationId = (req as CorrelationIdRequest).correlationId;
  const traceId = getCurrentTraceId();

  logger.log('error', 'Request failed', {
    correlationId,
    traceId,
    code: appError.code,
    statusCode: appError.statusCode,
    message: appError.message,
    operational: appError.isOperational,
    stack: process.env.NODE_ENV === 'development' ? (err as Error)?.stack : undefined,
  });

  if (appError.statusCode >= 500) {
    httpErrorCount.inc({
      method: req.method,
      route: req.route ? req.route.path : req.path,
      status_code: appError.statusCode,
    });
  }

  const envelope = buildEnvelope(appError, correlationId);
  res.status(appError.statusCode).json(envelope);
};

/**
 * Express 404 handler that emits the same standard envelope as {@link errorHandler}.
 */
export const notFoundHandler: RequestHandler = (req, res): void => {
  const correlationId = (req as CorrelationIdRequest).correlationId;
  const envelope = buildEnvelope(new NotFoundError(), correlationId);
  res.status(envelope.status).json(envelope);
};

export { buildEnvelope };
