import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createApiClient,
  subscribeToApiTelemetry,
  type ApiTelemetryEvent,
} from ".";

describe("ApiClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries transient GET failures with backoff and emits telemetry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "temporarily unavailable" }), {
          status: 503,
          statusText: "Service Unavailable",
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    vi.stubGlobal("fetch", fetchMock);

    const events: ApiTelemetryEvent[] = [];
    const unsubscribe = subscribeToApiTelemetry((event) => {
      events.push(event);
    });

    const client = createApiClient({ baseUrl: "http://localhost" });
    const request = client.get<{ ok: boolean }>("/health");

    await vi.runAllTimersAsync();

    await expect(request).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events.some((event) => event.type === "retry")).toBe(true);

    unsubscribe();
  });

  it("does not retry non-idempotent requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "bad gateway" }), {
        status: 502,
        statusText: "Bad Gateway",
        headers: { "content-type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    const client = createApiClient({ baseUrl: "http://localhost" });

    await expect(
      client.post("/orders", { body: { amount: 1 } }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes terminal HTTP errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "bad request" }), {
          status: 400,
          statusText: "Bad Request",
          headers: { "content-type": "application/json", "x-trace-id": "trace-123" },
        }),
      ),
    );

    const client = createApiClient({ baseUrl: "http://localhost" });

    await expect(client.get("/vault")).rejects.toMatchObject({
      code: "HTTP_ERROR",
      status: 400,
      traceId: "trace-123",
      userMessage:
        "We could not complete that request. Please review your input and try again.",
    });
  });

  it("sets X-Correlation-ID header on outgoing requests via the request interceptor", async () => {
    const correlationId = "test-correlation-id-abc123";
    let capturedHeaders: Headers | undefined;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        capturedHeaders = init.headers as Headers;
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }),
    );

    const client = createApiClient({
      baseUrl: "http://localhost",
      getCorrelationId: () => correlationId,
    });

    await client.get("/health");

    expect(capturedHeaders).toBeDefined();
    expect(capturedHeaders!.get("X-Correlation-ID")).toBe(correlationId);
  });

  it("attaches correlationId to ApiError on HTTP failure", async () => {
    const correlationId = "error-correlation-id-xyz789";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          statusText: "Not Found",
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const client = createApiClient({
      baseUrl: "http://localhost",
      getCorrelationId: () => correlationId,
    });

    const error: unknown = await client.get("/missing").catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    if (error instanceof ApiError) {
      expect(error.correlationId).toBe(correlationId);
    }
  });
});
