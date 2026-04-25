/**
 * Time-range options used by the vault performance chart.
 * Defined here so helpers and the chart component share a single source of truth.
 */
export type TimeRange = "7D" | "1M" | "3M" | "ALL";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Days represented by each finite time-range bucket. */
const RANGE_DAYS: Record<Exclude<TimeRange, "ALL">, number> = {
  "7D": 7,
  "1M": 30,
  "3M": 90,
};

/**
 * Returns the current time as a Date object.
 *
 * Extracted into a function so unit tests can mock it without patching
 * global `Date` directly:
 *   vi.spyOn(dateUtils, "getNow").mockReturnValue(new Date("2025-01-01T00:00:00Z"))
 */
export function getNow(): Date {
  return new Date();
}

/**
 * Computes the cutoff Date for a given finite time range.
 *
 * Uses timestamp arithmetic instead of `setDate` to avoid mutating the
 * `now` argument and to sidestep DST edge-cases on month/year boundaries.
 *
 * @param range - One of the finite buckets ("7D" | "1M" | "3M").
 * @param now   - Reference instant (defaults to `getNow()`). Injected by
 *               callers that need deterministic behaviour (e.g. tests).
 * @returns A new Date representing `now` minus the number of days for `range`.
 */
export function getCutoffDate(
  range: Exclude<TimeRange, "ALL">,
  now: Date = getNow(),
): Date {
  return new Date(now.getTime() - RANGE_DAYS[range] * MS_PER_DAY);
}
