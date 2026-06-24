#![no_std]
//! # YieldVault - Stellar RWA Smart Contract
//!
//! A decentralized vault protocol for real-world assets (RWAs) on Stellar's Soroban.
//!
//! ## Overview
//!
//! YieldVault implements an ERC-4626-style vault with:
//! - Fractional share minting (`yvUSDC`) for deposits
//! - Multi-strategy support (BENJI, Korean Debt)
//! - DAO governance for strategy selection
//! - RWA shipment tracking for asset provenance
//! - Protocol fees with treasury accumulation
//! - Large-withdrawal timelocks for risk management
//! - Per-user deposit caps and minimum deposit thresholds
//! - Oracle price validation infrastructure
//!
//! ## Architecture
//!
//! See [`docs/CONTRACTS_ARCHITECTURE.md`](../docs/CONTRACTS_ARCHITECTURE.md) for:
//! - Module responsibilities and interaction boundaries
//! - Storage architecture and data flow
//! - Security model and authorization boundaries
//! - Developer guide and testing procedures
//!
//! ## Quick Start
//!
//! ```ignore
//! // Initialize vault
//! vault.initialize(&admin, &usdc_token);
//!
//! // User deposits USDC
//! let shares = vault.deposit(&user, &100)?;
//!
//! // User withdraws shares
//! let assets = vault.withdraw(&user, &shares)?;
//!
//! // Admin accrues yield
//! vault.accrue_yield(&50);
//! ```
//!
//! ## Testing
//!
//! Run all tests with `cargo test`. Key test suites:
//! - `src/test.rs` — Core vault logic (50+ tests)
//! - `src/fuzz_math.rs` — Math safety (10,000+ property tests)
//! - `src/oracle_tests.rs` — Oracle validation (10+ tests)
//! - `src/event_tests.rs` — Event emission (5+ tests)
//! - `src/proxy_tests.rs` — Upgrade & storage (4+ tests)
//!
//! ## Deployment
//!
//! See `DEPLOYMENT.md` for step-by-step deployment to Stellar testnet/mainnet.

#[cfg(not(target_arch = "wasm32"))]
pub mod benji_strategy;
pub mod emergency;
#[cfg(test)]
mod event_tests;
pub mod external_calls;
#[cfg(test)]
mod feature_tests;
pub mod fee_math;
#[cfg(test)]
mod fuzz_math;
pub mod math;
#[cfg(test)]
mod oracle_tests;
pub mod permissions;
#[cfg(test)]
pub mod proxy_tests;
pub mod storage_registry;
pub mod strategy;
mod test;
pub mod upgrade;

pub mod oracle;
pub mod whitelist;

use crate::strategy::StrategyClient;
use crate::upgrade::{
    get_admin, get_pending_admin, get_storage_version, is_initialized, set_admin, set_initialized,
    set_pending_admin, set_storage_version,
};
use crate::whitelist::SecureWhitelist;
use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, symbol_short, token,
    Address, BytesN, Env, String, Vec,
};

const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

const STORAGE_VERSION: u32 = 2;
const MAX_PAGE_SIZE: u32 = 50;
const SHARE_PRICE_SCALE: i128 = 1_000_000_000_000_000_000;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
/// Shipment status for RWA asset tracking.
pub enum ShipmentStatus {
    Pending,
    InTransit,
    Delivered,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
/// Paginated response for shipment queries.
pub struct ShipmentPage {
    pub shipment_ids: Vec<u64>,
    pub next_cursor: Option<u64>,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
/// Explicit reason code recorded when the vault is paused.
pub enum PauseReason {
    /// No pause active (stored only while paused).
    None = 0,
    /// Suspected exploit or unauthorized activity.
    SecurityIncident = 1,
    /// Oracle feed stale, invalid, or manipulated.
    OracleFailure = 2,
    /// Insufficient liquidity or bank-run conditions.
    LiquidityCrisis = 3,
    /// DAO or governance-directed halt.
    Governance = 4,
    /// Planned maintenance or upgrade window.
    Maintenance = 5,
    /// Operator-defined catch-all.
    Other = 6,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
/// Current vault state: total shares, total assets, and pause status.
pub struct VaultState {
    pub total_shares: i128,
    pub total_assets: i128,
    pub is_paused: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    TokenAsset,
    TotalShares,
    TotalAssets,
    Admin,
    Strategy,
    State,
    DaoThreshold,
    ProposalNonce,
    BenjiStrategy,
    KoreanDebtStrategy,
    IsPaused,
    PauseReason,
    EmergencyApproverPrimary,
    EmergencyApproverSecondary,
    EmergencyProposalNonce,
    EmergencyProposal(u32),
    Proposal(u32),
    Vote(u32, Address),
    ShareBalance(Address),
    ShipmentByStatus(ShipmentStatus),
    ShipmentStatusOf(u64),
    UserDeposit(Address),
    PerUserCap,
    StrategyWhitelist(Address),
    StrategyCap(Address),
    StrategyRiskThreshold(Address),
    StrategyWatermark(Address),
    // Goal 1: protocol fee
    FeeBps,
    Treasury,
    TreasuryBalance,
    // Goal 2: timelock withdrawals
    LargeWithdrawalThreshold,
    PendingWithdrawal(Address),
    // Goal 3: min deposit
    MinDeposit,
    // Minimum idle liquidity retained before allocating to a strategy
    MinLiquidityBuffer,
    // Oracle configuration
    PriceOracle,
    OracleEnabled,
    OracleHeartbeat,
    // Withdrawal cooldown
    WithdrawalCooldown,
    LastDepositTime(Address),
    CheckpointNonce,
    CheckpointTotalShares(u32),
    CheckpointTotalAssets(u32),
    UserCheckpoint(Address),
    UserBalanceAt(Address, u32),
    // Relayer batch-deposit whitelist
    RelayerWhitelist(Address),
    // Maximum entries allowed in a single batch_deposit call
    MaxBatchSize,
    // Dispute window duration in seconds for emergency proposals (default 3600 = 1 hour)
    EmergencyDisputeWindow,
    // Monotonic counter stamped on every event topic for deterministic indexer ordering.
    EventSeq,
    // FIFO withdrawal queue metadata (head/tail sequence counters)
    WithdrawalQueueMeta,
    WithdrawalQueueEntry(u64),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
/// DAO governance proposal for strategy selection.
pub struct StrategyProposal {
    pub strategy: Address,
    pub yes_votes: i128,
    pub no_votes: i128,
    pub executed: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
/// Pending large withdrawal with 24-hour timelock.
pub struct PendingWithdrawal {
    pub shares: i128,
    pub unlock_timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
/// Queued withdrawal awaiting available idle liquidity (FIFO by sequence).
pub struct WithdrawalQueueEntry {
    pub user: Address,
    pub shares: i128,
    pub assets: i128,
    pub enqueued_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
/// Head/tail sequence counters for the withdrawal liquidity queue.
pub struct WithdrawalQueueMeta {
    pub head: u64,
    pub tail: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
/// A single entry in a batch deposit request: one user and their deposit amount.
pub struct DepositEntry {
    /// The depositing user address (requires auth).
    pub user: Address,
    /// The amount of underlying tokens to deposit.
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
/// Per-entry result for a batch deposit operation.
pub struct DepositResult {
    /// The depositing user address.
    pub user: Address,
    /// Shares minted on success, or 0 on failure.
    pub shares_minted: i128,
    /// True if this entry succeeded.
    pub success: bool,
    /// Error code if this entry failed; 0 means no error.
    pub error_code: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
/// Aggregate result returned by `batch_deposit`.
pub struct BatchDepositResult {
    /// Per-entry outcomes in the same order as the input `entries` vector.
    pub results: Vec<DepositResult>,
    /// Total shares minted across all successful entries.
    pub total_shares_minted: i128,
    /// Number of entries that succeeded.
    pub success_count: u32,
    /// Number of entries that failed.
    pub failure_count: u32,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
/// Vault error codes.
pub enum VaultError {
    /// Contract has already been initialized.
    AlreadyInitialized = 1,
    /// User does not have enough shares to withdraw.
    InsufficientShares = 2,
    /// Amount is invalid (zero or negative).
    InvalidAmount = 3,
    /// Vault is paused; deposits and withdrawals are blocked.
    ContractPaused = 4,
    /// Deposit would exceed per-user cap.
    ExceedsUserCap = 5,
    /// Deposit is below minimum deposit threshold.
    MinDepositNotMet = 6,
    /// Large withdrawal timelock has not expired yet.
    TimelockNotExpired = 7,
    /// No pending withdrawal exists for this user.
    NoPendingWithdrawal = 8,
    /// Strategy allocation would leave idle liquidity below the configured buffer.
    LiquidityBufferNotMet = 9,
    /// Strategy allocation exceeds configured cap.
    ExceedsStrategyCap = 10,
    /// Strategy allocation exceeds configured risk threshold.
    ExceedsRiskThreshold = 11,
    /// Withdrawal blocked due to active deposit cooldown.
    WithdrawalCooldownActive = 12,
    /// Requested storage migration target is older than the current stored version.
    InvalidMigrationTarget = 13,
    /// Arithmetic overflow was detected before mutating state.
    MathOverflow = 14,
    /// Strategy operation exceeded maximum allowed slippage.
    SlippageExceeded = 15,
    /// Batch deposit entries vector exceeds the maximum allowed size.
    BatchTooLarge = 16,
    /// Caller is not a registered relayer and cannot submit batch deposits.
    RelayerNotAuthorized = 17,
    /// Emergency proposal is still within the dispute window and cannot be confirmed yet.
    DisputeWindowActive = 18,
    /// Emergency proposal has been cancelled and cannot be confirmed or executed.
    ProposalCancelled = 19,
    /// Dispute window has already closed; the proposal can no longer be cancelled.
    DisputeWindowClosed = 20,
    /// Withdrawal was queued because idle liquidity was insufficient.
    WithdrawalQueued = 21,
}

#[contractclient(name = "KoreanDebtStrategyClient")]
/// Client for Korean sovereign debt strategy contract.
pub trait KoreanDebtStrategy {
    /// Harvest yield from the Korean debt strategy.
    fn harvest_yield(env: Env) -> i128;
}

#[contract]
/// YieldVault - Main vault contract for RWA yield farming on Stellar.
pub struct YieldVault;

#[contractimpl]
impl YieldVault {
    /// Initializes the vault with an admin and the underlying token asset.
    ///
    /// ### Parameters
    /// * `admin` - The address with authority to configure strategies and manage shipments.
    /// * `token` - The Address of the Stellar Asset (SAC) used for deposits.
    ///
    /// ### Errors
    /// * `VaultError::AlreadyInitialized` - If the admin key is already set.
    pub fn initialize(env: Env, admin: Address, token: Address) -> Result<(), VaultError> {
        if is_initialized(&env) {
            return Err(VaultError::AlreadyInitialized);
        }

        set_admin(&env, &admin);
        set_initialized(&env);
        set_storage_version(&env, STORAGE_VERSION);

        env.storage().instance().set(&DataKey::TokenAsset, &token);
        env.storage().instance().set(&DataKey::TotalAssets, &0i128);
        env.storage().instance().set(&DataKey::TotalShares, &0i128);
        env.storage().instance().set(
            &DataKey::State,
            &VaultState {
                total_shares: 0,
                total_assets: 0,
                is_paused: false,
            },
        );
        env.storage().instance().set(&DataKey::DaoThreshold, &1i128);
        env.storage().instance().set(&DataKey::ProposalNonce, &0u32);
        Ok(())
    }

