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

/// Checked variant of [`assets_to_shares`] for fuzzing and property tests.
///
/// Returns `None` when intermediate multiplication would overflow i128.
pub fn try_assets_to_shares(assets: i128, total_shares: i128, total_assets: i128) -> Option<i128> {
    if total_assets == 0 || total_shares == 0 {
        return Some(assets);
    }
    assets.checked_mul(total_shares)?.checked_div(total_assets)
}

/// Checked variant of [`shares_to_assets`] for fuzzing and property tests.
///
/// Returns `None` when intermediate multiplication would overflow i128.
pub fn try_shares_to_assets(shares: i128, total_shares: i128, total_assets: i128) -> Option<i128> {
    if total_shares == 0 {
        return Some(0);
    }
    shares.checked_mul(total_assets)?.checked_div(total_shares)
}

/// Converts assets to shares using the current vault state (round-down).
pub fn assets_to_shares(assets: i128, total_shares: i128, total_assets: i128) -> i128 {
    if total_assets == 0 || total_shares == 0 {
        return assets;
    }

    assets
        .checked_mul(total_shares)
        .expect("overflow in assets_to_shares multiplication")
        .checked_div(total_assets)
        .expect("division by zero in assets_to_shares")
}

/// Converts shares to assets using the current vault state (round-down).
pub fn shares_to_assets(shares: i128, total_shares: i128, total_assets: i128) -> i128 {
    if total_shares == 0 {
        return 0;
    }

    shares
        .checked_mul(total_assets)
        .expect("overflow in shares_to_assets multiplication")
        .checked_div(total_shares)
        .expect("division by zero in shares_to_assets")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_first_deposit_one_to_one() {
        let shares = assets_to_shares(1000, 0, 0);
        assert_eq!(shares, 1000);
    }

    #[test]
    fn test_round_trip_never_increases_value() {
        let original_assets = 300;
        let shares = assets_to_shares(original_assets, 1000, 1500);
        let recovered_assets = shares_to_assets(shares, 1000 + shares, 1500 + original_assets);
        assert!(recovered_assets <= original_assets);
    }

    #[test]
    #[should_panic(expected = "overflow")]
    fn test_overflow_protection_assets_to_shares() {
        let _ = assets_to_shares(i128::MAX, i128::MAX, 1);
    }
}
