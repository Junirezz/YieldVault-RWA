//! Vault share conversion math with deterministic rounding policy.
//!
//! `no_std` so it links cleanly into the Soroban vault's `wasm32-unknown-unknown`
//! build; also used host-side by the proptest suite and `cargo fuzz` targets.
//!
//! ## Numeric Boundaries and Constraints
//! - Maximum `i128` (3.4e38) represents the theoretical absolute upper limit for assets or shares.
//! - The conversion math uses intermediate multiplication: `assets * total_shares` and `shares * total_assets`.
//! - These multiplications must not exceed `i128::MAX`. If they do, the `try_` functions will return `None`.
//! - For practical usage, to prevent overflow during standard operations, total vault shares and assets
//!   should generally be kept significantly below `i128::MAX / expected_deposit_size`.
//! - Specifically, if `total_shares` and `total_assets` are bounded by `2^64`, then any operation with
//!   values up to `2^63` will never overflow an `i128`.
#![no_std]

pub mod fuzz_invariants;
pub mod rounding;

/// Error returned when checked math cannot produce an i128 result.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum MathError {
    Overflow,
    DivisionByZero,
}

/// Checked assets-to-shares conversion using round-down arithmetic.
///
/// An empty vault (zero shares or assets) uses a 1:1 conversion.
pub fn try_assets_to_shares(
    assets: i128,
    total_shares: i128,
    total_assets: i128,
) -> Result<i128, MathError> {
    if total_assets == 0 || total_shares == 0 {
        return Ok(assets);
    }
    let product = assets
        .checked_mul(total_shares)
        .ok_or(MathError::Overflow)?;
    product
        .checked_div(total_assets)
        .ok_or(MathError::Overflow)
}

/// Checked shares-to-assets conversion using round-down arithmetic.
///
/// A vault with no outstanding shares redeems to zero.
pub fn try_shares_to_assets(
    shares: i128,
    total_shares: i128,
    total_assets: i128,
) -> Result<i128, MathError> {
    if total_shares == 0 {
        return Ok(0);
    }
    let product = shares
        .checked_mul(total_assets)
        .ok_or(MathError::Overflow)?;
    product
        .checked_div(total_shares)
        .ok_or(MathError::Overflow)
}

/// Converts assets to shares using the current vault state (round-down).
pub fn assets_to_shares(
    assets: i128,
    total_shares: i128,
    total_assets: i128,
) -> Result<i128, MathError> {
    try_assets_to_shares(assets, total_shares, total_assets)
}

/// Converts shares to assets using the current vault state (round-down).
pub fn shares_to_assets(
    shares: i128,
    total_shares: i128,
    total_assets: i128,
) -> Result<i128, MathError> {
    try_shares_to_assets(shares, total_shares, total_assets)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_first_deposit_one_to_one() {
        let shares = assets_to_shares(1000, 0, 0).unwrap();
        assert_eq!(shares, 1000);
    }

    #[test]
    fn test_round_trip_never_increases_value() {
        let original_assets = 300;
        let shares = assets_to_shares(original_assets, 1000, 1500).unwrap();
        let recovered_assets =
            shares_to_assets(shares, 1000 + shares, 1500 + original_assets).unwrap();
        assert!(recovered_assets <= original_assets);
    }

    #[test]
    fn test_overflow_protection_assets_to_shares() {
        assert_eq!(
            try_assets_to_shares(i128::MAX, i128::MAX, 1),
            Err(MathError::Overflow)
        );
    }

    #[test]
    fn test_overflow_protection_shares_to_assets() {
        assert_eq!(
            try_shares_to_assets(i128::MAX, 1, i128::MAX),
            Err(MathError::Overflow)
        );
    }
}
