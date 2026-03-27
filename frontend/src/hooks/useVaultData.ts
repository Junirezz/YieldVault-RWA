import { useQuery } from "@tanstack/react-query";
import { getVaultSummary, getVaultHistory } from "../lib/vaultApi";
import { queryKeys } from "../lib/queryClient";

/**
 * Hook for fetching vault summary with caching.
 * Stale time: 30s (vault metrics update slowly)
 */
export function useVaultSummary() {
  return useQuery({
    queryKey: queryKeys.vault.summary(),
    queryFn: getVaultSummary,
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook for fetching vault performance history with caching.
 * Stale time: 60s (historical data changes infrequently)
 */
export function useVaultHistory() {
  return useQuery({
    queryKey: queryKeys.vault.history(),
    queryFn: getVaultHistory,
    staleTime: 60000, // 60 seconds
  });
}
