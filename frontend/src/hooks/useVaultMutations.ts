import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../lib/queryClient";
import { PortfolioHolding } from "../lib/portfolioApi";

/**
 * Simulated deposit mutation with optimistic UI updates.
 * In production, this would call the actual contract interaction.
 */
export function useDepositMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { walletAddress: string; amount: number }) => {
      // Simulate API call delay
      await new Promise((resolve) => setTimeout(resolve, 2000));
      // Randomly fail to test rollback (1 in 10 chance)
      if (Math.random() < 0.1) {
        throw new Error("Deposit failed (Simulated Error)");
      }
      return { success: true, ...params };
    },
    onMutate: async (variables) => {
      const { walletAddress, amount } = variables;

      // Cancel outgoing queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({
        queryKey: queryKeys.balance.usdc(walletAddress),
      });
      await queryClient.cancelQueries({
        queryKey: queryKeys.portfolio.holdings(walletAddress),
      });

      // Snapshot the previous values
      const prevBalance = queryClient.getQueryData<number>(
        queryKeys.balance.usdc(walletAddress),
      );
      const prevHoldings = queryClient.getQueryData<PortfolioHolding[]>(
        queryKeys.portfolio.holdings(walletAddress),
      );

      // Optimistically update the balance
      if (prevBalance !== undefined) {
        queryClient.setQueryData<number>(
          queryKeys.balance.usdc(walletAddress),
          prevBalance - amount,
        );
      }

      // Optimistically update holdings
      if (prevHoldings) {
        const updatedHoldings = prevHoldings.map((h) => {
          if (h.symbol === "yvUSDC") {
            return {
              ...h,
              shares: h.shares + amount,
              valueUsd: h.valueUsd + amount,
            };
          }
          return h;
        });
        queryClient.setQueryData<PortfolioHolding[]>(
          queryKeys.portfolio.holdings(walletAddress),
          updatedHoldings,
        );
      }

      return { prevBalance, prevHoldings };
    },
    onError: (err, variables, context) => {
      const { walletAddress } = variables;
      // Rollback to snapshots
      if (context?.prevBalance !== undefined) {
        queryClient.setQueryData(
          queryKeys.balance.usdc(walletAddress),
          context.prevBalance,
        );
      }
      if (context?.prevHoldings) {
        queryClient.setQueryData(
          queryKeys.portfolio.holdings(walletAddress),
          context.prevHoldings,
        );
      }
    },
    onSettled: (_, __, variables) => {
      // Invalidate related queries to ensure consistency
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
      // Simulate API call delay
      await new Promise((resolve) => setTimeout(resolve, 2000));
      // Randomly fail to test rollback (1 in 10 chance)
      if (Math.random() < 0.1) {
        throw new Error("Withdrawal failed (Simulated Error)");
      }
      return { success: true, ...params };
    },
    onMutate: async (variables) => {
      const { walletAddress, amount } = variables;

      // Cancel outgoing queries
      await queryClient.cancelQueries({
        queryKey: queryKeys.balance.usdc(walletAddress),
      });
      await queryClient.cancelQueries({
        queryKey: queryKeys.portfolio.holdings(walletAddress),
      });

      // Snapshot
      const prevBalance = queryClient.getQueryData<number>(
        queryKeys.balance.usdc(walletAddress),
      );
      const prevHoldings = queryClient.getQueryData<PortfolioHolding[]>(
        queryKeys.portfolio.holdings(walletAddress),
      );

      // Optimistically update balance (withdrawal increases USDC balance in this simulation)
      if (prevBalance !== undefined) {
        queryClient.setQueryData<number>(
          queryKeys.balance.usdc(walletAddress),
          prevBalance + amount,
        );
      }

      // Optimistically update holdings
      if (prevHoldings) {
        const updatedHoldings = prevHoldings.map((h) => {
          if (h.symbol === "yvUSDC") {
            return {
              ...h,
              shares: Math.max(0, h.shares - amount),
              valueUsd: Math.max(0, h.valueUsd - amount),
            };
          }
          return h;
        });
        queryClient.setQueryData<PortfolioHolding[]>(
          queryKeys.portfolio.holdings(walletAddress),
          updatedHoldings,
        );
      }

      return { prevBalance, prevHoldings };
    },
    onError: (err, variables, context) => {
      const { walletAddress } = variables;
      // Rollback
      if (context?.prevBalance !== undefined) {
        queryClient.setQueryData(
          queryKeys.balance.usdc(walletAddress),
          context.prevBalance,
        );
      }
      if (context?.prevHoldings) {
        queryClient.setQueryData(
          queryKeys.portfolio.holdings(walletAddress),
          context.prevHoldings,
        );
      }
    },
    onSettled: (_, __, variables) => {
      // Invalidate
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
