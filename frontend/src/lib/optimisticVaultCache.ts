import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { queryKeys } from "./queryClient";
import type { PortfolioHolding } from "./portfolioApi";
import type { VaultSummary } from "./vaultApi";
import type { Transaction } from "./transactionApi";

export type VaultMutationAction = "deposit" | "withdrawal";

/**
 * Captures whether a query key had cached data so rollback can distinguish
 * "never cached" from "cached as undefined/empty".
 */
export interface SnapshotEntry<T> {
  exists: boolean;
  data?: T;
}

export interface VaultOptimisticSnapshot {
  balance: SnapshotEntry<number>;
  holdings: SnapshotEntry<PortfolioHolding[]>;
  summary: SnapshotEntry<VaultSummary>;
  transactions: SnapshotEntry<Transaction[]>;
}

export interface VaultCacheKeys {
  balanceKey: QueryKey;
  holdingsKey: QueryKey;
  summaryKey: QueryKey;
  txKey: QueryKey;
}

export function getVaultCacheKeys(walletAddress: string): VaultCacheKeys {
  return {
    balanceKey: queryKeys.balance.usdc(walletAddress),
    holdingsKey: queryKeys.portfolio.holdings(walletAddress),
    summaryKey: queryKeys.vault.summary(),
    txKey: queryKeys.transactions.list(walletAddress),
  };
}

function captureEntry<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
): SnapshotEntry<T> {
  const state = queryClient.getQueryState(queryKey);
  if (!state) {
    return { exists: false };
  }

  return {
    exists: true,
    data: queryClient.getQueryData<T>(queryKey),
  };
}

export function captureVaultOptimisticSnapshot(
  queryClient: QueryClient,
  walletAddress: string,
): VaultOptimisticSnapshot {
  const keys = getVaultCacheKeys(walletAddress);
  return {
    balance: captureEntry<number>(queryClient, keys.balanceKey),
    holdings: captureEntry<PortfolioHolding[]>(queryClient, keys.holdingsKey),
    summary: captureEntry<VaultSummary>(queryClient, keys.summaryKey),
    transactions: captureEntry<Transaction[]>(queryClient, keys.txKey),
  };
}

export function restoreSnapshotEntry<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  entry: SnapshotEntry<T> | undefined,
): void {
  if (!entry) {
    return;
  }

  if (!entry.exists) {
    queryClient.removeQueries({ queryKey, exact: true });
    return;
  }

  queryClient.setQueryData(queryKey, entry.data);
}

export function rollbackVaultOptimisticSnapshot(
  queryClient: QueryClient,
  walletAddress: string,
  snapshot: VaultOptimisticSnapshot | undefined,
): void {
  if (!snapshot) {
    return;
  }

  const keys = getVaultCacheKeys(walletAddress);
  restoreSnapshotEntry(queryClient, keys.balanceKey, snapshot.balance);
  restoreSnapshotEntry(queryClient, keys.holdingsKey, snapshot.holdings);
  restoreSnapshotEntry(queryClient, keys.summaryKey, snapshot.summary);
  restoreSnapshotEntry(queryClient, keys.txKey, snapshot.transactions);
}

export async function cancelVaultOptimisticQueries(
  queryClient: QueryClient,
  walletAddress: string,
): Promise<void> {
  const keys = getVaultCacheKeys(walletAddress);
  await Promise.all([
    queryClient.cancelQueries({ queryKey: keys.balanceKey }),
    queryClient.cancelQueries({ queryKey: keys.holdingsKey }),
    queryClient.cancelQueries({ queryKey: keys.summaryKey }),
    queryClient.cancelQueries({ queryKey: keys.txKey }),
  ]);
}

export function invalidateVaultOptimisticQueries(
  queryClient: QueryClient,
  walletAddress: string,
): void {
  const keys = getVaultCacheKeys(walletAddress);
  void queryClient.invalidateQueries({ queryKey: keys.balanceKey });
  void queryClient.invalidateQueries({ queryKey: keys.holdingsKey });
  void queryClient.invalidateQueries({ queryKey: keys.summaryKey });
  void queryClient.invalidateQueries({ queryKey: keys.txKey });
}

export function buildPendingTransaction(
  action: VaultMutationAction,
  amount: number,
  now: number = Date.now(),
): Transaction {
  return {
    id: `optimistic-${action}-${now}`,
    type: action,
    status: "pending",
    amount: amount.toFixed(2),
    asset: "USDC",
    timestamp: new Date(now).toISOString(),
    transactionHash: `pending-${now}`,
  };
}

export function updateHoldings(
  current: PortfolioHolding[] | undefined,
  deltaUsd: number,
): PortfolioHolding[] | undefined {
  if (!current?.length) {
    return current;
  }

  return current.map((holding, index) =>
    index === 0
      ? {
          ...holding,
          valueUsd: Math.max(holding.valueUsd + deltaUsd, 0),
          status: "pending",
        }
      : holding,
  );
}

/**
 * Apply optimistic cache patches for a deposit or withdrawal.
 *
 * Deposit: wallet USDC decreases, vault holdings/TVL increase.
 * Withdrawal: wallet USDC increases, vault holdings/TVL decrease.
 */
export function applyOptimisticVaultPatch(
  queryClient: QueryClient,
  walletAddress: string,
  action: VaultMutationAction,
  amount: number,
  now: number = Date.now(),
): void {
  const keys = getVaultCacheKeys(walletAddress);
  const walletDelta = action === "deposit" ? -amount : amount;
  const vaultDelta = action === "deposit" ? amount : -amount;

  queryClient.setQueryData<number>(keys.balanceKey, (current = 0) =>
    Math.max(current + walletDelta, 0),
  );
  queryClient.setQueryData<PortfolioHolding[] | undefined>(
    keys.holdingsKey,
    (current) => updateHoldings(current, vaultDelta),
  );
  queryClient.setQueryData<VaultSummary | undefined>(keys.summaryKey, (current) =>
    current
      ? {
          ...current,
          tvl: Math.max(current.tvl + vaultDelta, 0),
          updatedAt: new Date(now).toISOString(),
        }
      : current,
  );
  queryClient.setQueryData<Transaction[] | undefined>(keys.txKey, (current) => [
    buildPendingTransaction(action, amount, now),
    ...(current ?? []),
  ]);
}
