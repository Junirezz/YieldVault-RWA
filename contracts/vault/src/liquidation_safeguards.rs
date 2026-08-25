//! Liquidation and recovery safeguards for strategy shortfalls (Issue #1165).
//!
//! A strategy can report back less value than the vault deployed into it —
//! through a defaulted RWA tranche, an oracle-reported markdown, or a bug in the
//! strategy adapter. Left unhandled, the vault keeps quoting a share price that
//! its assets no longer back, and the first movers redeem at par while the last
//! movers absorb the entire loss.
//!
//! This module is a *pure* decision layer evaluated **before** any state is
//! mutated, mirroring [`crate::withdrawal_queue_safety`]: it classifies the
//! shortfall, gates recovery execution behind explicit preconditions, and
//! computes the loss socialisation that keeps the share price honest.
//!
//! ## Responsibilities
//!
//! - [`assess_shortfall`] — classify a strategy position as healthy, degraded,
//!   or impaired against an operator-configured tolerance.
//! - [`check_recovery_preconditions`] — reject recovery attempts made under
//!   invalid conditions (live vault, missing governance approvals, no measured
//!   shortfall, over-sized recovery amount).
//! - [`socialize_loss`] — apply an impairment to the vault's asset base with
//!   saturating, non-negative arithmetic.
//!
//! Operator and governance responsibilities are documented in
//! `docs/runbooks/VAULT_LIQUIDATION_RECOVERY.md`.
//!
//! ## Error-code reuse
//!
//! The Soroban error enum is capped at 50 cases (see [`crate::errors`]), so this
//! module deliberately reuses existing codes rather than defining new ones:
//!
//! | Condition | Code |
//! |---|---|
//! | No strategy configured | [`VaultError::StrategyNotConfigured`] |
//! | Non-positive / corrupt amounts | [`VaultError::InvalidAmount`] |
//! | `tolerance_bps` outside `0..=10_000` | [`VaultError::InvalidRiskThreshold`] |
//! | Fewer approvals than required | [`VaultError::GovernanceThresholdNotMet`] |
//! | Vault still live (not paused) | [`VaultError::RescueUnauthorized`] |
//! | Recovery amount exceeds the measured shortfall | [`VaultError::ExceedsRiskThreshold`] |
//! | Arithmetic overflow | [`VaultError::MathOverflow`] |

use crate::errors::VaultError;

/// Basis-point denominator.
pub const BPS_DENOMINATOR: i128 = 10_000;

/// Classification of a strategy's reported value against the vault's expectation.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum StrategyHealth {
    /// Reported value meets or exceeds what the vault deployed.
    Healthy,
    /// Reported value is short, but within the configured tolerance — the vault
    /// keeps operating and the position is watched, not liquidated.
    Degraded,
    /// Reported value is short beyond tolerance. The position is treated as bad
    /// debt: recovery may be executed and the loss socialised.
    Impaired,
}

/// Outcome of a shortfall assessment.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct ShortfallReport {
    /// Health classification for the position.
    pub health: StrategyHealth,
    /// Absolute shortfall in underlying asset units (never negative).
    pub shortfall: i128,
    /// Shortfall as a share of `expected_value`, in basis points, rounded **up**
    /// so a partially-lost basis point never reads as zero loss.
    pub shortfall_bps: i128,
}

impl ShortfallReport {
    /// Whether the position carries bad debt that recovery may act on.
    pub fn is_impaired(&self) -> bool {
        matches!(self.health, StrategyHealth::Impaired)
    }
}

/// A strategy position as the vault sees it at assessment time.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct StrategyPosition {
    /// Value the vault believes is deployed — the strategy high-water mark.
    pub expected_value: i128,
    /// Value the strategy currently reports via `total_value()`.
    pub reported_value: i128,
    /// Shortfall the vault tolerates before declaring the position impaired.
    pub tolerance_bps: u32,
}

