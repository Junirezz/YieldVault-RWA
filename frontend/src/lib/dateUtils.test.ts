import { describe, it, expect, vi, afterEach } from "vitest";
import * as dateUtils from "./dateUtils";
import { getNow, getCutoffDate } from "./dateUtils";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Fixed reference instant used across all tests.
const FIXED_NOW = new Date("2026-04-24T12:00:00.000Z");

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// getNow
// ---------------------------------------------------------------------------
describe("getNow", () => {
  it("returns the real current time when not mocked", () => {
    const before = Date.now();
    const result = getNow().getTime();
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it("can be mocked via vi.spyOn for deterministic tests", () => {
    vi.spyOn(dateUtils, "getNow").mockReturnValue(FIXED_NOW);
    expect(getNow()).toBe(FIXED_NOW);
  });
});

// ---------------------------------------------------------------------------
// getCutoffDate
// ---------------------------------------------------------------------------
describe("getCutoffDate", () => {
  it("returns a date exactly 7 days before `now` for the 7D range", () => {
    const cutoff = getCutoffDate("7D", FIXED_NOW);
    expect(cutoff.getTime()).toBe(FIXED_NOW.getTime() - 7 * MS_PER_DAY);
  });

  it("returns a date exactly 30 days before `now` for the 1M range", () => {
    const cutoff = getCutoffDate("1M", FIXED_NOW);
    expect(cutoff.getTime()).toBe(FIXED_NOW.getTime() - 30 * MS_PER_DAY);
  });

  it("returns a date exactly 90 days before `now` for the 3M range", () => {
    const cutoff = getCutoffDate("3M", FIXED_NOW);
    expect(cutoff.getTime()).toBe(FIXED_NOW.getTime() - 90 * MS_PER_DAY);
  });

  it("does not mutate the `now` argument", () => {
    const now = new Date(FIXED_NOW.getTime());
    getCutoffDate("1M", now);
    expect(now.getTime()).toBe(FIXED_NOW.getTime());
  });

  it("uses getNow() when no `now` argument is provided", () => {
    // Fake the system clock so new Date() inside getNow() returns FIXED_NOW.
    // vi.spyOn on the named export cannot intercept the in-module call used
    // by the default parameter, but fake timers mock Date() at the runtime level.
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    try {
      const cutoff = getCutoffDate("7D");
      expect(cutoff.getTime()).toBe(FIXED_NOW.getTime() - 7 * MS_PER_DAY);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Filtering simulation (the core chart behaviour)
// ---------------------------------------------------------------------------
describe("time-range filtering with mocked system time", () => {
  /** Build a synthetic history point `daysAgo` days before FIXED_NOW. */
  function makePoint(daysAgo: number) {
    return {
      date: new Date(FIXED_NOW.getTime() - daysAgo * MS_PER_DAY).toISOString(),
      value: 100 + daysAgo,
    };
  }

  const history = [
    makePoint(0),   // today
    makePoint(5),   // 5 days ago  – inside 7D
    makePoint(7),   // exactly 7 days ago – boundary (inclusive)
    makePoint(8),   // 8 days ago  – outside 7D, inside 1M
    makePoint(29),  // 29 days ago – inside 1M
    makePoint(30),  // exactly 30 days ago – boundary (inclusive)
    makePoint(31),  // 31 days ago – outside 1M, inside 3M
    makePoint(89),  // 89 days ago – inside 3M
    makePoint(90),  // exactly 90 days ago – boundary (inclusive)
    makePoint(91),  // 91 days ago – outside all finite ranges
  ];

  function filter(range: Exclude<dateUtils.TimeRange, "ALL">) {
    const cutoff = getCutoffDate(range, FIXED_NOW);
    return history.filter(p => new Date(p.date) >= cutoff);
  }

  it("7D: keeps points on or after the 7-day cutoff", () => {
    const result = filter("7D");
    // today (0d), 5d, 7d should be included; 8d+ excluded
    expect(result).toHaveLength(3);
    const daysAgo = result.map(p =>
      Math.round((FIXED_NOW.getTime() - new Date(p.date).getTime()) / MS_PER_DAY),
    );
    expect(daysAgo).toEqual([0, 5, 7]);
  });

  it("1M: keeps points on or after the 30-day cutoff", () => {
    const result = filter("1M");
    // 0d, 5d, 7d, 8d, 29d, 30d included; 31d+ excluded
    expect(result).toHaveLength(6);
  });

  it("3M: keeps points on or after the 90-day cutoff", () => {
    const result = filter("3M");
    // all except the 91-day point
    expect(result).toHaveLength(9);
  });
});
