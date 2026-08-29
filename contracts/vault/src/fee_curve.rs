//! Utilization-based dynamic protocol fee curve.
//!
//! The static protocol fee (`DataKey::FeeBps`) charges the same rate no matter
//! how much of the vault's capital is actually deployed. That leaves the vault
//! with no lever to balance supply and demand: when almost everything is
//! working inside the strategy, idle liquidity is scarce and withdrawals get
//! queued, yet depositing stays exactly as cheap as it was at 10% utilization.
//!
//! This module supplies the missing lever — a **kinked linear fee curve** over
//! the vault's utilization ratio:
//!
//! ```text
//!   fee_bps
//!      ▲
//!  max ┤                                        ╱
//!      │                                      ╱
//!      │                                    ╱
//!  opt ┤────────────────────────────────╱
//!      │                        ╱───────
//!      │            ╱───────────
//! base ┤────────────
//!      └────────────┬───────────────────┬──────▶ utilization_bps
//!      0          kink              10_000
//! ```
//!
//! Below the kink (`optimal_utilization_bps`) the fee climbs gently from
//! `base_fee_bps` to `optimal_fee_bps`. Above it the curve steepens toward
//! `max_fee_bps`, so the scarcer idle liquidity becomes, the more the protocol
//! charges on incoming yield.
//!
//! ## Rounding
//!
//! Every interpolation uses **floor division**, matching the policy in
//! [`crate::fee_math`]: the vault never rounds a fee up, so a sub-basis-point
//! remainder always stays with depositors.
//!
//! ## Safety properties enforced here
//!
//! * [`validate`] rejects any curve that is not monotonically non-decreasing
//!   (`base <= optimal <= max`), so a "dynamic" curve can never be shaped to
//!   charge *less* at high utilization than at low.
//! * Every leg is bounded by `max_fee_bps <= 10_000`, so
//!   [`fee_bps_at`] always returns a value [`crate::fee_math`] accepts.
//! * The curve is **disabled by default**. Until governance explicitly enables
//!   one, the vault keeps charging the static `fee_bps` exactly as before.

use crate::VaultError;
use soroban_sdk::contracttype;

/// Basis-point denominator: 10_000 bps == 100%.
pub const BPS_DENOMINATOR: i128 = 10_000;

/// Governance-configurable parameters for the dynamic fee curve.
///
/// All fee fields are basis points of harvested yield; `optimal_utilization_bps`
/// is the kink expressed in basis points of utilization.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeCurve {
    /// When false the vault ignores the curve and charges the static `fee_bps`.
    pub enabled: bool,
    /// Fee charged at 0% utilization.
    pub base_fee_bps: i128,
    /// Fee charged exactly at the kink.
    pub optimal_fee_bps: i128,
    /// Fee charged at 100% utilization.
    pub max_fee_bps: i128,
    /// Utilization at which the curve changes slope (0 < kink < 10_000).
    pub optimal_utilization_bps: i128,
}

/// A fee-curve change queued behind the sensitive-parameter timelock.
///
/// Mirrors [`crate::timelock::PendingI128Change`] for a struct-valued parameter.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingFeeCurveChange {
    pub new_value: FeeCurve,
    /// Ledger timestamp at/after which this change may be executed.
    pub eta: u64,
}

/// The curve a vault has before governance ever configures one: disabled, and
/// therefore inert. Field values are placeholders that still satisfy
/// [`validate`], so a governance call can flip `enabled` without also having to
/// repair the shape.
pub fn default_curve() -> FeeCurve {
    FeeCurve {
        enabled: false,
        base_fee_bps: 0,
        optimal_fee_bps: 0,
        max_fee_bps: 0,
        optimal_utilization_bps: 8_000,
    }
}

