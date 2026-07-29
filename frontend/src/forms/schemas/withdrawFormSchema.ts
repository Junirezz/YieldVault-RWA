/**
 * Validation schema for the withdraw form.
 * 
 * Enforces business rules for vault withdrawals:
 * - Amount is required and must be a positive number, formatted like the API's AmountSchema
 * - Amount cannot exceed user's vault balance
 * - User must have sufficient XLM balance for network fees (when provided)
 */

import type { ValidationSchema } from "../validate";
import { parseAmountInput } from "./amountValidation";

export interface WithdrawFormValues {
  amount: string;
}

/**
 * Create a withdraw form validation schema.
 * 
 * @param availableBalance - User's available vault balance (sum of holdings value, in USD)
 * @param xlmBalance - User's available XLM balance (defaults to Infinity, i.e. no fee check)
 * @param feeXlm - Estimated XLM required for network fees (defaults to 0, i.e. no fee check)
 * @returns Validation schema for withdraw form
 */
export function createWithdrawFormSchema(
  availableBalance: number,
  xlmBalance: number = Infinity,
  feeXlm: number = 0,
): ValidationSchema<WithdrawFormValues> {
  return {
    amount: {
      required: "Amount is required.",
      custom: (value) => {
        const parsed = parseAmountInput(value);
        if (!parsed.ok) {
          return parsed.error;
        }
        const num = parsed.amount;

        // Check available vault balance
        if (num > availableBalance) {
          return `Withdrawal amount cannot exceed your available vault balance of ${availableBalance.toFixed(2)}.`;
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
