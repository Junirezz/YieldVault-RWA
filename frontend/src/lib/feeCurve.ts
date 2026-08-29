/**
 * Client-side mirror of the vault contract's utilization-based fee curve
 * (`contracts/vault/src/fee_curve.rs`).
 *
 * The contract is the authority on what a depositor actually pays. These
 * helpers exist so the dashboard can render the same numbers — including the
 * shape of the curve either side of its kink — without a round trip, and they
 * reproduce the contract's arithmetic exactly: basis points throughout, and
 * **floor** division on every interpolation, so a displayed fee is never
 * rounded up past what the vault would charge.
 */

/** Basis-point denominator: 10_000 bps === 100%. */
export const BPS_DENOMINATOR = 10_000;

/** Governance-configured legs of the dynamic fee curve. */
export interface FeeCurve {
  /** Fee at 0% utilization. */
  baseFeeBps: number;
  /** Fee exactly at the kink. */
  optimalFeeBps: number;
  /** Fee at 100% utilization. */
  maxFeeBps: number;
  /** Utilization at which the curve changes slope. */
  optimalUtilizationBps: number;
}

/** Fee and utilization state reported alongside the vault summary. */
export interface VaultFeeInfo {
  /** The flat protocol fee, charged whenever the curve is off. */
  staticFeeBps: number;
  /** The fee the vault would charge on yield reported right now. */
  effectiveFeeBps: number;
  /** Share of vault assets working inside the strategy. */
  utilizationBps: number;
  /** Whether governance has enabled the dynamic curve. */
  dynamicEnabled: boolean;
  /** The configured curve, when the vault reports one. */
  curve?: FeeCurve;
}

/** How loaded the vault is, used to pick the utilization bar's tone. */
export type UtilizationTone = "normal" | "elevated" | "high";

/** Utilization at or above which the vault reads as heavily drawn down. */
const HIGH_UTILIZATION_BPS = 9_500;

function clampBps(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), BPS_DENOMINATOR);
}

/**
 * Converts basis points to a percentage number (250 → 2.5).
 */
export function bpsToPercent(bps: number): number {
  if (!Number.isFinite(bps)) return 0;
  return bps / 100;
}

/**
 * Formats basis points as a percentage string (250 → `"2.50%"`).
 *
 * @param bps - Value in basis points.
 * @param decimals - Fraction digits to keep; defaults to 2.
 */
export function formatBpsPercent(bps: number, decimals = 2): string {
  return `${bpsToPercent(bps).toFixed(decimals)}%`;
}

/**
 * Computes utilization in basis points from deployed and total assets.
 *
 * Mirrors the contract: an empty vault reads as 0%, and a strategy marked
 * above the recorded total is capped at 100% rather than overflowing the bar.
 */
export function utilizationBps(deployed: number, total: number): number {
  if (!Number.isFinite(deployed) || !Number.isFinite(total)) return 0;
  if (total <= 0 || deployed <= 0) return 0;
  if (deployed >= total) return BPS_DENOMINATOR;
  return Math.floor((deployed * BPS_DENOMINATOR) / total);
}

/**
 * Interpolates the fee (bps) the curve charges at a given utilization.
 *
 * Utilization outside `0..=10_000` is clamped, matching the contract. A
 * degenerate kink (at or beyond either end) falls back to the adjacent leg
 * instead of dividing by zero — the contract rejects such curves at the
 * governance call, so this path only guards against malformed API data.
 */
export function feeBpsAt(curve: FeeCurve, utilization: number): number {
  const u = clampBps(utilization);
  const kink = curve.optimalUtilizationBps;

  if (u <= kink) {
    if (kink <= 0) return curve.optimalFeeBps;
    const span = curve.optimalFeeBps - curve.baseFeeBps;
    return curve.baseFeeBps + Math.floor((span * u) / kink);
  }

  const aboveKink = BPS_DENOMINATOR - kink;
  if (aboveKink <= 0) return curve.maxFeeBps;
  const span = curve.maxFeeBps - curve.optimalFeeBps;
  return curve.optimalFeeBps + Math.floor((span * (u - kink)) / aboveKink);
}

/**
 * Resolves the fee to charge, honouring the curve's enabled flag.
 *
 * Returns `staticFeeBps` untouched while the curve is off — the state of every
 * vault that has not opted in.
 */
export function effectiveFeeBps(
  info: Pick<VaultFeeInfo, "staticFeeBps" | "dynamicEnabled" | "utilizationBps" | "curve">,
): number {
  if (!info.dynamicEnabled || !info.curve) return info.staticFeeBps;
  return feeBpsAt(info.curve, info.utilizationBps);
}

/**
 * Classifies utilization for display: below the kink is business as usual,
 * above it the curve has started steepening, and at
 * {@link HIGH_UTILIZATION_BPS} idle liquidity is genuinely scarce.
 *
 * Without a curve there is no kink to compare against, so only the high
 * threshold applies.
 */
export function utilizationTone(utilization: number, curve?: FeeCurve): UtilizationTone {
  const u = clampBps(utilization);
  if (u >= HIGH_UTILIZATION_BPS) return "high";
  if (curve && u > curve.optimalUtilizationBps) return "elevated";
  return "normal";
}
