import { describe, it, expect } from "vitest";
import {
  BPS_DENOMINATOR,
  bpsToPercent,
  effectiveFeeBps,
  feeBpsAt,
  formatBpsPercent,
  utilizationBps,
  utilizationTone,
} from "./feeCurve";
import type { FeeCurve } from "./feeCurve";

/**
 * The same reference curve the contract's `fee_curve.rs` tests use:
 * 0.25% base → 1% at an 80% kink → 5% at full utilization. The expected fee
 * values below are the exact integers the Rust tests assert, so this suite
 * doubles as a cross-language parity check on the interpolation.
 */
const referenceCurve: FeeCurve = {
  baseFeeBps: 25,
  optimalFeeBps: 100,
  maxFeeBps: 500,
  optimalUtilizationBps: 8_000,
};

describe("utilizationBps", () => {
  it("reads an empty vault as zero", () => {
    expect(utilizationBps(0, 0)).toBe(0);
    expect(utilizationBps(100, 0)).toBe(0);
    expect(utilizationBps(0, 1_000)).toBe(0);
  });

  it("treats negative inputs as zero", () => {
    expect(utilizationBps(-1, 1_000)).toBe(0);
    expect(utilizationBps(500, -1)).toBe(0);
  });

  it("computes the common ratios", () => {
    expect(utilizationBps(200, 1_000)).toBe(2_000);
    expect(utilizationBps(500, 1_000)).toBe(5_000);
    expect(utilizationBps(800, 1_000)).toBe(8_000);
    expect(utilizationBps(950, 1_000)).toBe(9_500);
  });

  it("caps a fully (or over-) deployed vault at 100%", () => {
    expect(utilizationBps(1_000, 1_000)).toBe(BPS_DENOMINATOR);
    expect(utilizationBps(1_500, 1_000)).toBe(BPS_DENOMINATOR);
  });

  it("floors rather than rounding up", () => {
    expect(utilizationBps(1, 3)).toBe(3_333);
  });

  it("returns zero for non-finite inputs", () => {
    expect(utilizationBps(Number.NaN, 1_000)).toBe(0);
    expect(utilizationBps(100, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("feeBpsAt — acceptance-criteria utilization levels", () => {
  it("charges 43 bps at 20% utilization", () => {
    expect(feeBpsAt(referenceCurve, 2_000)).toBe(43);
  });

  it("charges 71 bps at 50% utilization", () => {
    expect(feeBpsAt(referenceCurve, 5_000)).toBe(71);
  });

  it("charges exactly the kink fee at 80% utilization", () => {
    expect(feeBpsAt(referenceCurve, 8_000)).toBe(100);
  });

  it("charges 400 bps at 95% utilization", () => {
    expect(feeBpsAt(referenceCurve, 9_500)).toBe(400);
  });

  it("rises monotonically across the four levels", () => {
    const fees = [2_000, 5_000, 8_000, 9_500].map((u) => feeBpsAt(referenceCurve, u));
    expect(fees).toEqual([43, 71, 100, 400]);
    expect(fees.every((fee, i) => i === 0 || fees[i - 1] < fee)).toBe(true);
  });
});

describe("feeBpsAt — endpoints and clamping", () => {
  it("returns the configured legs at the endpoints", () => {
    expect(feeBpsAt(referenceCurve, 0)).toBe(referenceCurve.baseFeeBps);
    expect(feeBpsAt(referenceCurve, BPS_DENOMINATOR)).toBe(referenceCurve.maxFeeBps);
  });

  it("clamps out-of-range utilization instead of extrapolating", () => {
    expect(feeBpsAt(referenceCurve, -500)).toBe(referenceCurve.baseFeeBps);
    expect(feeBpsAt(referenceCurve, 25_000)).toBe(referenceCurve.maxFeeBps);
  });

  it("never dips or leaves the configured band across the full sweep", () => {
    let previous = -1;
    for (let u = 0; u <= BPS_DENOMINATOR; u += 1) {
      const fee = feeBpsAt(referenceCurve, u);
      expect(fee).toBeGreaterThanOrEqual(previous);
      expect(fee).toBeGreaterThanOrEqual(referenceCurve.baseFeeBps);
      expect(fee).toBeLessThanOrEqual(referenceCurve.maxFeeBps);
      previous = fee;
    }
  });

  it("returns a single rate for a flat curve", () => {
    const flat: FeeCurve = {
      baseFeeBps: 250,
      optimalFeeBps: 250,
      maxFeeBps: 250,
      optimalUtilizationBps: 8_000,
    };
    for (const u of [0, 2_000, 5_000, 8_000, 9_500, 10_000]) {
      expect(feeBpsAt(flat, u)).toBe(250);
    }
  });

  it("stays in range for a degenerate kink instead of dividing by zero", () => {
    // The contract rejects these curves at the governance call, so this only
    // guards against malformed API data reaching the panel.
    const kinkAtZero = { ...referenceCurve, optimalUtilizationBps: 0 };
    expect(feeBpsAt(kinkAtZero, 0)).toBe(referenceCurve.optimalFeeBps);
    // Everything above 0% rides the upper leg: 100 + 400 * 5000/10000.
    expect(feeBpsAt(kinkAtZero, 5_000)).toBe(300);

    const kinkAtFull = { ...referenceCurve, optimalUtilizationBps: BPS_DENOMINATOR };
    // Everything rides the lower leg: 25 + 75 * 5000/10000 (floored).
    expect(feeBpsAt(kinkAtFull, 5_000)).toBe(62);
    expect(feeBpsAt(kinkAtFull, BPS_DENOMINATOR)).toBe(referenceCurve.optimalFeeBps);
  });
});

describe("effectiveFeeBps", () => {
  it("ignores the curve while dynamic fees are disabled", () => {
    for (const utilization of [0, 2_000, 5_000, 9_500, 10_000]) {
      expect(
        effectiveFeeBps({
          staticFeeBps: 250,
          dynamicEnabled: false,
          utilizationBps: utilization,
          curve: referenceCurve,
        }),
      ).toBe(250);
    }
  });

  it("uses the curve once dynamic fees are enabled", () => {
    expect(
      effectiveFeeBps({
        staticFeeBps: 250,
        dynamicEnabled: true,
        utilizationBps: 9_500,
        curve: referenceCurve,
      }),
    ).toBe(400);
  });

  it("falls back to the static fee when no curve was reported", () => {
    expect(
      effectiveFeeBps({ staticFeeBps: 250, dynamicEnabled: true, utilizationBps: 9_500 }),
    ).toBe(250);
  });
});

describe("utilizationTone", () => {
  it("is normal below the kink", () => {
    expect(utilizationTone(2_000, referenceCurve)).toBe("normal");
    expect(utilizationTone(8_000, referenceCurve)).toBe("normal");
  });

  it("is elevated above the kink", () => {
    expect(utilizationTone(8_001, referenceCurve)).toBe("elevated");
    expect(utilizationTone(9_499, referenceCurve)).toBe("elevated");
  });

  it("is high at or above 95%", () => {
    expect(utilizationTone(9_500, referenceCurve)).toBe("high");
    expect(utilizationTone(10_000, referenceCurve)).toBe("high");
  });

  it("applies only the high threshold when no curve is configured", () => {
    expect(utilizationTone(8_500)).toBe("normal");
    expect(utilizationTone(9_500)).toBe("high");
  });
});

describe("formatting helpers", () => {
  it("converts basis points to a percentage number", () => {
    expect(bpsToPercent(250)).toBe(2.5);
    expect(bpsToPercent(0)).toBe(0);
    expect(bpsToPercent(Number.NaN)).toBe(0);
  });

  it("formats basis points as a percentage string", () => {
    expect(formatBpsPercent(250)).toBe("2.50%");
    expect(formatBpsPercent(43)).toBe("0.43%");
    expect(formatBpsPercent(9_500, 1)).toBe("95.0%");
    expect(formatBpsPercent(8_000, 0)).toBe("80%");
  });
});