    /// Upgrades the contract code to a new WASM hash.
    /// Only the Admin can call this.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin = get_admin(&env).expect("Admin not set");
        admin.require_auth();

        let pre_version = get_storage_version(&env);
        Self::run_storage_migration(&env, STORAGE_VERSION).expect("storage migration failed");
        // Checkpoint: storage version must equal STORAGE_VERSION after migration.
        let post_version = get_storage_version(&env);
        assert_eq!(
            post_version, STORAGE_VERSION,
            "storage version checkpoint failed: expected {}, got {}",
            STORAGE_VERSION, post_version
        );
        // Ensure the migration was either a no-op or a forward progression.
        assert!(
            post_version >= pre_version,
            "storage version must not decrease: was {}, now {}",
            pre_version, post_version
        );

        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    /// Runs storage schema migrations up to the requested target version.
    /// This can be called before or during an upgrade flow to backfill versioned state.
    pub fn migrate_storage(env: Env, target_version: u32) -> Result<(), VaultError> {
        let admin = get_admin(&env).expect("Admin not set");
        admin.require_auth();

        let pre_version = get_storage_version(&env);
        Self::run_storage_migration(&env, target_version)?;
        // Checkpoint: storage version must equal target_version after migration.
        let post_version = get_storage_version(&env);
        assert_eq!(
            post_version, target_version,
            "storage version checkpoint failed: expected {}, got {}",
            target_version, post_version
        );
        assert!(
            post_version >= pre_version,
            "storage version must not decrease: was {}, now {}",
            pre_version, post_version
        );
        Ok(())
    }

    pub fn storage_version(env: Env) -> u32 {
        get_storage_version(&env)
    }

    pub fn contract_version(env: Env) -> String {
        String::from_str(&env, CONTRACT_VERSION)
    }

    /// Propose a new admin.
    /// Only the current Admin can call this.
    pub fn propose_admin(env: Env, new_admin: Address) {
        let admin = get_admin(&env).expect("Admin not set");
        admin.require_auth();

        let previous_pending = get_pending_admin(&env);
        set_pending_admin(&env, &Some(new_admin));
        env.events().publish(
            (symbol_short!("adminprop"),),
            (admin, previous_pending, get_pending_admin(&env).unwrap()),
        );
    }

    /// Accept the admin role.
    /// Only the pending Admin can call this.
    pub fn accept_admin(env: Env) {
        let pending_admin = get_pending_admin(&env).expect("No pending admin");
        pending_admin.require_auth();

        let previous_admin = get_admin(&env).expect("Admin not set");
        set_admin(&env, &pending_admin);
        set_pending_admin(&env, &None);
        env.events().publish(
            (symbol_short!("adminxfer"),),
            (previous_admin, pending_admin),
        );
    }

    /// Cancel an in-flight admin rotation.
    /// Only the current Admin can call this.
    pub fn cancel_admin_rotation(env: Env) {
        let admin = get_admin(&env).expect("Admin not set");
        admin.require_auth();

        let previous_pending = get_pending_admin(&env);
        set_pending_admin(&env, &None);
        env.events()
            .publish((symbol_short!("admincncl"),), (admin, previous_pending));
    }

    pub fn admin(env: Env) -> Option<Address> {
        get_admin(&env)
    }

    pub fn pending_admin(env: Env) -> Option<Address> {
        get_pending_admin(&env)
    }

    /// Set or update the active strategy connector.
    ///
    /// The strategy must be whitelisted before it can be set as the active strategy.
    /// Only the admin can call this function.
    ///
    /// # Arguments
    /// * `env` - Soroban environment
    /// * `strategy` - Strategy address to set as active
    ///
    /// # Panics
    /// Panics if the strategy is not whitelisted
    pub fn set_strategy(env: Env, strategy: Address) {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();

        // Check whitelist using SecureWhitelist module
        if !SecureWhitelist::is_strategy_whitelisted(&env, &strategy) {
            panic!("strategy not whitelisted");
        }

        env.storage().instance().set(&DataKey::Strategy, &strategy);
    }

    /// Whitelist or un-whitelist a strategy address.
    ///
    /// Only the admin can add or remove strategies from the whitelist.
    /// Whitelisted strategies can be set as the active strategy.
    ///
    /// # Arguments
    /// * `env` - Soroban environment
    /// * `strategy` - Strategy address to whitelist/un-whitelist
    /// * `approved` - true to whitelist, false to un-whitelist
    ///
    /// # Authorization
    /// Caller must be the vault admin
    pub fn whitelist_strategy(env: Env, strategy: Address, approved: bool) {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();

        // Use SecureWhitelist module for whitelist operations
        match SecureWhitelist::set_whitelist_status(&env, &admin, &strategy, approved) {
            Ok(_) => {
                // Also update the DataKey-based storage for backward compatibility
                env.storage()
                    .instance()
                    .set(&DataKey::StrategyWhitelist(strategy), &approved);
            }
            Err(_) => panic!("whitelist operation failed"),
        }
    }

    /// Check if a strategy is whitelisted.
    ///
    /// Returns true if the strategy is approved for allocation operations.
    ///
    /// # Arguments
    /// * `env` - Soroban environment
    /// * `strategy` - Strategy address to check
    ///
    /// # Returns
    /// true if the strategy is whitelisted, false otherwise
    pub fn is_strategy_whitelisted(env: Env, strategy: Address) -> bool {
        // Use SecureWhitelist module for whitelist checks
        SecureWhitelist::is_strategy_whitelisted(&env, &strategy)
    }

    /// Read the active strategy address.
    pub fn strategy(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Strategy)
    }

    pub fn pause(env: Env, reason: PauseReason) {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();

        let mut state = Self::get_state(&env);
        state.is_paused = true;
        env.storage().instance().set(&DataKey::State, &state);
        env.storage().instance().set(&DataKey::PauseReason, &reason);
        env.events()
            .publish((symbol_short!("paused"),), (reason as u32,));
    }

    pub fn unpause(env: Env) {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();

        let mut state = Self::get_state(&env);
        state.is_paused = false;
        env.storage().instance().set(&DataKey::State, &state);
        env.storage().instance().remove(&DataKey::PauseReason);
        env.events().publish((symbol_short!("unpaused"),), ());
    }

    pub fn is_paused(env: Env) -> bool {
        Self::get_state(&env).is_paused
    }

    /// Returns the stored pause reason while paused; `None` when active.
    pub fn pause_reason(env: Env) -> Option<PauseReason> {
        if !Self::is_paused(env.clone()) {
            return None;
        }
        env.storage().instance().get(&DataKey::PauseReason)
    }

    /// Configure the two distinct approvers required for emergency actions.
    pub fn set_emergency_approvers(env: Env, primary: Address, secondary: Address) {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();
        emergency::require_distinct_approvers(&primary, &secondary);
        env.storage()
            .instance()
            .set(&DataKey::EmergencyApproverPrimary, &primary);
        env.storage()
            .instance()
            .set(&DataKey::EmergencyApproverSecondary, &secondary);
    }

    pub fn emergency_approver_primary(env: Env) -> Option<Address> {
        emergency::primary_approver(&env)
    }

    pub fn emergency_approver_secondary(env: Env) -> Option<Address> {
        emergency::secondary_approver(&env)
    }

    /// Primary approver initiates a dual-approval emergency action.
    ///
    /// A dispute window starts immediately. The admin may call
    /// `cancel_emergency_action` before the window closes. The secondary
    /// approver can only confirm after the dispute window has elapsed.
    pub fn propose_emergency_action(
        env: Env,
        initiator: Address,
        kind: emergency::EmergencyActionKind,
        pause_reason_code: u32,
        divest_amount: Option<i128>,
        wasm_hash: Option<BytesN<32>>,
    ) -> u32 {
        initiator.require_auth();
        let primary = emergency::primary_approver(&env).expect("primary approver not set");
        assert!(initiator == primary, "only primary approver can initiate");

        let window_secs: u64 = env
            .storage()
            .instance()
            .get(&DataKey::EmergencyDisputeWindow)
            .unwrap_or(3_600u64);
        let dispute_deadline = env
            .ledger()
            .timestamp()
            .checked_add(window_secs)
            .expect("overflow");

        let proposal_id = emergency::next_proposal_id(&env);
        let proposal = emergency::EmergencyProposal {
            kind,
            pause_reason_code,
            divest_amount,
            wasm_hash,
            initiator: initiator.clone(),
            confirmed: false,
            executed: false,
            cancelled: false,
            dispute_deadline,
        };
        emergency::write_proposal(&env, proposal_id, &proposal);
        env.events()
            .publish((symbol_short!("emrgprop"),), (proposal_id, kind as u32, dispute_deadline));
        proposal_id
    }

