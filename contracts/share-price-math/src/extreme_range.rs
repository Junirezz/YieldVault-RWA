//! Share-price conversion invariants across the full `i128` and decimal range (#1736).
//!
//! The older `fuzz_invariants` encoding only carries 8 bytes per value, so it can
//! never reach beyond `u64::MAX`. Real assets span 0 to 38 decimal places and the
//! conversion intermediates (`a * b`) overflow `i128` long before the inputs do,
//! so this module decodes full 16-byte values and deliberately steers them to the
//! boundaries where those products overflow.
//!
//! Shared by the `share_price_extreme_ranges` libFuzzer target and by plain
//! `cargo test`, so every invariant is also exercised without a nightly toolchain.
//!
//! ## Input layout (little-endian, 66 bytes; missing bytes read as zero)
//!
//! | Bytes   | Meaning |
//! |---------|---------|
//! | 0..16   | `assets` (raw `i128`) |
//! | 16..32  | `total_shares` (raw `i128`) |
//! | 32..48  | `total_assets` (raw `i128`) |
//! | 48..64  | `delta` (raw `i128`): amount increase and yield accrual |
//! | 64      | decimals selector, taken modulo 39 (0..=38) |
//! | 65      | shaping kind, 2 bits per field in the order above |
//!
//! Shaping kinds: `0` raw non-negative value, `1` boundary table entry,
//! `2` `10^decimals` +/- 1, `3` 32-bit mantissa times `10^decimals`.

use crate::rounding::{
    assets_to_shares_rounded, mul_div, shares_to_assets_rounded, Op, Rounding,
};
use crate::{try_assets_to_shares, try_shares_to_assets, MathError};

/// Length of a fully specified input.
pub const INPUT_LEN: usize = 66;
/// Largest decimal exponent for which `10^d` still fits in an `i128`.
pub const MAX_DECIMALS: u32 = 38;

/// `floor(sqrt(i128::MAX))`: the square-root boundary at which `a * a` starts to overflow.
pub const SQRT_I128_MAX: i128 = 13_043_817_825_332_782_212;

/// Values at which conversion arithmetic changes behaviour.
pub const BOUNDARIES: [i128; 18] = [
    0,
    1,
    2,
    3,
    10_000_000,                              // one unit of a 7-decimal Stellar asset
    1_000_000_000_000_000_000,               // one unit of an 18-decimal asset
    100_000_000_000_000_000_000_000_000_000_000_000_000, // 10^38, largest power of ten
    SQRT_I128_MAX - 1,
    SQRT_I128_MAX,
    SQRT_I128_MAX + 1,
    u64::MAX as i128,
    (u64::MAX as i128) + 1,
    i64::MAX as i128,
    i128::MAX / 2,
    i128::MAX / 2 + 1,
    i128::MAX - 2,
    i128::MAX - 1,
    i128::MAX,
];

/// A decoded fuzz input: raw signed values for the no-panic pass and shaped,
/// non-negative values for the vault-state invariants.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct ExtremeInput {
    pub raw: [i128; 4],
    pub decimals: u32,
    pub assets: i128,
    pub total_shares: i128,
    pub total_assets: i128,
    pub delta: i128,
}

/// `10^decimals` for `decimals <= 38`.
pub fn pow10(decimals: u32) -> i128 {
    let mut value: i128 = 1;
    let mut i = 0;
    while i < decimals.min(MAX_DECIMALS) {
        value *= 10;
        i += 1;
    }
    value
}

fn read_i128(data: &[u8], offset: usize) -> i128 {
    let mut arr = [0u8; 16];
    for (i, slot) in arr.iter_mut().enumerate() {
        if let Some(byte) = data.get(offset + i) {
            *slot = *byte;
        }
    }
    i128::from_le_bytes(arr)
}

/// Steers a raw value onto a non-negative, boundary-heavy value.
pub fn shape(raw: i128, kind: u8, decimals: u32) -> i128 {
    match kind & 3 {
        0 => raw & i128::MAX,
        1 => BOUNDARIES[(raw as u8 as usize) % BOUNDARIES.len()],
        2 => {
            let offset = raw.rem_euclid(3) - 1;
            pow10(decimals).saturating_add(offset).max(0)
        }
        _ => ((raw as u32) as i128).saturating_mul(pow10(decimals)),
    }
}

