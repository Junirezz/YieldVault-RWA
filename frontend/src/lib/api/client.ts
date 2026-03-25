import { ApiError, normalizeApiError, type NormalizeApiErrorOptions } from "./error";
import { emitApiTelemetry } from "./telemetry";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export interface ApiRequestOptions extends Omit<RequestInit, "body" | "method"> {
  method?: HttpMethod;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: BodyInit | object | null;
  headers?: HeadersInit;
  retry?: RetryOptions | false;
}

export interface ApiRequestContext
  extends Omit<ApiRequestOptions, "body" | "method"> {
  method: HttpMethod;
  body?: BodyInit | null;
  url: string;
}

export interface ApiResponseContext<T> {
  request: ApiRequestContext;
  response: Response;
  data: T;
}

interface ApiClientConfig {
  baseUrl?: string;
  headers?: HeadersInit;
}

type RequestInterceptor = (
  request: ApiRequestContext,
) => ApiRequestContext | Promise<ApiRequestContext>;

type ResponseInterceptor = <T>(
  context: ApiResponseContext<T>,
) => ApiResponseContext<T> | Promise<ApiResponseContext<T>>;

type ErrorInterceptor = (
  error: ApiError,
  request: ApiRequestContext,
) => ApiError | Promise<ApiError>;

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  attempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 2000,
};

async function parseResponseData<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }

  return (await response.text()) as T;
}

function buildUrl(baseUrl: string | undefined, path: string, query?: ApiRequestOptions["query"]) {
  const url = new URL(path, baseUrl ?? window.location.origin);

  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null) {
        return;
      }

      url.searchParams.set(key, String(value));
    });
  }

  return url.toString();
}

function isJsonBody(body: ApiRequestOptions["body"]): body is object {
  return !!body && typeof body === "object" && !(body instanceof FormData) && !(body instanceof URLSearchParams) && !(body instanceof Blob);
}

function createRequestContext(
  baseConfig: ApiClientConfig,
  path: string,
  options: ApiRequestOptions = {},
): ApiRequestContext {
  const method = options.method ?? "GET";
  const headers = new Headers(baseConfig.headers);

  new Headers(options.headers).forEach((value, key) => {
    headers.set(key, value);
  });

  let body: BodyInit | null | undefined = null;
  if (options.body === undefined || options.body === null) {
    body = null;
  } else if (isJsonBody(options.body)) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.body);
  } else {
    body = options.body;
  }

  return {
    ...options,
    method,
    headers,
    body,
    url: buildUrl(baseConfig.baseUrl, path, options.query),
  };
}

function getRetryOptions(request: ApiRequestContext): Required<RetryOptions> | null {
  if (request.retry === false) {
    return null;
  }

  return {
    attempts: request.retry?.attempts ?? DEFAULT_RETRY_OPTIONS.attempts,
    baseDelayMs: request.retry?.baseDelayMs ?? DEFAULT_RETRY_OPTIONS.baseDelayMs,
    maxDelayMs: request.retry?.maxDelayMs ?? DEFAULT_RETRY_OPTIONS.maxDelayMs,
  };
}

function shouldRetry(request: ApiRequestContext, error: ApiError, attempt: number) {
  const retryOptions = getRetryOptions(request);
  if (!retryOptions) {
    return false;
  }

  const isSafeMethod = request.method === "GET" || request.method === "DELETE";
  if (!isSafeMethod) {
    return false;
  }

  return error.retryable && attempt < retryOptions.attempts;
}

function getRetryDelay(request: ApiRequestContext, attempt: number) {
  const retryOptions = getRetryOptions(request) ?? DEFAULT_RETRY_OPTIONS;
  const exponentialDelay = retryOptions.baseDelayMs * 2 ** (attempt - 1);
  const jitter = Math.round(Math.random() * 100);
  return Math.min(exponentialDelay + jitter, retryOptions.maxDelayMs);
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function buildApiError(
  error: unknown,
  request: ApiRequestContext,
  options: NormalizeApiErrorOptions = {},
) {
  return normalizeApiError(error, {
    ...options,
    method: request.method,
    url: request.url,
  });
}

export class ApiClient {
  private readonly baseConfig: ApiClientConfig;
  private readonly requestInterceptors: RequestInterceptor[] = [];
  private readonly responseInterceptors: ResponseInterceptor[] = [];
  private readonly errorInterceptors: ErrorInterceptor[] = [];

  constructor(config: ApiClientConfig = {}) {
    this.baseConfig = config;
  }

  useRequest(interceptor: RequestInterceptor) {
    this.requestInterceptors.push(interceptor);
    return () => {
      const index = this.requestInterceptors.indexOf(interceptor);
      this.requestInterceptors.splice(index, 1);
    };
  }

  useResponse(interceptor: ResponseInterceptor) {
    this.responseInterceptors.push(interceptor);
    return () => {
      const index = this.responseInterceptors.indexOf(interceptor);
      this.responseInterceptors.splice(index, 1);
    };
  }

  useError(interceptor: ErrorInterceptor) {
    this.errorInterceptors.push(interceptor);
    return () => {
      const index = this.errorInterceptors.indexOf(interceptor);
      this.errorInterceptors.splice(index, 1);
    };
  }

  async request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    let request = createRequestContext(this.baseConfig, path, options);

    for (const interceptor of this.requestInterceptors) {
      request = await interceptor(request);
    }

    let attempt = 0;

    while (true) {
      attempt += 1;
      const startedAt = performance.now();

      emitApiTelemetry({
        type: "request",
        method: request.method,
        url: request.url,
        attempt,
      });

      try {
        const response = await fetch(request.url, request);
        const durationMs = Math.round(performance.now() - startedAt);

        if (!response.ok) {
          const details = await parseResponseData<unknown>(response).catch(() => undefined);
          throw await buildApiError(undefined, request, {
            status: response.status,
            statusText: response.statusText,
            details,
            traceId: response.headers.get("x-trace-id") ?? undefined,
          });
        }

        let context: ApiResponseContext<T> = {
          request,
          response,
          data: await parseResponseData<T>(response),
        };

        for (const interceptor of this.responseInterceptors) {
          context = await interceptor(context);
        }

        emitApiTelemetry({
          type: "success",
          method: request.method,
          url: request.url,
          attempt,
          durationMs,
          status: response.status,
        });

        return context.data;
      } catch (unknownError) {
        let apiError = await buildApiError(unknownError, request);

        for (const interceptor of this.errorInterceptors) {
          apiError = await interceptor(apiError, request);
        }

        const durationMs = Math.round(performance.now() - startedAt);

        if (shouldRetry(request, apiError, attempt)) {
          const delayMs = getRetryDelay(request, attempt);
          emitApiTelemetry({
            type: "retry",
            method: request.method,
            url: request.url,
            attempt,
            delayMs,
            reason: apiError.code,
          });
          await sleep(delayMs);
          continue;
        }

        emitApiTelemetry({
          type: "error",
          method: request.method,
          url: request.url,
          attempt,
          durationMs,
          error: apiError,
        });

        throw apiError;
      }
    }
  }

  get<T>(path: string, options: Omit<ApiRequestOptions, "method"> = {}) {
    return this.request<T>(path, { ...options, method: "GET" });
  }

  post<T>(path: string, options: Omit<ApiRequestOptions, "method"> = {}) {
    return this.request<T>(path, { ...options, method: "POST" });
  }
}

export function createApiClient(config: ApiClientConfig = {}) {
  return new ApiClient(config);
}
