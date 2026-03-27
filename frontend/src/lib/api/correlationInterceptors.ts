import { log } from "../logger";
import type { ApiRequestContext, ApiResponseContext } from "./client";

export type RequestInterceptor = (
  request: ApiRequestContext,
) => ApiRequestContext | Promise<ApiRequestContext>;

export type ResponseInterceptor = <T>(
  context: ApiResponseContext<T>,
) => ApiResponseContext<T> | Promise<ApiResponseContext<T>>;

/** UUID v4 pattern for validation in tests. */
export const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Generates a correlation ID using `crypto.randomUUID()`.
 * Falls back to `fallback-<timestamp>` in non-secure contexts where the API
 * is unavailable, and emits a `warn` log entry.
 */
export function generateCorrelationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const fallbackId = `fallback-${Date.now()}`;
  log("warn", "crypto.randomUUID is unavailable; using fallback correlation ID", {
    correlationId: fallbackId,
  });
  return fallbackId;
}

/**
 * Request interceptor: reads the correlation ID from the provided getter and
 * sets the `X-Correlation-ID` header on every outgoing request.
 */
export function createCorrelationRequestInterceptor(
  getCorrelationId: () => string,
): RequestInterceptor {
  return (request: ApiRequestContext): ApiRequestContext => {
    const headers = new Headers(request.headers as HeadersInit);
    const correlationId = getCorrelationId();
    headers.set("X-Correlation-ID", correlationId);
    return { ...request, headers };
  };
}

/**
 * Response interceptor: reads the echoed `X-Correlation-ID` from response
 * headers and attaches it to the request context for downstream telemetry.
 */
export function createCorrelationResponseInterceptor(): ResponseInterceptor {
  return <T>(context: ApiResponseContext<T>): ApiResponseContext<T> => {
    const echoedId = context.response.headers.get("X-Correlation-ID");
    if (!echoedId) {
      return context;
    }

    // Propagate the echoed ID back onto the request headers so downstream
    // telemetry subscribers can read it from the request context.
    const headers = new Headers(context.request.headers as HeadersInit);
    headers.set("X-Correlation-ID", echoedId);

    return {
      ...context,
      request: { ...context.request, headers },
    };
  };
}
