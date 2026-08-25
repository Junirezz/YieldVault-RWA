import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { createRequestId, normalizeRequestId, requestIdStorage } from '../requestContext';
import { getTracer, getCurrentTraceId } from '../tracing';

const CORRELATION_ID_HEADER = 'X-Correlation-ID';
const REQUEST_ID_HEADER = 'X-Request-ID';
const TRACE_ID_HEADER = 'X-Trace-ID';
const TRACE_PARENT_HEADER = 'traceparent';

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      requestId: string;
      traceId?: string;
    }
  }
}

export type CorrelationIdRequest = Request;

/**
 * Middleware to attach correlation and trace IDs to all requests.
 * 
 * Propagates:
 * - X-Correlation-ID: Unique ID for request chains
 * - X-Request-ID: Unique ID for this specific request
 * - X-Trace-ID: OpenTelemetry trace ID for distributed tracing
 * 
 * IDs are propagated to:
 * - Response headers
 * - AsyncLocalStorage for access in async contexts
 * - OpenTelemetry spans
 */
export const correlationIdMiddleware: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const correlationId =
    normalizeRequestId(req.get?.(CORRELATION_ID_HEADER)) || createRequestId();
  const requestId =
    normalizeRequestId(req.get?.(REQUEST_ID_HEADER)) || correlationId;

  req.correlationId = correlationId;
  req.requestId = requestId;
  
  // Set response headers for client and downstream services
  res.setHeader(CORRELATION_ID_HEADER, correlationId);
  res.setHeader(REQUEST_ID_HEADER, requestId);

  // Run with context for async operations
  requestIdStorage.run({ requestId, correlationId }, () => {
    // Create a span for this request with trace context
    const tracer = getTracer();
    const span = tracer.startSpan('http.request', {
      attributes: {
        'http.method': req.method,
        'http.url': req.originalUrl,
        'http.target': req.path,
        'correlation.id': correlationId,
        'request.id': requestId,
      },
    });

    // Add trace ID to request and response
    const traceId = getCurrentTraceId();
    if (traceId) {
      req.traceId = traceId;
      res.setHeader(TRACE_ID_HEADER, traceId);
    }

    // Capture response status and end span on response finish
    const originalSend = res.send.bind(res);
    res.send = function (data: any) {
      span.setAttributes({
        'http.status_code': res.statusCode,
      });
      span.end();
      return originalSend(data);
    };

    next();
  });
};
