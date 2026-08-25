//! Transactional accounting model and recovery regression tests (Issue #1172).
//!
//! Complex operator sequences — a deposit, then a withdrawal, then a fee change,
//! then a retry of the step that failed — are exactly where a vault ends up in an
//! inconsistent state. A Soroban transaction rolls back on panic, but a call that
//! returns `Err` after *partially* mutating storage does not: the vault keeps the
//! half-applied write.
//!
//! This module encodes the vault's accounting as an explicit state machine where
//! [`apply`] is **transactional by construction**: it validates every
//! precondition, computes the whole next state, and only then returns it. A
//! failing step returns `Err` and hands back nothing, so the caller's state is
//! provably untouched. [`apply_sequence`] runs a list of steps under that rule
//! and reports where the sequence stopped.
//!
//! The tests below are the regression suite the issue asks for: they interleave
//! deposits, withdrawals, yield accrual, and fee changes with injected failures,
//! then assert that
//!
//! 1. the state after an interrupted step is byte-identical to the state before,
//! 2. [`check_invariants`] still holds at every point in the sequence, and
//! 3. re-running the failed step after the operator fixes the input succeeds and
//!    lands on the same state as if the failure had never happened.
//!
//! The developer-facing recovery procedure is documented in
//! `docs/runbooks/VAULT_LIQUIDATION_RECOVERY.md`.

use crate::errors::VaultError;

/// Basis-point denominator.
pub const BPS_DENOMINATOR: i128 = 10_000;

/// The subset of vault storage that deposits, withdrawals, yield, and fee
/// changes can mutate.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct AccountingState {
    /// Total shares outstanding.
    pub total_shares: i128,
    /// Assets held by the vault itself, backing `total_shares`.
    pub total_assets: i128,
    /// Protocol fees accrued but not yet claimed.
    pub treasury_balance: i128,
    /// Protocol fee rate applied to accrued yield.
    pub fee_bps: i128,
}

impl AccountingState {
    /// An initialised, empty vault.
    pub fn empty() -> Self {
        Self {
            total_shares: 0,
            total_assets: 0,
            treasury_balance: 0,
            fee_bps: 0,
        }
    }
}

/// A single operator- or user-initiated step in a sequence.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Step {
    /// A user deposits `assets` and receives shares at the current share price.
    Deposit { assets: i128 },
    /// A user burns `shares` and receives assets at the current share price.
    Withdraw { shares: i128 },
    /// Admin books `amount` of yield, net of the protocol fee.
    AccrueYield { amount: i128 },
    /// Admin changes the protocol fee rate.
    SetFeeBps { bps: i128 },
}

/// Where a sequence stopped, and the state it stopped in.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct SequenceOutcome {
    /// State after the last **successful** step.
    pub state: AccountingState,
    /// Number of steps that committed.
    pub applied: u32,
    /// The error that halted the sequence, if any.
    pub halted_with: Option<VaultError>,
}

/// Structural invariants that must hold after every committed step.
///
/// # Errors
/// - [`VaultError::InvalidAmount`] — a negative balance or an out-of-range fee.
/// - [`VaultError::InsufficientShares`] — shares outstanding with no assets
///   backing them, which would make the share price zero for live holders.
pub fn check_invariants(state: &AccountingState) -> Result<(), VaultError> {
    if state.total_shares < 0 || state.total_assets < 0 || state.treasury_balance < 0 {
        return Err(VaultError::InvalidAmount);
    }
    if state.fee_bps < 0 || state.fee_bps > BPS_DENOMINATOR {
        return Err(VaultError::InvalidFeeBps);
    }
    if state.total_shares > 0 && state.total_assets == 0 {
        return Err(VaultError::InsufficientShares);
    }
    if state.total_shares == 0 && state.total_assets != 0 {
        // Assets with no shares outstanding are unattributable — every holder
        // exited, so the vault must have drained with them.
        return Err(VaultError::InvalidAmount);
    }
    Ok(())
}

/// Converts `assets` to shares at the current price, rounding **down** so a
/// depositor can never mint more value than they contributed.
pub fn shares_for_assets(state: &AccountingState, assets: i128) -> Result<i128, VaultError> {
    if state.total_shares == 0 || state.total_assets == 0 {
        return Ok(assets);
    }
    assets
        .checked_mul(state.total_shares)
        .ok_or(VaultError::MathOverflow)
        .map(|v| v / state.total_assets)
}

