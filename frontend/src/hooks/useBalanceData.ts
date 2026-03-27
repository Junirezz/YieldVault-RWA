import { useQuery } from "@tanstack/react-query";
import { fetchUsdcBalance } from "../lib/stellarAccount";
import { queryKeys } from "../lib/queryClient";

/**
 * Hook for fetching USDC balance with caching.
 * Stale time: 10s (balance is real-time critical but we don't want to spam)
 * Only fetches when wallet is connected.
 */
export function useUsdcBalance(walletAddress: string | null) {
  return useQuery({
    queryKey: queryKeys.balance.usdc(walletAddress),
    queryFn: async () => {
      if (!walletAddress) {
        return 0;
      }
      try {
        return await fetchUsdcBalance(walletAddress);
      } catch {
        return 0;
      }
    },
    staleTime: 10000, // 10 seconds
    enabled: !!walletAddress, // Only fetch when wallet is connected
  });
}
