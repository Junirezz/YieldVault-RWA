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

/// Compute protocol fee and net amount using floor rounding.
///
/// Returns `(fee_amount, net_amount)` where `fee_amount + net_amount == amount`.
pub fn calculate_protocol_fee(amount: i128, fee_bps: i128) -> (i128, i128) {
    assert!(amount >= 0, "amount must be non-negative");
    assert!(
        (0..=BPS_DENOMINATOR).contains(&fee_bps),
        "fee_bps out of range"
    );

    if amount == 0 || fee_bps == 0 {
        return (0, amount);
    }

    let fee_amount = amount.checked_mul(fee_bps).expect("fee overflow") / BPS_DENOMINATOR;
    let net_amount = amount - fee_amount;
    assert!(
        fee_amount >= 0 && net_amount >= 0,
        "fee accounting invariant violated: negative fee share"
    );
    assert_eq!(
        fee_amount + net_amount,
        amount,
        "fee accounting invariant violated: fee + net != amount"
    );
    (fee_amount, net_amount)
}

/// Check if accumulating a fee amount would exceed the bounded accumulator.
/// Returns true if rollover protection should be triggered.
pub fn would_exceed_accumulator_bound(current_balance: i128, fee_to_add: i128) -> bool {
    current_balance > MAX_TREASURY_ACCUMULATOR
        || current_balance.saturating_add(fee_to_add) > MAX_TREASURY_ACCUMULATOR
}

#[cfg(test)]
mod tests {
    use super::*;

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
    #[should_panic(expected = "fee_bps out of range")]
    fn test_rejects_negative_bps() {
        calculate_protocol_fee(100, -1);
    }

    #[test]
    #[should_panic(expected = "fee_bps out of range")]
    fn test_rejects_bps_above_denominator() {
        calculate_protocol_fee(100, 10_001);
    }

    #[test]
    #[should_panic(expected = "amount must be non-negative")]
    fn test_rejects_negative_amount() {
        calculate_protocol_fee(-1, 100);
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
