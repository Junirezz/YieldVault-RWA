import { useState } from "react";

export type ApprovalStatus = "idle" | "pending" | "confirmed" | "error";

/**
 * Simulates USDC allowance check and approval flow.
 *
 * In production this would call the USDC contract's `allowance(owner, spender)`
 * view function and submit an `approve(spender, amount)` transaction.
 */
export function useTokenAllowance(walletAddress: string | null) {
  // Simulate: new wallets start with 0 allowance
  const [allowance, setAllowance] = useState<number>(0);
  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus>("idle");

  const needsApproval = (depositAmount: number) =>
    walletAddress !== null && allowance < depositAmount && depositAmount > 0;

  const approve = async (amount: number): Promise<void> => {
    setApprovalStatus("pending");
    try {
      // Simulate on-chain approval tx (~1.5 s)
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));
      setAllowance(amount);
      setApprovalStatus("confirmed");
    } catch {
      setApprovalStatus("error");
      throw new Error("Approval transaction failed.");
    }
  };

  const resetApproval = () => {
    setApprovalStatus("idle");
  };

  return { allowance, approvalStatus, needsApproval, approve, resetApproval };
}
