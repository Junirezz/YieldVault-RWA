import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../lib/queryClient";

/**
 * Simulated deposit mutation with cache invalidation.
 * In production, this would call the actual contract interaction.
 */
export function useDepositMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { walletAddress: string; amount: number }) => {
      // Simulate API call delay
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return { success: true, ...params };
    },
    onSuccess: (_, variables) => {
      // Invalidate related queries to trigger refetch
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
 * Simulated withdrawal mutation with cache invalidation.
 * In production, this would call the actual contract interaction.
 */
export function useWithdrawMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { walletAddress: string; amount: number }) => {
      // Simulate API call delay
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return { success: true, ...params };
    },
    onSuccess: (_, variables) => {
      // Invalidate related queries to trigger refetch
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