/// Classifies `position` as healthy, degraded, or impaired.
///
/// A position with `expected_value == 0` is always [`StrategyHealth::Healthy`]:
/// nothing was deployed, so nothing can be lost. This matters because a naive
/// percentage would divide by zero on a freshly registered strategy.
///
/// # Errors
/// - [`VaultError::InvalidAmount`] — negative expected or reported value.
/// - [`VaultError::InvalidRiskThreshold`] — tolerance outside `0..=10_000` bps.
/// - [`VaultError::MathOverflow`] — the basis-point scaling would overflow.
pub fn assess_shortfall(position: &StrategyPosition) -> Result<ShortfallReport, VaultError> {
    if position.expected_value < 0 || position.reported_value < 0 {
        return Err(VaultError::InvalidAmount);
    }
    if position.tolerance_bps as i128 > BPS_DENOMINATOR {
        return Err(VaultError::InvalidRiskThreshold);
    }

    if position.expected_value == 0 || position.reported_value >= position.expected_value {
        return Ok(ShortfallReport {
            health: StrategyHealth::Healthy,
            shortfall: 0,
            shortfall_bps: 0,
        });
    }

    let shortfall = position
        .expected_value
        .checked_sub(position.reported_value)
        .ok_or(VaultError::MathOverflow)?;

    // Round up: a 0.004% loss must not be reported as a 0 bps loss.
    let scaled = shortfall
        .checked_mul(BPS_DENOMINATOR)
        .ok_or(VaultError::MathOverflow)?;
    let shortfall_bps = scaled
        .checked_add(position.expected_value - 1)
        .ok_or(VaultError::MathOverflow)?
        / position.expected_value;

    let health = if shortfall_bps > position.tolerance_bps as i128 {
        StrategyHealth::Impaired
    } else {
        StrategyHealth::Degraded
    };

    Ok(ShortfallReport {
        health,
        shortfall,
        shortfall_bps,
    })
}

/// Conditions under which a recovery is being attempted.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct RecoveryRequest {
    /// Asset amount the operator wants to claw back / write down.
    pub amount: i128,
    /// Whether a strategy is currently configured on the vault.
    pub strategy_configured: bool,
    /// Whether the vault is paused. Recovery mutates the share price, so it must
    /// never run while deposits and withdrawals are live.
    pub vault_paused: bool,
    /// Governance approvals collected for this recovery.
    pub approvals: u32,
    /// Governance approvals required.
    pub required_approvals: u32,
}

/// Rejects a recovery attempt made under invalid conditions.
///
/// Checks run cheapest-and-most-structural first so an operator sees the most
/// actionable failure rather than a downstream symptom.
///
/// # Errors
/// See the error-code table in the [module docs](self).
pub fn check_recovery_preconditions(
    request: &RecoveryRequest,
    report: &ShortfallReport,
) -> Result<(), VaultError> {
    if !request.strategy_configured {
        return Err(VaultError::StrategyNotConfigured);
    }
    if request.amount <= 0 || report.shortfall < 0 {
        return Err(VaultError::InvalidAmount);
    }
    // A live vault would let depositors mint at the pre-write-down share price.
    if !request.vault_paused {
        return Err(VaultError::RescueUnauthorized);
    }
    if request.approvals < request.required_approvals {
        return Err(VaultError::GovernanceThresholdNotMet);
    }
    // Nothing to recover: refuse rather than silently writing down a solvent
    // position. `Degraded` is inside tolerance and is explicitly not actionable.
    if !report.is_impaired() {
        return Err(VaultError::InvalidAmount);
    }
    if request.amount > report.shortfall {
        return Err(VaultError::ExceedsRiskThreshold);
    }
    Ok(())
}

/// Applies a realised loss to the vault's asset base.
///
/// Returns the post-write-down total assets. The result is floored at zero: a
/// loss larger than the asset base wipes the vault out rather than wrapping into
/// a negative balance that would corrupt every downstream share-price read.
///
/// `total_shares` is not mutated — socialising a loss means every share is worth
/// proportionally less, not that shares are burned.
///
/// # Errors
/// - [`VaultError::InvalidAmount`] — negative assets, shares, or loss.
pub fn socialize_loss(
    total_assets: i128,
    total_shares: i128,
    loss: i128,
) -> Result<i128, VaultError> {
    if total_assets < 0 || total_shares < 0 || loss < 0 {
        return Err(VaultError::InvalidAmount);
    }
    Ok(total_assets.saturating_sub(loss).max(0))
}

