export type ApiErrorCode =
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "ABORTED"
  | "HTTP_ERROR"
  | "INVALID_RESPONSE"
  | "UNKNOWN_ERROR";

export interface ApiErrorMetadata {
  code: ApiErrorCode;
  message: string;
  userMessage: string;
  retryable: boolean;
  status?: number;
  statusText?: string;
  url?: string;
  method?: string;
  traceId?: string;
  details?: unknown;
  cause?: unknown;
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly userMessage: string;
  readonly retryable: boolean;
  readonly status?: number;
  readonly statusText?: string;
  readonly url?: string;
  readonly method?: string;
  readonly traceId?: string;
  readonly details?: unknown;
  override readonly cause?: unknown;

  constructor(metadata: ApiErrorMetadata) {
    super(metadata.message);
    this.name = "ApiError";
    this.code = metadata.code;
    this.userMessage = metadata.userMessage;
    this.retryable = metadata.retryable;
    this.status = metadata.status;
    this.statusText = metadata.statusText;
    this.url = metadata.url;
    this.method = metadata.method;
    this.traceId = metadata.traceId;
    this.details = metadata.details;
    this.cause = metadata.cause;
  }
}

export interface NormalizeApiErrorOptions {
  status?: number;
  statusText?: string;
  url?: string;
  method?: string;
  details?: unknown;
  traceId?: string;
}

const DEFAULT_USER_MESSAGE =
  "Something went wrong while loading data. Please try again.";

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isRetryableStatus(status?: number): boolean {
  return typeof status === "number" && RETRYABLE_STATUS_CODES.has(status);
}

export function normalizeApiError(
  error: unknown,
  options: NormalizeApiErrorOptions = {},
): ApiError {
  if (isApiError(error)) {
    return error;
  }

  const baseMetadata = {
    url: options.url,
    method: options.method,
    details: options.details,
    traceId: options.traceId,
  };

  if (error instanceof DOMException && error.name === "AbortError") {
    return new ApiError({
      ...baseMetadata,
      code: "ABORTED",
      message: "The request was aborted.",
      userMessage: "The request was cancelled. Please try again.",
      retryable: false,
      cause: error,
    });
  }

  if (error instanceof TypeError) {
    return new ApiError({
      ...baseMetadata,
      code: "NETWORK_ERROR",
      message: error.message || "Network request failed.",
      userMessage:
        "We could not reach the server. Check your connection and try again.",
      retryable: true,
      cause: error,
    });
  }

  if (error instanceof SyntaxError) {
    return new ApiError({
      ...baseMetadata,
      code: "INVALID_RESPONSE",
      message: error.message,
      userMessage:
        "We received an unexpected response from the server. Please try again.",
      retryable: false,
      cause: error,
    });
  }

  if (options.status) {
    return new ApiError({
      ...baseMetadata,
      code: "HTTP_ERROR",
      message: `Request failed with status ${options.status}.`,
      userMessage:
        options.status >= 500
          ? "The service is temporarily unavailable. Please try again shortly."
          : "We could not complete that request. Please review your input and try again.",
      retryable: isRetryableStatus(options.status),
      status: options.status,
      statusText: options.statusText,
      cause: error,
    });
  }

  if (error instanceof Error) {
    return new ApiError({
      ...baseMetadata,
      code: "UNKNOWN_ERROR",
      message: error.message,
      userMessage: DEFAULT_USER_MESSAGE,
      retryable: false,
      cause: error,
    });
  }

  return new ApiError({
    ...baseMetadata,
    code: "UNKNOWN_ERROR",
    message: "An unknown API error occurred.",
    userMessage: DEFAULT_USER_MESSAGE,
    retryable: false,
    cause: error,
  });
}
