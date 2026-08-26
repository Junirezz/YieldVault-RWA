import { QueryClient } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";

/**
 * Global QueryClient configuration for React Query caching layer.
 *
 * Cache strategy (stale-while-revalidate):
 * - Fresh data is served from cache until staleTime elapses
 * - A background refetch runs after staleTime (SWR)
 * - Unused cache is retained for gcTime and dehydrated for offline reuse
 *
 * Domain stale times:
 * - Vault data: 30s
 * - Portfolio holdings: 20s
 * - Transactions: 15s
 * - Balance data: 10s
 */
export const QUERY_CACHE_KEY = "yieldvault-query-cache";
export const QUERY_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: QUERY_CACHE_MAX_AGE_MS,
      retry: 2,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchOnMount: true,
      networkMode: "offlineFirst",
      placeholderData: (previousData: unknown) => previousData,
    },
    mutations: {
      retry: 0,
      networkMode: "offlineFirst",
    },
  },
});

/**
 * Query keys for consistent cache management.
 * Using arrays allows for hierarchical invalidation.
 */
export const queryKeys = {
  vault: {
    all: ["vault"] as const,
    summary: () => [...queryKeys.vault.all, "summary"] as const,
    history: () => [...queryKeys.vault.all, "history"] as const,
    sharePrice: () => [...queryKeys.vault.all, "sharePrice"] as const,
    health: () => [...queryKeys.vault.all, "health"] as const,
  },
  portfolio: {
    all: ["portfolio"] as const,
    holdings: (walletAddress?: string | null) =>
      [...queryKeys.portfolio.all, "holdings", walletAddress] as const,
  },
  transactions: {
    all: ["transactions"] as const,
    list: (walletAddress?: string | null) =>
      [...queryKeys.transactions.all, "list", walletAddress] as const,
  },
  balance: {
    all: ["balance"] as const,
    usdc: (walletAddress?: string | null) =>
      [...queryKeys.balance.all, "usdc", walletAddress] as const,
    xlm: (walletAddress?: string | null) =>
      [...queryKeys.balance.all, "xlm", walletAddress] as const,
  },
} as const;

export function invalidateVaultQueries(client: QueryClient = queryClient) {
  return client.invalidateQueries({ queryKey: queryKeys.vault.all });
}

export function invalidatePortfolioQueries(
  client: QueryClient = queryClient,
  walletAddress?: string | null,
) {
  return client.invalidateQueries({
    queryKey: walletAddress
      ? queryKeys.portfolio.holdings(walletAddress)
      : queryKeys.portfolio.all,
  });
}

export function invalidateTransactionQueries(
  client: QueryClient = queryClient,
  walletAddress?: string | null,
) {
  return client.invalidateQueries({
    queryKey: walletAddress
      ? queryKeys.transactions.list(walletAddress)
      : queryKeys.transactions.all,
  });
}

export function invalidateBalanceQueries(
  client: QueryClient = queryClient,
) {
  return client.invalidateQueries({
    queryKey: queryKeys.balance.all,
  });
}

export function setupQueryPersistence(client: QueryClient = queryClient): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  if (import.meta.env.MODE === "test") {
    return () => undefined;
  }

  const persister = createSyncStoragePersister({
    storage: window.localStorage,
    key: QUERY_CACHE_KEY,
  });

  const [unsubscribe] = persistQueryClient({
    queryClient: client,
    persister,
    maxAge: QUERY_CACHE_MAX_AGE_MS,
    dehydrateOptions: {
      shouldDehydrateQuery: (query) => query.state.status === "success",
    },
  }) as unknown as [() => void];

  return typeof unsubscribe === "function" ? unsubscribe : () => undefined;
}