/// Computes the vault's utilization ratio in basis points.
///
/// `deployed` is the capital working inside the strategy; `total` is that plus
/// the idle balance the vault still holds. The result is clamped to
/// `0..=10_000`, and a vault with no assets reads as 0% utilized.
///
/// Never panics: at balances large enough that `deployed * 10_000` would
/// overflow `i128`, it divides first instead of multiplying. That loses at most
/// one basis point of precision, and only above ~1.7e34 stroops.
pub fn utilization_bps(deployed: i128, total: i128) -> i128 {
    if total <= 0 || deployed <= 0 {
        return 0;
    }
    if deployed >= total {
        return BPS_DENOMINATOR;
    }
    match deployed.checked_mul(BPS_DENOMINATOR) {
        Some(scaled) => scaled / total,
        None => {
            // `total > deployed`, so `total` is astronomically large too.
            // Scale the denominator down instead of the numerator up.
            let divisor = (total / BPS_DENOMINATOR).max(1);
            (deployed / divisor).clamp(0, BPS_DENOMINATOR)
        }
    }
}

/// Validates a governance-supplied curve.
///
/// # Errors
/// Returns [`VaultError::InvalidFeeBps`] when any fee leg falls outside
/// `0..=10_000`, when the legs are not monotonically non-decreasing, or when
/// the kink is not strictly between 0% and 100% utilization.
///
/// `VaultError` is capped at 50 variants by the Soroban error-enum spec, so
/// this reuses the existing fee-range code rather than defining a new one —
/// the same reuse convention documented on [`VaultError::NoPendingWithdrawal`].
pub fn validate(curve: &FeeCurve) -> Result<(), VaultError> {
    let in_range = |bps: i128| (0..=BPS_DENOMINATOR).contains(&bps);
    if !in_range(curve.base_fee_bps)
        || !in_range(curve.optimal_fee_bps)
        || !in_range(curve.max_fee_bps)
    {
        return Err(VaultError::InvalidFeeBps);
    }
    if curve.base_fee_bps > curve.optimal_fee_bps || curve.optimal_fee_bps > curve.max_fee_bps {
        return Err(VaultError::InvalidFeeBps);
    }
    if !(1..BPS_DENOMINATOR).contains(&curve.optimal_utilization_bps) {
        return Err(VaultError::InvalidFeeBps);
    }
    Ok(())
}

/// Interpolates the fee (in bps) that `curve` charges at `utilization_bps`.
///
/// Utilization outside `0..=10_000` is clamped rather than rejected, so a
/// caller can hand this a raw ratio without a second range check.
///
/// Assumes `curve` passed [`validate`]; every stored curve does, because
/// `YieldVault::queue_fee_curve_change` validates before persisting. The
/// arithmetic is still overflow-free for any in-range curve: the largest
/// intermediate is `10_000 * 10_000`.
pub fn fee_bps_at(curve: &FeeCurve, utilization_bps: i128) -> i128 {
    let utilization = utilization_bps.clamp(0, BPS_DENOMINATOR);
    let kink = curve.optimal_utilization_bps;

    if utilization <= kink {
        if kink <= 0 {
            return curve.optimal_fee_bps;
        }
        let span = curve.optimal_fee_bps - curve.base_fee_bps;
        curve.base_fee_bps + (span * utilization) / kink
    } else {
        let above_kink = BPS_DENOMINATOR - kink;
        if above_kink <= 0 {
            return curve.max_fee_bps;
        }
        let span = curve.max_fee_bps - curve.optimal_fee_bps;
        curve.optimal_fee_bps + (span * (utilization - kink)) / above_kink
    }
}

