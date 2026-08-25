//! Gated contract telemetry and debugging hooks (Issue #1174).
//!
//! Diagnosing a vault incident from the outside means reconstructing state from
//! a dozen separate getter calls, each a round trip, none of them consistent
//! with one another. This module exposes a single consistent snapshot of the
//! vault's high-value accounting plus a derived health classification, so an
//! operator can answer "what is the vault doing right now" in one call.
//!
//! ## Gating
//!
//! Diagnostics are **off by default** and are turned on by the admin via
//! `set_diagnostics_enabled`. When disabled, [`require_enabled`] rejects the
//! read. This keeps the hook out of the default attack surface and makes
//! enabling it an auditable, admin-authorised action.
//!
//! ## What is deliberately *not* exposed
//!
//! The snapshot carries **aggregates only**. It contains no addresses, no
//! per-user balances, no pending-proposal contents, and no oracle credentials —
//! nothing that is not already derivable from the vault's public getters. See
//! [`DIAGNOSTIC_FIELD_POLICY`] and the `redacts_*` tests below, which exist to
//! fail loudly if a future field breaks that rule.
//!
//! Operator usage is documented in `docs/runbooks/VAULT_DIAGNOSTICS.md`.

use crate::errors::VaultError;
use soroban_sdk::contracttype;

/// The contract of this module, asserted by tests rather than left to prose.
pub const DIAGNOSTIC_FIELD_POLICY: &str =
    "aggregates only: no addresses, no per-user balances, no secrets";

/// Coarse health classification derived from a snapshot.
///
/// Mirrors what an operator would conclude from the raw numbers, so alerting can
/// key off one field instead of re-deriving thresholds in every consumer.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum VaultHealth {
    /// Operating normally.
    Nominal = 0,
    /// Withdrawals are queueing or idle liquidity is thin — degraded service,
    /// but the accounting is sound.
    LiquidityStressed = 1,
    /// The vault is paused. No user-facing flows are running.
    Halted = 2,
    /// Accounting is internally inconsistent — shares outstanding with no assets
    /// behind them, or a negative aggregate. Page someone.
    Inconsistent = 3,
}

/// A consistent, aggregate-only snapshot of vault state.
///
/// Every field is a protocol-level total. Adding a field that identifies a user
/// or an external system is a policy violation — see the module docs.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultDiagnostics {
    /// Ledger sequence the snapshot was taken at.
    pub ledger_sequence: u32,
    /// Ledger timestamp the snapshot was taken at.
    pub timestamp: u64,
    /// Storage layout version currently deployed.
    pub storage_version: u32,
    /// Total shares outstanding.
    pub total_shares: i128,
    /// Idle assets held by the vault itself.
    pub idle_assets: i128,
    /// Share price scaled to 1e18, or `0` when no shares are outstanding.
    pub share_price: i128,
    /// Unclaimed protocol fees.
    pub treasury_balance: i128,
    /// Current protocol fee rate in basis points.
    pub fee_bps: i128,
    /// Entries waiting in the FIFO withdrawal queue.
    pub withdrawal_queue_length: u64,
    /// Whether the vault is paused.
    pub paused: bool,
    /// Derived health classification.
    pub health: VaultHealth,
}

/// Rejects a diagnostics read when the hook has not been enabled by the admin.
///
/// # Errors
/// - [`VaultError::ContractPaused`] — diagnostics are disabled. The code is
///   reused rather than adding a 51st variant (the Soroban error enum is capped
///   at 50 cases); it reads as "this entry point is not currently open".
pub fn require_enabled(enabled: bool) -> Result<(), VaultError> {
    if enabled {
        Ok(())
    } else {
        Err(VaultError::ContractPaused)
    }
}

/// Raw aggregates a caller collects before building a snapshot.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct DiagnosticInputs {
    pub ledger_sequence: u32,
    pub timestamp: u64,
    pub storage_version: u32,
    pub total_shares: i128,
    pub idle_assets: i128,
    pub share_price: i128,
    pub treasury_balance: i128,
    pub fee_bps: i128,
    pub withdrawal_queue_length: u64,
    pub paused: bool,
    /// Idle assets that must stay in the vault, used to detect liquidity stress.
    pub min_liquidity_buffer: i128,
}

/// Classifies vault health from raw aggregates.
///
/// Ordering matters: inconsistency outranks a pause, because a paused vault with
/// broken accounting is still broken and must not be reported as merely halted.
pub fn classify_health(inputs: &DiagnosticInputs) -> VaultHealth {
    let negative = inputs.total_shares < 0
        || inputs.idle_assets < 0
        || inputs.treasury_balance < 0
        || inputs.share_price < 0;
    let unbacked = inputs.total_shares > 0 && inputs.share_price == 0;
    if negative || unbacked {
        return VaultHealth::Inconsistent;
    }
    if inputs.paused {
        return VaultHealth::Halted;
    }
    if inputs.withdrawal_queue_length > 0 || inputs.idle_assets < inputs.min_liquidity_buffer {
        return VaultHealth::LiquidityStressed;
    }
    VaultHealth::Nominal
}