/// Decodes arbitrary bytes into an [`ExtremeInput`]. Never fails: short input is
/// zero-padded so the fuzzer can mutate length freely.
pub fn decode_extreme_input(data: &[u8]) -> ExtremeInput {
    let raw = [
        read_i128(data, 0),
        read_i128(data, 16),
        read_i128(data, 32),
        read_i128(data, 48),
    ];
    let decimals = (data.get(64).copied().unwrap_or(0) as u32) % (MAX_DECIMALS + 1);
    let kinds = data.get(65).copied().unwrap_or(0);
    ExtremeInput {
        raw,
        decimals,
        assets: shape(raw[0], kinds, decimals),
        total_shares: shape(raw[1], kinds >> 2, decimals),
        total_assets: shape(raw[2], kinds >> 4, decimals),
        delta: shape(raw[3], kinds >> 6, decimals),
    }
}

/// Encodes values into the input layout. `kinds` and `decimals` choose how each
/// field is shaped on decode.
pub fn encode_extreme_input(
    raw: [i128; 4],
    decimals: u8,
    kinds: u8,
) -> [u8; INPUT_LEN] {
    let mut out = [0u8; INPUT_LEN];
    for (i, value) in raw.iter().enumerate() {
        out[i * 16..(i + 1) * 16].copy_from_slice(&value.to_le_bytes());
    }
    out[64] = decimals;
    out[65] = kinds;
    out
}

/// Real vaults are either empty or have shares outstanding (including zero idle assets).
fn is_valid_vault_state(total_shares: i128, total_assets: i128) -> bool {
    (total_shares == 0 && total_assets == 0) || (total_shares > 0 && total_assets >= 0)
}

/// Full 128x128 -> 256-bit multiply of two unsigned values, as `(high, low)`.
pub fn wide_mul(a: u128, b: u128) -> (u128, u128) {
    const MASK: u128 = u64::MAX as u128;
    let (a_lo, a_hi) = (a & MASK, a >> 64);
    let (b_lo, b_hi) = (b & MASK, b >> 64);

    let ll = a_lo * b_lo;
    let lh = a_lo * b_hi;
    let hl = a_hi * b_lo;
    let hh = a_hi * b_hi;

    let mid = (ll >> 64) + (lh & MASK) + (hl & MASK);
    let low = (ll & MASK) | (mid << 64);
    let high = hh + (lh >> 64) + (hl >> 64) + (mid >> 64);
    (high, low)
}

/// `a * b` as an `i128` for non-negative operands, or `None` if it does not fit.
fn exact_product(a: i128, b: i128) -> Option<i128> {
    let (high, low) = wide_mul(a as u128, b as u128);
    if high != 0 || low > i128::MAX as u128 {
        None
    } else {
        Some(low as i128)
    }
}

/// Reference `a * b / denom` for non-negative operands and `denom > 0`, computed
/// without relying on the implementation under test.
fn reference_mul_div(a: i128, b: i128, denom: i128, rounding: Rounding) -> Result<i128, MathError> {
    let product = exact_product(a, b).ok_or(MathError::Overflow)?;
    let quotient = product / denom;
    let remainder = product % denom;
    match rounding {
        Rounding::Down => Ok(quotient),
        Rounding::Up if remainder == 0 => Ok(quotient),
        Rounding::Up => quotient.checked_add(1).ok_or(MathError::Overflow),
    }
}

fn assert_non_decreasing(
    low: Result<i128, MathError>,
    high: Result<i128, MathError>,
    what: &str,
    context: (i128, i128, i128, i128),
) {
    if let (Ok(low), Ok(high)) = (low, high) {
        assert!(
            low <= high,
            "{what} not monotonic: {low} > {high} for (a={}, ts={}, ta={}, delta={})",
            context.0,
            context.1,
            context.2,
            context.3
        );
    }
}

