//! Protocol-level risk limits for vault exposure (Issue #1173).
//!
//! Hard caps that apply on top of per-strategy `StrategyCap` /
//! `StrategyRiskThreshold`. They reduce how much the vault can take on
//! under volatility or strategy stress.
//!
//! Default configuration is **unlimited** so existing deployments and
//! tests keep their current behaviour. Operators opt in by setting
//! non-default caps.
//!
//! Error-code reuse (Soroban enum cap of 50 cases):
//!
//! | Condition | Code |
//! |---|---|
//! | Negative TVL / amount | [`VaultError::InvalidAmount`] |
//! | BPS outside `0..=10_000` | [`VaultError::InvalidRiskThreshold`] |
//! | Deposit would exceed max TVL | [`VaultError::ExceedsRiskThreshold`] |
//! | Invest would exceed concentration or deployed BPS | [`VaultError::ExceedsRiskThreshold`] |
//!
//! See `docs/PROTOCOL_RISK_LIMITS.md` for thresholds and override conditions.

use crate::errors::VaultError;

/// Basis-point denominator (100% = 10_000).
pub const BPS_DENOMINATOR: i128 = 10_000;

/// Default concentration / deployed caps: 100% (no protocol-level restriction).
pub const DEFAULT_MAX_CONCENTRATION_BPS: i128 = BPS_DENOMINATOR;
pub const DEFAULT_MAX_DEPLOYED_BPS: i128 = BPS_DENOMINATOR;

/// Default stress-mode concentration: 50% of TVL in any single strategy.
pub const DEFAULT_STRESS_CONCENTRATION_BPS: i128 = 5_000;

/// Default stress-mode deployed cap: 70% of TVL allocated to strategies.
pub const DEFAULT_STRESS_DEPLOYED_BPS: i128 = 7_000;

/// Protocol-wide exposure limits stored on the vault.
///
/// `max_vault_tvl == 0` means unlimited TVL.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProtocolRiskLimits {
    pub max_vault_tvl: i128,
    pub max_strategy_concentration_bps: i128,
    pub max_deployed_bps: i128,
    pub stress_mode: bool,
    pub stress_max_strategy_concentration_bps: i128,
    pub stress_max_deployed_bps: i128,
}

impl ProtocolRiskLimits {
    /// Unlimited protocol limits (backward-compatible defaults).
    pub fn unlimited() -> Self {
        Self {
            max_vault_tvl: 0,
            max_strategy_concentration_bps: DEFAULT_MAX_CONCENTRATION_BPS,
            max_deployed_bps: DEFAULT_MAX_DEPLOYED_BPS,
            stress_mode: false,
            stress_max_strategy_concentration_bps: DEFAULT_STRESS_CONCENTRATION_BPS,
            stress_max_deployed_bps: DEFAULT_STRESS_DEPLOYED_BPS,
        }
    }

    /// Concentration cap currently in force (stress mode uses the tighter value).
    pub fn effective_concentration_bps(&self) -> i128 {
        if self.stress_mode {
            core::cmp::min(
                self.max_strategy_concentration_bps,
                self.stress_max_strategy_concentration_bps,
            )
        } else {
            self.max_strategy_concentration_bps
        }
    }

    /// Deployed-capital cap currently in force.
    pub fn effective_deployed_bps(&self) -> i128 {
        if self.stress_mode {
            core::cmp::min(self.max_deployed_bps, self.stress_max_deployed_bps)
        } else {
            self.max_deployed_bps
        }
    }
}

/// Validate operator-configured BPS fields.
pub fn validate_bps(bps: i128) -> Result<(), VaultError> {
    if !(0..=BPS_DENOMINATOR).contains(&bps) {
        return Err(VaultError::InvalidRiskThreshold);
    }
    Ok(())
}

/// Reject a deposit that would push accounting TVL past the hard cap.
///
/// `max_tvl == 0` disables the cap.
pub fn check_deposit_tvl(
    current_tvl: i128,
    deposit_amount: i128,
    max_tvl: i128,
) -> Result<(), VaultError> {
    if current_tvl < 0 || deposit_amount <= 0 {
        return Err(VaultError::InvalidAmount);
    }
    if max_tvl < 0 {
        return Err(VaultError::InvalidAmount);
    }
    if max_tvl == 0 {
        return Ok(());
    }
    let new_tvl = current_tvl
        .checked_add(deposit_amount)
        .ok_or(VaultError::MathOverflow)?;
    if new_tvl > max_tvl {
        return Err(VaultError::ExceedsRiskThreshold);
    }
    Ok(())
}

