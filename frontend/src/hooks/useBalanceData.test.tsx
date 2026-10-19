/**
 * Issue #1624: balance hooks must surface failures via `isError`/`error`
 * instead of swallowing them and reporting a misleading zero balance.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { useUsdcBalance, useXlmBalance } from "./useBalanceData";
import * as stellarAccount from "../lib/stellarAccount";

vi.mock("../lib/stellarAccount", () => ({
  fetchUsdcBalance: vi.fn(),
  fetchXlmBalance: vi.fn(),
}));

const WALLET = "GABC123";

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("balance hooks error state (issue #1624)", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = makeQueryClient();
    vi.clearAllMocks();
  });

  it("returns the fetched USDC balance", async () => {
    vi.mocked(stellarAccount.fetchUsdcBalance).mockResolvedValue(42.5);

    const { result } = renderHook(() => useUsdcBalance(WALLET), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(42.5);
    expect(result.current.isError).toBe(false);
  });

  it("exposes isError/error instead of returning 0 when the USDC fetch fails", async () => {
    const failure = new Error("horizon unavailable");
    vi.mocked(stellarAccount.fetchUsdcBalance).mockRejectedValue(failure);

    const { result } = renderHook(() => useUsdcBalance(WALLET), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
  });

  it("returns the fetched XLM balance", async () => {
    vi.mocked(stellarAccount.fetchXlmBalance).mockResolvedValue(12.25);

    const { result } = renderHook(() => useXlmBalance(WALLET), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(12.25);
    expect(result.current.isError).toBe(false);
  });

  it("exposes isError/error instead of returning 0 when the XLM fetch fails", async () => {
    const failure = new Error("network down");
    vi.mocked(stellarAccount.fetchXlmBalance).mockRejectedValue(failure);

    const { result } = renderHook(() => useXlmBalance(WALLET), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
  });

  it("does not fetch when no wallet is connected", () => {
    const { result } = renderHook(() => useUsdcBalance(null), {
      wrapper: wrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(stellarAccount.fetchUsdcBalance).not.toHaveBeenCalled();
  });
});
