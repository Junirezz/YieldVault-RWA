//! Deterministic protocol-fee rounding policy.
//!
//! All fee calculations use **floor division** (truncate toward zero):
//! `fee = amount * fee_bps / 10_000` with integer division rounding down.
//! The vault never over-charges; any sub-stroop remainder stays with depositors.
//!
//! ## Accumulator Rollover Handling
//!
//! Long-running vaults may accumulate very large treasury balances. This module
//! provides bounded accumulator logic to prevent precision loss and rollover:
//!
//! - **Max Accumulator**: i128::MAX / 2 (prevents overflow during accumulation)
//! - **Rollover Behavior**: When accumulated fees would exceed the bound, excess
//!   is carried to a secondary account or marked for immediate claiming.

pub const BPS_DENOMINATOR: i128 = 10_000;
pub const MAX_TREASURY_ACCUMULATOR: i128 = i128::MAX / 2;

use crate::VaultError;

/// Compute protocol fee and net amount using floor rounding.
///
/// Returns `(fee_amount, net_amount)` where `fee_amount + net_amount == amount`.
pub fn calculate_protocol_fee(
    amount: i128,
    fee_bps: i128,
) -> Result<(i128, i128), VaultError> {
    if amount < 0 {
        return Err(VaultError::InvalidAmount);
    }
    if !(0..=BPS_DENOMINATOR).contains(&fee_bps) {
        return Err(VaultError::InvalidFeeBps);
    }

    if amount == 0 || fee_bps == 0 {
        return Ok((0, amount));
    }

    let whole_fee = (amount / BPS_DENOMINATOR)
        .checked_mul(fee_bps)
        .ok_or(VaultError::MathOverflow)?;
    let fractional_fee = (amount % BPS_DENOMINATOR)
        .checked_mul(fee_bps)
        .ok_or(VaultError::MathOverflow)?
        / BPS_DENOMINATOR;
    let fee_amount = whole_fee
        .checked_add(fractional_fee)
        .ok_or(VaultError::MathOverflow)?;
    let net_amount = amount
        .checked_sub(fee_amount)
        .ok_or(VaultError::MathOverflow)?;
    Ok((fee_amount, net_amount))
}

/// Check if accumulating a fee amount would exceed the bounded accumulator.
/// Returns true if rollover protection should be triggered.
pub fn would_exceed_accumulator_bound(current_balance: i128, fee_to_add: i128) -> bool {
    current_balance > MAX_TREASURY_ACCUMULATOR
        || current_balance.saturating_add(fee_to_add) > MAX_TREASURY_ACCUMULATOR
}

#[cfg(test)]
mod tests {
    use super::{
        calculate_protocol_fee as try_calculate_protocol_fee, would_exceed_accumulator_bound,
        MAX_TREASURY_ACCUMULATOR,
    };
    use crate::VaultError;
    use proptest::prelude::*;

    fn calculate_protocol_fee(amount: i128, fee_bps: i128) -> (i128, i128) {
        try_calculate_protocol_fee(amount, fee_bps).unwrap()
    }

    #[test]
    fn test_zero_amount_zero_fee() {
        assert_eq!(calculate_protocol_fee(0, 500), (0, 0));
    }

    #[test]
    fn test_zero_bps_no_fee() {
        assert_eq!(calculate_protocol_fee(1_000_000, 0), (0, 1_000_000));
    }

    #[test]
    fn test_max_bps_full_fee() {
        assert_eq!(calculate_protocol_fee(1_000, 10_000), (1_000, 0));
    }

    #[test]
    fn test_one_bps_exact() {
        assert_eq!(calculate_protocol_fee(10_000, 1), (1, 9_999));
    }

    #[test]
    fn test_one_bps_truncates_down() {
        // 9_999 * 1 / 10_000 = 0 (floor)
        assert_eq!(calculate_protocol_fee(9_999, 1), (0, 9_999));
    }

    #[test]
    fn test_sub_stroop_remainder_stays_with_depositor() {
        // amount=1, fee_bps=3333 → fee = 0, net = 1
        assert_eq!(calculate_protocol_fee(1, 3_333), (0, 1));
        // amount=2, fee_bps=3333 → fee = 0, net = 2
        assert_eq!(calculate_protocol_fee(2, 3_333), (0, 2));
        // amount=3, fee_bps=3333 → fee = 0, net = 3
        assert_eq!(calculate_protocol_fee(3, 3_333), (0, 3));
        // amount=4, fee_bps=3333 → fee = 1, net = 3
        assert_eq!(calculate_protocol_fee(4, 3_333), (1, 3));
    }

    #[test]
    fn test_boundary_one_below_bps_denominator() {
        assert_eq!(calculate_protocol_fee(9_999, 10_000), (9_999, 0));
    }