/// Largest loss that can be socialised without driving the share price to zero.
///
/// Operators use this to size a partial write-down when a full one would leave
/// outstanding shares backed by nothing.
pub fn max_socializable_loss(total_assets: i128, total_shares: i128) -> Result<i128, VaultError> {
    if total_assets < 0 || total_shares < 0 {
        return Err(VaultError::InvalidAmount);
    }
    // With no shares outstanding there is nobody to socialise the loss to.
    if total_shares == 0 {
        return Ok(total_assets);
    }
    // Leave at least one asset unit backing the outstanding shares.
    Ok(if total_assets > 0 {
        total_assets - 1
    } else {
        0
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn position(expected: i128, reported: i128, tolerance_bps: u32) -> StrategyPosition {
        StrategyPosition {
            expected_value: expected,
            reported_value: reported,
            tolerance_bps,
        }
    }

    fn request(amount: i128) -> RecoveryRequest {
        RecoveryRequest {
            amount,
            strategy_configured: true,
            vault_paused: true,
            approvals: 2,
            required_approvals: 2,
        }
    }

    fn impaired(shortfall: i128) -> ShortfallReport {
        ShortfallReport {
            health: StrategyHealth::Impaired,
            shortfall,
            shortfall_bps: 10_000,
        }
    }

    // ── assess_shortfall ────────────────────────────────────────────────────

    #[test]
    fn healthy_when_strategy_reports_at_or_above_expectation() {
        assert_eq!(
            assess_shortfall(&position(1_000, 1_000, 100))
                .unwrap()
                .health,
            StrategyHealth::Healthy
        );
        assert_eq!(
            assess_shortfall(&position(1_000, 1_500, 100))
                .unwrap()
                .health,
            StrategyHealth::Healthy
        );
    }

    #[test]
    fn undeployed_strategy_is_healthy_not_a_division_by_zero() {
        let report = assess_shortfall(&position(0, 0, 100)).unwrap();
        assert_eq!(report.health, StrategyHealth::Healthy);
        assert_eq!(report.shortfall_bps, 0);
    }

    #[test]
    fn shortfall_within_tolerance_is_degraded() {
        // 1% loss against a 5% tolerance.
        let report = assess_shortfall(&position(10_000, 9_900, 500)).unwrap();
        assert_eq!(report.health, StrategyHealth::Degraded);
        assert_eq!(report.shortfall, 100);
        assert_eq!(report.shortfall_bps, 100);
    }

    #[test]
    fn shortfall_at_exact_tolerance_boundary_is_still_degraded() {
        let report = assess_shortfall(&position(10_000, 9_500, 500)).unwrap();
        assert_eq!(report.health, StrategyHealth::Degraded);
        assert_eq!(report.shortfall_bps, 500);
    }

    #[test]
    fn shortfall_one_bp_beyond_tolerance_is_impaired() {
        let report = assess_shortfall(&position(10_000, 9_499, 500)).unwrap();
        assert_eq!(report.health, StrategyHealth::Impaired);
        assert_eq!(report.shortfall, 501);
        assert_eq!(report.shortfall_bps, 501);
    }

    #[test]
    fn sub_basis_point_loss_rounds_up_and_is_never_reported_as_zero() {
        // 1 unit lost out of 1_000_000 == 0.01 bps, which floors to 0.
        let report = assess_shortfall(&position(1_000_000, 999_999, 0)).unwrap();
        assert_eq!(report.shortfall, 1);
        assert_eq!(report.shortfall_bps, 1, "loss must round up, not vanish");
        assert_eq!(report.health, StrategyHealth::Impaired);
    }

    #[test]
    fn total_loss_reports_full_basis_points() {
        let report = assess_shortfall(&position(1_000, 0, 0)).unwrap();
        assert_eq!(report.shortfall, 1_000);
        assert_eq!(report.shortfall_bps, BPS_DENOMINATOR);
        assert!(report.is_impaired());
    }

    #[test]
    fn rejects_negative_values() {
        assert_eq!(
            assess_shortfall(&position(-1, 0, 0)),
            Err(VaultError::InvalidAmount)
        );
        assert_eq!(
            assess_shortfall(&position(0, -1, 0)),
            Err(VaultError::InvalidAmount)
        );
    }

    #[test]
    fn rejects_tolerance_outside_basis_point_range() {
        assert_eq!(
            assess_shortfall(&position(1_000, 500, 10_001)),
            Err(VaultError::InvalidRiskThreshold)
        );
    }

    #[test]
    fn rejects_basis_point_scaling_overflow() {
        assert_eq!(
            assess_shortfall(&position(i128::MAX, 0, 0)),
            Err(VaultError::MathOverflow)
        );
    }

    // ── check_recovery_preconditions ────────────────────────────────────────

    #[test]
    fn accepts_a_fully_authorised_recovery() {
        assert_eq!(
            check_recovery_preconditions(&request(500), &impaired(500)),
            Ok(())
        );
    }

    #[test]
    fn rejects_recovery_without_a_configured_strategy() {
        let mut req = request(500);
        req.strategy_configured = false;
        assert_eq!(
            check_recovery_preconditions(&req, &impaired(500)),
            Err(VaultError::StrategyNotConfigured)
        );
    }

    #[test]
    fn rejects_non_positive_recovery_amount() {
        assert_eq!(
            check_recovery_preconditions(&request(0), &impaired(500)),
            Err(VaultError::InvalidAmount)
        );
        assert_eq!(
            check_recovery_preconditions(&request(-1), &impaired(500)),
            Err(VaultError::InvalidAmount)
        );
    }

    #[test]
    fn rejects_recovery_while_the_vault_is_live() {
        let mut req = request(500);
        req.vault_paused = false;
        assert_eq!(
            check_recovery_preconditions(&req, &impaired(500)),
            Err(VaultError::RescueUnauthorized)
        );
    }

    #[test]
    fn rejects_recovery_below_the_governance_threshold() {
        let mut req = request(500);
        req.approvals = 1;
        req.required_approvals = 2;
        assert_eq!(
            check_recovery_preconditions(&req, &impaired(500)),
            Err(VaultError::GovernanceThresholdNotMet)
        );
    }

    #[test]
    fn rejects_recovery_against_a_healthy_position() {
        let healthy = ShortfallReport {
            health: StrategyHealth::Healthy,
            shortfall: 0,
            shortfall_bps: 0,
        };
        assert_eq!(
            check_recovery_preconditions(&request(1), &healthy),
            Err(VaultError::InvalidAmount)
        );
    }

    #[test]
    fn rejects_recovery_against_a_merely_degraded_position() {
        let degraded = ShortfallReport {
            health: StrategyHealth::Degraded,
            shortfall: 100,
            shortfall_bps: 100,
        };
        assert_eq!(
            check_recovery_preconditions(&request(100), &degraded),
            Err(VaultError::InvalidAmount),
            "a position inside tolerance must not be liquidated"
        );
    }

    #[test]
    fn rejects_recovery_larger_than_the_measured_shortfall() {
        assert_eq!(
            check_recovery_preconditions(&request(501), &impaired(500)),
            Err(VaultError::ExceedsRiskThreshold)
        );
    }

    #[test]
    fn accepts_a_partial_recovery() {
        assert_eq!(
            check_recovery_preconditions(&request(1), &impaired(500)),
            Ok(())
        );
    }

    // ── socialize_loss ──────────────────────────────────────────────────────

    #[test]
    fn socializes_a_partial_loss() {
        assert_eq!(socialize_loss(1_000, 1_000, 250), Ok(750));
    }

    #[test]
    fn loss_larger_than_the_asset_base_floors_at_zero() {
        assert_eq!(socialize_loss(1_000, 1_000, 5_000), Ok(0));
        assert_eq!(socialize_loss(0, 1_000, i128::MAX), Ok(0));
    }

    #[test]
    fn socialize_loss_rejects_negative_inputs() {
        assert_eq!(socialize_loss(-1, 0, 0), Err(VaultError::InvalidAmount));
        assert_eq!(socialize_loss(0, -1, 0), Err(VaultError::InvalidAmount));
        assert_eq!(socialize_loss(0, 0, -1), Err(VaultError::InvalidAmount));
    }

    #[test]
    fn max_socializable_loss_leaves_a_unit_backing_outstanding_shares() {
        assert_eq!(max_socializable_loss(1_000, 500), Ok(999));
        let remaining = socialize_loss(1_000, 500, max_socializable_loss(1_000, 500).unwrap());
        assert_eq!(remaining, Ok(1), "share price must stay non-zero");
    }

    #[test]
    fn max_socializable_loss_with_no_shares_is_the_whole_asset_base() {
        assert_eq!(max_socializable_loss(1_000, 0), Ok(1_000));
        assert_eq!(max_socializable_loss(0, 0), Ok(0));
    }

    #[test]
    fn assessment_feeds_recovery_end_to_end() {
        let report = assess_shortfall(&position(10_000, 6_000, 500)).unwrap();
        assert!(report.is_impaired());
        assert_eq!(report.shortfall, 4_000);

        assert_eq!(
            check_recovery_preconditions(&request(report.shortfall), &report),
            Ok(())
        );
        assert_eq!(socialize_loss(10_000, 10_000, report.shortfall), Ok(6_000));
    }
}