/// Every conversion entry point must return a `Result` for any signed input,
/// including `i128::MIN`, never panic.
fn assert_no_panic_on_raw(raw: [i128; 4]) {
    let [a, b, c, d] = raw;
    for (x, y, z) in [(a, b, c), (a, c, b), (b, a, c), (d, a, b), (c, d, a)] {
        let _ = try_assets_to_shares(x, y, z);
        let _ = try_shares_to_assets(x, y, z);
        for op in [Op::Deposit, Op::Mint, Op::Withdraw, Op::Redeem] {
            let _ = assets_to_shares_rounded(x, y, z, op);
            let _ = shares_to_assets_rounded(x, y, z, op);
        }
        let _ = mul_div(x, y, z, Rounding::Down);
        let _ = mul_div(x, y, z, Rounding::Up);
    }
}

/// Asserts the share-price invariants for one vault state and probe amounts.
///
/// `assets` is used both as a deposit amount and as a share amount, `delta` as
/// both an amount increase and a yield accrual. All values must be non-negative.
pub fn assert_extreme_state_invariants(
    assets: i128,
    total_shares: i128,
    total_assets: i128,
    delta: i128,
) {
    if assets < 0 || delta < 0 || !is_valid_vault_state(total_shares, total_assets) {
        return;
    }
    let ctx = (assets, total_shares, total_assets, delta);

    // 1. Agreement with an independent wide-integer reference: overflow is reported
    //    exactly when the product does not fit, never spuriously and never missed.
    if total_shares > 0 && total_assets > 0 {
        for rounding in [Rounding::Down, Rounding::Up] {
            assert_eq!(
                mul_div(assets, total_shares, total_assets, rounding),
                reference_mul_div(assets, total_shares, total_assets, rounding),
                "assets->shares {rounding:?} disagrees with reference for {ctx:?}"
            );
        }
    }
    if total_shares > 0 {
        for rounding in [Rounding::Down, Rounding::Up] {
            let actual = mul_div(assets, total_assets, total_shares, rounding);
            let expected = reference_mul_div(assets, total_assets, total_shares, rounding);
            assert_eq!(
                actual, expected,
                "shares->assets {rounding:?} disagrees with reference for {ctx:?}"
            );
        }
    }

    // 2. Rounding up is never cheaper than rounding down, and differs by at most 1.
    for (down_op, up_op) in [(Op::Deposit, Op::Withdraw), (Op::Redeem, Op::Mint)] {
        let (down, up) = if down_op == Op::Deposit {
            (
                assets_to_shares_rounded(assets, total_shares, total_assets, down_op),
                assets_to_shares_rounded(assets, total_shares, total_assets, up_op),
            )
        } else {
            (
                shares_to_assets_rounded(assets, total_shares, total_assets, down_op),
                shares_to_assets_rounded(assets, total_shares, total_assets, up_op),
            )
        };
        if let (Ok(down), Ok(up)) = (down, up) {
            assert!(
                up >= down && up - down <= 1,
                "round-up ({up}) vs round-down ({down}) out of range for {ctx:?}"
            );
        }
    }

    // 3. Monotonic in the amount: a larger input never yields less.
    let bigger = assets.saturating_add(delta);
    for op in [Op::Deposit, Op::Withdraw] {
        assert_non_decreasing(
            assets_to_shares_rounded(assets, total_shares, total_assets, op),
            assets_to_shares_rounded(bigger, total_shares, total_assets, op),
            "assets->shares in amount",
            ctx,
        );
    }
    for op in [Op::Redeem, Op::Mint] {
        assert_non_decreasing(
            shares_to_assets_rounded(assets, total_shares, total_assets, op),
            shares_to_assets_rounded(bigger, total_shares, total_assets, op),
            "shares->assets in amount",
            ctx,
        );
    }

    // 4. Share price is monotonic under yield: more assets backing the same shares
    //    never lowers the redemption value and never raises the shares minted.
    if let Some(after_assets) = total_assets.checked_add(delta) {
        if total_shares > 0 {
            for op in [Op::Redeem, Op::Mint] {
                assert_non_decreasing(
                    shares_to_assets_rounded(assets, total_shares, total_assets, op),
                    shares_to_assets_rounded(assets, total_shares, after_assets, op),
                    "redemption value under yield",
                    ctx,
                );
            }
            if total_assets > 0 {
                for op in [Op::Deposit, Op::Withdraw] {
                    assert_non_decreasing(
                        assets_to_shares_rounded(assets, total_shares, after_assets, op),
                        assets_to_shares_rounded(assets, total_shares, total_assets, op),
                        "shares minted under yield (must not increase)",
                        ctx,
                    );
                }
            }
        }
    }

    // 5. A deposit followed by a redeem never returns more than was deposited.
    if let Ok(shares) = assets_to_shares_rounded(assets, total_shares, total_assets, Op::Deposit) {
        if let (Some(new_shares), Some(new_assets)) = (
            total_shares.checked_add(shares),
            total_assets.checked_add(assets),
        ) {
            if let Ok(returned) =
                shares_to_assets_rounded(shares, new_shares, new_assets, Op::Redeem)
            {
                assert!(
                    returned <= assets,
                    "deposit/redeem round trip created value: {returned} > {assets} for {ctx:?}"
                );
            }
        }
    }

    // 6. Quotes never favour the user: shares charged to withdraw `assets` redeem
    //    for at least `assets`, and assets charged to mint `assets` shares buy at
    //    least that many shares.
    if total_shares > 0 && total_assets > 0 {
        if let Ok(shares_needed) =
            assets_to_shares_rounded(assets, total_shares, total_assets, Op::Withdraw)
        {
            if let Ok(redeemed) =
                shares_to_assets_rounded(shares_needed, total_shares, total_assets, Op::Redeem)
            {
                assert!(
                    redeemed >= assets,
                    "withdraw quote undercharged: shares {shares_needed} redeem {redeemed} < {assets} for {ctx:?}"
                );
            }
        }
        if let Ok(assets_needed) =
            shares_to_assets_rounded(assets, total_shares, total_assets, Op::Mint)
        {
            if let Ok(minted) =
                assets_to_shares_rounded(assets_needed, total_shares, total_assets, Op::Deposit)
            {
                assert!(
                    minted >= assets,
                    "mint quote undercharged: assets {assets_needed} buy {minted} < {assets} for {ctx:?}"
                );
            }
        }
    }
}

