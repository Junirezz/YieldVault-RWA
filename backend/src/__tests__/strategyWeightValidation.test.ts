/**
 * Tests for VaultStrategyBodySchema weight validation.
 *
 * Two acceptance modes:
 *   1. Basis-point integers summing to exactly 10 000.
 *   2. Floats in [0,1] summing to within 1e-9 of 1.0, auto-normalised to bps.
 *
 * Covers the acceptance criteria from the strategy weight gap report:
 *   - bps: 3333 + 3333 + 3334 = 10 000  →  200
 *   - float: 0.333 + 0.333 + 0.334 ≈ 1   →  200 (normalised to bps)
 *   - single-vault 100% allocation         →  200
 *   - invalid bps sum                      →  400
 *   - invalid float sum                    →  400
 *   - negative weight                      →  400
 *   - empty weights map                    →  400
 */

import { VaultStrategyBodySchema } from '../types/validation';

// ─── Helper ──────────────────────────────────────────────────────────────────

function parse(weights: Record<string, number> | undefined) {
  return VaultStrategyBodySchema.safeParse({ strategyId: 'rwa-1', walletAddress: 'GABC', weights });
}

// ─── Basis-point mode ────────────────────────────────────────────────────────

describe('VaultStrategyBodySchema – basis-point weights', () => {
  it('accepts 3333 + 3333 + 3334 (three-vault split)', () => {
    const result = parse({ vaultA: 3333, vaultB: 3333, vaultC: 3334 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.weights).toEqual({ vaultA: 3333, vaultB: 3333, vaultC: 3334 });
  });

  it('accepts 5000 + 5000 (two-vault equal split)', () => {
    const result = parse({ vaultA: 5000, vaultB: 5000 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.weights).toEqual({ vaultA: 5000, vaultB: 5000 });
  });

  it('accepts single-vault 100% allocation (10000 bps)', () => {
    const result = parse({ primary: 10_000 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.weights).toEqual({ primary: 10_000 });
  });

  it('rejects bps weights that sum to < 10000', () => {
    const result = parse({ vaultA: 3333, vaultB: 3333, vaultC: 3333 }); // 9999
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].message).toMatch(/10000/);
  });

  it('rejects bps weights that sum to > 10000', () => {
    const result = parse({ vaultA: 5000, vaultB: 5001 }); // 10001
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].message).toMatch(/10000/);
  });
});

// ─── Float mode ──────────────────────────────────────────────────────────────

describe('VaultStrategyBodySchema – float weights', () => {
  it('accepts 0.333 + 0.333 + 0.334 with float tolerance', () => {
    const result = parse({ vaultA: 0.333, vaultB: 0.333, vaultC: 0.334 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    // Output must be normalised integer bps summing to 10 000
    const bps = result.data.weights as Record<string, number>;
    const total = Object.values(bps).reduce((a, b) => a + b, 0);
    expect(total).toBe(10_000);
    Object.values(bps).forEach((v) => expect(Number.isInteger(v)).toBe(true));
  });

  it('accepts single-vault 1.0 allocation', () => {
    const result = parse({ primary: 1.0 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.weights).toEqual({ primary: 10_000 });
  });

  it('accepts 0.5 + 0.5 two-vault split', () => {
    const result = parse({ vaultA: 0.5, vaultB: 0.5 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.weights).toEqual({ vaultA: 5000, vaultB: 5000 });
  });

  it('rejects float weights summing significantly below 1', () => {
    const result = parse({ vaultA: 0.4, vaultB: 0.4 }); // 0.8
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].message).toMatch(/sum to 1/i);
  });

  it('rejects float weights summing significantly above 1', () => {
    const result = parse({ vaultA: 0.6, vaultB: 0.6 }); // 1.2
    expect(result.success).toBe(false);
    if (result.success) return;
    // Floats > 1 hit the "float mode must be between 0 and 1" guard
    expect(result.error.issues[0].message).toMatch(/between 0 and 1|sum to 1/i);
  });
});

// ─── Edge cases ──────────────────────────────────────────────────────────────

describe('VaultStrategyBodySchema – edge cases', () => {
  it('rejects an empty weights map', () => {
    const result = parse({});
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].message).toMatch(/at least one entry/);
  });

  it('rejects a negative weight value', () => {
    const result = parse({ vaultA: -100, vaultB: 10_100 });
    expect(result.success).toBe(false);
  });

  it('accepts a request with no weights field (field is optional)', () => {
    const result = VaultStrategyBodySchema.safeParse({ strategyId: 'rwa-1' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.weights).toBeUndefined();
  });
});
