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

  res.status(options.status).json({
    error: options.error ?? statusLabel(options.status),
    status: options.status,
    code: options.code,
    message: options.message,
    retryable: options.retryable ?? options.status >= 500,
    ...(options.details !== undefined ? { details: options.details } : {}),
    ...(correlationId ? { correlationId } : {}),
    ...(traceId ? { traceId } : {}),
  });
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

    return json({
      ...errorBody,
      error: typeof errorBody.error === 'string' ? errorBody.error : statusLabel(res.statusCode),
      status: typeof errorBody.status === 'number' ? errorBody.status : res.statusCode,
      code: typeof errorBody.code === 'string' ? errorBody.code : defaultErrorCode(res.statusCode),
      message: typeof errorBody.message === 'string' ? errorBody.message : String(errorBody.error),
      retryable: typeof errorBody.retryable === 'boolean' ? errorBody.retryable : res.statusCode >= 500,
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