import { useState, useEffect } from "react";
import { estimateNetworkFee, getXlmPrice } from "../lib/vaultApi";
import { useQuery } from "@tanstack/react-query";

export function useFeeEstimate(
  walletAddress: string | null,
  amount: string,
  action: "deposit" | "withdraw"
) {
  const [feeXlm, setFeeXlm] = useState<number>(0);
  const [feeUsd, setFeeUsd] = useState<number>(0);
  const [isEstimating, setIsEstimating] = useState(false);

  const { data: xlmPrice = 0.12 } = useQuery({
    queryKey: ["xlmPrice"],
    queryFn: getXlmPrice,
    refetchInterval: 60000, // Refresh every minute
  });

  useEffect(() => {
    const enteredAmount = Number(amount);
    if (!walletAddress || isNaN(enteredAmount) || enteredAmount <= 0) {
      setFeeXlm(0);
      setFeeUsd(0);
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
        }
      } catch (error) {
        console.error("Fee estimation failed", error);
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
  };
}
