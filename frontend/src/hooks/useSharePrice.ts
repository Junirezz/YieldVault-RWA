import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useQueryWithPolling, POLLING_INTERVALS } from "./useQueryWithPolling";
import { getSharePrice } from "../lib/vaultApi";
import { queryKeys } from "../lib/queryClient";
import { log } from "../lib/logger";

export interface UseSharePriceResult {
  sharePrice: number | null;
  isLoading: boolean;
  isRefetching: boolean;
  error: Error | null;
  lastUpdated: Date | null;
  forceRefresh: () => void;
}

export function useSharePrice(): UseSharePriceResult {
  const query = useQuery({
    queryKey: queryKeys.vault.sharePrice(),
    queryFn: getSharePrice,
    staleTime: POLLING_INTERVALS.normal,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const { polling, lastUpdated } = useQueryWithPolling(query, {
    interval: POLLING_INTERVALS.normal,
    pauseOnHidden: true,
    pauseOnOffline: true,
  });

  useEffect(() => {
    if (query.error) {
      log("warn", "Share price fetch failed", {
        errorCode: query.error.name,
        message: query.error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }, [query.error]);

  return {
    sharePrice: query.data ?? null,
    isLoading: query.isLoading,
    isRefetching: query.isFetching && !query.isLoading,
    error: query.error,
    lastUpdated,
    forceRefresh: polling.forceRefresh,
  };
}
