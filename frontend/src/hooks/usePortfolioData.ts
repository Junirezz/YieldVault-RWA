import { useQuery } from "@tanstack/react-query";
import { getPortfolioHoldings } from "../lib/portfolioApi";
import { queryKeys } from "../lib/queryClient";

/**
 * Hook for fetching portfolio holdings with caching.
 * Stale time: 20s (user portfolio updates moderately)
 * Only fetches when wallet is connected.
 */
export function usePortfolioHoldings(walletAddress: string | null) {
  return useQuery({
    queryKey: queryKeys.portfolio.holdings(walletAddress),
    queryFn: getPortfolioHoldings,
    staleTime: 20000, // 20 seconds
    enabled: !!walletAddress, // Only fetch when wallet is connected
  });
}