/// Resolves the fee the vault should actually charge right now.
///
/// Returns `static_fee_bps` untouched whenever the curve is disabled, which is
/// the state of every vault that has not opted in. Otherwise returns the
/// curve's fee at the supplied utilization.
pub fn effective_fee_bps(curve: &FeeCurve, static_fee_bps: i128, utilization_bps: i128) -> i128 {
    if !curve.enabled {
        return static_fee_bps;
    }
    fee_bps_at(curve, utilization_bps)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Reference curve used across the acceptance-criteria tests:
    /// 0.25% base → 1% at an 80% kink → 5% at full utilization.
    fn reference_curve() -> FeeCurve {
        FeeCurve {
            enabled: true,
            base_fee_bps: 25,
            optimal_fee_bps: 100,
            max_fee_bps: 500,
            optimal_utilization_bps: 8_000,
        }
    }

    // ── utilization_bps ──────────────────────────────────────────────────────

    #[test]
    fn test_utilization_empty_vault_is_zero() {
        assert_eq!(utilization_bps(0, 0), 0);
        assert_eq!(utilization_bps(100, 0), 0);
        assert_eq!(utilization_bps(0, 1_000), 0);
    }

    #[test]
    fn test_utilization_negative_inputs_read_as_zero() {
        assert_eq!(utilization_bps(-1, 1_000), 0);
        assert_eq!(utilization_bps(500, -1), 0);
    }

    #[test]
    fn test_utilization_common_ratios() {
        assert_eq!(utilization_bps(200, 1_000), 2_000);
        assert_eq!(utilization_bps(500, 1_000), 5_000);
        assert_eq!(utilization_bps(800, 1_000), 8_000);
        assert_eq!(utilization_bps(950, 1_000), 9_500);
    }

    #[test]
    fn test_utilization_fully_deployed_is_capped_at_100_percent() {
        assert_eq!(utilization_bps(1_000, 1_000), BPS_DENOMINATOR);
        // Strategy mark-to-market can exceed the recorded total after a harvest.
        assert_eq!(utilization_bps(1_500, 1_000), BPS_DENOMINATOR);
    }

    #[test]
    fn test_utilization_floors_rather_than_rounding_up() {
        // 1/3 == 3333.33… bps
        assert_eq!(utilization_bps(1, 3), 3_333);
        // 9_999 * 10_000 / 10_000 == 9_999 exactly
        assert_eq!(utilization_bps(9_999, 10_000), 9_999);
    }

    #[test]
    fn test_utilization_large_balances_do_not_panic() {
        let total = i128::MAX;
        let deployed = i128::MAX / 2;
        let result = utilization_bps(deployed, total);
        assert!((0..=BPS_DENOMINATOR).contains(&result));
        // Half deployed, within the one-bps tolerance of the divide-first path.
        assert!((4_999..=5_001).contains(&result), "got {result}");
    }

    // ── validate ─────────────────────────────────────────────────────────────

    #[test]
    fn test_validate_accepts_reference_curve() {
        assert_eq!(validate(&reference_curve()), Ok(()));
    }

    #[test]
    fn test_validate_accepts_default_disabled_curve() {
        assert_eq!(validate(&default_curve()), Ok(()));
    }

    #[test]
    fn test_validate_accepts_flat_curve() {
        let curve = FeeCurve {
            enabled: true,
            base_fee_bps: 100,
            optimal_fee_bps: 100,
            max_fee_bps: 100,
            optimal_utilization_bps: 5_000,
        };
        assert_eq!(validate(&curve), Ok(()));
    }

    #[test]
    fn test_validate_rejects_decreasing_legs() {
        let mut curve = reference_curve();
        curve.optimal_fee_bps = 10; // below base
        assert_eq!(validate(&curve), Err(VaultError::InvalidFeeBps));

        let mut curve = reference_curve();
        curve.max_fee_bps = 50; // below optimal
        assert_eq!(validate(&curve), Err(VaultError::InvalidFeeBps));
    }

    #[test]
    fn test_validate_rejects_out_of_range_fees() {
        let mut curve = reference_curve();
        curve.base_fee_bps = -1;
        assert_eq!(validate(&curve), Err(VaultError::InvalidFeeBps));

        let mut curve = reference_curve();
        curve.max_fee_bps = 10_001;
        assert_eq!(validate(&curve), Err(VaultError::InvalidFeeBps));
    }

    #[test]
    fn test_validate_rejects_degenerate_kink() {
        for kink in [-1, 0, 10_000, 10_001] {
            let mut curve = reference_curve();
            curve.optimal_utilization_bps = kink;
            assert_eq!(
                validate(&curve),
                Err(VaultError::InvalidFeeBps),
                "kink={kink}"
            );
        }
    }

    // ── fee_bps_at: acceptance-criteria utilization levels ───────────────────

    #[test]
    fn test_fee_at_20_percent_utilization() {
        // 25 + (100-25) * 2000/8000 = 25 + 18 (18.75 floored) = 43
        assert_eq!(fee_bps_at(&reference_curve(), 2_000), 43);
    }

    #[test]
    fn test_fee_at_50_percent_utilization() {
        // 25 + 75 * 5000/8000 = 25 + 46 (46.875 floored) = 71
        assert_eq!(fee_bps_at(&reference_curve(), 5_000), 71);
    }

    #[test]
    fn test_fee_at_80_percent_utilization_is_exactly_the_kink() {
        assert_eq!(fee_bps_at(&reference_curve(), 8_000), 100);
    }

    #[test]
    fn test_fee_at_95_percent_utilization() {
        // 100 + (500-100) * 1500/2000 = 100 + 300 = 400
        assert_eq!(fee_bps_at(&reference_curve(), 9_500), 400);
    }

    #[test]
    fn test_fee_rises_across_the_four_acceptance_levels() {
        let curve = reference_curve();
        let fees: [i128; 4] = [
            fee_bps_at(&curve, 2_000),
            fee_bps_at(&curve, 5_000),
            fee_bps_at(&curve, 8_000),
            fee_bps_at(&curve, 9_500),
        ];
        assert_eq!(fees, [43, 71, 100, 400]);
        assert!(fees.windows(2).all(|pair| pair[0] < pair[1]));
    }

    // ── fee_bps_at: endpoints, clamping, invariants ──────────────────────────

    #[test]
    fn test_fee_at_endpoints_matches_configured_legs() {
        let curve = reference_curve();
        assert_eq!(fee_bps_at(&curve, 0), curve.base_fee_bps);
        assert_eq!(fee_bps_at(&curve, BPS_DENOMINATOR), curve.max_fee_bps);
    }

    #[test]
    fn test_fee_clamps_out_of_range_utilization() {
        let curve = reference_curve();
        assert_eq!(fee_bps_at(&curve, -500), curve.base_fee_bps);
        assert_eq!(fee_bps_at(&curve, 25_000), curve.max_fee_bps);
    }

    #[test]
    fn test_fee_is_monotonic_and_bounded_across_full_sweep() {
        let curve = reference_curve();
        let mut previous = i128::MIN;
        let mut utilization = 0;
        while utilization <= BPS_DENOMINATOR {
            let fee = fee_bps_at(&curve, utilization);
            assert!(fee >= previous, "fee dipped at utilization={utilization}");
            assert!(
                (curve.base_fee_bps..=curve.max_fee_bps).contains(&fee),
                "fee {fee} outside configured legs at utilization={utilization}"
            );
            previous = fee;
            utilization += 1;
        }
    }

    #[test]
    fn test_fee_never_exceeds_the_bps_denominator() {
        let curve = FeeCurve {
            enabled: true,
            base_fee_bps: 0,
            optimal_fee_bps: 5_000,
            max_fee_bps: BPS_DENOMINATOR,
            optimal_utilization_bps: 5_000,
        };
        for utilization in [0, 1, 2_500, 5_000, 7_500, 9_999, 10_000] {
            let fee = fee_bps_at(&curve, utilization);
            assert!(
                (0..=BPS_DENOMINATOR).contains(&fee),
                "fee {fee} out of range at utilization={utilization}"
            );
        }
    }

    #[test]
    fn test_flat_curve_returns_the_same_fee_everywhere() {
        let curve = FeeCurve {
            enabled: true,
            base_fee_bps: 250,
            optimal_fee_bps: 250,
            max_fee_bps: 250,
            optimal_utilization_bps: 8_000,
        };
        for utilization in [0, 2_000, 5_000, 8_000, 9_500, 10_000] {
            assert_eq!(fee_bps_at(&curve, utilization), 250);
        }
    }

    // ── effective_fee_bps ────────────────────────────────────────────────────

    #[test]
    fn test_effective_fee_ignores_curve_while_disabled() {
        let mut curve = reference_curve();
        curve.enabled = false;
        for utilization in [0, 2_000, 5_000, 8_000, 9_500, 10_000] {
            assert_eq!(effective_fee_bps(&curve, 250, utilization), 250);
        }
    }

    #[test]
    fn test_effective_fee_uses_curve_once_enabled() {
        let curve = reference_curve();
        assert_eq!(effective_fee_bps(&curve, 250, 2_000), 43);
        assert_eq!(effective_fee_bps(&curve, 250, 9_500), 400);
    }

    #[test]
    fn test_default_curve_is_inert() {
        let curve = default_curve();
        assert!(!curve.enabled);
        assert_eq!(effective_fee_bps(&curve, 777, 9_500), 777);
    }
}
