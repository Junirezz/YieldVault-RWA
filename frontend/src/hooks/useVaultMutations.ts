import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../lib/queryClient";
/**
 * Simulated deposit mutation with optimistic UI updates.
 * In production, this would call the actual contract interaction.
 */
export function useDepositMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { walletAddress: string; amount: number }) => {
      // Simulate tx broadcast + confirmation delay
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (Math.random() < 0.1) {
        throw new Error(
          "Deposit confirmation failed. Check network status and wallet approval.",
        );
      }
      return { success: true, ...params };
    },
    onSuccess: (_, variables) => {
      // Refresh related queries after confirmation
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
 * Simulated withdrawal mutation with optimistic UI updates.
 * In production, this would call the actual contract interaction.
 */
export function useWithdrawMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { walletAddress: string; amount: number }) => {
      // Simulate tx broadcast + confirmation delay
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (Math.random() < 0.1) {
        throw new Error(
          "Withdrawal confirmation failed. Verify liquidity and retry.",
        );
      }
      return { success: true, ...params };
    },
    onSuccess: (_, variables) => {
      // Refresh related queries after confirmation
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
