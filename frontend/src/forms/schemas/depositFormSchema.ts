/**
 * Validation schema for the deposit form.
 * 
 * Enforces business rules for vault deposits:
 * - Amount is required and must be a positive number
 * - Amount must meet minimum deposit requirement
 * - Amount cannot exceed user's available USDC balance
 * - Amount cannot exceed vault capacity (if reached)
 * - User must have sufficient XLM balance for network fees
 */

import type { ValidationSchema } from "../validate";
import { parseAmountInput } from "./amountValidation";

export interface DepositFormValues {
  amount: string;
}

/** Minimum deposit amount in USDC */
export const MIN_DEPOSIT_AMOUNT = 1;

/**
 * Create a deposit form validation schema.
 * 
 * @param availableBalance - User's available USDC balance
 * @param isCapReached - Whether the vault has reached its deposit cap
 * @param xlmBalance - User's available XLM balance
 * @param feeXlm - Estimated XLM required for network fees
 * @returns Validation schema for deposit form
 */
export function createDepositFormSchema(
  availableBalance: number,
  isCapReached: boolean,
  xlmBalance: number,
  feeXlm: number,
): ValidationSchema<DepositFormValues> {
  return {
    amount: {
      required: "Amount is required.",
      custom: (value) => {
        const parsed = parseAmountInput(value);
        if (!parsed.ok) {
          return parsed.error;
        }
        const num = parsed.amount;

        // Check minimum deposit amount
        if (num < MIN_DEPOSIT_AMOUNT) {
          return `Minimum deposit is ${MIN_DEPOSIT_AMOUNT.toFixed(2)} USDC.`;
        }

        // Check vault capacity
        if (isCapReached) {
          return "Deposits are temporarily disabled because the vault is at capacity.";
        }

        // Check available balance
        if (num > availableBalance) {
          return `Deposit amount cannot exceed your available USDC balance of ${availableBalance.toFixed(2)}.`;
        }

        // Check network fee coverage
        if (xlmBalance < feeXlm) {
          return `Insufficient XLM balance for network fees. You need ${feeXlm.toFixed(7)} XLM.`;
        }

        return undefined;
      },
    },
  };
}
