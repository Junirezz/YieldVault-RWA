import { useCallback, useState } from "react";
import { submitUsdcApproval } from "../lib/approvalApi";

export type ApprovalStatus = "idle" | "pending" | "confirmed" | "error";

/**
 * Simulates USDC allowance check and approval flow.
 *
 * In production this would call the USDC contract's `allowance(owner, spender)`
 * view function and submit an `approve(spender, amount)` transaction.
 */
const e2ePreApproved = import.meta.env.VITE_E2E_STUB_BALANCES === "true";

export function useTokenAllowance(walletAddress: string | null) {
  // Simulate: new wallets start with 0 allowance (pre-approved in E2E builds)
  const [allowance, setAllowance] = useState<number>(
    e2ePreApproved ? Number.MAX_SAFE_INTEGER : 0,
  );
  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus>(
    e2ePreApproved ? "confirmed" : "idle",
  );
  // Last approval failure, surfaced to callers instead of being swallowed
  // (issue #1624).
  const [error, setError] = useState<Error | null>(null);

  const needsApproval = useCallback(
    (depositAmount: number) =>
      walletAddress !== null && allowance < depositAmount && depositAmount > 0,
    [walletAddress, allowance],
  );

  const approve = useCallback(
    async (amount: number): Promise<void> => {
      if (!walletAddress) {
        const walletError = new Error(
          "A connected wallet is required to approve USDC.",
        );
        setError(walletError);
        setApprovalStatus("error");
        throw walletError;
      }

      setError(null);
      setApprovalStatus("pending");
      try {
        await submitUsdcApproval(walletAddress, amount);
        setAllowance(amount);
        setApprovalStatus("confirmed");
      } catch (cause) {
        const approvalError =
          cause instanceof Error
            ? cause
            : new Error("Approval transaction failed.");
        setError(approvalError);
        setApprovalStatus("error");
        throw approvalError;
      }
    },
    [walletAddress],
  );

  const resetApproval = useCallback(() => {
    setError(null);
    setApprovalStatus("idle");
  }, []);

  return {
    allowance,
    approvalStatus,
    needsApproval,
    approve,
    resetApproval,
    error,
    isError: error !== null,
  };
}
