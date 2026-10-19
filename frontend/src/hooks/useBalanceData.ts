import { useQuery } from "@tanstack/react-query";
import { fetchUsdcBalance, fetchXlmBalance } from "../lib/stellarAccount";
import { queryKeys } from "../lib/queryClient";

/**
 * Hook for fetching USDC balance with caching.
 * Stale time: 10s (balance is real-time critical but we don't want to spam)
 * Only fetches when wallet is connected.
 */
export function useUsdcBalance(walletAddress: string | null) {
  const e2eStub = import.meta.env.VITE_E2E_STUB_BALANCES === "true";

  return useQuery({
    queryKey: queryKeys.balance.usdc(walletAddress),
    queryFn: async () => {
      if (!walletAddress) {
        return 0;
      }
      if (e2eStub) {
        return 1250.5;
      }
      // Let failures propagate so React Query exposes `isError`/`error` and
      // consumers can render an error state instead of a misleading zero
      // balance (issue #1624).
      return fetchUsdcBalance(walletAddress);
    },
    staleTime: 10000, // 10 seconds
    enabled: !!walletAddress, // Only fetch when wallet is connected
  });
}

/**
 * Hook for fetching native XLM balance with caching.
 * Stale time: 10s
 * Only fetches when wallet is connected.
 */
export function useXlmBalance(walletAddress: string | null) {
  const e2eStub = import.meta.env.VITE_E2E_STUB_BALANCES === "true";

  return useQuery({
    queryKey: queryKeys.balance.xlm(walletAddress),
    queryFn: async () => {
      if (!walletAddress) {
        return 0;
      }
      if (e2eStub) {
        return 5;
      }
      // Let failures propagate so React Query exposes `isError`/`error` and
      // consumers can render an error state instead of a misleading zero
      // balance (issue #1624).
      return fetchXlmBalance(walletAddress);
    },
    staleTime: 10000, // 10 seconds
    enabled: !!walletAddress, // Only fetch when wallet is connected
  });
}