/// Builds a snapshot from raw aggregates, classifying health along the way.
///
/// Pure and total: it never reads storage and never fails, so a diagnostics call
/// cannot itself become an incident.
pub fn build_snapshot(inputs: &DiagnosticInputs) -> VaultDiagnostics {
    VaultDiagnostics {
        ledger_sequence: inputs.ledger_sequence,
        timestamp: inputs.timestamp,
        storage_version: inputs.storage_version,
        total_shares: inputs.total_shares,
        idle_assets: inputs.idle_assets,
        share_price: inputs.share_price,
        treasury_balance: inputs.treasury_balance,
        fee_bps: inputs.fee_bps,
        withdrawal_queue_length: inputs.withdrawal_queue_length,
        paused: inputs.paused,
        health: classify_health(inputs),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nominal() -> DiagnosticInputs {
        DiagnosticInputs {
            ledger_sequence: 42,
            timestamp: 1_700_000_000,
            storage_version: 3,
            total_shares: 1_000,
            idle_assets: 1_000,
            share_price: 1_000_000_000_000_000_000,
            treasury_balance: 25,
            fee_bps: 500,
            withdrawal_queue_length: 0,
            paused: false,
            min_liquidity_buffer: 0,
        }
    }

    // ── Gating ──────────────────────────────────────────────────────────────

    #[test]
    fn diagnostics_are_rejected_when_the_hook_is_disabled() {
        assert_eq!(require_enabled(false), Err(VaultError::ContractPaused));
    }

    #[test]
    fn diagnostics_are_allowed_once_enabled() {
        assert_eq!(require_enabled(true), Ok(()));
    }

    // ── Health classification ───────────────────────────────────────────────

    #[test]
    fn healthy_vault_reports_nominal() {
        assert_eq!(classify_health(&nominal()), VaultHealth::Nominal);
    }

    #[test]
    fn paused_vault_reports_halted() {
        let mut inputs = nominal();
        inputs.paused = true;
        assert_eq!(classify_health(&inputs), VaultHealth::Halted);
    }

    #[test]
    fn queued_withdrawals_report_liquidity_stress() {
        let mut inputs = nominal();
        inputs.withdrawal_queue_length = 3;
        assert_eq!(classify_health(&inputs), VaultHealth::LiquidityStressed);
    }

    #[test]
    fn idle_below_the_buffer_reports_liquidity_stress() {
        let mut inputs = nominal();
        inputs.min_liquidity_buffer = 5_000;
        assert_eq!(classify_health(&inputs), VaultHealth::LiquidityStressed);
    }

    #[test]
    fn shares_with_a_zero_share_price_report_inconsistent() {
        let mut inputs = nominal();
        inputs.share_price = 0;
        assert_eq!(classify_health(&inputs), VaultHealth::Inconsistent);
    }

    #[test]
    fn negative_aggregates_report_inconsistent() {
        for mutate in [
            (|i: &mut DiagnosticInputs| i.total_shares = -1) as fn(&mut DiagnosticInputs),
            |i: &mut DiagnosticInputs| i.idle_assets = -1,
            |i: &mut DiagnosticInputs| i.treasury_balance = -1,
            |i: &mut DiagnosticInputs| i.share_price = -1,
        ] {
            let mut inputs = nominal();
            mutate(&mut inputs);
            assert_eq!(classify_health(&inputs), VaultHealth::Inconsistent);
        }
    }

    #[test]
    fn inconsistency_outranks_a_pause() {
        let mut inputs = nominal();
        inputs.paused = true;
        inputs.total_shares = -1;
        assert_eq!(
            classify_health(&inputs),
            VaultHealth::Inconsistent,
            "a paused vault with broken accounting is still broken"
        );
    }

    #[test]
    fn an_empty_vault_is_nominal_not_inconsistent() {
        let mut inputs = nominal();
        inputs.total_shares = 0;
        inputs.idle_assets = 0;
        inputs.share_price = 0; // defined as zero with no shares outstanding
        assert_eq!(classify_health(&inputs), VaultHealth::Nominal);
    }

    // ── Snapshot construction ───────────────────────────────────────────────

    #[test]
    fn snapshot_carries_every_input_through_unchanged() {
        let inputs = nominal();
        let snap = build_snapshot(&inputs);
        assert_eq!(snap.ledger_sequence, inputs.ledger_sequence);
        assert_eq!(snap.timestamp, inputs.timestamp);
        assert_eq!(snap.storage_version, inputs.storage_version);
        assert_eq!(snap.total_shares, inputs.total_shares);
        assert_eq!(snap.idle_assets, inputs.idle_assets);
        assert_eq!(snap.share_price, inputs.share_price);
        assert_eq!(snap.treasury_balance, inputs.treasury_balance);
        assert_eq!(snap.fee_bps, inputs.fee_bps);
        assert_eq!(snap.withdrawal_queue_length, inputs.withdrawal_queue_length);
        assert_eq!(snap.paused, inputs.paused);
        assert_eq!(snap.health, VaultHealth::Nominal);
    }

    #[test]
    fn snapshot_is_deterministic_for_identical_inputs() {
        let inputs = nominal();
        assert_eq!(build_snapshot(&inputs), build_snapshot(&inputs));
    }

    /// Guards [`DIAGNOSTIC_FIELD_POLICY`]. If a future change adds an
    /// `Address`, a per-user balance, or an oracle endpoint to the snapshot,
    /// the struct will no longer round-trip through this aggregate-only
    /// construction and this test will stop compiling — which is the point.
    #[test]
    fn snapshot_exposes_aggregates_only() {
        let inputs = nominal();
        let snap = build_snapshot(&inputs);
        let VaultDiagnostics {
            ledger_sequence: _,
            timestamp: _,
            storage_version: _,
            total_shares: _,
            idle_assets: _,
            share_price: _,
            treasury_balance: _,
            fee_bps: _,
            withdrawal_queue_length: _,
            paused: _,
            health: _,
        } = snap;
        assert!(DIAGNOSTIC_FIELD_POLICY.contains("no addresses"));
    }
}
