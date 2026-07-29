/**
 * Shared amount parsing rules for deposit/withdraw forms.
 *
 * Mirrors the API's `AmountSchema` (`packages/api-schemas/src/primitives.ts`):
 * a positive decimal string with at most 7 fractional digits (Stellar's
 * stroop precision) and no scientific notation. Keeping the pattern in sync
 * means a value the frontend accepts will not be rejected by the API, and
 * vice versa.
 */

/** Matches `AmountSchema` in `packages/api-schemas/src/primitives.ts`. */
export const AMOUNT_PATTERN = /^\d+(\.\d{1,7})?$/;

export type ParseAmountResult =
  | { ok: true; amount: number }
  | { ok: false; error: string };

/**
 * Parses a raw form input string into a validated amount.
 *
 * Validation order intentionally matches the messages already surfaced by
 * `depositFormSchema` / `withdrawFormSchema`:
 * 1. empty input -> "Amount is required."
 * 2. not a finite number (e.g. "abc", "NaN", "Infinity") -> "Enter a valid number."
 * 3. zero or negative -> "Amount must be greater than 0."
 * 4. finite, positive, but not in canonical decimal form (scientific
 *    notation, more than 7 decimal places, leading "+", etc.) -> format error.
 */
export function parseAmountInput(rawValue: string): ParseAmountResult {
  const value = rawValue.trim();

  if (value.length === 0) {
    return { ok: false, error: "Amount is required." };
  }

  const numeric = Number(value);
  if (Number.isNaN(numeric) || !Number.isFinite(numeric)) {
    return { ok: false, error: "Enter a valid number." };
  }

  if (numeric <= 0) {
    return { ok: false, error: "Amount must be greater than 0." };
  }

  if (!AMOUNT_PATTERN.test(value)) {
    return {
      ok: false,
      error: "Enter an amount using digits only, with up to 7 decimal places.",
    };
  }

  return { ok: true, amount: numeric };
}
