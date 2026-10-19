import { useState, useEffect } from "react";
import { estimateNetworkFee, getXlmPrice } from "../lib/vaultApi";
import { useQuery } from "@tanstack/react-query";

/**
 * Hook for estimating network fees for vault operations.
 * Fetches current XLM price with polling (60s interval).
 *
 * @param walletAddress - User's wallet address
 * @param amount - Amount for which to estimate the fee
 * @param action - Type of action: 'deposit' or 'withdraw'
 * @param enabledNetworkPolling - Optional flag to enable/disable XLM price polling (defaults to true)
 *                                Pass `isOnline` from useNetworkStatus to pause polling when offline
 *
 * @example
 * ```tsx
 * const { isOnline } = useNetworkStatus();
 * const { feeXlm, feeUsd } = useFeeEstimate(address, "100", "deposit", isOnline);
 * ```
 */
export function useFeeEstimate(
  walletAddress: string | null,
  amount: string,
  action: "deposit" | "withdraw",
  enabledNetworkPolling = true
) {
  const [feeXlm, setFeeXlm] = useState<number>(0);
  const [feeUsd, setFeeUsd] = useState<number>(0);
  const [isEstimating, setIsEstimating] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const { data: xlmPrice = 0.12 } = useQuery({
    queryKey: ["xlmPrice"],
    queryFn: getXlmPrice,
    refetchInterval: 60000, // Refresh every minute
    enabled: enabledNetworkPolling, // Support pause/resume based on network status
  });

  useEffect(() => {
    const enteredAmount = Number(amount);
    if (!walletAddress || isNaN(enteredAmount) || enteredAmount <= 0) {
      queueMicrotask(() => {
        setFeeXlm(0);
        setFeeUsd(0);
        setLastUpdated(null);
        setError(null);
      });
      return;
    }

    let isCancelled = false;
    const fetchEstimate = async () => {
      setIsEstimating(true);
      try {
        const xlmFeeStr = await estimateNetworkFee({
          walletAddress,
          amount: enteredAmount,
          action,
        });
        
        if (!isCancelled) {
          const xlmFee = parseFloat(xlmFeeStr);
          setFeeXlm(xlmFee);
          setFeeUsd(xlmFee * xlmPrice);
          setLastUpdated(new Date());
          setError(null);
        }
      } catch (caught) {
        console.error("Fee estimation failed", caught);
        if (!isCancelled) {
          // Surface the failure instead of leaving a stale quote on screen
          // (issue #1624).
          setFeeXlm(0);
          setFeeUsd(0);
          setLastUpdated(null);
          setError(caught instanceof Error ? caught : new Error(String(caught)));
        }
      } finally {
        if (!isCancelled) {
          setIsEstimating(false);
        }
      }
    };

    const timer = setTimeout(fetchEstimate, 500); // Debounce
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [walletAddress, amount, action, xlmPrice]);

  const feeToValueRatio = Number(amount) > 0 ? feeUsd / Number(amount) : 0;
  const isHighFee = feeToValueRatio > 0.01;

  return {
    feeXlm,
    feeUsd,
    isEstimating,
    isHighFee,
    feeToValueRatio,
    lastUpdated,
    error,
    isError: error !== null,
  };
}
