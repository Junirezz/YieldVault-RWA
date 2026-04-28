import { useQuery, useMutation } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";

export interface ReferralStats {
  referral_count: number;
  total_reward_earned: string;
}

export interface ReferralCode {
  code: string;
}

/**
 * Hook to fetch referral stats for a wallet address
 */
export function useReferralStats(walletAddress: string | null) {
  return useQuery({
    queryKey: ["referralStats", walletAddress],
    queryFn: async (): Promise<ReferralStats | null> => {
      if (!walletAddress) return null;
      try {
        return await apiClient.get<ReferralStats>(`/api/v1/referrals/${walletAddress}`);
      } catch (error) {
        // Return null for 404 (no referral activity) or other errors
        return null;
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
    queryKey: ["referralCode", walletAddress],
    queryFn: async (): Promise<ReferralCode | null> => {
      if (!walletAddress) return null;
      return await apiClient.get<ReferralCode>(`/api/v1/referrals/code/${walletAddress}`);
    },
    enabled: !!walletAddress,
    staleTime: 30 * 60 * 1000, // 30 minutes - codes are persistent
  });
}

/**
 * Hook to generate referral link
 */
export function useReferralLink(walletAddress: string | null) {
  const { data: referralCode } = useReferralCode(walletAddress);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const referralLink = referralCode ? `${baseUrl}/?ref=${referralCode.code}` : null;

  return { referralLink, referralCode: referralCode?.code };
}