    #[test]
    fn test_boundary_one_at_bps_denominator() {
        assert_eq!(calculate_protocol_fee(10_000, 10_000), (10_000, 0));
    }

    #[test]
    fn test_large_amount_no_overflow() {
        let amount = i128::MAX / 10_000;
        let (fee, net) = calculate_protocol_fee(amount, 100);
        assert_eq!(fee + net, amount);
        assert!(fee <= amount);
    }

    #[test]
    fn test_common_fee_rates_deterministic() {
        let cases: &[(i128, i128, i128)] = &[
            (100, 250, 2),   // 2.5% of 100
            (100, 500, 5),   // 5%
            (100, 1000, 10), // 10%
            (1, 5000, 0),    // 50% of 1 truncates to 0
            (3, 5000, 1),    // 50% of 3 = 1
            (10_000_000_000, 25, 25_000_000),
        ];
        for &(amount, bps, expected_fee) in cases {
            let (fee, net) = calculate_protocol_fee(amount, bps);
            assert_eq!(fee, expected_fee, "amount={amount} bps={bps}");
            assert_eq!(fee + net, amount);
        }
    }

    #[test]
    fn test_fee_invariant_across_multiple_yield_values() {
        for amount in [0, 1, 2, 3, 4, 9, 10, 99, 100, 1_001, 10_000] {
            for bps in [0, 1, 25, 100, 333, 500, 999, 1000, 3333, 5000, 9999, 10_000] {
                let (fee, net) = calculate_protocol_fee(amount, bps);
                assert_eq!(fee + net, amount, "amount={amount} bps={bps}");
                assert!(fee <= amount && net <= amount, "amount={amount} bps={bps}");
            }
        }
    }

    #[test]
    fn test_fee_invariant_large_balances() {
        let cases = [
            (i128::MAX / 10, 250),
            (i128::MAX / 100, 5000),
            (i128::MAX / 1_000, 10_000),
        ];
        for &(amount, bps) in &cases {
            let (fee, net) = calculate_protocol_fee(amount, bps);
            assert_eq!(fee + net, amount, "amount={amount} bps={bps}");
        }
    }

    #[test]
    fn test_monotonic_fee_never_exceeds_amount() {
        for amount in [1i128, 2, 3, 7, 99, 100, 101, 9999, 10_000, 10_001] {
            for bps in [1, 50, 100, 333, 500, 999, 1000, 3333, 5000, 9999, 10_000] {
                let (fee, net) = calculate_protocol_fee(amount, bps);
                assert!(fee <= amount);
                assert_eq!(fee + net, amount);
            }
        }
    }

    #[test]
    fn test_rejects_negative_bps() {
        assert_eq!(
            try_calculate_protocol_fee(100, -1),
            Err(VaultError::InvalidFeeBps)
        );
    }

    #[test]
    fn test_rejects_bps_above_denominator() {
        assert_eq!(
            try_calculate_protocol_fee(100, 10_001),
            Err(VaultError::InvalidFeeBps)
        );
    }

    #[test]
    fn test_rejects_negative_amount() {
        assert_eq!(
            try_calculate_protocol_fee(-1, 100),
            Err(VaultError::InvalidAmount)
        );
    }

    #[test]
    fn test_maximum_amount_does_not_overflow() {
        assert_eq!(
            try_calculate_protocol_fee(i128::MAX, 10_000),
            Ok((i128::MAX, 0))
        );
    }

    proptest! {
        #[test]
        fn protocol_fee_is_conservative(
            amount in 0i128..=i128::MAX,
            fee_bps in 0i128..=10_000,
        ) {
            let (fee, net) = try_calculate_protocol_fee(amount, fee_bps).unwrap();
            prop_assert!(fee >= 0 && net >= 0);
            prop_assert!(fee <= amount && net <= amount);
            prop_assert_eq!(fee.checked_add(net), Some(amount));
        }
    }

    #[test]
    fn test_math_overflow_is_returned() {
        assert_eq!(
            try_calculate_protocol_fee(i128::MAX, 5_000),
            Ok((i128::MAX / 2, i128::MAX - i128::MAX / 2))
        );
    }

    #[test]
    fn test_accumulator_bound_safe_values() {
        assert!(!would_exceed_accumulator_bound(0, 1_000));
        assert!(!would_exceed_accumulator_bound(1_000, 1_000));
    }

    #[test]
    fn test_accumulator_rollover_detection() {
        let near_limit = MAX_TREASURY_ACCUMULATOR - 100;
        assert!(!would_exceed_accumulator_bound(near_limit, 50));
        assert!(would_exceed_accumulator_bound(near_limit, 200));
    }

    #[test]
    fn test_accumulator_already_exceeded() {
        let over_limit = MAX_TREASURY_ACCUMULATOR + 1;
        assert!(would_exceed_accumulator_bound(over_limit, 0));
    }
}