/// Reject an invest that would breach concentration or deployed-capital caps.
///
/// `current_tvl` is the vault AUM used as the denominator. Invest moves idle
/// funds into a strategy and does not itself increase TVL.
pub fn check_invest_exposure(
    current_tvl: i128,
    current_invested: i128,
    invest_amount: i128,
    limits: &ProtocolRiskLimits,
) -> Result<(), VaultError> {
    if current_tvl < 0 || current_invested < 0 || invest_amount <= 0 {
        return Err(VaultError::InvalidAmount);
    }
    if current_tvl == 0 {
        return Err(VaultError::ExceedsRiskThreshold);
    }

    let new_invested = current_invested
        .checked_add(invest_amount)
        .ok_or(VaultError::MathOverflow)?;
    let scaled = new_invested
        .checked_mul(BPS_DENOMINATOR)
        .ok_or(VaultError::MathOverflow)?;
    let exposure_bps = scaled / current_tvl;

    if exposure_bps > limits.effective_concentration_bps() {
        return Err(VaultError::ExceedsRiskThreshold);
    }
    if exposure_bps > limits.effective_deployed_bps() {
        return Err(VaultError::ExceedsRiskThreshold);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn limits_with_tvl(max_tvl: i128) -> ProtocolRiskLimits {
        let mut limits = ProtocolRiskLimits::unlimited();
        limits.max_vault_tvl = max_tvl;
        limits
    }

    fn concentrated(bps: i128) -> ProtocolRiskLimits {
        let mut limits = ProtocolRiskLimits::unlimited();
        limits.max_strategy_concentration_bps = bps;
        limits.max_deployed_bps = bps;
        limits
    }

    #[test]
    fn unlimited_defaults_allow_any_deposit() {
        assert_eq!(check_deposit_tvl(0, 1_000, 0), Ok(()));
        assert_eq!(check_deposit_tvl(10_000, 50_000, 0), Ok(()));
    }

    #[test]
    fn deposit_at_cap_is_allowed() {
        assert_eq!(check_deposit_tvl(900, 100, 1_000), Ok(()));
    }

    #[test]
    fn deposit_over_cap_is_rejected() {
        assert_eq!(
            check_deposit_tvl(900, 101, 1_000),
            Err(VaultError::ExceedsRiskThreshold)
        );
    }

    #[test]
    fn deposit_recovers_after_tvl_falls() {
        // After a withdrawal, TVL is 400 against a 1_000 cap — deposit fits.
        assert_eq!(check_deposit_tvl(400, 500, 1_000), Ok(()));
    }

    #[test]
    fn negative_deposit_inputs_are_invalid() {
        assert_eq!(
            check_deposit_tvl(-1, 10, 100),
            Err(VaultError::InvalidAmount)
        );
        assert_eq!(
            check_deposit_tvl(10, 0, 100),
            Err(VaultError::InvalidAmount)
        );
        assert_eq!(
            check_deposit_tvl(10, 10, -1),
            Err(VaultError::InvalidAmount)
        );
    }

    #[test]
    fn invest_within_concentration_passes() {
        let limits = concentrated(5_000);
        // 4_000 / 10_000 = 40% < 50%
        assert_eq!(check_invest_exposure(10_000, 3_000, 1_000, &limits), Ok(()));
    }

    #[test]
    fn invest_over_concentration_is_rejected() {
        let limits = concentrated(5_000);
        // 6_000 / 10_000 = 60% > 50%
        assert_eq!(
            check_invest_exposure(10_000, 3_000, 3_000, &limits),
            Err(VaultError::ExceedsRiskThreshold)
        );
    }

    #[test]
    fn invest_recovers_after_divest() {
        let limits = concentrated(5_000);
        assert_eq!(
            check_invest_exposure(10_000, 5_000, 1, &limits),
            Err(VaultError::ExceedsRiskThreshold)
        );
        // Divest 2_000 → invested 3_000; 4_000 / 10_000 = 40% is allowed again.
        assert_eq!(check_invest_exposure(10_000, 3_000, 1_000, &limits), Ok(()));
    }

    #[test]
    fn stress_mode_tightens_caps() {
        let mut limits = ProtocolRiskLimits::unlimited();
        limits.max_strategy_concentration_bps = 8_000;
        limits.max_deployed_bps = 8_000;
        limits.stress_max_strategy_concentration_bps = 4_000;
        limits.stress_max_deployed_bps = 4_000;

        assert_eq!(
            check_invest_exposure(10_000, 0, 5_000, &limits),
            Ok(()),
            "50% is under the 80% normal cap"
        );

        limits.stress_mode = true;
        assert_eq!(
            check_invest_exposure(10_000, 0, 5_000, &limits),
            Err(VaultError::ExceedsRiskThreshold),
            "50% exceeds the 40% stress cap"
        );
        assert_eq!(
            check_invest_exposure(10_000, 0, 4_000, &limits),
            Ok(()),
            "exactly 40% is allowed in stress mode"
        );
    }

    #[test]
    fn disabling_stress_mode_is_the_override() {
        let mut limits = ProtocolRiskLimits::unlimited();
        limits.max_strategy_concentration_bps = 8_000;
        limits.stress_mode = true;
        limits.stress_max_strategy_concentration_bps = 2_000;

        assert_eq!(
            check_invest_exposure(10_000, 0, 5_000, &limits),
            Err(VaultError::ExceedsRiskThreshold)
        );
        limits.stress_mode = false;
        assert_eq!(check_invest_exposure(10_000, 0, 5_000, &limits), Ok(()));
    }

    #[test]
    fn validate_bps_bounds() {
        assert_eq!(validate_bps(0), Ok(()));
        assert_eq!(validate_bps(10_000), Ok(()));
        assert_eq!(validate_bps(-1), Err(VaultError::InvalidRiskThreshold));
        assert_eq!(validate_bps(10_001), Err(VaultError::InvalidRiskThreshold));
    }

    #[test]
    fn invest_into_empty_tvl_is_rejected() {
        let limits = ProtocolRiskLimits::unlimited();
        assert_eq!(
            check_invest_exposure(0, 0, 1, &limits),
            Err(VaultError::ExceedsRiskThreshold)
        );
    }

    #[test]
    fn tvl_cap_on_limits_struct_is_independent_of_invest() {
        let limits = limits_with_tvl(1_000);
        // Invest does not grow TVL, so the TVL cap is not consulted here.
        assert_eq!(check_invest_exposure(1_000, 0, 500, &limits), Ok(()));
    }

    #[test]
    fn effective_caps_take_the_tighter_stress_value() {
        let mut limits = ProtocolRiskLimits::unlimited();
        limits.max_strategy_concentration_bps = 3_000;
        limits.stress_max_strategy_concentration_bps = 8_000;
        limits.stress_mode = true;
        assert_eq!(
            limits.effective_concentration_bps(),
            3_000,
            "stress must not loosen a tighter normal cap"
        );
    }
}
