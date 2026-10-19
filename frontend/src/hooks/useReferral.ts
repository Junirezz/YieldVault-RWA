import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { isApiError } from "../lib/api/error";
import { queryKeys } from "../lib/queryClient";

export interface ReferralStats {
  referral_count: number;
  total_reward_earned: string;
}

export interface ReferralCode {
  code: string;
}

/**
 * A 404 means the wallet simply has no referral activity yet, which is an
 * empty state rather than a failure.
 */
function isNotFound(error: unknown): boolean {
  return isApiError(error) && error.status === 404;
}

/**
 * Hook to fetch referral stats for a wallet address.
 *
 * Missing referral activity (404) resolves to `null`; any other failure is
 * rethrown so React Query exposes `isError`/`error` instead of silently
 * reporting empty earnings (issue #1624).
 */
export function useReferralStats(walletAddress: string | null) {
  return useQuery({
    queryKey: queryKeys.referral.stats(walletAddress),
    queryFn: async (): Promise<ReferralStats | null> => {
      if (!walletAddress) return null;
      try {
        return await apiClient.get<ReferralStats>(`/api/v1/referrals/${walletAddress}`);
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
    },
    enabled: !!walletAddress,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to get or create referral code for a wallet address
 */
export function useReferralCode(walletAddress: string | null) {
  return useQuery({
    queryKey: queryKeys.referral.code(walletAddress),
    queryFn: async (): Promise<ReferralCode | null> => {
      if (!walletAddress) return null;
      return await apiClient.get<ReferralCode>(`/api/v1/referrals/code/${walletAddress}`);
    },
    enabled: !!walletAddress,
    staleTime: 30 * 60 * 1000, // 30 minutes - codes are persistent
  });
}

/**
 * Hook to generate referral link.
 *
 * Surfaces the underlying query's loading/error state so callers do not have
 * to treat a failed request as "no referral link yet".
 */
export function useReferralLink(walletAddress: string | null) {
  const {
    data: referralCode,
    isLoading,
    isError,
    error,
  } = useReferralCode(walletAddress);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const referralLink = referralCode ? `${baseUrl}/?ref=${referralCode.code}` : null;

  return {
    referralLink,
    referralCode: referralCode?.code,
    isLoading,
    isError,
    error,
  };
}