/// Converts `shares` to assets at the current price, rounding **down** so the
/// vault never pays out more than the shares are worth.
pub fn assets_for_shares(state: &AccountingState, shares: i128) -> Result<i128, VaultError> {
    if state.total_shares == 0 {
        return Ok(0);
    }
    shares
        .checked_mul(state.total_assets)
        .ok_or(VaultError::MathOverflow)
        .map(|v| v / state.total_shares)
}

/// Applies one step, returning the next state.
///
/// This function never mutates its input. On `Err` the caller keeps the state it
/// already had, which is the property the recovery tests assert.
///
/// # Errors
/// - [`VaultError::InvalidAmount`] — non-positive amount.
/// - [`VaultError::InvalidFeeBps`] — fee outside `0..=10_000`.
/// - [`VaultError::InsufficientShares`] — withdrawal exceeds shares outstanding.
/// - [`VaultError::InsufficientLiquidity`] — withdrawal exceeds assets held.
/// - [`VaultError::MathOverflow`] — any intermediate product overflows.
pub fn apply(state: &AccountingState, step: Step) -> Result<AccountingState, VaultError> {
    match step {
        Step::Deposit { assets } => {
            if assets <= 0 {
                return Err(VaultError::InvalidAmount);
            }
            let minted = shares_for_assets(state, assets)?;
            if minted <= 0 {
                // The deposit is worth less than one share at the current price;
                // accepting it would take the assets and mint nothing.
                return Err(VaultError::InvalidAmount);
            }
            Ok(AccountingState {
                total_shares: state
                    .total_shares
                    .checked_add(minted)
                    .ok_or(VaultError::MathOverflow)?,
                total_assets: state
                    .total_assets
                    .checked_add(assets)
                    .ok_or(VaultError::MathOverflow)?,
                ..*state
            })
        }
        Step::Withdraw { shares } => {
            if shares <= 0 {
                return Err(VaultError::InvalidAmount);
            }
            if shares > state.total_shares {
                return Err(VaultError::InsufficientShares);
            }
            let owed = assets_for_shares(state, shares)?;
            if owed > state.total_assets {
                return Err(VaultError::InsufficientLiquidity);
            }
            let remaining_shares = state.total_shares - shares;
            let remaining_assets = state.total_assets - owed;
            // A full exit must drain the vault; dust left behind with no shares
            // outstanding would be unattributable (see `check_invariants`).
            let remaining_assets = if remaining_shares == 0 {
                0
            } else {
                remaining_assets
            };
            Ok(AccountingState {
                total_shares: remaining_shares,
                total_assets: remaining_assets,
                ..*state
            })
        }
        Step::AccrueYield { amount } => {
            if amount <= 0 {
                return Err(VaultError::InvalidYieldAmount);
            }
            if state.total_shares == 0 {
                // Nobody to accrue to; booking yield here would create assets
                // with no shares behind them.
                return Err(VaultError::InsufficientShares);
            }
            let fee = amount
                .checked_mul(state.fee_bps)
                .ok_or(VaultError::MathOverflow)?
                / BPS_DENOMINATOR;
            let net = amount - fee;
            Ok(AccountingState {
                total_assets: state
                    .total_assets
                    .checked_add(net)
                    .ok_or(VaultError::MathOverflow)?,
                treasury_balance: state
                    .treasury_balance
                    .checked_add(fee)
                    .ok_or(VaultError::MathOverflow)?,
                ..*state
            })
        }
        Step::SetFeeBps { bps } => {
            if !(0..=BPS_DENOMINATOR).contains(&bps) {
                return Err(VaultError::InvalidFeeBps);
            }
            Ok(AccountingState {
                fee_bps: bps,
                ..*state
            })
        }
    }
}

