import { QueryClient } from "@tanstack/react-query";

/**
 * Global QueryClient configuration for React Query caching layer.
 * 
 * Cache Strategy:
 * - Vault data: 30s stale time (relatively stable)
 * - Portfolio holdings: 20s stale time (user-specific, moderate updates)
 * - Transactions: 15s stale time (frequently updated)
 * - Balance data: 10s stale time (real-time critical)
 * 
 * All queries cache for 5 minutes after becoming unused.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Global defaults
      staleTime: 30000, // 30 seconds - data considered fresh
      gcTime: 5 * 60 * 1000, // 5 minutes - cache retention after unused
      retry: 2, // Retry failed requests twice
      refetchOnWindowFocus: true, // Refetch when user returns to tab
      refetchOnReconnect: true, // Refetch when network reconnects
      refetchOnMount: true, // Refetch when component mounts if data is stale
    },
    mutations: {
      // Mutations don't retry by default to avoid duplicate operations
      retry: 0,
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
  },
} as const;
