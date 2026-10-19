import { z } from "zod";

/** Minimum accepted slippage tolerance, in percent. */
export const SLIPPAGE_MIN_PERCENT = 0.1;

/** Maximum accepted slippage tolerance, in percent. */
export const SLIPPAGE_MAX_PERCENT = 50;

/** Default slippage applied when nothing valid is stored. */
export const SLIPPAGE_DEFAULT_PERCENT = 0.5;

/** Slippage at or above which the UI shows a high-slippage warning, in percent. */
export const SLIPPAGE_HIGH_THRESHOLD_PERCENT = 5;

export const SLIPPAGE_RANGE_ERROR =
  `Slippage tolerance must be between ${SLIPPAGE_MIN_PERCENT}% and ${SLIPPAGE_MAX_PERCENT}%.`;

/**
 * Shared slippage validation (percent).
 *
 * Single source of truth for every slippage input in the app — the settings
 * form schema and the dashboard's custom slippage input both validate through
 * this schema so their allowed ranges can never drift apart again.
 */
export const slippageSchema = z
  .number()
  .min(SLIPPAGE_MIN_PERCENT, SLIPPAGE_RANGE_ERROR)
  .max(SLIPPAGE_MAX_PERCENT, SLIPPAGE_RANGE_ERROR);

/** True when `value` is a finite number inside the accepted slippage range. */
export function isValidSlippagePercent(value: number): boolean {
  return slippageSchema.safeParse(value).success;
}

/**
 * Clamp a raw slippage value into the accepted range.
 * Non-finite input falls back to the default slippage.
 */
export function clampSlippagePercent(value: number): number {
  if (!Number.isFinite(value)) return SLIPPAGE_DEFAULT_PERCENT;
  return Math.min(SLIPPAGE_MAX_PERCENT, Math.max(SLIPPAGE_MIN_PERCENT, value));
}
