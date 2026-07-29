/**
 * Unit tests for optimistic vault cache helpers (snapshot / apply / rollback).
 */
import { QueryClient } from "@tanstack/react-query";
import { describe, it, expect, beforeEach } from "vitest";
import {
  applyOptimisticVaultPatch,
  buildPendingTransaction,
  captureVaultOptimisticSnapshot,
  getVaultCacheKeys,
  rollbackVaultOptimisticSnapshot,
  updateHoldings,
} from "./optimisticVaultCache";
import type { PortfolioHolding } from "./portfolioApi";
import type { VaultSummary } from "./vaultApi";
import type { Transaction } from "./transactionApi";

const WALLET = "GABC123";

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

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "existing-1",
    type: "deposit",
    status: "completed",
    amount: "50.00",
    asset: "USDC",
    timestamp: "2025-01-01T00:00:00.000Z",
    transactionHash: "hash-1",
    ...overrides,
  };
}

describe("optimisticVaultCache helpers", () => {
  let queryClient: QueryClient;
  let keys: ReturnType<typeof getVaultCacheKeys>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } },
    });
    keys = getVaultCacheKeys(WALLET);
  });

  it("buildPendingTransaction marks rows as pending with stable ids", () => {
    const tx = buildPendingTransaction("deposit", 42.5, 1_700_000_000_000);
    expect(tx.id).toBe("optimistic-deposit-1700000000000");
    expect(tx.status).toBe("pending");
    expect(tx.type).toBe("deposit");
    expect(tx.amount).toBe("42.50");
  });

  it("updateHoldings adjusts first holding and marks it pending", () => {
    const updated = updateHoldings([makeHolding(), makeHolding({ id: "h2" })], 50);
    expect(updated?.[0].valueUsd).toBe(250);
    expect(updated?.[0].status).toBe("pending");
    expect(updated?.[1].valueUsd).toBe(200);
    expect(updated?.[1].status).toBe("active");
  });

  it("applyOptimisticVaultPatch decreases wallet balance on deposit", () => {
    queryClient.setQueryData(keys.balanceKey, 500);
    queryClient.setQueryData(keys.holdingsKey, [makeHolding()]);
    queryClient.setQueryData(keys.summaryKey, makeSummary());
    queryClient.setQueryData(keys.txKey, [makeTx()]);

    applyOptimisticVaultPatch(queryClient, WALLET, "deposit", 100, 1_700_000_000_000);

    expect(queryClient.getQueryData(keys.balanceKey)).toBe(400);
    expect(queryClient.getQueryData<PortfolioHolding[]>(keys.holdingsKey)?.[0].valueUsd).toBe(300);
    expect(queryClient.getQueryData<VaultSummary>(keys.summaryKey)?.tvl).toBe(1100);
    expect(queryClient.getQueryData<Transaction[]>(keys.txKey)?.[0].id).toMatch(
      /^optimistic-deposit-/,
    );
  });

  it("applyOptimisticVaultPatch increases wallet balance on withdrawal", () => {
    queryClient.setQueryData(keys.balanceKey, 500);
    queryClient.setQueryData(keys.holdingsKey, [makeHolding({ valueUsd: 300 })]);
    queryClient.setQueryData(keys.summaryKey, makeSummary({ tvl: 1000 }));

    applyOptimisticVaultPatch(queryClient, WALLET, "withdrawal", 100, 1_700_000_000_000);

    expect(queryClient.getQueryData(keys.balanceKey)).toBe(600);
    expect(queryClient.getQueryData<PortfolioHolding[]>(keys.holdingsKey)?.[0].valueUsd).toBe(200);
    expect(queryClient.getQueryData<VaultSummary>(keys.summaryKey)?.tvl).toBe(900);
  });

  it("rollback restores all cached keys to the pre-mutation snapshot", () => {
    queryClient.setQueryData(keys.balanceKey, 500);
    queryClient.setQueryData(keys.holdingsKey, [makeHolding()]);
    queryClient.setQueryData(keys.summaryKey, makeSummary());
    queryClient.setQueryData(keys.txKey, [makeTx()]);

    const snapshot = captureVaultOptimisticSnapshot(queryClient, WALLET);
    applyOptimisticVaultPatch(queryClient, WALLET, "deposit", 100);
    rollbackVaultOptimisticSnapshot(queryClient, WALLET, snapshot);

    expect(queryClient.getQueryData(keys.balanceKey)).toBe(500);
    expect(queryClient.getQueryData(keys.holdingsKey)).toEqual([makeHolding()]);
    expect(queryClient.getQueryData(keys.summaryKey)).toEqual(makeSummary());
    expect(queryClient.getQueryData(keys.txKey)).toEqual([makeTx()]);
  });

  it("rollback removes keys that did not exist before the optimistic patch", () => {
    const snapshot = captureVaultOptimisticSnapshot(queryClient, WALLET);
    expect(snapshot.balance.exists).toBe(false);

    applyOptimisticVaultPatch(queryClient, WALLET, "deposit", 50);
    expect(queryClient.getQueryData(keys.balanceKey)).toBe(0);

    rollbackVaultOptimisticSnapshot(queryClient, WALLET, snapshot);
    expect(queryClient.getQueryData(keys.balanceKey)).toBeUndefined();
    expect(queryClient.getQueryState(keys.balanceKey)).toBeUndefined();
  });
});