/// Runs every extreme-range invariant for one decoded input.
pub fn assert_extreme_range_invariants(input: &ExtremeInput) {
    assert_no_panic_on_raw(input.raw);
    assert_extreme_state_invariants(
        input.assets,
        input.total_shares,
        input.total_assets,
        input.delta,
    );
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rounding::FIXTURES;
    use std::vec::Vec;

    #[test]
    fn pow10_covers_every_supported_decimal() {
        assert_eq!(pow10(0), 1);
        assert_eq!(pow10(7), 10_000_000);
        assert_eq!(pow10(18), 1_000_000_000_000_000_000);
        assert_eq!(pow10(38), BOUNDARIES[6]);
        // 10^38 is the largest power of ten that fits; 10^39 would not.
        assert!(pow10(38).checked_mul(10).is_none());
    }

    #[test]
    fn sqrt_boundary_is_exact() {
        assert!(SQRT_I128_MAX.checked_mul(SQRT_I128_MAX).is_some());
        assert!((SQRT_I128_MAX + 1).checked_mul(SQRT_I128_MAX + 1).is_none());
    }

    #[test]
    fn wide_mul_matches_known_values() {
        assert_eq!(wide_mul(0, u128::MAX), (0, 0));
        assert_eq!(wide_mul(3, 7), (0, 21));
        // (2^128 - 1)^2 = 2^256 - 2^129 + 1
        assert_eq!(wide_mul(u128::MAX, u128::MAX), (u128::MAX - 1, 1));
        // 2^64 * 2^64 = 2^128
        assert_eq!(wide_mul(1u128 << 64, 1u128 << 64), (1, 0));
    }

    #[test]
    fn exact_product_detects_i128_overflow() {
        assert_eq!(exact_product(i128::MAX, 1), Some(i128::MAX));
        assert_eq!(exact_product(i128::MAX, 2), None);
        assert_eq!(exact_product(SQRT_I128_MAX, SQRT_I128_MAX).is_some(), true);
        assert_eq!(exact_product(SQRT_I128_MAX + 1, SQRT_I128_MAX + 1), None);
    }

    #[test]
    fn decode_pads_short_input_and_never_fails() {
        let empty = decode_extreme_input(&[]);
        assert_eq!(empty.raw, [0; 4]);
        assert_eq!((empty.assets, empty.total_shares), (0, 0));
        // Arbitrary lengths and contents must decode.
        for len in 0..=INPUT_LEN + 8 {
            let bytes: Vec<u8> = (0..len).map(|i| (i * 37 + 11) as u8).collect();
            assert_extreme_range_invariants(&decode_extreme_input(&bytes));
        }
    }

    #[test]
    fn encode_decode_round_trip_raw_fields() {
        let raw = [i128::MAX, 42, -7, i128::MIN];
        let bytes = encode_extreme_input(raw, 18, 0b00_00_00_00);
        let decoded = decode_extreme_input(&bytes);
        assert_eq!(decoded.raw, raw);
        assert_eq!(decoded.decimals, 18);
        assert_eq!(decoded.assets, i128::MAX);
        // Raw kind masks the sign bit, so negative values become non-negative.
        assert!(decoded.delta >= 0);
    }

    #[test]
    fn shape_kinds_hit_their_targets() {
        assert_eq!(shape(-1, 0, 5), i128::MAX);
        assert_eq!(shape(0, 1, 5), BOUNDARIES[0]);
        assert_eq!(shape(17, 1, 5), i128::MAX);
        assert_eq!(shape(1, 2, 7), 10_000_000); // rem_euclid(3) - 1 == 0
        assert_eq!(shape(5, 3, 7), 5 * 10_000_000);
        // Mantissa times 10^38 saturates instead of overflowing.
        assert_eq!(shape(u32::MAX as i128, 3, 38), i128::MAX);
    }

    #[test]
    fn fixtures_hold_at_every_decimal_scale() {
        for fixture in FIXTURES {
            for decimals in 0..=MAX_DECIMALS {
                let scale = pow10(decimals);
                let scaled = (
                    fixture.amount.checked_mul(scale),
                    fixture.total_shares.checked_mul(scale),
                    fixture.total_assets.checked_mul(scale),
                );
                if let (Some(a), Some(ts), Some(ta)) = scaled {
                    // Use the fixture amount as the delta too: a plausible small accrual.
                    assert_extreme_state_invariants(a, ts, ta, a);
                    assert_extreme_state_invariants(a, ts, ta, 1);
                }
            }
        }
    }

    #[test]
    fn boundary_grid_holds() {
        for &a in &BOUNDARIES {
            for &ts in &BOUNDARIES {
                for &ta in &BOUNDARIES {
                    for &d in &[0, 1, SQRT_I128_MAX, i128::MAX] {
                        assert_extreme_state_invariants(a, ts, ta, d);
                    }
                }
            }
        }
    }

    #[test]
    fn extreme_values_overflow_cleanly_instead_of_panicking() {
        assert_eq!(
            mul_div(i128::MAX, i128::MAX, 1, Rounding::Down),
            Err(MathError::Overflow)
        );
        assert_eq!(
            mul_div(i128::MIN, -1, 1, Rounding::Down),
            Err(MathError::Overflow)
        );
        assert_eq!(
            mul_div(1, 1, i128::MIN, Rounding::Up).is_ok(),
            true
        );
        assert_extreme_range_invariants(&decode_extreme_input(&encode_extreme_input(
            [i128::MIN, i128::MIN, i128::MIN, i128::MIN],
            38,
            0,
        )));
    }

    /// Seeds for `contracts/vault/fuzz/corpus/share_price_extreme_ranges/`, derived
    /// from the rounding fixtures (at 7 and 18 decimals) and the boundary values.
    fn corpus_seeds() -> Vec<(std::string::String, [u8; INPUT_LEN])> {
        use std::format;
        let mut seeds = Vec::new();
        // kinds = 0b11_11_11_11: every field is `mantissa * 10^decimals`.
        for fixture in FIXTURES {
            for decimals in [7u8, 18u8] {
                seeds.push((
                    format!("fixture_{}_d{}", fixture.id.replace('-', "_"), decimals),
                    encode_extreme_input(
                        [fixture.amount, fixture.total_shares, fixture.total_assets, 1],
                        decimals,
                        0xFF,
                    ),
                ));
            }
        }
        // kinds = 0: raw values straight through.
        let raw = |name: &str, values: [i128; 4], decimals: u8| {
            (std::string::String::from(name), encode_extreme_input(values, decimals, 0))
        };
        let max = i128::MAX;
        seeds.push(raw("all_zero", [0, 0, 0, 0], 0));
        seeds.push(raw("max_everything", [max, max, max, max], 38));
        seeds.push(raw("max_amount_unit_state", [max, 1, 1, 1], 7));
        seeds.push(raw("unit_amount_max_state", [1, max, max, 1], 7));
        seeds.push(raw("sqrt_boundary_product", [SQRT_I128_MAX, SQRT_I128_MAX, 1, 1], 18));
        seeds.push(raw("sqrt_boundary_plus_one", [SQRT_I128_MAX + 1, SQRT_I128_MAX + 1, 1, 1], 18));
        seeds.push(raw("max_shares_zero_assets", [1_000, max, 0, 1], 0));
        seeds.push(raw("max_yield_on_max_assets", [1_000, 1_000, max, max], 7));
        seeds.push(raw("pow10_38_state", [pow10(38), pow10(38), pow10(38), 1], 38));
        seeds.push(raw("dust_against_huge_total_assets", [1, 1_000, max / 2, 1], 7));
        // Negative values must reach the no-panic pass untouched (i128::MIN / -1).
        seeds.push(raw("signed_min_and_minus_one", [i128::MIN, -1, i128::MIN, i128::MIN], 0));
        // Boundary-table and 10^decimals shaping paths.
        seeds.push((
            std::string::String::from("boundary_table_pairs"),
            encode_extreme_input([17, 16, 9, 8], 0, 0b01_01_01_01),
        ));
        seeds.push((
            std::string::String::from("pow10_neighbours_d18"),
            encode_extreme_input([0, 1, 2, 3], 18, 0b10_10_10_10),
        ));
        seeds
    }

    #[test]
    fn corpus_seeds_pass_invariants() {
        for (name, bytes) in corpus_seeds() {
            let input = decode_extreme_input(&bytes);
            assert_extreme_range_invariants(&input);
            assert_eq!(bytes.len(), INPUT_LEN, "{name}");
        }
    }

    fn corpus_dir() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../vault/fuzz/corpus/share_price_extreme_ranges")
    }

    /// Fails if a committed seed drifts from the generator, so the corpus cannot
    /// silently stop matching the input layout.
    #[test]
    fn committed_corpus_is_in_sync_with_generator() {
        for (name, expected) in corpus_seeds() {
            let path = corpus_dir().join(&name);
            let actual = std::fs::read(&path)
                .unwrap_or_else(|_| panic!("missing corpus seed {path:?}; regenerate it"));
            assert_eq!(
                actual.as_slice(),
                expected.as_slice(),
                "corpus seed {name} is stale; regenerate with:                  cargo test -p share-price-math regenerate_extreme_corpus -- --ignored"
            );
        }
    }

    #[test]
    #[ignore = "writes corpus files; run manually to regenerate"]
    fn regenerate_extreme_corpus() {
        std::fs::create_dir_all(corpus_dir()).unwrap();
        for (name, bytes) in corpus_seeds() {
            std::fs::write(corpus_dir().join(name), bytes).unwrap();
        }
    }

    /// Deterministic pseudo-random sweep so the invariants are exercised on stable
    /// Rust without a fuzzing engine.
    #[test]
    fn pseudo_random_sweep_holds() {
        let mut state: u64 = 0x9E37_79B9_7F4A_7C15;
        let mut next = move || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state
        };
        for _ in 0..60_000 {
            let mut bytes = [0u8; INPUT_LEN];
            for chunk in bytes.chunks_mut(8) {
                let word = next().to_le_bytes();
                chunk.copy_from_slice(&word[..chunk.len()]);
            }
            assert_extreme_range_invariants(&decode_extreme_input(&bytes));
        }
    }
}
