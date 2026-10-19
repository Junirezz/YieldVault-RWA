#![no_std]
//! # Bridge Compatibility Layer
//!
//! A generic compatibility layer for cross-chain USDC transfers via
//! bridge providers (Wormhole, LayerZero, etc.) on Stellar/Soroban.
//!
//! ## Overview
//!
//! This contract provides:
//! - A unified interface for multiple bridge providers
//! - Fallback handling when a primary bridge fails
//! - Admin-controlled bridge provider registration
//! - Transfer tracking with nonces for reconciliation
//! - Fee estimation per bridge provider
//!
//! ## Architecture
//!
//! ```text
//! User -> BridgeCompat -> BridgeProvider -> Destination Chain
//!                  \-> FallbackProvider (on failure)
//! ```
//!
//! ## Security Model
//! - Admin-only provider registration and configuration
//! - Transfer limits per transaction and per epoch
//! - Nonce-based replay protection
//! - Graceful degradation on provider failures

use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, symbol_short, Address,
    Bytes, Env, String, Vec,
};

// ── Error types ────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum BridgeError {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    ProviderNotFound = 3,
    ProviderAlreadyRegistered = 4,
    TransferLimitExceeded = 5,
    TransferFailed = 6,
    InsufficientBalance = 7,
    InvalidAmount = 8,
    TransferInFlight = 9,
    NonceAlreadyUsed = 10,
    NoFallbackAvailable = 11,
    ProviderDisabled = 12,
    TimelockNotReady = 13,
    NoPendingRemoval = 14,
    ArithmeticOverflow = 15,
    InvalidLimits = 16,
}

// ── Bridge endpoint interface ──────────────────────────────────────────────

/// Interface every bridge provider endpoint contract must expose.
///
/// The bridge layer keeps custody of the locked tokens (so failed transfers
/// can be refunded) and notifies the endpoint to relay the message. Any
/// error or panic from `send` is treated as a provider failure and the
/// transfer is routed to the next eligible provider.
#[contractclient(name = "BridgeEndpointClient")]
pub trait BridgeEndpoint {
    fn send(
        env: Env,
        transfer_id: u64,
        token: Address,
        amount: i128,
        dest_chain: u32,
        recipient: Bytes,
    );
}

