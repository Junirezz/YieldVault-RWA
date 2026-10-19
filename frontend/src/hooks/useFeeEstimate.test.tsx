/**
 * Issue #1624: a failed fee estimate must clear the previous quote and expose
 * the error instead of silently keeping a stale value on screen.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { useFeeEstimate } from "./useFeeEstimate";
import * as vaultApi from "../lib/vaultApi";

vi.mock("../lib/vaultApi", () => ({
  estimateNetworkFee: vi.fn(),
  getXlmPrice: vi.fn(),
}));

const WALLET = "GABC123";
// The hook debounces for 500ms before calling the estimator.
const WAIT = { timeout: 4000 };

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useFeeEstimate error state (issue #1624)", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = makeQueryClient();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(vaultApi.getXlmPrice).mockResolvedValue(0.12);
  });

  it("reports the estimated fee and clears the error on success", async () => {
    vi.mocked(vaultApi.estimateNetworkFee).mockResolvedValue("0.0100");

    const { result } = renderHook(() => useFeeEstimate(WALLET, "100", "deposit"), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => expect(result.current.feeXlm).toBeCloseTo(0.01), WAIT);
    expect(result.current.isError).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.lastUpdated).not.toBeNull();
  });

  it("clears the previous fee and exposes the error when estimation fails", async () => {
    vi.mocked(vaultApi.estimateNetworkFee).mockResolvedValueOnce("0.0100");

    const { result, rerender } = renderHook(
      ({ amount }: { amount: string }) => useFeeEstimate(WALLET, amount, "deposit"),
      { wrapper: wrapper(queryClient), initialProps: { amount: "100" } },
    );

    await waitFor(() => expect(result.current.feeXlm).toBeCloseTo(0.01), WAIT);
    expect(result.current.lastUpdated).not.toBeNull();

    const failure = new Error("fee service down");
    vi.mocked(vaultApi.estimateNetworkFee).mockRejectedValueOnce(failure);
    rerender({ amount: "200" });

    await waitFor(() => expect(result.current.isError).toBe(true), WAIT);
    expect(result.current.error).toBe(failure);
    expect(result.current.feeXlm).toBe(0);
    expect(result.current.feeUsd).toBe(0);
    expect(result.current.lastUpdated).toBeNull();
  });

  it("does not estimate and reports no error when the amount is empty", async () => {
    const { result } = renderHook(() => useFeeEstimate(WALLET, "", "deposit"), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isEstimating).toBe(false));
    expect(vaultApi.estimateNetworkFee).not.toHaveBeenCalled();
    expect(result.current.isError).toBe(false);
    expect(result.current.feeXlm).toBe(0);
  });
});
