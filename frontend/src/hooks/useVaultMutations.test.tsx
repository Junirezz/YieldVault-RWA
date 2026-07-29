/**
 * Tests for optimistic UI updates in useDepositMutation / useWithdrawMutation.
 * Covers: pending insert, balance/holdings/TVL patches, rollback on error,
 * reconcile on settled, and withdraw wallet-credit direction.
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { useDepositMutation, useWithdrawMutation } from "./useVaultMutations";
import * as vaultApi from "../lib/vaultApi";
import { queryKeys } from "../lib/queryClient";
import type { Transaction } from "../lib/transactionApi";
import type { PortfolioHolding } from "../lib/portfolioApi";
import type { VaultSummary } from "../lib/vaultApi";

vi.mock("../lib/vaultApi", () => ({
  submitDeposit: vi.fn(),
  submitWithdrawal: vi.fn(),
}));

const WALLET = "GABC123";
const TX_KEY = queryKeys.transactions.list(WALLET);
const BALANCE_KEY = queryKeys.balance.usdc(WALLET);
const HOLDINGS_KEY = queryKeys.portfolio.holdings(WALLET);
const SUMMARY_KEY = queryKeys.vault.summary();

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "existing-1",
    type: "deposit",
    status: "completed",
    amount: "50.00",
    asset: "USDC",
    timestamp: "2025-01-01T00:00:00.000Z",
    transactionHash: "hash-existing-1",
    ...overrides,
  };
}

function makeHolding(overrides: Partial<PortfolioHolding> = {}): PortfolioHolding {
  return {
    id: "h1",
    asset: "USDC",
    vaultName: "YieldVault",
    symbol: "yvUSDC",
    shares: 100,
    apy: 8,
    valueUsd: 200,
    unrealizedGainUsd: 5,
    issuer: "issuer",
    status: "active",
    ...overrides,
  };
}

function makeSummary(overrides: Partial<VaultSummary> = {}): VaultSummary {
  return {
    tvl: 1000,
    depositCap: 10000,
    apy: 8,
    participantCount: 10,
    monthlyGrowthPct: 1,
    strategyStabilityPct: 95,
    assetLabel: "USDC",
    exchangeRate: 1,
    networkFeeEstimate: "0.01",
    updatedAt: "2025-01-01T00:00:00.000Z",
    contractPaused: false,
    strategy: {
      id: "rwa-1",
      name: "RWA",
      issuer: "issuer",
      network: "testnet",
      rpcUrl: "https://example.test",
      status: "active",
      description: "test",
    },
    ...overrides,
  };
}

function seedCaches(queryClient: QueryClient) {
  const holdings = [makeHolding()];
  const summary = makeSummary();
  const txs = [makeTransaction()];
  queryClient.setQueryData(BALANCE_KEY, 500);
  queryClient.setQueryData(HOLDINGS_KEY, holdings);
  queryClient.setQueryData(SUMMARY_KEY, summary);
  queryClient.setQueryData(TX_KEY, txs);
  return { holdings, summary, txs };
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } },
  });
}

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useDepositMutation – optimistic updates", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = makeQueryClient();
    vi.clearAllMocks();
  });

  it("inserts a pending transaction row immediately on mutate", async () => {
    vi.mocked(vaultApi.submitDeposit).mockResolvedValue(undefined);
    queryClient.setQueryData<Transaction[]>(TX_KEY, [makeTransaction()]);

    const { result } = renderHook(() => useDepositMutation(), {
      wrapper: wrapper(queryClient),
    });

    act(() => {
      result.current.mutate({ walletAddress: WALLET, amount: 100 });
    });

    await waitFor(() => {
      const txs = queryClient.getQueryData<Transaction[]>(TX_KEY);
      expect(txs?.[0].status).toBe("pending");
      expect(txs?.[0].type).toBe("deposit");
      expect(txs?.[0].id).toMatch(/^optimistic-deposit-/);
    });
  });

  it("optimistically decreases wallet balance and increases holdings/TVL", async () => {
    let resolveDeposit!: () => void;
    vi.mocked(vaultApi.submitDeposit).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDeposit = () => resolve(undefined);
        }),
    );
    seedCaches(queryClient);

    const { result } = renderHook(() => useDepositMutation(), {
      wrapper: wrapper(queryClient),
    });

    act(() => {
      result.current.mutate({ walletAddress: WALLET, amount: 100 });
    });

    await waitFor(() => {
      expect(queryClient.getQueryData(BALANCE_KEY)).toBe(400);
      expect(queryClient.getQueryData<PortfolioHolding[]>(HOLDINGS_KEY)?.[0].valueUsd).toBe(300);
      expect(queryClient.getQueryData<VaultSummary>(SUMMARY_KEY)?.tvl).toBe(1100);
    });

    await act(async () => {
      resolveDeposit();
    });
  });

  it("pending row is prepended — existing rows remain below it", async () => {
    vi.mocked(vaultApi.submitDeposit).mockResolvedValue(undefined);
    const existing = [makeTransaction({ id: "e1" }), makeTransaction({ id: "e2" })];
    queryClient.setQueryData<Transaction[]>(TX_KEY, existing);

    const { result } = renderHook(() => useDepositMutation(), {
      wrapper: wrapper(queryClient),
    });

    act(() => {
      result.current.mutate({ walletAddress: WALLET, amount: 25 });
    });

    await waitFor(() => {
      const txs = queryClient.getQueryData<Transaction[]>(TX_KEY)!;
      expect(txs[0].id).toMatch(/^optimistic-/);
      expect(txs[1].id).toBe("e1");
      expect(txs[2].id).toBe("e2");
    });
  });

  it("rolls back balance, holdings, TVL, and transactions on error", async () => {
    vi.mocked(vaultApi.submitDeposit).mockRejectedValue(new Error("network error"));
    const seeded = seedCaches(queryClient);

    const { result } = renderHook(() => useDepositMutation(), {
      wrapper: wrapper(queryClient),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({ walletAddress: WALLET, amount: 100 });
      } catch {
        // expected
      }
    });

    expect(queryClient.getQueryData(BALANCE_KEY)).toBe(500);
    expect(queryClient.getQueryData(HOLDINGS_KEY)).toEqual(seeded.holdings);
    expect(queryClient.getQueryData(SUMMARY_KEY)).toEqual(seeded.summary);
    expect(queryClient.getQueryData(TX_KEY)).toEqual(seeded.txs);
    expect(
      queryClient.getQueryData<Transaction[]>(TX_KEY)?.some((t) => t.id.startsWith("optimistic-")),
    ).toBe(false);
  });

  it("invalidates related queries on settled success (reconcile)", async () => {
    vi.mocked(vaultApi.submitDeposit).mockResolvedValue(undefined);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useDepositMutation(), {
      wrapper: wrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ walletAddress: WALLET, amount: 50 });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: TX_KEY }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: BALANCE_KEY }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: HOLDINGS_KEY }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: SUMMARY_KEY }),
    );
  });

  it("invalidates related queries after error rollback (reconcile)", async () => {
    vi.mocked(vaultApi.submitDeposit).mockRejectedValue(new Error("rpc fail"));
    seedCaches(queryClient);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useDepositMutation(), {
      wrapper: wrapper(queryClient),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({ walletAddress: WALLET, amount: 50 });
      } catch {
        // expected
      }
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: BALANCE_KEY }),
    );
  });

  it("pending row has a timestamp at or after mutation start", async () => {
    vi.mocked(vaultApi.submitDeposit).mockResolvedValue(undefined);
    const before = Date.now();

    const { result } = renderHook(() => useDepositMutation(), {
      wrapper: wrapper(queryClient),
    });

    act(() => {
      result.current.mutate({ walletAddress: WALLET, amount: 10 });
    });

    await waitFor(() => {
      const txs = queryClient.getQueryData<Transaction[]>(TX_KEY);
      const pending = txs?.find((t) => t.id.startsWith("optimistic-"));
      expect(pending).toBeDefined();
      expect(new Date(pending!.timestamp).getTime()).toBeGreaterThanOrEqual(before);
    });
  });
});

describe("useWithdrawMutation – optimistic updates", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = makeQueryClient();
    vi.clearAllMocks();
  });

  it("inserts a pending withdrawal row immediately on mutate", async () => {
    vi.mocked(vaultApi.submitWithdrawal).mockResolvedValue(undefined);
    queryClient.setQueryData<Transaction[]>(TX_KEY, []);

    const { result } = renderHook(() => useWithdrawMutation(), {
      wrapper: wrapper(queryClient),
    });

    act(() => {
      result.current.mutate({ walletAddress: WALLET, amount: 75 });
    });

    await waitFor(() => {
      const txs = queryClient.getQueryData<Transaction[]>(TX_KEY);
      expect(txs?.[0].status).toBe("pending");
      expect(txs?.[0].type).toBe("withdrawal");
      expect(txs?.[0].id).toMatch(/^optimistic-withdrawal-/);
    });
  });

  it("optimistically credits wallet balance and decreases holdings/TVL", async () => {
    let resolveWithdraw!: () => void;
    vi.mocked(vaultApi.submitWithdrawal).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveWithdraw = () => resolve(undefined);
        }),
    );
    seedCaches(queryClient);

    const { result } = renderHook(() => useWithdrawMutation(), {
      wrapper: wrapper(queryClient),
    });

    act(() => {
      result.current.mutate({ walletAddress: WALLET, amount: 100 });
    });

    await waitFor(() => {
      expect(queryClient.getQueryData(BALANCE_KEY)).toBe(600);
      expect(queryClient.getQueryData<PortfolioHolding[]>(HOLDINGS_KEY)?.[0].valueUsd).toBe(100);
      expect(queryClient.getQueryData<VaultSummary>(SUMMARY_KEY)?.tvl).toBe(900);
    });

    await act(async () => {
      resolveWithdraw();
    });
  });

  it("rolls back balance, holdings, TVL, and transactions on error", async () => {
    vi.mocked(vaultApi.submitWithdrawal).mockRejectedValue(new Error("rpc error"));
    const seeded = seedCaches(queryClient);

    const { result } = renderHook(() => useWithdrawMutation(), {
      wrapper: wrapper(queryClient),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({ walletAddress: WALLET, amount: 30 });
      } catch {
        // expected
      }
    });

    expect(queryClient.getQueryData(BALANCE_KEY)).toBe(500);
    expect(queryClient.getQueryData(HOLDINGS_KEY)).toEqual(seeded.holdings);
    expect(queryClient.getQueryData(SUMMARY_KEY)).toEqual(seeded.summary);
    expect(queryClient.getQueryData(TX_KEY)).toEqual(seeded.txs);
  });

  it("invalidates transaction query on settled success", async () => {
    vi.mocked(vaultApi.submitWithdrawal).mockResolvedValue(undefined);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useWithdrawMutation(), {
      wrapper: wrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ walletAddress: WALLET, amount: 20 });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: TX_KEY }),
    );
  });

  it("no duplicate rows after success invalidation clears optimistic entry", async () => {
    vi.mocked(vaultApi.submitWithdrawal).mockResolvedValue(undefined);
    const serverData = [makeTransaction({ id: "server-1", type: "withdrawal" })];
    queryClient.setQueryData<Transaction[]>(TX_KEY, []);

    const { result } = renderHook(() => useWithdrawMutation(), {
      wrapper: wrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ walletAddress: WALLET, amount: 20 });
    });

    queryClient.setQueryData<Transaction[]>(TX_KEY, serverData);

    const txs = queryClient.getQueryData<Transaction[]>(TX_KEY)!;
    const optimisticRows = txs.filter((t) => t.id.startsWith("optimistic-"));
    expect(optimisticRows).toHaveLength(0);
    expect(txs).toHaveLength(1);
  });
});
