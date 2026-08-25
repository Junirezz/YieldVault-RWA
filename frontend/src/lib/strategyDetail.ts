import {
  RISK_TIER_LABELS,
  RISK_TIER_RANK,
  VAULT_STRATEGIES,
  type RiskTier,
  type VaultStrategy,
} from "./vaultStrategies";

/**
 * Content and resolution helpers behind the strategy detail page
 * (`/strategies/:strategyId`).
 *
 * The catalog itself lives in `lib/vaultStrategies`; this module adds the
 * lookup rules, risk guidance copy, and historical-yield statistics that only
 * the detail page needs.
 */

// ─── Strategy resolution ─────────────────────────────────────────────────────

/**
 * Resolves a URL slug into a catalog entry.
 *
 * The live vault summary (`mock-api/vault-summary.json`) reports ids such as
 * `stellar-benji` while the local catalog uses `benji`, so lookups proceed in
 * three passes: exact id, exact display-name match, then substring containment
 * in either direction. Everything is case-insensitive because URLs are
 * user-editable.
 */
export function resolveStrategy(
  rawId: string,
  catalog: readonly VaultStrategy[] = VAULT_STRATEGIES,
): VaultStrategy | undefined {
  const candidate = rawId.trim().toLowerCase();
  if (!candidate) return undefined;

  return (
    catalog.find((strategy) => strategy.id.toLowerCase() === candidate) ??
    catalog.find((strategy) => strategy.name.toLowerCase() === candidate) ??
    catalog.find(
      (strategy) =>
        strategy.id.toLowerCase().includes(candidate) ||
        candidate.includes(strategy.id.toLowerCase()),
    )
  );
}

/** Every other catalog entry, used for the "other strategies" links. */
export function getRelatedStrategies(
  strategy: VaultStrategy,
  catalog: readonly VaultStrategy[] = VAULT_STRATEGIES,
): VaultStrategy[] {
  return catalog.filter((entry) => entry.id !== strategy.id);
}

// ─── Risk guidance ───────────────────────────────────────────────────────────

export interface RiskGuidance {
  /** One-sentence plain-language summary of what the tier means. */
  summary: string;
  /** Concrete monitoring points the vault applies at this tier. */
  factors: string[];
}

/**
 * Static guidance copy per risk tier. The catalog stores only an ordinal
 * (`RISK_TIER_RANK`); this gives users the "why" behind it so the detail page
 * can explain the risk model instead of just labelling it.
 */
export const RISK_GUIDANCE: Record<RiskTier, RiskGuidance> = {
  "very-low": {
    summary:
      "Reserve-style capital preservation. Assets stay immediately reachable and are not lent into market exposure.",
    factors: [
      "No external issuer exposure — assets remain in the vault reserve",
      "Redemptions settle instantly with no lockup or notice period",
      "Yield is intentionally lower in exchange for same-day liquidity",
    ],
  },
  low: {
    summary:
      "Short-duration government treasury exposure prioritising capital preservation and predictable liquidity windows.",
    factors: [
      "Underlying instruments are short-duration sovereign debt",
      "Duration is kept short so rate moves have limited price impact",
      "Redemption windows are published in advance and honoured weekly",
    ],
  },
  moderate: {
    summary:
      "Tokenized money-market and sovereign bond exposure with active monitoring and standard settlement friction.",
    factors: [
      "Issuer concentration is capped and reviewed each rebalance epoch",
      "Subscription and redemption flows can take up to one business day",
      "Yield tracks money-market rates, which float with policy rates",
    ],
  },
  elevated: {
    summary:
      "Private credit exposure targeting higher yield, accepting more settlement friction and monitoring overhead.",
    factors: [
      "Underlying loans are less liquid than treasuries; redemptions queue weekly",
      "A mandatory lockup protects remaining depositors from sudden outflows",
      "Borrower defaults are the primary risk; positions are monitored continuously",
    ],
  },
};

export { RISK_TIER_LABELS, RISK_TIER_RANK };

// ─── Historical yield statistics ─────────────────────────────────────────────

export interface HistoryPointLike {
  date: string;
  value: number;
}

export interface YieldStats {
  /** Share-price index value at the start of the window. */
  firstValue: number;
  /** Share-price index value at the end of the window. */
  latestValue: number;
  /** Total index change across the window, in percent. */
  changePct: number;
  minValue: number;
  maxValue: number;
  averageValue: number;
  pointCount: number;
}

/**
 * Summarises a normalized share-price series (100 = baseline) into the figures
 * shown beside the historical chart. Returns `null` when there is nothing to
 * summarise so callers can fall back to their empty state.
 */
export function computeYieldStats(
  history: readonly HistoryPointLike[],
): YieldStats | null {
  if (history.length === 0) return null;

  const values = history.map((point) => point.value);
  const firstValue = values[0];
  const latestValue = values[values.length - 1];
  const sum = values.reduce((total, value) => total + value, 0);

  return {
    firstValue,
    latestValue,
    changePct: ((latestValue - firstValue) / firstValue) * 100,
    minValue: Math.min(...values),
    maxValue: Math.max(...values),
    averageValue: sum / values.length,
    pointCount: history.length,
  };
}
