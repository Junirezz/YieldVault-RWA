import { useQuery } from "@tanstack/react-query";
import { getTransactions } from "../lib/transactionApi";
import { queryKeys } from "../lib/queryClient";

/**
 * Hook for fetching transaction history with caching.
 * Stale time: 15s (transactions update frequently)
 * Only fetches when wallet is connected.
 */
export function useTransactionHistory(walletAddress: string | null) {
  return useQuery({
    queryKey: queryKeys.transactions.list(walletAddress),
    queryFn: () => {
      if (!walletAddress) {
        throw new Error("Wallet address required");
      }
      return getTransactions(walletAddress);
    },
    staleTime: 15000, // 15 seconds
    enabled: !!walletAddress, // Only fetch when wallet is connected
  });
}
