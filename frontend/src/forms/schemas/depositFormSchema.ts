/**
 * Validation schema for the deposit form.
 *
 * Enforces business rules for vault deposits:
 * - Amount is required and must be a positive number
 * - Amount must meet minimum deposit requirement
 * - Amount must not exceed the configured maximum deposit limit
 * - Decimal places must not exceed the display precision for USDC
 * - Amount cannot exceed user's available USDC balance
 * - Amount cannot exceed vault capacity (if reached)
 * - User must have sufficient XLM balance for network fees
 */

import type { ValidationSchema } from "../validate";
import { parseAmountInput } from "./amountValidation";

export interface DepositFormValues {
  amount: string;
}

/** Minimum deposit amount in USDC. */
export const MIN_DEPOSIT_AMOUNT = 1;

/**
 * Maximum single-deposit amount in USDC.
 *
 * Acts as a sanity cap independent of the user's wallet balance or vault
 * capacity. Prevents accidentally submitting excessively large transactions
 * and gives the form a concrete upper bound to display to users.
 */
export const MAX_DEPOSIT_AMOUNT = 1_000_000;

/**
 * Maximum decimal places accepted for a USDC deposit in the UI.
 *
 * The API and Stellar network accept up to 7 decimal places (stroop
 * precision), but USDC conventionally uses 2 decimal places for display.
 * This constant enforces the user-facing precision limit so users aren't
 * confused by amounts like "100.1234567" being valid on the wire but
 * unusual in practice.
 *
 * If a vault operator needs to accept sub-cent amounts they can override
 * this via the `maxDecimals` parameter of `createDepositFormSchema`.
 */
export const USDC_DISPLAY_DECIMALS = 2;

/**
 * Build an error message for the maximum deposit exceeded case.
 * Exported so UI components can generate the same copy without importing
 * the full schema factory.
 */
export function buildMaxDepositError(maxAmount: number): string {
  return `Maximum deposit is ${maxAmount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USDC.`;
}

/**
 * Build an error message for the precision exceeded case.
 */
export function buildPrecisionError(maxDecimals: number): string {
  return `Enter an amount with up to ${maxDecimals} decimal place${maxDecimals === 1 ? "" : "s"}.`;
}

/**
 * Count the number of decimal places in a trimmed numeric string.
 * Returns 0 for integers or strings without a decimal point.
 */
function countDecimals(value: string): number {
  const dotIndex = value.indexOf(".");
  return dotIndex === -1 ? 0 : value.length - dotIndex - 1;
}

/**
 * Create a deposit form validation schema.
 *
 * @param availableBalance - User's available USDC balance
 * @param isCapReached - Whether the vault has reached its deposit cap
 * @param xlmBalance - User's available XLM balance
 * @param feeXlm - Estimated XLM required for network fees
 * @param maxAmount - Upper bound for a single deposit (defaults to MAX_DEPOSIT_AMOUNT)
 * @param maxDecimals - Maximum decimal places accepted (defaults to USDC_DISPLAY_DECIMALS)
 * @returns Validation schema for deposit form
 */
export function createDepositFormSchema(
  availableBalance: number,
  isCapReached: boolean,
  xlmBalance: number,
  feeXlm: number,
  maxAmount: number = MAX_DEPOSIT_AMOUNT,
  maxDecimals: number = USDC_DISPLAY_DECIMALS,
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

        // Check maximum deposit amount
        if (num > maxAmount) {
          return buildMaxDepositError(maxAmount);
        }

        // Check decimal precision
        if (countDecimals(value.trim()) > maxDecimals) {
          return buildPrecisionError(maxDecimals);
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
