import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  invalidateBalanceQueries,
  invalidatePortfolioQueries,
  invalidateTransactionQueries,
  invalidateVaultQueries,
} from "../lib/queryClient";

/**
 * Cache invalidation helpers for domain queries.
 * Call after a successful mutation when optimistic updates are not used.
 */
export function useInvalidateQueries() {
  const queryClient = useQueryClient();

  const invalidateVault = useCallback(
    () => invalidateVaultQueries(queryClient),
    [queryClient],
  );

  const invalidatePortfolio = useCallback(
    (walletAddress?: string | null) =>
      invalidatePortfolioQueries(queryClient, walletAddress),
    [queryClient],
  );

  const invalidateTransactions = useCallback(
    (walletAddress?: string | null) =>
      invalidateTransactionQueries(queryClient, walletAddress),
    [queryClient],
  );

  const invalidateBalances = useCallback(
    () => invalidateBalanceQueries(queryClient),
    [queryClient],
  );

  const invalidateAll = useCallback(
    () => queryClient.invalidateQueries(),
    [queryClient],
  );

  return {
    invalidateVault,
    invalidatePortfolio,
    invalidateTransactions,
    invalidateBalances,
    invalidateAll,
  };
}