// ── Types ──────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BridgeProviderKind {
    Wormhole,
    LayerZero,
    Custom,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BridgeProvider {
    /// Unique identifier for this provider.
    pub id: u32,
    /// Human-readable name.
    pub name: String,
    /// The kind of bridge provider.
    pub kind: BridgeProviderKind,
    /// Contract address of the bridge endpoint on Stellar.
    pub endpoint: Address,
    /// Whether this provider is currently active.
    pub enabled: bool,
    /// Fee in basis points for transfers through this provider.
    pub fee_bps: i128,
    /// Maximum transfer amount per transaction.
    pub max_transfer: i128,
    /// Supported destination chain identifiers.
    pub supported_chains: Vec<u32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TransferStatus {
    Pending,
    InFlight,
    Completed,
    Failed,
    Refunded,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BridgeTransfer {
    /// Unique transfer identifier.
    pub transfer_id: u64,
    /// Sender address on Stellar.
    pub sender: Address,
    /// Recipient address on the destination chain (encoded as bytes).
    pub recipient: Bytes,
    /// Amount of USDC to transfer.
    pub amount: i128,
    /// Source chain (Stellar = 0).
    pub source_chain: u32,
    /// Destination chain identifier.
    pub dest_chain: u32,
    /// Provider used for this transfer.
    pub provider_id: u32,
    /// Current status.
    pub status: TransferStatus,
    /// Timestamp of creation.
    pub created_at: u64,
    /// Timestamp of completion (0 if not yet completed).
    pub completed_at: u64,
    /// Nonce for replay protection.
    pub nonce: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransferLimits {
    /// Maximum amount per single transfer.
    pub per_transfer_limit: i128,
    /// Maximum total volume per epoch (in seconds).
    pub epoch_volume_limit: i128,
    /// Epoch duration in seconds.
    pub epoch_duration: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransferEstimate {
    /// Provider ID used.
    pub provider_id: u32,
    /// Amount the recipient will receive (after fees).
    pub receive_amount: i128,
    /// Fee charged by the bridge.
    pub fee_amount: i128,
    /// Estimated time to complete in seconds.
    pub estimated_seconds: u64,
}

// ── Storage keys ───────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum DataKey {
    Admin,
    TokenAsset,
    ProviderNonce,
    Provider(u32),
    Transfer(u64),
    TransferNonce,
    UserTransferCount(Address),
    EpochVolume,
    EpochStart,
    EpochAccounting,
    Limits,
    DefaultProvider,
    TransferNonceFor(Address, u32),
    MinTransfer,
    PendingRemoval(u32),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
struct EpochAccounting {
    start: u64,
    volume: i128,
}

// ── Constants ──────────────────────────────────────────────────────────────

const STELLAR_CHAIN_ID: u32 = 0;
const BPS_DENOMINATOR: i128 = 10_000;
const STORAGE_TTL_THRESHOLD: u32 = 10_000;
const STORAGE_TTL_EXTENSION: u32 = 100_000;
/// Default minimum transfer amount when none is configured.
const DEFAULT_MIN_TRANSFER: i128 = 1;
/// Delay between queueing and executing a provider removal.
pub const PROVIDER_REMOVAL_DELAY: u64 = 86_400;

// ── Contract ───────────────────────────────────────────────────────────────

#[contract]
pub struct BridgeCompat;

#[contractimpl]
impl BridgeCompat {
    /// Initialize the bridge compatibility layer.
    ///
    /// # Parameters
    /// * `admin` - Address with administrative control.
    /// * `token` - Address of the USDC (or other) token contract.
    pub fn initialize(env: Env, admin: Address, token: Address) -> Result<(), BridgeError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(BridgeError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TokenAsset, &token);
        env.storage().instance().set(&DataKey::ProviderNonce, &0u32);
        env.storage().instance().set(&DataKey::TransferNonce, &0u64);
        env.storage().instance().set(
            &DataKey::Limits,
            &TransferLimits {
                per_transfer_limit: 1_000_000_000_000,  // 1M USDC (6 decimals)
                epoch_volume_limit: 10_000_000_000_000, // 10M USDC per epoch
                epoch_duration: 86_400,                 // 24 hours
            },
        );
        Ok(())
    }

    /// Returns the admin address.
    pub fn admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Admin)
    }

    /// Returns the token address.
    pub fn token(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::TokenAsset)
    }

    // ── Provider management ────────────────────────────────────────────────

    /// Register a new bridge provider. Admin-only.
    ///
    /// Returns the assigned provider ID.
    pub fn register_provider(
        env: Env,
        name: String,
        kind: BridgeProviderKind,
        endpoint: Address,
        fee_bps: i128,
        max_transfer: i128,
        supported_chains: Vec<u32>,
    ) -> Result<u32, BridgeError> {
        let admin = Self::require_admin(&env)?;

        if !(0..=BPS_DENOMINATOR).contains(&fee_bps) {
            return Err(BridgeError::InvalidAmount);
        }
        // Bound max_transfer so fee math (amount * fee_bps) cannot overflow.
        if max_transfer <= 0 || max_transfer > i128::MAX / BPS_DENOMINATOR {
            return Err(BridgeError::InvalidLimits);
        }

        let provider_id = env
            .storage()
            .instance()
            .get::<_, u32>(&DataKey::ProviderNonce)
            .unwrap_or(0)
            .checked_add(1)
            .ok_or(BridgeError::ArithmeticOverflow)?;

        let provider = BridgeProvider {
            id: provider_id,
            name: name.clone(),
            kind: kind.clone(),
            endpoint: endpoint.clone(),
            enabled: true,
            fee_bps,
            max_transfer,
            supported_chains,
        };

        Self::set_provider(&env, provider_id, &provider);
        env.storage()
            .instance()
            .set(&DataKey::ProviderNonce, &provider_id);

        // Set as default if first provider
        let has_default = env.storage().instance().has(&DataKey::DefaultProvider);
        if !has_default {
            env.storage()
                .instance()
                .set(&DataKey::DefaultProvider, &provider_id);
        }

        env.events().publish(
            (symbol_short!("brgadd"), admin),
            (provider_id, name, kind as u32),
        );

        Ok(provider_id)
    }

    /// Enable or disable a bridge provider. Admin-only.
    pub fn set_provider_enabled(
        env: Env,
        provider_id: u32,
        enabled: bool,
    ) -> Result<(), BridgeError> {
        Self::require_admin(&env)?;
        let mut provider = Self::get_provider(&env, provider_id)?;
        provider.enabled = enabled;
        Self::set_provider(&env, provider_id, &provider);
        env.events()
            .publish((symbol_short!("brgtog"),), (provider_id, enabled));
        Ok(())
    }

    /// Update a provider's fee. Admin-only.
    pub fn set_provider_fee(env: Env, provider_id: u32, fee_bps: i128) -> Result<(), BridgeError> {
        Self::require_admin(&env)?;
        if !(0..=BPS_DENOMINATOR).contains(&fee_bps) {
            return Err(BridgeError::InvalidAmount);
        }
        let mut provider = Self::get_provider(&env, provider_id)?;
        provider.fee_bps = fee_bps;
        Self::set_provider(&env, provider_id, &provider);
        Ok(())
    }

    /// Set the default provider. Admin-only.
    pub fn set_default_provider(env: Env, provider_id: u32) -> Result<(), BridgeError> {
        Self::require_admin(&env)?;
        let _ = Self::get_provider(&env, provider_id)?; // validate exists
        env.storage()
            .instance()
            .set(&DataKey::DefaultProvider, &provider_id);
        env.events()
            .publish((symbol_short!("brgdef"),), (provider_id,));
        Ok(())
    }

    /// Queue removal of a provider. Admin-only; executable after
    /// [`PROVIDER_REMOVAL_DELAY`]. Returns the earliest execution time.
    pub fn queue_unregister_provider(env: Env, provider_id: u32) -> Result<u64, BridgeError> {
        Self::require_admin(&env)?;
        let _ = Self::get_provider(&env, provider_id)?; // validate exists
        let eta = env
            .ledger()
            .timestamp()
            .checked_add(PROVIDER_REMOVAL_DELAY)
            .ok_or(BridgeError::InvalidAmount)?;
        env.storage()
            .instance()
            .set(&DataKey::PendingRemoval(provider_id), &eta);
        env.events()
            .publish((symbol_short!("brgrmq"),), (provider_id, eta));
        Ok(eta)
    }

    /// Cancel a queued provider removal. Admin-only.
    pub fn cancel_unregister_provider(env: Env, provider_id: u32) -> Result<(), BridgeError> {
        Self::require_admin(&env)?;
        let key = DataKey::PendingRemoval(provider_id);
        if !env.storage().instance().has(&key) {
            return Err(BridgeError::NoPendingRemoval);
        }
        env.storage().instance().remove(&key);
        env.events()
            .publish((symbol_short!("brgrmc"),), (provider_id,));
        Ok(())
    }

    /// Remove a provider once its queued removal timelock has elapsed.
    /// Admin-only. Clears the default provider if it pointed at this one.
    pub fn unregister_provider(env: Env, provider_id: u32) -> Result<(), BridgeError> {
        Self::require_admin(&env)?;
        let pending_key = DataKey::PendingRemoval(provider_id);
        let eta: u64 = env
            .storage()
            .instance()
            .get(&pending_key)
            .ok_or(BridgeError::NoPendingRemoval)?;
        if env.ledger().timestamp() < eta {
            return Err(BridgeError::TimelockNotReady);
        }
        let _ = Self::get_provider(&env, provider_id)?;

        let key = DataKey::Provider(provider_id);
        env.storage().persistent().remove(&key);
        env.storage().instance().remove(&pending_key);
        if Self::default_provider(env.clone()) == Some(provider_id) {
            env.storage().instance().remove(&DataKey::DefaultProvider);
        }
        env.events()
            .publish((symbol_short!("brgrm"),), (provider_id,));
        Ok(())
    }

    /// Returns the earliest execution time of a queued provider removal.
    pub fn pending_unregister(env: Env, provider_id: u32) -> Option<u64> {
        env.storage()
            .instance()
            .get(&DataKey::PendingRemoval(provider_id))
    }

    /// Returns a provider by ID.
    pub fn provider(env: Env, provider_id: u32) -> Option<BridgeProvider> {
        Self::get_provider(&env, provider_id).ok()
    }

    /// Returns the default provider ID.
    pub fn default_provider(env: Env) -> Option<u32> {
        env.storage().instance().get(&DataKey::DefaultProvider)
    }

    /// Returns the total number of registered providers.
    pub fn provider_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get::<_, u32>(&DataKey::ProviderNonce)
            .unwrap_or(0)
    }

    // ── Transfer limits ────────────────────────────────────────────────────

    /// Update transfer limits. Admin-only.
    pub fn set_transfer_limits(env: Env, limits: TransferLimits) -> Result<(), BridgeError> {
        Self::require_admin(&env)?;
        if limits.per_transfer_limit <= 0
            || limits.epoch_volume_limit <= 0
            || limits.per_transfer_limit > limits.epoch_volume_limit
            || limits.epoch_duration == 0
        {
            return Err(BridgeError::InvalidLimits);
        }
        env.storage().instance().set(&DataKey::Limits, &limits);
        Ok(())
    }

    /// Set the minimum amount accepted by `transfer_out` / `estimate_transfer`.
    /// Admin-only; must be positive.
    pub fn set_min_transfer(env: Env, min_transfer: i128) -> Result<(), BridgeError> {
        Self::require_admin(&env)?;
        if min_transfer <= 0 {
            return Err(BridgeError::InvalidAmount);
        }
        env.storage()
            .instance()
            .set(&DataKey::MinTransfer, &min_transfer);
        Ok(())
    }

    /// Returns the minimum transfer amount.
    pub fn min_transfer(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::MinTransfer)
            .unwrap_or(DEFAULT_MIN_TRANSFER)
    }

    /// Returns the current transfer limits.
    pub fn transfer_limits(env: Env) -> TransferLimits {
        env.storage()
            .instance()
            .get(&DataKey::Limits)
            .unwrap_or(TransferLimits {
                per_transfer_limit: 1_000_000_000_000,
                epoch_volume_limit: 10_000_000_000_000,
                epoch_duration: 86_400,
            })
    }

    // ── Transfer operations ────────────────────────────────────────────────

    /// Estimate the fee and received amount for a transfer.
    pub fn estimate_transfer(
        env: Env,
        amount: i128,
        dest_chain: u32,
        provider_id: Option<u32>,
    ) -> Result<TransferEstimate, BridgeError> {
        let pid = provider_id
            .or_else(|| env.storage().instance().get(&DataKey::DefaultProvider))
            .ok_or(BridgeError::ProviderNotFound)?;
        let provider = Self::get_provider(&env, pid)?;

        if !provider.enabled {
            return Err(BridgeError::ProviderDisabled);
        }
        if !provider.supported_chains.contains(dest_chain) {
            return Err(BridgeError::ProviderNotFound);
        }
        Self::check_amount_bounds(&env, &provider, amount)?;

        let fee_amount = amount
            .checked_mul(provider.fee_bps)
            .ok_or(BridgeError::ArithmeticOverflow)?
            / BPS_DENOMINATOR;
        let receive_amount = amount
            .checked_sub(fee_amount)
            .ok_or(BridgeError::ArithmeticOverflow)?;

        Ok(TransferEstimate {
            provider_id: pid,
            receive_amount,
            fee_amount,
            estimated_seconds: 1800, // default 30 min estimate
        })
    }

    /// Initiate a cross-chain USDC transfer.
    ///
    /// Pulls USDC from the sender into this contract's custody, then invokes
    /// the selected provider's [`BridgeEndpoint::send`]. If the primary
    /// endpoint fails, the transfer is routed to the next enabled provider
    /// (ascending ID) that supports `dest_chain`; if none succeeds the call
    /// reverts with [`BridgeError::NoFallbackAvailable`]. The recorded
    /// transfer carries the provider that actually accepted it.
    pub fn transfer_out(
        env: Env,
        sender: Address,
        recipient: Bytes,
        amount: i128,
        dest_chain: u32,
        provider_id: Option<u32>,
    ) -> Result<u64, BridgeError> {
        sender.require_auth();

        let pid = provider_id
            .or_else(|| env.storage().instance().get(&DataKey::DefaultProvider))
            .ok_or(BridgeError::ProviderNotFound)?;
        let provider = Self::get_provider(&env, pid)?;

        if !provider.enabled {
            return Err(BridgeError::ProviderDisabled);
        }
        if !provider.supported_chains.contains(dest_chain) {
            return Err(BridgeError::ProviderNotFound);
        }
        Self::check_amount_bounds(&env, &provider, amount)?;

        // Check per-transfer limit
        let limits: TransferLimits =
            env.storage()
                .instance()
                .get(&DataKey::Limits)
                .unwrap_or(TransferLimits {
                    per_transfer_limit: 1_000_000_000_000,
                    epoch_volume_limit: 10_000_000_000_000,
                    epoch_duration: 86_400,
                });
        if amount > limits.per_transfer_limit {
            return Err(BridgeError::TransferLimitExceeded);
        }

        // Check epoch volume
        Self::check_epoch_volume(&env, amount, &limits)?;

        // Check the sender can fund the transfer
        let token_addr: Address = env.storage().instance().get(&DataKey::TokenAsset).unwrap();
        let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
        let balance = token_client.balance(&sender);
        if balance < amount {
            return Err(BridgeError::InsufficientBalance);
        }

        // Lock the sender's tokens before routing; any failure below reverts it.
        token_client.transfer(&sender, &env.current_contract_address(), &amount);

        // Primary first, then every other eligible provider as fallback.
        let mut routed: Option<(u32, u64, u64)> = None;
        let (nonce, transfer_id) = Self::next_transfer_id(&env, &sender, pid)?;
        if Self::call_endpoint(
            &env,
            &provider,
            transfer_id,
            &token_addr,
            amount,
            dest_chain,
            &recipient,
        ) {
            routed = Some((pid, nonce, transfer_id));
        } else {
            for fallback_id in 1..=Self::provider_count(env.clone()) {
                if fallback_id == pid {
                    continue;
                }
                let fallback = match Self::get_provider(&env, fallback_id) {
                    Ok(p) if p.enabled && p.supported_chains.contains(dest_chain) => p,
                    _ => continue,
                };
                let (nonce, transfer_id) = Self::next_transfer_id(&env, &sender, fallback_id)?;
                if Self::call_endpoint(
                    &env,
                    &fallback,
                    transfer_id,
                    &token_addr,
                    amount,
                    dest_chain,
                    &recipient,
                ) {
                    env.events()
                        .publish((symbol_short!("brgfbk"),), (pid, fallback_id, transfer_id));
                    routed = Some((fallback_id, nonce, transfer_id));
                    break;
                }
            }
        }
        let (used_pid, nonce, transfer_id) = routed.ok_or(BridgeError::NoFallbackAvailable)?;

        let transfer = BridgeTransfer {
            transfer_id,
            sender: sender.clone(),
            recipient: recipient.clone(),
            amount,
            source_chain: STELLAR_CHAIN_ID,
            dest_chain,
            provider_id: used_pid,
            status: TransferStatus::InFlight,
            created_at: env.ledger().timestamp(),
            completed_at: 0,
            nonce,
        };

        env.storage()
            .instance()
            .set(&DataKey::Transfer(transfer_id), &transfer);
        env.storage()
            .instance()
            .set(&DataKey::TransferNonceFor(sender.clone(), used_pid), &nonce);

        // Update user transfer count
        let user_count: i128 = env
            .storage()
            .instance()
            .get(&DataKey::UserTransferCount(sender.clone()))
            .unwrap_or(0);
        let new_user_count = user_count
            .checked_add(1)
            .ok_or(BridgeError::ArithmeticOverflow)?;
        env.storage()
            .instance()
            .set(&DataKey::UserTransferCount(sender.clone()), &new_user_count);

        env.events().publish(
            (symbol_short!("brgout"), sender.clone()),
            (transfer_id, amount, dest_chain, used_pid),
        );

        Ok(transfer_id)
    }

    /// Mark a transfer as completed (called by bridge relayer or admin).
    ///
    /// In production, this would be triggered by a bridge event listener.
    /// For testnet, admin can manually confirm transfers.
    pub fn confirm_transfer(env: Env, transfer_id: u64) -> Result<(), BridgeError> {
        Self::require_admin(&env)?;

        let mut transfer: BridgeTransfer = env
            .storage()
            .instance()
            .get(&DataKey::Transfer(transfer_id))
            .ok_or(BridgeError::TransferFailed)?;

        if transfer.status != TransferStatus::InFlight {
            return Err(BridgeError::TransferInFlight);
        }

        transfer.status = TransferStatus::Completed;
        transfer.completed_at = env.ledger().timestamp();

        env.storage()
            .instance()
            .set(&DataKey::Transfer(transfer_id), &transfer);

        env.events()
            .publish((symbol_short!("brgdone"),), (transfer_id, transfer.amount));

        Ok(())
    }

    /// Mark a transfer as failed and refund the sender.
    ///
    /// If a transfer fails (e.g., bridge timeout), the tokens are returned
    /// to the sender. Admin-only in testnet; production would use oracle.
    pub fn fail_transfer(env: Env, transfer_id: u64) -> Result<(), BridgeError> {
        Self::require_admin(&env)?;

        let mut transfer: BridgeTransfer = env
            .storage()
            .instance()
            .get(&DataKey::Transfer(transfer_id))
            .ok_or(BridgeError::TransferFailed)?;

        if transfer.status != TransferStatus::InFlight {
            return Err(BridgeError::TransferInFlight);
        }

        // Refund the sender
        let token_addr: Address = env.storage().instance().get(&DataKey::TokenAsset).unwrap();
        let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
        token_client.transfer(
            &env.current_contract_address(),
            &transfer.sender,
            &transfer.amount,
        );

        transfer.status = TransferStatus::Refunded;
        transfer.completed_at = env.ledger().timestamp();

        env.storage()
            .instance()
            .set(&DataKey::Transfer(transfer_id), &transfer);

        env.events().publish(
            (symbol_short!("brgfail"), transfer.sender.clone()),
            (transfer_id, transfer.amount),
        );

        Ok(())
    }

    /// Returns a transfer record by ID.
    pub fn transfer(env: Env, transfer_id: u64) -> Option<BridgeTransfer> {
        env.storage()
            .instance()
            .get(&DataKey::Transfer(transfer_id))
    }

    /// Returns the number of transfers initiated by a user.
    pub fn user_transfer_count(env: Env, user: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::UserTransferCount(user))
            .unwrap_or(0)
    }

    // ── Internal helpers ───────────────────────────────────────────────────

    fn require_admin(env: &Env) -> Result<Address, BridgeError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(BridgeError::Unauthorized)?;
        admin.require_auth();
        Ok(admin)
    }

    /// Enforces `min_transfer <= amount <= provider.max_transfer`.
    fn check_amount_bounds(
        env: &Env,
        provider: &BridgeProvider,
        amount: i128,
    ) -> Result<(), BridgeError> {
        let min_transfer = Self::min_transfer(env.clone());
        if amount < min_transfer || amount > provider.max_transfer {
            return Err(BridgeError::InvalidAmount);
        }
        Ok(())
    }

    fn get_provider(env: &Env, provider_id: u32) -> Result<BridgeProvider, BridgeError> {
        let key = DataKey::Provider(provider_id);
        if let Some(provider) = env.storage().persistent().get(&key) {
            env.storage().persistent().extend_ttl(
                &key,
                STORAGE_TTL_THRESHOLD,
                STORAGE_TTL_EXTENSION,
            );
            return Ok(provider);
        }

        // Migrate providers created by earlier releases out of instance storage.
        let provider: BridgeProvider = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(BridgeError::ProviderNotFound)?;
        Self::set_provider(env, provider_id, &provider);
        env.storage().instance().remove(&key);
        Ok(provider)
    }

    fn set_provider(env: &Env, provider_id: u32, provider: &BridgeProvider) {
        let key = DataKey::Provider(provider_id);
        env.storage().persistent().set(&key, provider);
        env.storage()
            .persistent()
            .extend_ttl(&key, STORAGE_TTL_THRESHOLD, STORAGE_TTL_EXTENSION);
    }

    /// Next unused (nonce, transfer_id) for the sender/provider domain.
    fn next_transfer_id(
        env: &Env,
        sender: &Address,
        provider_id: u32,
    ) -> Result<(u64, u64), BridgeError> {
        // Nonces are monotonic within a sender/provider domain. Transfer IDs
        // additionally bind that nonce to both identities so they cannot be
        // confused with replay nonces or reused across providers.
        let nonce = env
            .storage()
            .instance()
            .get::<_, u64>(&DataKey::TransferNonceFor(sender.clone(), provider_id))
            .unwrap_or(0)
            .checked_add(1)
            .ok_or(BridgeError::NonceAlreadyUsed)?;
        let transfer_id = Self::derive_transfer_id(env, sender, nonce, provider_id);
        if env
            .storage()
            .instance()
            .has(&DataKey::Transfer(transfer_id))
        {
            return Err(BridgeError::NonceAlreadyUsed);
        }
        Ok((nonce, transfer_id))
    }

    /// Invoke the provider endpoint; `false` on any error or panic.
    fn call_endpoint(
        env: &Env,
        provider: &BridgeProvider,
        transfer_id: u64,
        token: &Address,
        amount: i128,
        dest_chain: u32,
        recipient: &Bytes,
    ) -> bool {
        BridgeEndpointClient::new(env, &provider.endpoint)
            .try_send(&transfer_id, token, &amount, &dest_chain, recipient)
            .is_ok()
    }

    fn derive_transfer_id(env: &Env, sender: &Address, nonce: u64, provider_id: u32) -> u64 {
        let mut payload = sender.to_xdr(env);
        payload.append(&nonce.to_xdr(env));
        payload.append(&provider_id.to_xdr(env));
        let digest = env.crypto().sha256(&payload).to_array();
        u64::from_be_bytes([
            digest[0], digest[1], digest[2], digest[3], digest[4], digest[5], digest[6], digest[7],
        ])
    }

    fn check_epoch_volume(
        env: &Env,
        amount: i128,
        limits: &TransferLimits,
    ) -> Result<(), BridgeError> {
        let now = env.ledger().timestamp();
        let persistent = env.storage().persistent();
        let accounting_key = DataKey::EpochAccounting;
        let mut accounting: EpochAccounting =
            if let Some(accounting) = persistent.get(&accounting_key) {
                accounting
            } else {
                let instance = env.storage().instance();
                let legacy_start: Option<u64> = instance.get(&DataKey::EpochStart);
                let legacy_volume: Option<i128> = instance.get(&DataKey::EpochVolume);
                if legacy_start.is_some() {
                    instance.remove(&DataKey::EpochStart);
                }
                if legacy_volume.is_some() {
                    instance.remove(&DataKey::EpochVolume);
                }
                EpochAccounting {
                    start: legacy_start.unwrap_or(0),
                    volume: legacy_volume.unwrap_or(0),
                }
            };

        // Reset epoch if expired
        let epoch_end = accounting
            .start
            .checked_add(limits.epoch_duration)
            .ok_or(BridgeError::ArithmeticOverflow)?;
        if now >= epoch_end {
            accounting.volume = 0;
            accounting.start = now;
        }

        let new_volume = accounting
            .volume
            .checked_add(amount)
            .ok_or(BridgeError::TransferLimitExceeded)?;
        if new_volume > limits.epoch_volume_limit {
            return Err(BridgeError::TransferLimitExceeded);
        }

        accounting.volume = new_volume;
        persistent.set(&accounting_key, &accounting);
        persistent.extend_ttl(
            &accounting_key,
            STORAGE_TTL_THRESHOLD,
            STORAGE_TTL_EXTENSION,
        );
        Ok(())
    }
}

#[cfg(test)]
mod test;
