import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../lib/queryClient";
import type { PortfolioHolding } from "../lib/portfolioApi";
import type { VaultSummary } from "../lib/vaultApi";
import { submitDeposit, submitWithdrawal } from "../lib/vaultApi";
import type { Transaction } from "../lib/transactionApi";

interface MutationParams {
  walletAddress: string;
  amount: number;
  referralCode?: string;
}

interface OptimisticSnapshot {
  balance?: number;
  holdings?: PortfolioHolding[];
  summary?: VaultSummary;
  transactions?: Transaction[];
}

function buildPendingTransaction(
  action: "deposit" | "withdrawal",
  amount: number,
): Transaction {
  return {
    id: `optimistic-${action}-${Date.now()}`,
    type: action,
    amount: amount.toFixed(2),
    asset: "USDC",
    timestamp: new Date().toISOString(),
    transactionHash: "pending-confirmation",
  };
}

function updateHoldings(
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
 * Deposit mutation with optimistic UI cache updates.
 */
export function useDepositMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ walletAddress, amount, referralCode }: MutationParams) => {
      await submitDeposit({
        walletAddress,
        amount: amount.toString(),
        asset: "USDC",
        referralCode,
      });
      return { walletAddress, amount, referralCode };
    },
    onMutate: async ({ walletAddress, amount }) => {
      const balanceKey = queryKeys.balance.usdc(walletAddress);
      const holdingsKey = queryKeys.portfolio.holdings(walletAddress);
      const summaryKey = queryKeys.vault.summary();
      const txKey = queryKeys.transactions.list(walletAddress);

      await Promise.all([
        queryClient.cancelQueries({ queryKey: balanceKey }),
        queryClient.cancelQueries({ queryKey: holdingsKey }),
        queryClient.cancelQueries({ queryKey: summaryKey }),
        queryClient.cancelQueries({ queryKey: txKey }),
      ]);

      const snapshot: OptimisticSnapshot = {
        balance: queryClient.getQueryData<number>(balanceKey),
        holdings: queryClient.getQueryData<PortfolioHolding[]>(holdingsKey),
        summary: queryClient.getQueryData<VaultSummary>(summaryKey),
        transactions: queryClient.getQueryData<Transaction[]>(txKey),
      };

      queryClient.setQueryData<number>(balanceKey, (current = 0) =>
        Math.max(current - amount, 0),
      );
      queryClient.setQueryData<PortfolioHolding[] | undefined>(
        holdingsKey,
        (current) => updateHoldings(current, amount),
      );
      queryClient.setQueryData<VaultSummary | undefined>(summaryKey, (current) =>
        current
          ? {
              ...current,
              tvl: current.tvl + amount,
              updatedAt: new Date().toISOString(),
            }
          : current,
      );
      queryClient.setQueryData<Transaction[] | undefined>(txKey, (current) => [
        buildPendingTransaction("deposit", amount),
        ...(current ?? []),
      ]);

      return snapshot;
    },
    onError: (_error, variables, snapshot) => {
      queryClient.setQueryData(
        queryKeys.balance.usdc(variables.walletAddress),
        snapshot?.balance,
      );
      queryClient.setQueryData(
        queryKeys.portfolio.holdings(variables.walletAddress),
        snapshot?.holdings,
      );
      queryClient.setQueryData(queryKeys.vault.summary(), snapshot?.summary);
      queryClient.setQueryData(
        queryKeys.transactions.list(variables.walletAddress),
        snapshot?.transactions,
      );
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.balance.usdc(variables.walletAddress),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.portfolio.holdings(variables.walletAddress),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.vault.summary(),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.transactions.list(variables.walletAddress),
      });
    },
  });
}

/**
 * Withdrawal mutation with optimistic UI cache updates.
 */
export function useWithdrawMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ walletAddress, amount }: MutationParams) => {
      const shares = Math.max(1, Math.round(amount));
      await submitWithdrawal({
        walletAddress,
        shares,
        asset: "USDC",
      });
      return { walletAddress, amount };
    },
    onMutate: async ({ walletAddress, amount }) => {
      const balanceKey = queryKeys.balance.usdc(walletAddress);
      const holdingsKey = queryKeys.portfolio.holdings(walletAddress);
      const summaryKey = queryKeys.vault.summary();
      const txKey = queryKeys.transactions.list(walletAddress);

      await Promise.all([
        queryClient.cancelQueries({ queryKey: balanceKey }),
        queryClient.cancelQueries({ queryKey: holdingsKey }),
        queryClient.cancelQueries({ queryKey: summaryKey }),
        queryClient.cancelQueries({ queryKey: txKey }),
      ]);

      const snapshot: OptimisticSnapshot = {
        balance: queryClient.getQueryData<number>(balanceKey),
        holdings: queryClient.getQueryData<PortfolioHolding[]>(holdingsKey),
        summary: queryClient.getQueryData<VaultSummary>(summaryKey),
        transactions: queryClient.getQueryData<Transaction[]>(txKey),
      };

      queryClient.setQueryData<number>(balanceKey, (current = 0) =>
        Math.max(current - amount, 0),
      );
      queryClient.setQueryData<PortfolioHolding[] | undefined>(
        holdingsKey,
        (current) => updateHoldings(current, -amount),
      );
      queryClient.setQueryData<VaultSummary | undefined>(summaryKey, (current) =>
        current
          ? {
              ...current,
              tvl: Math.max(current.tvl - amount, 0),
              updatedAt: new Date().toISOString(),
            }
          : current,
      );
      queryClient.setQueryData<Transaction[] | undefined>(txKey, (current) => [
        buildPendingTransaction("withdrawal", amount),
        ...(current ?? []),
      ]);

      return snapshot;
    },
    onError: (_error, variables, snapshot) => {
      queryClient.setQueryData(
        queryKeys.balance.usdc(variables.walletAddress),
        snapshot?.balance,
      );
      queryClient.setQueryData(
        queryKeys.portfolio.holdings(variables.walletAddress),
        snapshot?.holdings,
      );
      queryClient.setQueryData(queryKeys.vault.summary(), snapshot?.summary);
      queryClient.setQueryData(
        queryKeys.transactions.list(variables.walletAddress),
        snapshot?.transactions,
      );
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.balance.usdc(variables.walletAddress),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.portfolio.holdings(variables.walletAddress),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.vault.summary(),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.transactions.list(variables.walletAddress),
      });
    },
  });
}