/// Applies `steps` in order, stopping at the first failure.
///
/// The returned [`SequenceOutcome`] carries the state after the last committed
/// step — never a partially applied one — so an operator can inspect exactly
/// where a batch stopped and retry from there.
pub fn apply_sequence(initial: &AccountingState, steps: &[Step]) -> SequenceOutcome {
    let mut state = *initial;
    let mut applied = 0u32;

    for step in steps {
        match apply(&state, *step) {
            Ok(next) => {
                state = next;
                applied += 1;
            }
            Err(err) => {
                return SequenceOutcome {
                    state,
                    applied,
                    halted_with: Some(err),
                }
            }
        }
    }

    SequenceOutcome {
        state,
        applied,
        halted_with: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn funded(shares: i128, assets: i128) -> AccountingState {
        AccountingState {
            total_shares: shares,
            total_assets: assets,
            treasury_balance: 0,
            fee_bps: 0,
        }
    }

    /// Runs `step` against `before` and asserts it failed with `expected`
    /// **and** left `before` untouched — the core recovery property.
    fn assert_rejected_without_mutation(before: AccountingState, step: Step, expected: VaultError) {
        let snapshot = before;
        assert_eq!(apply(&before, step), Err(expected));
        assert_eq!(before, snapshot, "a failed step must not mutate state");
        assert_eq!(check_invariants(&before), Ok(()));
    }

    // ── Happy-path baselines ────────────────────────────────────────────────

    #[test]
    fn first_deposit_mints_one_to_one() {
        let state = apply(&AccountingState::empty(), Step::Deposit { assets: 1_000 }).unwrap();
        assert_eq!(state, funded(1_000, 1_000));
        assert_eq!(check_invariants(&state), Ok(()));
    }

    #[test]
    fn full_exit_drains_the_vault() {
        let state = funded(1_000, 1_000);
        let state = apply(&state, Step::Withdraw { shares: 1_000 }).unwrap();
        assert_eq!(state, AccountingState::empty());
        assert_eq!(check_invariants(&state), Ok(()));
    }

    #[test]
    fn yield_accrual_splits_between_holders_and_treasury() {
        let mut state = funded(1_000, 1_000);
        state.fee_bps = 500; // 5%
        let state = apply(&state, Step::AccrueYield { amount: 200 }).unwrap();
        assert_eq!(state.total_assets, 1_190);
        assert_eq!(state.treasury_balance, 10);
        assert_eq!(state.total_shares, 1_000, "yield must not mint shares");
        assert_eq!(check_invariants(&state), Ok(()));
    }

    // ── Failed steps leave no partial state ─────────────────────────────────

    #[test]
    fn over_withdrawal_is_rejected_without_mutation() {
        assert_rejected_without_mutation(
            funded(1_000, 1_000),
            Step::Withdraw { shares: 1_001 },
            VaultError::InsufficientShares,
        );
    }

    #[test]
    fn non_positive_deposit_is_rejected_without_mutation() {
        assert_rejected_without_mutation(
            funded(1_000, 1_000),
            Step::Deposit { assets: 0 },
            VaultError::InvalidAmount,
        );
        assert_rejected_without_mutation(
            funded(1_000, 1_000),
            Step::Deposit { assets: -5 },
            VaultError::InvalidAmount,
        );
    }

    #[test]
    fn out_of_range_fee_change_is_rejected_without_mutation() {
        assert_rejected_without_mutation(
            funded(1_000, 1_000),
            Step::SetFeeBps { bps: 10_001 },
            VaultError::InvalidFeeBps,
        );
        assert_rejected_without_mutation(
            funded(1_000, 1_000),
            Step::SetFeeBps { bps: -1 },
            VaultError::InvalidFeeBps,
        );
    }

    #[test]
    fn yield_on_an_empty_vault_is_rejected_without_mutation() {
        assert_rejected_without_mutation(
            AccountingState::empty(),
            Step::AccrueYield { amount: 100 },
            VaultError::InsufficientShares,
        );
    }

    #[test]
    fn dust_deposit_that_would_mint_zero_shares_is_rejected() {
        // Share price is 1_000 assets per share: a 999-asset deposit rounds to 0.
        let state = funded(1, 1_000);
        assert_rejected_without_mutation(
            state,
            Step::Deposit { assets: 999 },
            VaultError::InvalidAmount,
        );
    }

    #[test]
    fn overflowing_deposit_is_rejected_without_mutation() {
        let state = funded(i128::MAX, 2);
        assert_rejected_without_mutation(
            state,
            Step::Deposit { assets: i128::MAX },
            VaultError::MathOverflow,
        );
    }

    // ── Sequences interrupted mid-flight ────────────────────────────────────

    #[test]
    fn sequence_halts_at_the_failing_step_and_keeps_prior_commits() {
        let outcome = apply_sequence(
            &AccountingState::empty(),
            &[
                Step::Deposit { assets: 1_000 },
                Step::SetFeeBps { bps: 500 },
                Step::AccrueYield { amount: 200 },
                Step::Withdraw { shares: 5_000 }, // fails: only 1_000 outstanding
                Step::SetFeeBps { bps: 100 },     // never reached
            ],
        );

        assert_eq!(outcome.applied, 3);
        assert_eq!(outcome.halted_with, Some(VaultError::InsufficientShares));
        assert_eq!(outcome.state.total_shares, 1_000);
        assert_eq!(outcome.state.total_assets, 1_190);
        assert_eq!(outcome.state.treasury_balance, 10);
        assert_eq!(
            outcome.state.fee_bps, 500,
            "the fee change committed before the failure must survive"
        );
        assert_eq!(check_invariants(&outcome.state), Ok(()));
    }

    #[test]
    fn interrupted_sequence_state_is_valid_and_the_retry_succeeds() {
        let interrupted = apply_sequence(
            &AccountingState::empty(),
            &[
                Step::Deposit { assets: 1_000 },
                Step::Withdraw { shares: 2_000 }, // operator typo
            ],
        );
        assert_eq!(
            interrupted.halted_with,
            Some(VaultError::InsufficientShares)
        );
        assert_eq!(check_invariants(&interrupted.state), Ok(()));

        // Operator corrects the amount and retries from where it stopped.
        let retried = apply(&interrupted.state, Step::Withdraw { shares: 400 }).unwrap();
        assert_eq!(check_invariants(&retried), Ok(()));

        // Identical to a run where the bad step never happened.
        let clean = apply_sequence(
            &AccountingState::empty(),
            &[
                Step::Deposit { assets: 1_000 },
                Step::Withdraw { shares: 400 },
            ],
        );
        assert_eq!(clean.halted_with, None);
        assert_eq!(retried, clean.state);
    }

    #[test]
    fn retrying_the_same_failing_step_is_idempotent() {
        let state = funded(1_000, 1_000);
        for _ in 0..5 {
            assert_eq!(
                apply(&state, Step::Withdraw { shares: 9_999 }),
                Err(VaultError::InsufficientShares)
            );
        }
        assert_eq!(state, funded(1_000, 1_000));
    }

    #[test]
    fn fee_change_between_accruals_does_not_retroactively_reprice() {
        let outcome = apply_sequence(
            &AccountingState::empty(),
            &[
                Step::Deposit { assets: 10_000 },
                Step::AccrueYield { amount: 1_000 }, // fee 0% -> all to holders
                Step::SetFeeBps { bps: 1_000 },      // 10%
                Step::AccrueYield { amount: 1_000 }, // 100 to treasury
            ],
        );
        assert_eq!(outcome.halted_with, None);
        assert_eq!(outcome.state.treasury_balance, 100);
        assert_eq!(outcome.state.total_assets, 10_000 + 1_000 + 900);
    }

    #[test]
    fn invariants_hold_after_every_step_of_a_long_mixed_sequence() {
        let steps = [
            Step::Deposit { assets: 5_000 },
            Step::SetFeeBps { bps: 250 },
            Step::AccrueYield { amount: 400 },
            Step::Deposit { assets: 2_500 },
            Step::Withdraw { shares: 1_000 },
            Step::AccrueYield { amount: 100 },
            Step::Withdraw { shares: 100_000 }, // fails
        ];

        let mut state = AccountingState::empty();
        for (i, step) in steps.iter().enumerate() {
            match apply(&state, *step) {
                Ok(next) => {
                    state = next;
                    assert_eq!(
                        check_invariants(&state),
                        Ok(()),
                        "invariant broke at step {i}"
                    );
                }
                Err(_) => {
                    assert_eq!(
                        check_invariants(&state),
                        Ok(()),
                        "invariant broke after failed step {i}"
                    );
                }
            }
        }
    }

    #[test]
    fn round_trip_never_returns_more_than_was_deposited() {
        let deposited = 7_777;
        let after_deposit = apply(
            &AccountingState::empty(),
            Step::Deposit { assets: deposited },
        )
        .unwrap();
        let returned = assets_for_shares(&after_deposit, after_deposit.total_shares).unwrap();
        assert!(
            returned <= deposited,
            "round trip minted value: {returned} > {deposited}"
        );
    }

    // ── Invariant checker itself ────────────────────────────────────────────

    #[test]
    fn invariant_checker_rejects_corrupt_states() {
        assert_eq!(
            check_invariants(&funded(-1, 0)),
            Err(VaultError::InvalidAmount)
        );
        assert_eq!(
            check_invariants(&funded(1_000, 0)),
            Err(VaultError::InsufficientShares),
            "shares must always be backed by assets"
        );
        assert_eq!(
            check_invariants(&funded(0, 1_000)),
            Err(VaultError::InvalidAmount),
            "assets with no shares outstanding are unattributable"
        );
        let mut bad_fee = funded(1, 1);
        bad_fee.fee_bps = 10_001;
        assert_eq!(check_invariants(&bad_fee), Err(VaultError::InvalidFeeBps));
    }
}
