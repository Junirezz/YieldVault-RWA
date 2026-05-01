import { describe, it, expect } from "vitest";
import { calculateProjectedEarnings } from "./calculations";

describe("calculateProjectedEarnings", () => {
  it("returns 0 for zero amount", () => {
    expect(calculateProjectedEarnings(0, 8.45, 30)).toBe(0);
  });

  it("returns 0 for zero APY", () => {
    expect(calculateProjectedEarnings(1000, 0, 30)).toBe(0);
  });

  it("returns 0 for zero days", () => {
    expect(calculateProjectedEarnings(1000, 8.45, 0)).toBe(0);
  });

  it("calculates simple earnings correctly for 1 year", () => {
    // 1000 at 10% for 365 days compounded daily
    // A = 1000 * (1 + 0.10/365)^365 = 1105.155...
    // Earnings = 105.16
    const result = calculateProjectedEarnings(1000, 10, 365);
    expect(result).toBeCloseTo(105.16, 1);
  });

  it("calculates earnings for short horizon", () => {
    // 1000 at 8.45% for 30 days
    // A = 1000 * (1 + 0.0845/365)^30 = 1006.965...
    const result = calculateProjectedEarnings(1000, 8.45, 30);
    expect(result).toBeCloseTo(6.96, 1);
  });

  it("handles negative inputs gracefully", () => {
    expect(calculateProjectedEarnings(-1000, 8.45, 30)).toBe(0);
    expect(calculateProjectedEarnings(1000, -8.45, 30)).toBe(0);
    expect(calculateProjectedEarnings(1000, 8.45, -30)).toBe(0);
  });
});
