/**
 * Issue #1624: a failed referral request must surface as an error instead of
 * being flattened to `null` (which reads as "no referral activity yet").
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { useReferralLink, useReferralStats } from "./useReferral";
import { apiClient } from "../lib/apiClient";
import { ApiError } from "../lib/api/error";

vi.mock("../lib/apiClient", () => ({
  apiClient: { get: vi.fn() },
}));

const WALLET = "GABC123";

function httpError(status: number) {
  return new ApiError({
    code: "HTTP_ERROR",
    message: `Request failed with status ${status}.`,
    userMessage: "Request failed.",
    retryable: false,
    status,
  });
}

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("referral hooks error state (issue #1624)", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = makeQueryClient();
    vi.clearAllMocks();
  });

  it("resolves referral stats", async () => {
    const stats = { referral_count: 3, total_reward_earned: "12.50" };
    vi.mocked(apiClient.get).mockResolvedValue(stats);

    const { result } = renderHook(() => useReferralStats(WALLET), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(stats);
    expect(result.current.isError).toBe(false);
  });

  it("treats a 404 as an empty state rather than an error", async () => {
    vi.mocked(apiClient.get).mockRejectedValue(httpError(404));

    const { result } = renderHook(() => useReferralStats(WALLET), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  it("rethrows non-404 failures so isError/error are populated", async () => {
    const failure = httpError(500);
    vi.mocked(apiClient.get).mockRejectedValue(failure);

    const { result } = renderHook(() => useReferralStats(WALLET), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
  });

  it("surfaces the referral-code query failure through useReferralLink", async () => {
    const failure = httpError(503);
    vi.mocked(apiClient.get).mockRejectedValue(failure);

    const { result } = renderHook(() => useReferralLink(WALLET), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(failure);
    expect(result.current.referralLink).toBeNull();
  });

  it("builds the referral link when the code query succeeds", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ code: "ABC123" });

    const { result } = renderHook(() => useReferralLink(WALLET), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => expect(result.current.referralCode).toBe("ABC123"));
    expect(result.current.referralLink).toContain("?ref=ABC123");
    expect(result.current.isError).toBe(false);
  });
});
