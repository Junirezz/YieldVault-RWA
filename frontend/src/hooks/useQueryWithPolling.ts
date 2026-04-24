import { useCallback, useState } from 'react';
import type { UseQueryResult } from "@tanstack/react-query";
import { usePolling } from './usePolling';

interface PollingInterval {
  fast: number;
  normal: number;
  slow: number;
}

export const POLLING_INTERVALS: PollingInterval = {
  fast: 10000,
  normal: 30000,
  slow: 60000,
};

interface UseQueryWithPollingOptions {
  interval?: number;
  enabled?: boolean;
  pauseOnHidden?: boolean;
  pauseOnOffline?: boolean;
}

interface UseQueryWithPollingResult<T> {
  query: UseQueryResult<T, Error>;
  polling: {
    isPolling: boolean;
    isPaused: boolean;
    pauseReason: 'hidden' | 'offline' | 'manual' | null;
    pause: () => void;
    resume: () => void;
    forceRefresh: () => void;
  };
  lastUpdated: Date | null;
}

export function useQueryWithPolling<T>(
  query: UseQueryResult<T, Error>,
  options: UseQueryWithPollingOptions = {}
): UseQueryWithPollingResult<T> {
  const {
    interval = POLLING_INTERVALS.normal,
    enabled = true,
    pauseOnHidden = true,
    pauseOnOffline = true,
  } = options;

  const [lastUpdated, setLastUpdated] = useState<Date | null>(
    query.dataUpdatedAt ? new Date(query.dataUpdatedAt) : null
  );

  const refetchFn = useCallback(async () => {
    const result = await query.refetch();
    if (result.data !== undefined) {
      setLastUpdated(new Date());
    }
    return result;
  }, [query]);

  const polling = usePolling(refetchFn, {
    interval,
    enabled: enabled && !query.isLoading,
    pauseOnHidden,
    pauseOnOffline,
  });

  const forceRefresh = useCallback(() => {
    polling.forceRefresh();
  }, [polling]);

  return {
    query,
    polling: {
      ...polling,
      forceRefresh,
    },
    lastUpdated,
  };
}