    /// Secondary approver confirms and executes a pending emergency action.
    ///
    /// Confirmation is only allowed after the dispute window has closed and the
    /// proposal has not been cancelled.
    pub fn confirm_emergency_action(env: Env, confirmer: Address, proposal_id: u32) -> Result<(), VaultError> {
        confirmer.require_auth();
        let secondary = emergency::secondary_approver(&env).expect("secondary approver not set");
        assert!(
            confirmer == secondary,
            "only secondary approver can confirm"
        );

        let mut proposal = emergency::read_proposal(&env, proposal_id).expect("proposal not found");
        assert!(!proposal.executed, "proposal already executed");
        assert!(!proposal.confirmed, "proposal already confirmed");
        assert!(
            proposal.initiator != confirmer,
            "confirmer must differ from initiator"
        );

        if proposal.cancelled {
            return Err(VaultError::ProposalCancelled);
        }
        if env.ledger().timestamp() < proposal.dispute_deadline {
            return Err(VaultError::DisputeWindowActive);
        }

        proposal.confirmed = true;
        emergency::write_proposal(&env, proposal_id, &proposal);

        match proposal.kind {
            emergency::EmergencyActionKind::Pause => {
                let reason = Self::pause_reason_from_code(proposal.pause_reason_code);
                Self::apply_emergency_pause(&env, reason);
            }
            emergency::EmergencyActionKind::Unpause => {
                Self::apply_emergency_unpause(&env);
            }
            emergency::EmergencyActionKind::EmergencyDivest => {
                let amount = proposal.divest_amount.expect("divest amount required");
                Self::divest(env.clone(), amount);
            }
            emergency::EmergencyActionKind::ForceUpgrade => {
                let hash = proposal.wasm_hash.clone().expect("wasm hash required");
                env.deployer().update_current_contract_wasm(hash);
            }
        }

        proposal.executed = true;
        emergency::write_proposal(&env, proposal_id, &proposal);
        env.events().publish(
            (symbol_short!("emrgexec"),),
            (proposal_id, proposal.kind as u32),
        );
        Ok(())
    }

    /// Admin cancels an emergency proposal during its dispute window.
    ///
    /// Once the dispute window closes the proposal can no longer be cancelled
    /// and must proceed through secondary confirmation.
    pub fn cancel_emergency_action(env: Env, proposal_id: u32) -> Result<(), VaultError> {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();

        let mut proposal = emergency::read_proposal(&env, proposal_id).expect("proposal not found");
        assert!(!proposal.executed, "proposal already executed");

        if proposal.cancelled {
            return Err(VaultError::ProposalCancelled);
        }
        if env.ledger().timestamp() >= proposal.dispute_deadline {
            return Err(VaultError::DisputeWindowClosed);
        }

        proposal.cancelled = true;
        emergency::write_proposal(&env, proposal_id, &proposal);
        env.events()
            .publish((symbol_short!("emrgcncl"),), (proposal_id,));
        Ok(())
    }

    /// Sets the dispute window duration (in seconds) for new emergency proposals.
    ///
    /// Only the admin may configure this. Defaults to `3600` (1 hour) if never set.
    pub fn set_emergency_dispute_window(env: Env, seconds: u64) {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();
        assert!(seconds > 0, "dispute window must be positive");
        env.storage()
            .instance()
            .set(&DataKey::EmergencyDisputeWindow, &seconds);
    }

    /// Returns the configured dispute window in seconds (default 3600).
    pub fn emergency_dispute_window(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::EmergencyDisputeWindow)
            .unwrap_or(3_600u64)
    }

    pub fn emergency_proposal(env: Env, proposal_id: u32) -> Option<emergency::EmergencyProposal> {
        emergency::read_proposal(&env, proposal_id)
    }

    fn apply_emergency_pause(env: &Env, reason: PauseReason) {
        let mut state = Self::get_state(env);
        state.is_paused = true;
        env.storage().instance().set(&DataKey::State, &state);
        env.storage().instance().set(&DataKey::PauseReason, &reason);
    }

    fn apply_emergency_unpause(env: &Env) {
        let mut state = Self::get_state(env);
        state.is_paused = false;
        env.storage().instance().set(&DataKey::State, &state);
        env.storage().instance().remove(&DataKey::PauseReason);
    }

    fn pause_reason_from_code(code: u32) -> PauseReason {
        match code {
            0 => PauseReason::None,
            1 => PauseReason::SecurityIncident,
            2 => PauseReason::OracleFailure,
            3 => PauseReason::LiquidityCrisis,
            4 => PauseReason::Governance,
            5 => PauseReason::Maintenance,
            6 => PauseReason::Other,
            _ => PauseReason::SecurityIncident,
        }
    }

    pub fn set_per_user_cap(env: Env, cap: i128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::PerUserCap, &cap);
    }

    pub fn per_user_cap(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::PerUserCap)
            .unwrap_or(i128::MAX)
    }

    pub fn user_deposit(env: Env, user: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::UserDeposit(user))
            .unwrap_or(0)
    }

    fn get_state(env: &Env) -> VaultState {
        env.storage()
            .instance()
            .get(&DataKey::State)
            .unwrap_or(VaultState {
                total_shares: 0,
                total_assets: 0,
                is_paused: false,
            })
    }

    pub fn token(env: Env) -> Address {
        env.storage().instance().get(&DataKey::TokenAsset).unwrap()
    }

    pub fn total_shares(env: Env) -> i128 {
        Self::get_state(&env).total_shares
    }

    /// Read the total underlying assets (idle in vault + invested in strategy).
    pub fn total_assets(env: Env) -> i128 {
        let idle_assets = env
            .storage()
            .instance()
            .get::<_, i128>(&DataKey::TotalAssets)
            .unwrap_or(0);

        let strategy_assets = if let Some(strategy_addr) = Self::strategy(env.clone()) {
            let strategy_client = StrategyClient::new(&env, &strategy_addr);
            strategy_client.total_value()
        } else {
            0
        };

        idle_assets.checked_add(strategy_assets).expect("overflow")
    }

    /// Returns the current vault share price scaled to 10^18.
    ///
    /// This exchange rate represents the value of one vault share in underlying
    /// assets and is the basis for frontend share-price reporting. When no shares
    /// are outstanding, the share price is defined as zero.
    pub fn share_price(env: Env) -> i128 {
        let state = Self::get_state(&env);
        if state.total_shares == 0 {
            return 0;
        }
        state
            .total_assets
            .checked_mul(SHARE_PRICE_SCALE)
            .expect("overflow")
            .checked_div(state.total_shares)
            .expect("division by zero")
    }

    pub fn balance(env: Env, user: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::ShareBalance(user))
            .unwrap_or(0)
    }

    pub fn create_checkpoint(env: Env) -> u32 {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();

        let next_checkpoint = env
            .storage()
            .instance()
            .get::<_, u32>(&DataKey::CheckpointNonce)
            .unwrap_or(0)
            .checked_add(1)
            .expect("overflow");
        let state = Self::get_state(&env);

        env.storage()
            .instance()
            .set(&DataKey::CheckpointNonce, &next_checkpoint);
        env.storage().instance().set(
            &DataKey::CheckpointTotalShares(next_checkpoint),
            &state.total_shares,
        );
        env.storage().instance().set(
            &DataKey::CheckpointTotalAssets(next_checkpoint),
            &state.total_assets,
        );
        env.events()
            .publish((symbol_short!("chkpoint"),), (next_checkpoint,));
        next_checkpoint
    }

    pub fn total_shares_at(env: Env, checkpoint_id: u32) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::CheckpointTotalShares(checkpoint_id))
            .unwrap_or(0)
    }

    pub fn total_assets_at(env: Env, checkpoint_id: u32) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::CheckpointTotalAssets(checkpoint_id))
            .unwrap_or(0)
    }

    pub fn snapshot_user_balance(env: Env, user: Address) {
        user.require_auth();
        let checkpoint_id = env
            .storage()
            .instance()
            .get::<_, u32>(&DataKey::CheckpointNonce)
            .expect("no checkpoint");
        let balance = Self::balance(env.clone(), user.clone());
        env.storage()
            .instance()
            .set(&DataKey::UserCheckpoint(user.clone()), &checkpoint_id);
        env.storage()
            .instance()
            .set(&DataKey::UserBalanceAt(user, checkpoint_id), &balance);
    }

