//! Canonical on-chain error namespace for YieldVault.
//!
//! All user-facing failure paths must return [`VaultError`] rather than panicking.
//! Numeric codes are stable across contract versions; integrators should map them
//! via `docs/api/ERROR_CODE_CATALOG.md`.

use soroban_sdk::contracterror;

/// Core vault contract errors (codes 1–99).
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VaultError {
    // ── Core operations (1–24) ───────────────────────────────────────────────
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
    ///
    /// Note: also reused for "no pending record found for this identifier" in
    /// two other flows that don't warrant a dedicated code under the 50-case
    /// cap: `accept_admin`/`cancel_admin_rotation` with an unknown proposal id,
    /// and `execute_*_change`/`cancel_*_change` (sensitive-parameter timelock)
    /// with nothing currently queued.
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
    ///
    /// Note: also reused by `update_shipment_status` for an invalid RWA
    /// shipment lifecycle transition — both mean "the requested state
    /// transition target is invalid given the current state" — rather than
    /// spend a dedicated code under the 50-case cap.
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
    /// Admin parameter change attempted before the minimum interval elapsed.
    AdminParamChangeTooSoon = 22,
    /// No strategy has been configured on the vault.
    StrategyNotConfigured = 23,
    /// Vault does not have enough idle liquidity to satisfy the operation.
    InsufficientLiquidity = 24,

    // ── Governance (25–26, 30–36) ────────────────────────────────────────────
    /// Governance signers are not configured.
    GovernanceSignersNotConfigured = 25,
    /// Governance signature threshold was not met.
    GovernanceThresholdNotMet = 26,
    /// DAO or admin threshold must be greater than zero.
    InvalidDaoThreshold = 30,
    /// Governance signer threshold is outside the valid range.
    InvalidGovernanceThreshold = 31,
    /// Vote weight must be greater than zero.
    InvalidVoteWeight = 32,
    /// Voter has already cast a ballot on this proposal.
    DuplicateVote = 33,
    /// Proposal has already been executed.
    ProposalAlreadyExecuted = 34,
    /// Proposal has not reached the required quorum.
    QuorumNotReached = 35,
    /// Proposal was rejected (no votes exceed against votes).
    ProposalRejected = 36,

    // ── Oracle / treasury / strategy health (27–29, 37) ──────────────────────
    /// Oracle validation failed: expired heartbeat, invalid price data (zero,
    /// negative, future timestamp, unsafe decimals/overflow), excessive
    /// deviation from the last validated price, or an out-of-range
    /// `set_oracle_heartbeat` configuration. See [`crate::oracle`] for the
    /// full stale-data policy. Reused across all of `oracle::OracleError`'s
    /// variants rather than spending a dedicated code per variant under the
    /// 50-case cap.
    OracleValidationFailed = 27,
    /// Treasury claim quota exceeded for the current epoch.
    ClaimQuotaExceeded = 28,
    /// Strategy heartbeat expired; allocation operations are blocked.
    StrategyHeartbeatExpired = 29,
    /// Caller is not the configured or whitelisted strategy.
    UnauthorizedStrategy = 37,

    // ── Admin configuration (38–42) ────────────────────────────────────────
    /// Protocol fee basis points are outside 0–10000.
    InvalidFeeBps = 38,
    /// No protocol fees are available to claim.
    NoFeesToClaim = 39,
    /// Minimum deposit parameter is negative.
    InvalidMinDeposit = 40,
    /// Minimum liquidity buffer parameter is negative.
    InvalidLiquidityBuffer = 41,
    /// Risk threshold basis points are outside 0–10000.
    InvalidRiskThreshold = 42,

    // ── Whitelist / strategy registration (43–45) ────────────────────────────
    /// Strategy address is not on the whitelist.
    StrategyNotWhitelisted = 43,
    /// Whitelist mutation failed.
    WhitelistOperationFailed = 44,
    /// Accrued yield amount must be greater than zero.
    InvalidYieldAmount = 45,

    // ── RWA / pagination / batch limits (46–48) ──────────────────────────────
    /// Shipment identifier already exists.
    ShipmentAlreadyExists = 46,
    /// Page size must be greater than zero.
    InvalidPageSize = 47,
    /// Maximum batch size must be greater than zero.
    InvalidMaxBatchSize = 48,

    // ── Guard rails (49) ───────────────────────────────────────────────────
    /// Opposing deposit/withdraw action in the same ledger is not allowed.
    RapidAction = 49,

    // ── Emergency rescue (50) ────────────────────────────────────────────────
    /// Emergency rescue is not permitted: the caller is not an emergency
    /// approver, the destination is the vault itself, or the asset backs user
    /// deposits and is therefore never rescuable.
    ///
    /// Note: the Soroban error-enum spec caps this enum at 50 cases, so the
    /// rescue flow reuses [`VaultError::GovernanceSignersNotConfigured`] for a
    /// missing or non-distinct approver pair and [`VaultError::InvalidAmount`]
    /// for a non-positive amount rather than defining dedicated codes.
    RescueUnauthorized = 50,

    // ── Performance fee switch (51–53) ─────────────────────────────────────
    /// Performance fee basis points are outside 0–10000.
    InvalidPerformanceFeeBps = 51,
    /// Performance incentive pool address is not configured.
    PerformanceIncentivePoolNotConfigured = 52,
    /// Performance fee switch is in an invalid state for the requested operation.
    InvalidPerformanceFeeSwitchState = 53,
}
