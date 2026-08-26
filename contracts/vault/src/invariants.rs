//! Contract-level vault accounting invariants (Issue #1166).
//!
//! These checks run whenever accounting state is persisted so that
//! `total_shares` and share-price remain mathematically valid across
//! deposit, withdraw, and yield transitions.
//!
//! Broken assumptions return [`VaultError::MathOverflow`]. The Soroban
//! error enum is capped at 50 cases, so this reuses that code rather than
//! introducing a dedicated variant. The error message in tests and docs
//! identifies which invariant failed.
//!
//! See `docs/VAULT_INVARIANTS.md` for the operator-facing specification.

use crate::errors::VaultError;
use crate::VaultState;

/// Share-price scale used by [`crate::YieldVault::share_price`] (`10^18`).
pub const SHARE_PRICE_SCALE: i128 = 1_000_000_000_000_000_000;

/// Compute the scaled share price from accounting totals.
///
/// Returns `0` when no shares are outstanding. Fails if inputs are
/// negative or if `total_assets * 10^18` overflows `i128`.
pub fn share_price_from_totals(total_assets: i128, total_shares: i128) -> Result<i128, VaultError> {
    if total_shares < 0 || total_assets < 0 {
        return Err(VaultError::MathOverflow);
    }
    if total_shares == 0 {
        return Ok(0);
    }
    total_assets
        .checked_mul(SHARE_PRICE_SCALE)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(total_shares)
        .ok_or(VaultError::MathOverflow)
}

/// Assert the core total-supply / share-price invariants on a vault snapshot.
///
/// # Invariants
///
/// 1. **Non-negative supply** — `total_shares >= 0`
/// 2. **Non-negative assets** — `total_assets >= 0`
/// 3. **No unbacked shares** — if `total_shares > 0` then `total_assets > 0`
/// 4. **Empty-vault price** — if `total_shares == 0` then share price is `0`
/// 5. **Price consistency** — if `total_shares > 0` then
///    `share_price == floor(total_assets * 10^18 / total_shares)` and `share_price > 0`
///
/// Donation of assets into an empty vault (`total_assets > 0 && total_shares == 0`)
/// is allowed: the next deposit is minted 1:1.
pub fn assert_vault_state_invariants(state: &VaultState) -> Result<(), VaultError> {
    if state.total_shares < 0 {
        return Err(VaultError::MathOverflow);
    }
    if state.total_assets < 0 {
        return Err(VaultError::MathOverflow);
    }
    if state.total_shares > 0 && state.total_assets <= 0 {
        return Err(VaultError::MathOverflow);
    }

    let price = share_price_from_totals(state.total_assets, state.total_shares)?;
    if state.total_shares == 0 && price != 0 {
        return Err(VaultError::MathOverflow);
    }
    if state.total_shares > 0 && price <= 0 {
        return Err(VaultError::MathOverflow);
    }
    Ok(())
}

/// Assert that a state transition preserved share-price consistency.
///
/// `before` is the pre-transition snapshot and `after` is the post-transition
/// snapshot. Both must independently satisfy [`assert_vault_state_invariants`].
pub fn assert_transition_invariants(
    before: &VaultState,
    after: &VaultState,
) -> Result<(), VaultError> {
    assert_vault_state_invariants(before)?;
    assert_vault_state_invariants(after)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::VaultState;

    fn state(shares: i128, assets: i128) -> VaultState {
        VaultState {
            total_shares: shares,
            total_assets: assets,
            is_paused: false,
        }
    }

    #[test]
    fn empty_vault_is_valid() {
        assert_eq!(assert_vault_state_invariants(&state(0, 0)), Ok(()));
        assert_eq!(share_price_from_totals(0, 0), Ok(0));
    }

    #[test]
    fn donated_assets_with_zero_shares_are_valid() {
        assert_eq!(assert_vault_state_invariants(&state(0, 500)), Ok(()));
        assert_eq!(share_price_from_totals(500, 0), Ok(0));
    }

    #[test]
    fn consistent_non_empty_vault_is_valid() {
        let s = state(1_000, 2_000);
        assert_eq!(assert_vault_state_invariants(&s), Ok(()));
        assert_eq!(
            share_price_from_totals(2_000, 1_000),
            Ok(2 * SHARE_PRICE_SCALE)
        );
    }

    #[test]
    fn negative_shares_fail_with_math_overflow() {
        assert_eq!(
            assert_vault_state_invariants(&state(-1, 100)),
            Err(VaultError::MathOverflow)
        );
    }

    #[test]
    fn negative_assets_fail_with_math_overflow() {
        assert_eq!(
            assert_vault_state_invariants(&state(100, -1)),
            Err(VaultError::MathOverflow)
        );
    }

    #[test]
    fn unbacked_shares_fail_with_math_overflow() {
        assert_eq!(
            assert_vault_state_invariants(&state(100, 0)),
            Err(VaultError::MathOverflow)
        );
    }

    #[test]
    fn share_price_overflow_fails_with_math_overflow() {
        assert_eq!(
            share_price_from_totals(i128::MAX, 1),
            Err(VaultError::MathOverflow)
        );
        assert_eq!(
            assert_vault_state_invariants(&state(1, i128::MAX)),
            Err(VaultError::MathOverflow)
        );
    }

    #[test]
    fn transition_rejects_if_either_snapshot_is_invalid() {
        let good = state(100, 100);
        let bad = state(100, 0);
        assert_eq!(
            assert_transition_invariants(&good, &bad),
            Err(VaultError::MathOverflow)
        );
        assert_eq!(
            assert_transition_invariants(&bad, &good),
            Err(VaultError::MathOverflow)
        );
        assert_eq!(assert_transition_invariants(&good, &good), Ok(()));
    }

    #[test]
    fn one_to_one_first_deposit_price_is_scale() {
        assert_eq!(share_price_from_totals(1_000, 1_000), Ok(SHARE_PRICE_SCALE));
    }
}