    pub fn balance_at(env: Env, user: Address, checkpoint_id: u32) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::UserBalanceAt(user, checkpoint_id))
            .unwrap_or(0)
    }

    pub fn benji_strategy(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::BenjiStrategy)
            .unwrap()
    }

    pub fn korean_strategy(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::KoreanDebtStrategy)
            .unwrap()
    }

    pub fn configure_korean_strategy(env: Env, strategy: Address) {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::KoreanDebtStrategy, &strategy);
    }

    pub fn accrue_korean_debt_yield(env: Env) -> i128 {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();

        let strategy: Address = env
            .storage()
            .instance()
            .get(&DataKey::KoreanDebtStrategy)
            .unwrap();
        let strategy_client = KoreanDebtStrategyClient::new(&env, &strategy);
        let harvested = strategy_client.harvest_yield();

        if harvested <= 0 {
            panic!("yield amount must be > 0");
        }

        let mut state = Self::get_state(&env);
        state.total_assets = state.total_assets.checked_add(harvested).expect("overflow");
        env.storage().instance().set(&DataKey::State, &state);

        harvested
    }

    pub fn set_dao_threshold(env: Env, threshold: i128) {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();
        if threshold <= 0 {
            panic!("threshold must be > 0");
        }
        env.storage()
            .instance()
            .set(&DataKey::DaoThreshold, &threshold);
    }

    pub fn create_strategy_proposal(env: Env, proposer: Address, strategy: Address) -> u32 {
        proposer.require_auth();
        let mut next_nonce: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ProposalNonce)
            .unwrap_or(0);
        next_nonce = next_nonce.checked_add(1).expect("overflow");
        env.storage()
            .instance()
            .set(&DataKey::ProposalNonce, &next_nonce);

        let proposal = StrategyProposal {
            strategy,
            yes_votes: 0,
            no_votes: 0,
            executed: false,
        };
        env.storage()
            .instance()
            .set(&DataKey::Proposal(next_nonce), &proposal);
        next_nonce
    }

    pub fn vote_on_proposal(
        env: Env,
        voter: Address,
        proposal_id: u32,
        support: bool,
        weight: i128,
    ) {
        voter.require_auth();
        if weight <= 0 {
            panic!("weight must be > 0");
        }
        if env
            .storage()
            .instance()
            .has(&DataKey::Vote(proposal_id, voter.clone()))
        {
            panic!("duplicate vote");
        }

        let mut proposal: StrategyProposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .unwrap();
        if proposal.executed {
            panic!("proposal already executed");
        }

        if support {
            proposal.yes_votes = proposal.yes_votes.checked_add(weight).expect("overflow");
        } else {
            proposal.no_votes = proposal.no_votes.checked_add(weight).expect("overflow");
        }

        env.storage()
            .instance()
            .set(&DataKey::Proposal(proposal_id), &proposal);
        env.storage()
            .instance()
            .set(&DataKey::Vote(proposal_id, voter), &true);
    }

    pub fn execute_strategy_proposal(env: Env, proposal_id: u32) {
        let mut proposal: StrategyProposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal(proposal_id))
            .unwrap();
        if proposal.executed {
            panic!("proposal already executed");
        }

        let threshold: i128 = env
            .storage()
            .instance()
            .get(&DataKey::DaoThreshold)
            .unwrap_or(1);
        if proposal.yes_votes < threshold {
            panic!("quorum not reached");
        }
        if proposal.yes_votes <= proposal.no_votes {
            panic!("proposal rejected");
        }

        env.storage()
            .instance()
            .set(&DataKey::BenjiStrategy, &proposal.strategy);
        proposal.executed = true;
        env.storage()
            .instance()
            .set(&DataKey::Proposal(proposal_id), &proposal);
    }

    /// Adds a new RWA shipment to the tracking system.
    ///
    /// ### Parameters
    /// * `shipment_id` - Unique identifier for the cargo/asset.
    /// * `status` - The initial `ShipmentStatus` (e.g., Pending).
    ///
    /// ### Authority
    /// Requires `Admin` signature.
    pub fn add_shipment(env: Env, shipment_id: u64, status: ShipmentStatus) {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();

        if env
            .storage()
            .instance()
            .has(&DataKey::ShipmentStatusOf(shipment_id))
        {
            panic!("shipment already exists");
        }

        let list_key = DataKey::ShipmentByStatus(status.clone());
        let ids = env
            .storage()
            .instance()
            .get::<_, Vec<u64>>(&list_key)
            .unwrap_or(Vec::new(&env));
        let next_ids = Self::insert_sorted_unique(&env, ids, shipment_id);

        env.storage().instance().set(&list_key, &next_ids);
        env.storage()
            .instance()
            .set(&DataKey::ShipmentStatusOf(shipment_id), &status);
    }

    pub fn update_shipment_status(env: Env, shipment_id: u64, new_status: ShipmentStatus) {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();

        let old_status: ShipmentStatus = env
            .storage()
            .instance()
            .get(&DataKey::ShipmentStatusOf(shipment_id))
            .unwrap();
        if old_status == new_status {
            return;
        }

        let old_key = DataKey::ShipmentByStatus(old_status);
        let new_key = DataKey::ShipmentByStatus(new_status.clone());

        let old_ids = env
            .storage()
            .instance()
            .get::<_, Vec<u64>>(&old_key)
            .unwrap_or(Vec::new(&env));
        let new_ids = env
            .storage()
            .instance()
            .get::<_, Vec<u64>>(&new_key)
            .unwrap_or(Vec::new(&env));

        let filtered_old = Self::remove_id(&env, old_ids, shipment_id);
        let inserted_new = Self::insert_sorted_unique(&env, new_ids, shipment_id);

        env.storage().instance().set(&old_key, &filtered_old);
        env.storage().instance().set(&new_key, &inserted_new);
        env.storage()
            .instance()
            .set(&DataKey::ShipmentStatusOf(shipment_id), &new_status);
    }

    /// Returns a paginated list of shipment IDs filtered by status.
    ///
    /// ### Parameters
    /// * `cursor` - Optional ID to start after.
    /// * `page_size` - Number of items to return (max 50).
    pub fn shipment_ids_by_status(
        env: Env,
        status: ShipmentStatus,
        cursor: Option<u64>,
        page_size: u32,
    ) -> ShipmentPage {
        if page_size == 0 {
            panic!("page_size must be > 0");
        }

        let bounded_size = if page_size > MAX_PAGE_SIZE {
            MAX_PAGE_SIZE
        } else {
            page_size
        };

        let ids = env
            .storage()
            .instance()
            .get::<_, Vec<u64>>(&DataKey::ShipmentByStatus(status))
            .unwrap_or(Vec::new(&env));

        let start_idx = Self::index_after_cursor(&ids, cursor);
        let mut page_ids = Vec::new(&env);

        let mut idx = start_idx;
        let total = ids.len();
        while idx < total && page_ids.len() < bounded_size {
            let id = ids.get(idx).unwrap();
            page_ids.push_back(id);
            idx += 1;
        }

        let next_cursor = if idx < total {
            page_ids.get(page_ids.len() - 1)
        } else {
            None
        };

        ShipmentPage {
            shipment_ids: page_ids,
            next_cursor,
        }
    }

    /// Calculates the number of shares that would be minted for a given asset amount.
    ///
    /// Uses the deterministic round-down policy defined in the `math` module.
    /// See [`math::assets_to_shares`] for detailed rounding behavior.
    ///
    /// ### Parameters
    /// * `assets` - The amount of underlying tokens to convert.
    ///
    /// ### Returns
    /// The number of shares that would be minted (rounded down).
    ///
    /// ### Rounding
    /// Always rounds DOWN to prevent over-minting shares.
    pub fn calculate_shares(env: Env, assets: i128) -> i128 {
        let state = Self::get_state(&env);
        crate::math::assets_to_shares(assets, state.total_shares, state.total_assets)
    }

    /// Calculates the number of assets that would be returned for a given share amount.
    ///
    /// Uses the deterministic round-down policy defined in the `math` module.
    /// See [`math::shares_to_assets`] for detailed rounding behavior.
    ///
    /// ### Parameters
    /// * `shares` - The number of shares to convert.
    ///
    /// ### Returns
    /// The amount of underlying tokens that would be returned (rounded down).
    ///
    /// ### Rounding
    /// Always rounds DOWN to prevent over-withdrawal of assets.
    pub fn calculate_assets(env: Env, shares: i128) -> i128 {
        let state = Self::get_state(&env);
        crate::math::shares_to_assets(shares, state.total_shares, state.total_assets)
    }

    /// Deposits underlying tokens in exchange for vault shares.
    ///
    /// ### Parameters
    /// * `user` - The address providing the assets (requires auth).
    /// * `amount` - The quantity of the underlying token to deposit.
    ///
    /// ### Returns
    /// The number of shares minted to the user.
    ///
    /// ### Rounding
    /// Uses round-down conversion (see [`math::assets_to_shares`]).
    /// Rejects deposits that would mint zero shares to prevent silent loss of funds.
    ///
    /// ### Events
    /// Publishes a `(symbol_short!("deposit"),)` event with `(amount, shares_minted)`.
    pub fn deposit(env: Env, user: Address, amount: i128) -> Result<i128, VaultError> {
        let mut state = Self::get_state(&env);
        if state.is_paused {
            return Err(VaultError::ContractPaused);
        }

        user.require_auth();
        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        // Goal 3: enforce minimum deposit
        let min_deposit: i128 = env
            .storage()
            .instance()
            .get(&DataKey::MinDeposit)
            .unwrap_or(0);
        if amount < min_deposit {
            return Err(VaultError::MinDepositNotMet);
        }

        let token_addr: Address = env.storage().instance().get(&DataKey::TokenAsset).unwrap();
        let token_client = token::Client::new(&env, &token_addr);

        // Use centralized conversion with deterministic round-down policy
        let shares_to_mint =
            crate::math::assets_to_shares(amount, state.total_shares, state.total_assets);

        // Prevent silent loss of funds if shares round down to 0
        if shares_to_mint == 0 {
            return Err(VaultError::InvalidAmount);
        }

        let deposit_key = DataKey::UserDeposit(user.clone());
        let current_deposit: i128 = env.storage().instance().get(&deposit_key).unwrap_or(0);
        let new_deposit = current_deposit.checked_add(amount).expect("overflow");

        let cap: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PerUserCap)
            .unwrap_or(i128::MAX);
        if new_deposit > cap {
            return Err(VaultError::ExceedsUserCap);
        }

        token_client.transfer(&user, &env.current_contract_address(), &amount);

        env.storage().instance().set(&deposit_key, &new_deposit);

        // Update idle state
        let ta = env
            .storage()
            .instance()
            .get::<_, i128>(&DataKey::TotalAssets)
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::TotalAssets,
            &ta.checked_add(amount).expect("overflow"),
        );

        let ts = Self::total_shares(env.clone());
        env.storage().instance().set(
            &DataKey::TotalShares,
            &ts.checked_add(shares_to_mint).expect("overflow"),
        );
        state.total_assets = state.total_assets.checked_add(amount).expect("overflow");
        state.total_shares = state
            .total_shares
            .checked_add(shares_to_mint)
            .expect("overflow");
        env.storage().instance().set(&DataKey::State, &state);

        let user_key = DataKey::ShareBalance(user.clone());
        let user_shares: i128 = env.storage().instance().get(&user_key).unwrap_or(0);
        env.storage().instance().set(
            &user_key,
            &user_shares.checked_add(shares_to_mint).expect("overflow"),
        );

        // Track last deposit time for withdrawal cooldown
        env.storage().instance().set(
            &DataKey::LastDepositTime(user.clone()),
            &env.ledger().timestamp(),
        );

        env.events()
            .publish((symbol_short!("deposit"),), (amount, shares_to_mint));
        Ok(shares_to_mint)
    }

    // ── Relayer management ────────────────────────────────────────────────────

    /// Register or deregister a relayer address allowed to submit batch deposits.
    ///
    /// Only the Admin can call this.
    pub fn set_relayer(env: Env, relayer: Address, approved: bool) {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::RelayerWhitelist(relayer), &approved);
    }

    /// Returns whether the given address is a registered relayer.
    pub fn is_relayer(env: Env, relayer: Address) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::RelayerWhitelist(relayer))
            .unwrap_or(false)
    }

    /// Set the maximum number of entries permitted in a single `batch_deposit` call.
    ///
    /// Defaults to 50 if not set. Only the Admin can call this.
    pub fn set_max_batch_size(env: Env, size: u32) {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();
        if size == 0 {
            panic!("max_batch_size must be > 0");
        }
        env.storage().instance().set(&DataKey::MaxBatchSize, &size);
    }

    /// Returns the maximum batch size (default 50).
    pub fn max_batch_size(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::MaxBatchSize)
            .unwrap_or(50u32)
    }

    // ── Batch deposit ─────────────────────────────────────────────────────────

    /// Processes multiple user deposits atomically in a single transaction.
    ///
    /// This entrypoint is reserved for whitelisted relayers that aggregate deposits
    /// from multiple users and submit them in one Soroban transaction, reducing
    /// per-user transaction fees and improving throughput.
    ///
    /// ### Atomicity
    /// All state updates (total_assets, total_shares, share balances) are applied
    /// together. Individual entries that fail validation (invalid amount, cap
    /// exceeded, min deposit not met, etc.) are recorded with `success = false`
    /// in the returned `BatchDepositResult`; other valid entries still succeed.
    /// The vault pause check is performed upfront and fails the entire call.
    ///
    /// ### Authorization
    /// * `relayer` must be a registered relayer (see `set_relayer`).
    /// * Each `user` inside the entries must have pre-authorized the vault to
    ///   transfer their tokens (standard Soroban token auth).
    ///
    /// ### Parameters
    /// * `relayer`  — The address submitting the batch (must be whitelisted).
    /// * `entries`  — Vector of `DepositEntry { user, amount }` to process.
    ///
    /// ### Returns
    /// A `BatchDepositResult` with per-entry outcomes and aggregate totals.
    ///
    /// ### Errors
    /// * `VaultError::ContractPaused`      — Vault is paused; entire call rejected.
    /// * `VaultError::RelayerNotAuthorized` — Caller is not a whitelisted relayer.
    /// * `VaultError::BatchTooLarge`        — `entries.len()` exceeds `max_batch_size`.
    ///
    /// ### Events
    /// Publishes `(symbol_short!("batchdep"),)` with `(total_shares_minted, success_count, failure_count)`.
    pub fn batch_deposit(
        env: Env,
        relayer: Address,
        entries: Vec<DepositEntry>,
    ) -> Result<BatchDepositResult, VaultError> {
        // ── Checks ────────────────────────────────────────────────────────────

        // 1. Vault must not be paused
        let mut state = Self::get_state(&env);
        if state.is_paused {
            return Err(VaultError::ContractPaused);
        }

        // 2. Caller must be a whitelisted relayer
        relayer.require_auth();
        let is_approved: bool = env
            .storage()
            .instance()
            .get(&DataKey::RelayerWhitelist(relayer.clone()))
            .unwrap_or(false);
        if !is_approved {
            return Err(VaultError::RelayerNotAuthorized);
        }

        // 3. Batch size guard
        let max_size = env
            .storage()
            .instance()
            .get::<_, u32>(&DataKey::MaxBatchSize)
            .unwrap_or(50u32);
        if entries.len() > max_size {
            return Err(VaultError::BatchTooLarge);
        }

        // ── Pre-load shared config once ────────────────────────────────────────
        let token_addr: Address = env.storage().instance().get(&DataKey::TokenAsset).unwrap();
        let token_client = token::Client::new(&env, &token_addr);

        let min_deposit: i128 = env
            .storage()
            .instance()
            .get(&DataKey::MinDeposit)
            .unwrap_or(0);

        let cap: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PerUserCap)
            .unwrap_or(i128::MAX);

        // ── Effects: process each entry ────────────────────────────────────────
        let mut results: Vec<DepositResult> = Vec::new(&env);
        let mut total_shares_minted: i128 = 0i128;
        let mut success_count: u32 = 0u32;
        let mut failure_count: u32 = 0u32;

        let n = entries.len();
        let mut idx: u32 = 0;
        while idx < n {
            let entry = entries.get(idx).unwrap();
            let user = entry.user.clone();
            let amount = entry.amount;

            // Per-entry validation
            let entry_result = Self::process_single_batch_entry(
                &env,
                &mut state,
                &token_client,
                &user,
                amount,
                min_deposit,
                cap,
            );

            match entry_result {
                Ok(shares_minted) => {
                    total_shares_minted = total_shares_minted
                        .checked_add(shares_minted)
                        .expect("overflow");
                    success_count = success_count.checked_add(1).expect("overflow");
                    results.push_back(DepositResult {
                        user,
                        shares_minted,
                        success: true,
                        error_code: 0,
                    });
                }
                Err(e) => {
                    failure_count = failure_count.checked_add(1).expect("overflow");
                    results.push_back(DepositResult {
                        user,
                        shares_minted: 0,
                        success: false,
                        error_code: e as u32,
                    });
                }
            }

            idx += 1;
        }

        // Persist the updated vault state once after all entries are processed
        env.storage().instance().set(&DataKey::State, &state);

        env.events().publish(
            (symbol_short!("batchdep"),),
            (total_shares_minted, success_count, failure_count),
        );

        Ok(BatchDepositResult {
            results,
            total_shares_minted,
            success_count,
            failure_count,
        })
    }

    /// Internal helper: validates and applies a single deposit within a batch.
    ///
    /// State fields `total_assets` and `total_shares` on `state` are updated
    /// in-memory; the caller must persist `state` after the loop.
    fn process_single_batch_entry(
        env: &Env,
        state: &mut VaultState,
        token_client: &token::Client,
        user: &Address,
        amount: i128,
        min_deposit: i128,
        per_user_cap: i128,
    ) -> Result<i128, VaultError> {
        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        if amount < min_deposit {
            return Err(VaultError::MinDepositNotMet);
        }

        // Compute shares using current in-memory state (updated incrementally)
        let shares_to_mint =
            crate::math::assets_to_shares(amount, state.total_shares, state.total_assets);

        if shares_to_mint == 0 {
            return Err(VaultError::InvalidAmount);
        }

        // Per-user deposit cap check
        let deposit_key = DataKey::UserDeposit(user.clone());
        let current_deposit: i128 = env.storage().instance().get(&deposit_key).unwrap_or(0);
        let new_deposit = current_deposit.checked_add(amount).expect("overflow");
        if new_deposit > per_user_cap {
            return Err(VaultError::ExceedsUserCap);
        }

        // ── Interaction: pull tokens from user ─────────────────────────────────
        user.require_auth();
        token_client.transfer(user, &env.current_contract_address(), &amount);

        // ── Effects: update storage ────────────────────────────────────────────
        env.storage().instance().set(&deposit_key, &new_deposit);

        // Update idle TotalAssets in storage
        let ta: i128 = env
            .storage()
            .instance()
            .get::<_, i128>(&DataKey::TotalAssets)
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::TotalAssets,
            &ta.checked_add(amount).expect("overflow"),
        );

        // Update TotalShares in storage
        let ts: i128 = env
            .storage()
            .instance()
            .get::<_, i128>(&DataKey::TotalShares)
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::TotalShares,
            &ts.checked_add(shares_to_mint).expect("overflow"),
        );

        // Update in-memory state (used for subsequent entries in the same batch)
        state.total_assets = state.total_assets.checked_add(amount).expect("overflow");
        state.total_shares = state
            .total_shares
            .checked_add(shares_to_mint)
            .expect("overflow");

        // Update user share balance
        let user_key = DataKey::ShareBalance(user.clone());
        let user_shares: i128 = env.storage().instance().get(&user_key).unwrap_or(0);
        env.storage().instance().set(
            &user_key,
            &user_shares.checked_add(shares_to_mint).expect("overflow"),
        );

        // Track last deposit time for withdrawal cooldown
        env.storage().instance().set(
            &DataKey::LastDepositTime(user.clone()),
            &env.ledger().timestamp(),
        );

        env.events()
            .publish((symbol_short!("deposit"),), (amount, shares_to_mint));

        Ok(shares_to_mint)
    }

    /// Redeems vault shares for the proportional amount of underlying assets.
    ///
    /// For withdrawals above `LARGE_WITHDRAWAL_THRESHOLD`, a pending withdrawal
    /// is created with a 24-hour timelock. Call `execute_withdrawal` after the
    /// timelock expires to complete the transfer.
    ///
    /// ### Parameters
    /// * `user` - The share holder (requires auth).
    /// * `shares` - The number of shares to burn.
    ///
    /// ### Returns
    /// The quantity of underlying tokens returned to the user (0 if timelocked).
    ///
    /// ### Rounding
    /// Uses round-down conversion (see [`math::shares_to_assets`]).
    pub fn withdraw(env: Env, user: Address, shares: i128) -> Result<i128, VaultError> {
        let mut state = Self::get_state(&env);
        if state.is_paused {
            return Err(VaultError::ContractPaused);
        }

        user.require_auth();
        if shares <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        // Check withdrawal cooldown
        let cooldown: u64 = env
            .storage()
            .instance()
            .get(&DataKey::WithdrawalCooldown)
            .unwrap_or(0);
        if cooldown > 0 {
            let last_deposit: u64 = env
                .storage()
                .instance()
                .get(&DataKey::LastDepositTime(user.clone()))
                .unwrap_or(0);
            let earliest_withdrawal = last_deposit.checked_add(cooldown).expect("overflow");
            if env.ledger().timestamp() < earliest_withdrawal {
                return Err(VaultError::WithdrawalCooldownActive);
            }
        }

        let user_key = DataKey::ShareBalance(user.clone());
        let user_shares: i128 = env.storage().instance().get(&user_key).unwrap_or(0);
        if user_shares < shares {
            return Err(VaultError::InsufficientShares);
        }

        // Goal 2: check large-withdrawal threshold
        let threshold: i128 = env
            .storage()
            .instance()
            .get(&DataKey::LargeWithdrawalThreshold)
            .unwrap_or(i128::MAX);

        // Use centralized conversion with deterministic round-down policy
        let assets_to_return =
            crate::math::shares_to_assets(shares, state.total_shares, state.total_assets);

        if assets_to_return > threshold {
            // Create a pending withdrawal with a 24-hour timelock
            let unlock_ts = env
                .ledger()
                .timestamp()
                .checked_add(86_400)
                .expect("overflow");
            let pending = PendingWithdrawal {
                shares,
                unlock_timestamp: unlock_ts,
            };
            env.storage()
                .instance()
                .set(&DataKey::PendingWithdrawal(user.clone()), &pending);
            env.events()
                .publish((symbol_short!("pndwdraw"), user), (shares, unlock_ts));
            return Ok(0);
        }

        Self::do_withdraw(&env, &mut state, user, shares, assets_to_return)
    }

    /// Completes a pending large withdrawal after the timelock has expired.
    ///
    /// ### Rounding
    /// Uses round-down conversion (see [`math::shares_to_assets`]).
    pub fn execute_withdrawal(env: Env, user: Address) -> Result<i128, VaultError> {
        user.require_auth();

        let pending: PendingWithdrawal = env
            .storage()
            .instance()
            .get(&DataKey::PendingWithdrawal(user.clone()))
            .ok_or(VaultError::NoPendingWithdrawal)?;

        if env.ledger().timestamp() < pending.unlock_timestamp {
            return Err(VaultError::TimelockNotExpired);
        }

        env.storage()
            .instance()
            .remove(&DataKey::PendingWithdrawal(user.clone()));

        let mut state = Self::get_state(&env);

        // Use centralized conversion with deterministic round-down policy
        let assets_to_return =
            crate::math::shares_to_assets(pending.shares, state.total_shares, state.total_assets);

        Self::do_withdraw(&env, &mut state, user, pending.shares, assets_to_return)
    }

    /// Internal: burns shares, transfers assets, updates state.
    fn do_withdraw(
        env: &Env,
        state: &mut VaultState,
        user: Address,
        shares: i128,
        assets_to_return: i128,
    ) -> Result<i128, VaultError> {
        let token_addr = env.storage().instance().get(&DataKey::TokenAsset).unwrap();
        let token_client = token::Client::new(env, &token_addr);

        // Check if vault has enough idle assets, otherwise divest from strategy
        let mut idle_ta = env
            .storage()
            .instance()
            .get::<_, i128>(&DataKey::TotalAssets)
            .unwrap_or(0);
        if idle_ta < assets_to_return {
            let needed = assets_to_return.checked_sub(idle_ta).expect("underflow");
            Self::divest(env.clone(), needed);
            idle_ta = env
                .storage()
                .instance()
                .get::<_, i128>(&DataKey::TotalAssets)
                .unwrap_or(0);
        }

        if idle_ta < assets_to_return {
            return Self::enqueue_withdrawal_for_liquidity(
                env,
                state,
                user,
                shares,
                assets_to_return,
            );
        }

        token_client.transfer(&env.current_contract_address(), &user, &assets_to_return);

        env.storage().instance().set(
            &DataKey::TotalAssets,
            &idle_ta.checked_sub(assets_to_return).expect("underflow"),
        );

        let ts = Self::total_shares(env.clone());
        env.storage().instance().set(
            &DataKey::TotalShares,
            &ts.checked_sub(shares).expect("underflow"),
        );

        // Capture pre-burn share balance for proportional cost-basis reduction.
        let vault_balance = Self::balance(env.clone(), user.clone());
        env.storage().instance().set(
            &DataKey::ShareBalance(user.clone()),
            &vault_balance.checked_sub(shares).expect("underflow"),
        );

        state.total_assets = state
            .total_assets
            .checked_sub(assets_to_return)
            .expect("underflow");
        state.total_shares = state.total_shares.checked_sub(shares).expect("underflow");
        env.storage().instance().set(&DataKey::State, state);

        // Burn precedence rule: proportional cost-basis reduction.
        //
        // For partial withdrawals across mixed-lot share states (user made deposits at
        // different share prices), the burned cost basis is the proportional slice of
        // the total recorded deposit:
        //
        //   cost_basis_reduction = (shares_burned × current_deposit) / pre_burn_balance
        //
        // Rationale:
        // - Deterministic: same inputs always produce same output regardless of deposit history.
        // - Stable: does not require per-lot storage; works on a flat balance.
        // - Fair: each share carries an equal fraction of the aggregate cost basis.
        // - Solvency-safe: rounds down (truncates), never over-reduces the recorded deposit.
        //
        // Edge cases:
        // - Full burn (shares == vault_balance): new_deposit = 0.
        // - vault_balance == 0: unreachable (InsufficientShares guard fires first), but
        //   zeroed defensively.
        let deposit_key = DataKey::UserDeposit(user.clone());
        let current_deposit: i128 = env.storage().instance().get(&deposit_key).unwrap_or(0);
        let new_deposit = if vault_balance == 0 || shares >= vault_balance {
            // Full burn or degenerate state: zero out cost basis.
            0
        } else {
            // Proportional reduction: round down (truncate) to stay solvency-safe.
            let cost_basis_reduction = shares
                .checked_mul(current_deposit)
                .expect("overflow in cost_basis_reduction")
                .checked_div(vault_balance)
                .expect("division by zero in cost_basis_reduction");
            current_deposit
                .checked_sub(cost_basis_reduction)
                .expect("underflow in cost_basis_reduction")
        };
        env.storage().instance().set(&deposit_key, &new_deposit);

        env.events().publish(
            (symbol_short!("withdraw"), user),
            (assets_to_return, shares),
        );
        Ok(assets_to_return)
    }

    fn withdrawal_queue_meta(env: &Env) -> WithdrawalQueueMeta {
        env.storage()
            .instance()
            .get(&DataKey::WithdrawalQueueMeta)
            .unwrap_or(WithdrawalQueueMeta { head: 1, tail: 1 })
    }

    fn set_withdrawal_queue_meta(env: &Env, meta: &WithdrawalQueueMeta) {
        env.storage()
            .instance()
            .set(&DataKey::WithdrawalQueueMeta, meta);
    }

    fn withdrawal_queue_head(env: &Env) -> u64 {
        Self::withdrawal_queue_meta(env).head
    }

    fn withdrawal_queue_tail(env: &Env) -> u64 {
        Self::withdrawal_queue_meta(env).tail
    }

    fn set_withdrawal_queue_head(env: &Env, head: u64) {
        let mut meta = Self::withdrawal_queue_meta(env);
        meta.head = head;
        Self::set_withdrawal_queue_meta(env, &meta);
    }

    fn set_withdrawal_queue_tail(env: &Env, tail: u64) {
        let mut meta = Self::withdrawal_queue_meta(env);
        meta.tail = tail;
        Self::set_withdrawal_queue_meta(env, &meta);
    }

    /// Queue a withdrawal payout when idle liquidity is insufficient after divest.
    fn enqueue_withdrawal_for_liquidity(
        env: &Env,
        state: &mut VaultState,
        user: Address,
        shares: i128,
        assets_to_return: i128,
    ) -> Result<i128, VaultError> {
        let tail = Self::withdrawal_queue_tail(env);
        let entry = WithdrawalQueueEntry {
            user: user.clone(),
            shares,
            assets: assets_to_return,
            enqueued_at: env.ledger().timestamp(),
        };
        env.storage()
            .instance()
            .set(&DataKey::WithdrawalQueueEntry(tail), &entry);
        Self::set_withdrawal_queue_tail(env, tail.checked_add(1).expect("queue overflow"));

        let vault_balance = Self::balance(env.clone(), user.clone());
        env.storage().instance().set(
            &DataKey::ShareBalance(user.clone()),
            &vault_balance.checked_sub(shares).expect("underflow"),
        );

        let ts = Self::total_shares(env.clone());
        env.storage().instance().set(
            &DataKey::TotalShares,
            &ts.checked_sub(shares).expect("underflow"),
        );

        state.total_shares = state.total_shares.checked_sub(shares).expect("underflow");
        state.total_assets = state
            .total_assets
            .checked_sub(assets_to_return)
            .expect("underflow");
        env.storage().instance().set(&DataKey::State, state);

        let deposit_key = DataKey::UserDeposit(user.clone());
        let current_deposit: i128 = env.storage().instance().get(&deposit_key).unwrap_or(0);
        let new_deposit = if vault_balance == 0 || shares >= vault_balance {
            0
        } else {
            let cost_basis_reduction = shares
                .checked_mul(current_deposit)
                .expect("overflow")
                .checked_div(vault_balance)
                .expect("division by zero");
            current_deposit
                .checked_sub(cost_basis_reduction)
                .expect("underflow")
        };
        env.storage().instance().set(&deposit_key, &new_deposit);

        env.events()
            .publish((symbol_short!("wdqueue"), user.clone()), (tail, assets_to_return));

        Err(VaultError::WithdrawalQueued)
    }

    /// Returns the number of withdrawals waiting in the liquidity queue.
    pub fn withdrawal_queue_length(env: Env) -> u64 {
        let head = Self::withdrawal_queue_head(&env);
        let tail = Self::withdrawal_queue_tail(&env);
        tail.saturating_sub(head)
    }

    /// Process queued withdrawals in deterministic FIFO order while liquidity allows.
    pub fn process_withdrawal_queue(env: Env, max_entries: u32) -> u32 {
        if max_entries == 0 {
            return 0;
        }

        let token_addr = env.storage().instance().get(&DataKey::TokenAsset).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        let mut processed: u32 = 0;
        let mut head = Self::withdrawal_queue_head(&env);
        let tail = Self::withdrawal_queue_tail(&env);

        while head < tail && processed < max_entries {
            let key = DataKey::WithdrawalQueueEntry(head);
            let Some(entry) = env.storage().instance().get::<_, WithdrawalQueueEntry>(&key) else {
                head = head.checked_add(1).expect("overflow");
                continue;
            };

            let idle = env
                .storage()
                .instance()
                .get::<_, i128>(&DataKey::TotalAssets)
                .unwrap_or(0);
            if idle < entry.assets {
                break;
            }

            token_client.transfer(
                &env.current_contract_address(),
                &entry.user,
                &entry.assets,
            );
            env.storage().instance().set(
                &DataKey::TotalAssets,
                &idle.checked_sub(entry.assets).expect("underflow"),
            );
            env.storage().instance().remove(&key);
            env.events().publish(
                (symbol_short!("wdqproc"), entry.user.clone()),
                (head, entry.assets),
            );

            head = head.checked_add(1).expect("overflow");
            processed = processed.checked_add(1).expect("overflow");
        }

        Self::set_withdrawal_queue_head(&env, head);
        processed
    }

    /// Move idle funds to the strategy.
    pub fn invest(env: Env, amount: i128) -> Result<(), VaultError> {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();
        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        let strategy_addr = Self::strategy(env.clone()).expect("no strategy set");
        let strategy_client = StrategyClient::new(&env, &strategy_addr);

        // Cap check
        let cap: i128 = env
            .storage()
            .instance()
            .get(&DataKey::StrategyCap(strategy_addr.clone()))
            .unwrap_or(i128::MAX);
        let total_invested = strategy_client.total_value();
        if total_invested.checked_add(amount).expect("overflow") > cap {
            return Err(VaultError::ExceedsStrategyCap);
        }

        // Risk Threshold check
        let threshold: i128 = env
            .storage()
            .instance()
            .get(&DataKey::StrategyRiskThreshold(strategy_addr.clone()))
            .unwrap_or(10_000);
        let total_assets = Self::total_assets(env.clone());
        let new_total_invested = total_invested.checked_add(amount).expect("overflow");
        if total_assets > 0
            && (new_total_invested.checked_mul(10_000).expect("overflow") / total_assets)
                > threshold
        {
            return Err(VaultError::ExceedsRiskThreshold);
        }

        let idle_ta = env
            .storage()
            .instance()
            .get::<_, i128>(&DataKey::TotalAssets)
            .unwrap_or(0);
        if idle_ta < amount {
            panic!("insufficient idle assets");
        }
        let remaining_idle = idle_ta.checked_sub(amount).expect("underflow");
        if remaining_idle < Self::min_liquidity_buffer(env.clone()) {
            return Err(VaultError::LiquidityBufferNotMet);
        }

        // Approve and deposit to strategy
        let token_addr = Self::token(env.clone());
        let token_client = token::Client::new(&env, &token_addr);
        token_client.approve(
            &env.current_contract_address(),
            &strategy_addr,
            &amount,
            &env.ledger().sequence(),
        );

        strategy_client.deposit(&amount);
        Self::raise_strategy_watermark(&env, &strategy_addr, new_total_invested);

        // Update idle assets
        env.storage()
            .instance()
            .set(&DataKey::TotalAssets, &remaining_idle);
        Ok(())
    }

    /// Recall funds from the strategy.
    pub fn divest(env: Env, amount: i128) {
        // Can be called by admin or internally by withdraw
        let strategy_addr = Self::strategy(env.clone()).expect("no strategy set");
        let strategy_client = StrategyClient::new(&env, &strategy_addr);

        strategy_client.withdraw(&amount);
        let current_watermark = Self::strategy_watermark(env.clone(), strategy_addr.clone());
        if current_watermark > amount {
            env.storage().instance().set(
                &DataKey::StrategyWatermark(strategy_addr.clone()),
                &current_watermark.checked_sub(amount).expect("underflow"),
            );
        } else {
            env.storage()
                .instance()
                .set(&DataKey::StrategyWatermark(strategy_addr.clone()), &0i128);
        }

        // The strategy contract should have transferred funds back to the vault
        let idle_ta = env
            .storage()
            .instance()
            .get::<_, i128>(&DataKey::TotalAssets)
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::TotalAssets,
            &idle_ta.checked_add(amount).expect("overflow"),
        );
    }

    /// Rebalance funds between strategies with max slippage protection.
    /// Admin function to safely migrate assets from one strategy to another.
    pub fn rebalance(
        env: Env,
        from_strategy: Address,
        to_strategy: Address,
        amount: i128,
        min_divest_value: i128,
        min_invest_value: i128,
    ) -> Result<(), VaultError> {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();

        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        let from_client = StrategyClient::new(&env, &from_strategy);
        let to_client = StrategyClient::new(&env, &to_strategy);
        let token_addr = Self::token(env.clone());
        let token_client = token::Client::new(&env, &token_addr);

        // Measure actual token balance before divest
        let vault_bal_before = token_client.balance(&env.current_contract_address());

        // Divest from old strategy
        from_client.withdraw(&amount);

        // Verify divest slippage by measuring actual token balance
        let vault_bal_after_divest = token_client.balance(&env.current_contract_address());
        let withdrawn_assets = vault_bal_after_divest
            .checked_sub(vault_bal_before)
            .unwrap_or(0);

        if withdrawn_assets < min_divest_value {
            return Err(VaultError::SlippageExceeded);
        }

        // Adjust watermark for from_strategy
        let current_watermark = Self::strategy_watermark(env.clone(), from_strategy.clone());
        if current_watermark > withdrawn_assets {
            env.storage().instance().set(
                &DataKey::StrategyWatermark(from_strategy.clone()),
                &current_watermark
                    .checked_sub(withdrawn_assets)
                    .expect("underflow"),
            );
        } else {
            env.storage()
                .instance()
                .set(&DataKey::StrategyWatermark(from_strategy.clone()), &0i128);
        }

        // Record strategy state before invest
        let to_strategy_val_before = to_client.total_value();

        // Invest into new strategy
        token_client.approve(
            &env.current_contract_address(),
            &to_strategy,
            &withdrawn_assets,
            &env.ledger().sequence(),
        );

        to_client.deposit(&withdrawn_assets);

        // Verify invest slippage
        let to_strategy_val_after = to_client.total_value();
        let invested_value = to_strategy_val_after
            .checked_sub(to_strategy_val_before)
            .unwrap_or(0);

        if invested_value < min_invest_value {
            return Err(VaultError::SlippageExceeded);
        }

        // Adjust watermark for to_strategy
        Self::raise_strategy_watermark(&env, &to_strategy, to_strategy_val_after);

        // We moved withdrawn_assets into the new strategy, so idle TotalAssets hasn't changed.
        // We only moved funds from one strategy to another.
        // Note: The total_assets of the vault might have changed slightly due to slippage,
        // but idle assets remain the same because we sent exactly `withdrawn_assets` back out.

        Ok(())
    }

    /// Admin function to artificially accrue yield, deducting the protocol fee.
    /// The fee portion is credited to the treasury balance.
    pub fn accrue_yield(env: Env, amount: i128) -> Result<(), VaultError> {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();

        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        let fee_bps: i128 = env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0);
        let fee_amount = amount
            .checked_mul(fee_bps)
            .ok_or(VaultError::MathOverflow)?
            / fee_math::BPS_DENOMINATOR;
        let net_yield = amount
            .checked_sub(fee_amount)
            .ok_or(VaultError::MathOverflow)?;

        let token_addr = Self::token(env.clone());
        let token_client = token::Client::new(&env, &token_addr);

        token_client.transfer(&admin, &env.current_contract_address(), &amount);

        // Accumulate fee in treasury balance
        if fee_amount > 0 {
            let treasury_bal: i128 = env
                .storage()
                .instance()
                .get(&DataKey::TreasuryBalance)
                .unwrap_or(0);
            let new_treasury_bal = treasury_bal.checked_add(fee_amount).expect("overflow");
            env.storage()
                .instance()
                .set(&DataKey::TreasuryBalance, &new_treasury_bal);
            env.events()
                .publish((symbol_short!("feeacc"),), (fee_amount, new_treasury_bal));
        }

        let ta = env
            .storage()
            .instance()
            .get::<_, i128>(&DataKey::TotalAssets)
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::TotalAssets,
            &ta.checked_add(net_yield).expect("overflow"),
        );

        let mut state = Self::get_state(&env);
        let price_before = if state.total_shares > 0 {
            state
                .total_assets
                .checked_mul(SHARE_PRICE_SCALE)
                .expect("overflow")
                .checked_div(state.total_shares)
                .expect("division by zero")
        } else {
            0
        };

        state.total_assets = state.total_assets.checked_add(net_yield).expect("overflow");

        if state.total_shares > 0 {
            let price_after = state
                .total_assets
                .checked_mul(SHARE_PRICE_SCALE)
                .expect("overflow")
                .checked_div(state.total_shares)
                .expect("division by zero");
            assert!(
                price_after >= price_before,
                "share price must not decrease during yield accrual"
            );
        }

        env.storage().instance().set(&DataKey::State, &state);
        Ok(())
    }

    // ── Goal 1: Protocol fee ──────────────────────────────────────────────────

    /// Set the protocol fee in basis points (0–10000). Emits a FeeBpsChanged event.
    pub fn set_fee_bps(env: Env, new_bps: i128) {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();
        if !(0..=10_000).contains(&new_bps) {
            panic!("fee_bps must be 0-10000");
        }
        let old_bps: i128 = env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0);
        env.storage().instance().set(&DataKey::FeeBps, &new_bps);
        env.events()
            .publish((symbol_short!("feechg"),), (old_bps, new_bps));
    }

    /// Returns the current fee in basis points.
    pub fn fee_bps(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0)
    }

    /// Set the treasury address where fees accumulate.
    pub fn set_treasury(env: Env, treasury: Address) {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();
        env.storage().instance().set(&DataKey::Treasury, &treasury);
    }

    /// Returns the treasury address.
    pub fn treasury(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Treasury)
    }

    /// Returns the accumulated fee balance in the treasury.
    pub fn treasury_balance(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TreasuryBalance)
            .unwrap_or(0)
    }

    /// Transfers the entire accumulated treasury balance to the treasury address.
    /// Only the Admin can call this. Emits a `feeclm` event.
    ///
    /// ### Errors
    /// Panics if no treasury address is configured or the balance is zero.
    pub fn claim_fees(env: Env) {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();

        let treasury: Address = env
            .storage()
            .instance()
            .get(&DataKey::Treasury)
            .expect("treasury not set");

        let balance: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TreasuryBalance)
            .unwrap_or(0);
        if balance == 0 {
            panic!("no fees to claim");
        }

        env.storage()
            .instance()
            .set(&DataKey::TreasuryBalance, &0i128);

        let token_addr: Address = env.storage().instance().get(&DataKey::TokenAsset).unwrap();
        token::Client::new(&env, &token_addr).transfer(
            &env.current_contract_address(),
            &treasury,
            &balance,
        );

        env.events()
            .publish((symbol_short!("feeclm"),), (treasury, balance));
    }

    // ── Goal 2: Large-withdrawal timelock ────────────────────────────────────

    /// Set the threshold above which withdrawals require a 24-hour timelock.
    pub fn set_large_withdrawal_threshold(env: Env, threshold: i128) {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();
        if threshold <= 0 {
            panic!("threshold must be > 0");
        }
        env.storage()
            .instance()
            .set(&DataKey::LargeWithdrawalThreshold, &threshold);
    }

    /// Returns the current large-withdrawal threshold.
    pub fn large_withdrawal_threshold(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::LargeWithdrawalThreshold)
            .unwrap_or(i128::MAX)
    }

    // ── Goal 3: Minimum deposit ───────────────────────────────────────────────

    /// Set the minimum deposit amount. Emits a MinDepositChanged event.
    pub fn set_min_deposit(env: Env, new_min: i128) {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();
        if new_min < 0 {
            panic!("min_deposit must be >= 0");
        }
        let old_min: i128 = env
            .storage()
            .instance()
            .get(&DataKey::MinDeposit)
            .unwrap_or(0);
        env.storage().instance().set(&DataKey::MinDeposit, &new_min);
        env.events()
            .publish((symbol_short!("mindepchg"),), (old_min, new_min));
    }

    /// Returns the current minimum deposit threshold.
    pub fn min_deposit(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::MinDeposit)
            .unwrap_or(0)
    }

    /// Set the minimum idle vault liquidity retained before strategy allocation.
    pub fn set_min_liquidity_buffer(env: Env, new_buffer: i128) {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();
        if new_buffer < 0 {
            panic!("min_liquidity_buffer must be >= 0");
        }
        let old_buffer = Self::min_liquidity_buffer(env.clone());
        env.storage()
            .instance()
            .set(&DataKey::MinLiquidityBuffer, &new_buffer);
        env.events()
            .publish((symbol_short!("liqbufchg"),), (old_buffer, new_buffer));
    }

    /// Returns the minimum idle vault liquidity retained before strategy allocation.
    pub fn min_liquidity_buffer(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::MinLiquidityBuffer)
            .unwrap_or(0)
    }

    // ── Withdrawal cooldown ────────────────────────────────────────────────────

    /// Set the withdrawal cooldown duration in seconds.
    /// When non-zero, users must wait this long after depositing before they can withdraw.
    /// Only the Admin can call this.
    pub fn set_withdrawal_cooldown(env: Env, seconds: u64) {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();
        let old: u64 = env
            .storage()
            .instance()
            .get(&DataKey::WithdrawalCooldown)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::WithdrawalCooldown, &seconds);
        env.events()
            .publish((symbol_short!("wdrwcd"),), (old, seconds));
    }

    /// Returns the current withdrawal cooldown in seconds (0 = no cooldown).
    pub fn withdrawal_cooldown(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::WithdrawalCooldown)
            .unwrap_or(0)
    }

    // ── Oracle configuration ──────────────────────────────────────────────────

    /// Set the price oracle contract address used for strategy value validation.
    /// Only the Admin can call this.
    pub fn set_price_oracle(env: Env, oracle: Address) {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();
        env.storage().instance().set(&DataKey::PriceOracle, &oracle);
    }

    /// Returns the configured price oracle address, if any.
    pub fn price_oracle(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::PriceOracle)
    }

    /// Enable or disable oracle-based price validation for strategy values.
    /// Only the Admin can call this.
    pub fn set_oracle_enabled(env: Env, enabled: bool) {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::OracleEnabled, &enabled);
    }

    /// Returns whether oracle price validation is currently enabled.
    pub fn is_oracle_enabled(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::OracleEnabled)
            .unwrap_or(false)
    }

    /// Set the oracle heartbeat in seconds — the maximum age of a price feed
    /// before it is considered stale. Defaults to 3600 (1 hour).
    /// Only the Admin can call this.
    pub fn set_oracle_heartbeat(env: Env, seconds: u64) {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::OracleHeartbeat, &seconds);
    }

    /// Returns the current oracle heartbeat in seconds.
    pub fn oracle_heartbeat(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::OracleHeartbeat)
            .unwrap_or(crate::oracle::DEFAULT_HEARTBEAT_SECONDS)
    }

    /// Set the maximum strategy allocation cap.
    pub fn set_strategy_cap(env: Env, strategy: Address, cap: i128) {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::StrategyCap(strategy), &cap);
    }

    /// Set the strategy risk threshold in basis points (0–10000).
    pub fn set_strategy_risk_threshold(env: Env, strategy: Address, threshold: i128) {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();
        if !(0..=10_000).contains(&threshold) {
            panic!("threshold must be 0-10000");
        }
        env.storage()
            .instance()
            .set(&DataKey::StrategyRiskThreshold(strategy), &threshold);
    }

    /// Returns the per-strategy high-watermark used for performance-fee accounting.
    pub fn strategy_watermark(env: Env, strategy: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::StrategyWatermark(strategy))
            .unwrap_or(0)
    }

    pub fn report_benji_yield(env: Env, strategy: Address, amount: i128) {
        strategy.require_auth();
        if amount <= 0 {
            panic!("yield amount must be > 0");
        }

        let configured: Address = env
            .storage()
            .instance()
            .get(&DataKey::BenjiStrategy)
            .unwrap();
        if strategy != configured {
            panic!("unauthorized strategy");
        }

        let token_addr = Self::token(env.clone());
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&strategy, &env.current_contract_address(), &amount);

        let fee_bps: i128 = env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0);
        let (fee_amount, net_yield) = fee_math::calculate_protocol_fee(amount, fee_bps);
        if fee_amount > 0 {
            let treasury_bal: i128 = env
                .storage()
                .instance()
                .get(&DataKey::TreasuryBalance)
                .unwrap_or(0);
            env.storage().instance().set(
                &DataKey::TreasuryBalance,
                &treasury_bal.checked_add(fee_amount).expect("overflow"),
            );
        }
        let next_watermark = Self::strategy_watermark(env.clone(), strategy.clone())
            .checked_add(amount)
            .expect("overflow");
        Self::raise_strategy_watermark(&env, &strategy, next_watermark);

        let ta = env
            .storage()
            .instance()
            .get::<_, i128>(&DataKey::TotalAssets)
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::TotalAssets,
            &ta.checked_add(net_yield).expect("overflow"),
        );

        let mut state = Self::get_state(&env);
        state.total_assets = state.total_assets.checked_add(net_yield).expect("overflow");
        env.storage().instance().set(&DataKey::State, &state);
    }

    fn run_storage_migration(env: &Env, target_version: u32) -> Result<(), VaultError> {
        let current_version = get_storage_version(env);
        if target_version < current_version || target_version > STORAGE_VERSION {
            return Err(VaultError::InvalidMigrationTarget);
        }

        if current_version < 1 && !env.storage().instance().has(&DataKey::State) {
            let total_assets = env
                .storage()
                .instance()
                .get(&DataKey::TotalAssets)
                .unwrap_or(0);
            let total_shares = env
                .storage()
                .instance()
                .get(&DataKey::TotalShares)
                .unwrap_or(0);
            env.storage().instance().set(
                &DataKey::State,
                &VaultState {
                    total_shares,
                    total_assets,
                    is_paused: false,
                },
            );
        }

        set_storage_version(env, target_version);
        env.events().publish(
            (symbol_short!("migrate"),),
            (current_version, target_version),
        );
        Ok(())
    }

    fn raise_strategy_watermark(env: &Env, strategy: &Address, candidate: i128) {
        let current = Self::strategy_watermark(env.clone(), strategy.clone());
        if candidate > current {
            env.storage()
                .instance()
                .set(&DataKey::StrategyWatermark(strategy.clone()), &candidate);
            env.events().publish(
                (symbol_short!("strathwm"), strategy.clone()),
                (current, candidate),
            );
        }
    }

    fn insert_sorted_unique(env: &Env, ids: Vec<u64>, shipment_id: u64) -> Vec<u64> {
        let mut out = Vec::new(env);
        let mut inserted = false;
        let mut idx = 0;

        while idx < ids.len() {
            let current = ids.get(idx).unwrap();
            if current == shipment_id {
                return ids;
            }
            if !inserted && shipment_id < current {
                out.push_back(shipment_id);
                inserted = true;
            }
            out.push_back(current);
            idx += 1;
        }

        if !inserted {
            out.push_back(shipment_id);
        }

        out
    }

    fn remove_id(env: &Env, ids: Vec<u64>, target: u64) -> Vec<u64> {
        let mut out = Vec::new(env);
        let mut idx = 0;

        while idx < ids.len() {
            let current = ids.get(idx).unwrap();
            if current != target {
                out.push_back(current);
            }
            idx += 1;
        }

        out
    }

    fn index_after_cursor(ids: &Vec<u64>, cursor: Option<u64>) -> u32 {
        match cursor {
            None => 0,
            Some(value) => {
                let mut idx = 0;
                while idx < ids.len() {
                    if ids.get(idx).unwrap() > value {
                        return idx;
                    }
                    idx += 1;
                }
                ids.len()
            }
        }
    }
    /// Returns the registered storage key namespace catalog for operator audit.
    pub fn storage_key_registry(env: Env) -> storage_registry::ValidateRegistryResult {
        let keys = storage_registry::registered_vault_keys(&env);
        match storage_registry::validate_registry_no_collisions(&keys) {
            Ok(()) => storage_registry::ValidateRegistryResult { keys, valid: true },
            Err(_) => storage_registry::ValidateRegistryResult { keys, valid: false },
        }
    }

    /// Read-only: returns contract metadata such as version and simple config flags.
    pub fn metadata(env: Env) -> ContractMetadata {
        let state = Self::get_state(&env);
        let has_strategy = env
            .storage()
            .instance()
            .get::<_, Option<Address>>(&DataKey::Strategy)
            .is_some();
        ContractMetadata {
            version: String::from_str(&env, CONTRACT_VERSION),
            contract_paused: state.is_paused,
            has_strategy,
        }
    }
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractMetadata {
    pub version: soroban_sdk::String,
    pub contract_paused: bool,
    pub has_strategy: bool,
}
