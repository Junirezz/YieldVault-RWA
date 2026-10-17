import type { Request, Response } from 'express';
import { getCurrentTraceId } from '../tracing';
import type { CorrelationIdRequest } from './correlationId';

export interface ApiErrorOptions {
  status: number;
  code: string;
  message: string;
  details?: unknown;
  retryable?: boolean;
  retryAfterSeconds?: number | null;
  error?: string;
  summary?: string;
  errors?: unknown[];
  path?: string;
}

/**
 * Canonical wire shape for every error response.
 *
 * `error`/`status`/`code`/`message`/`retryable` are always present; `details`,
 * `correlationId` and `traceId` are only emitted when known.
 *
 * `summary`, `errors` and `path` are additive and only set by the callers that
 * have that information: `errors` mirrors `details` on validation failures so
 * clients can read the field list under either key, and `path` is set by the
 * catch-all route handler.
 */
export interface ApiErrorBody {
  error: string;
  status: number;
  code: string;
  message: string;
  retryable: boolean;
  details?: unknown;
  correlationId?: string;
  traceId?: string;
  summary?: string;
  errors?: unknown[];
  path?: string;
}

export interface BuildApiErrorBodyOptions {
  status?: number;
  code?: string;
  message: string;
  details?: unknown;
  retryable?: boolean;
  error?: string;
  correlationId?: string;
  traceId?: string;
  summary?: string;
  errors?: unknown[];
  path?: string;
}

/**
 * Build the canonical error envelope for a status/message pair.
 *
 * Every code path that produces an error body must go through this helper —
 * `sendApiError` for thrown/structured errors, `apiErrorContractMiddleware`
 * for handlers that hand-roll `res.status(n).json({ error, message })`, and
 * in-process snapshot builders that stand in for an HTTP endpoint. Synthesizing
 * a response outside this helper is what produced bodies that matched a route
 * in name but drifted from the real wire shape.
 */
export function buildApiErrorBody(options: BuildApiErrorBodyOptions): ApiErrorBody {
  const status = options.status ?? 500;
  return {
    error: options.error ?? statusLabel(status),
    status,
    code: options.code ?? defaultErrorCode(status),
    message: options.message,
    retryable: options.retryable ?? status >= 500,
    ...(options.details !== undefined ? { details: options.details } : {}),
    ...(options.summary !== undefined ? { summary: options.summary } : {}),
    ...(options.errors !== undefined ? { errors: options.errors } : {}),
    ...(options.path !== undefined ? { path: options.path } : {}),
    ...(options.correlationId ? { correlationId: options.correlationId } : {}),
    ...(options.traceId ? { traceId: options.traceId } : {}),
  };
}

export function sendApiError(
  req: Request,
  res: Response,
  options: ApiErrorOptions,
): void {
  const correlationId = (req as CorrelationIdRequest).correlationId;
  const traceId = getCurrentTraceId();

  if (options.retryAfterSeconds && options.retryAfterSeconds > 0) {
    res.setHeader('Retry-After', String(options.retryAfterSeconds));
  }

  res.status(options.status).json(
    buildApiErrorBody({
      error: options.error,
      status: options.status,
      code: options.code,
      message: options.message,
      retryable: options.retryable,
      details: options.details,
      summary: options.summary,
      errors: options.errors,
      path: options.path,
      correlationId,
      ...(traceId ? { traceId } : {}),
    })
  );
}

export function apiErrorContractMiddleware(
  _req: Request,
  res: Response,
  next: () => void,
): void {
  const json = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode < 400 || !body || typeof body !== 'object' || Array.isArray(body)) {
      return json(body);
    }

    const errorBody = body as Record<string, unknown>;
    if (typeof errorBody.error !== 'string' && typeof errorBody.message !== 'string') {
      return json(body);
    }

    // Every field is passed explicitly so this normalization keeps its original
    // defaults; the shared builder supplies the shape (key set and order), not
    // the fallback values.
    return json({
      ...errorBody,
      ...buildApiErrorBody({
        error: typeof errorBody.error === 'string' ? errorBody.error : statusLabel(res.statusCode),
        status: typeof errorBody.status === 'number' ? errorBody.status : res.statusCode,
        code: typeof errorBody.code === 'string' ? errorBody.code : defaultErrorCode(res.statusCode),
        message:
          typeof errorBody.message === 'string' ? errorBody.message : String(errorBody.error),
        retryable: typeof errorBody.retryable === 'boolean' ? errorBody.retryable : res.statusCode >= 500,
        details: errorBody.details,
      }),
    });
  }) as Response['json'];

  next();
}

function defaultErrorCode(status: number): string {
  switch (status) {
    case 400: return 'REQUEST_INVALID';
    case 401: return 'AUTH_REQUIRED';
    case 403: return 'AUTH_FORBIDDEN';
    case 404: return 'ROUTE_NOT_FOUND';
    case 409: return 'REQUEST_CONFLICT';
    case 422: return 'REQUEST_UNPROCESSABLE';
    case 429: return 'RATE_LIMITED';
    default: return status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR';
  }
}

export function statusLabel(status: number): string {
  switch (status) {
    case 400: return 'Bad Request';
    case 401: return 'Unauthorized';
    case 403: return 'Forbidden';
    case 404: return 'Not Found';
    case 409: return 'Conflict';
    case 422: return 'Unprocessable Entity';
    case 429: return 'Too Many Requests';
    case 500: return 'Internal Server Error';
    case 502: return 'Bad Gateway';
    case 503: return 'Service Unavailable';
    case 504: return 'Gateway Timeout';
    default: return 'Request Error';
  }
}