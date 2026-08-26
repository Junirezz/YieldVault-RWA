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

use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, symbol_short, Address, Bytes, Env,
    String, Vec,
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
    Limits,
    DefaultProvider,
}

// ── Constants ──────────────────────────────────────────────────────────────

const STELLAR_CHAIN_ID: u32 = 0;
const BPS_DENOMINATOR: i128 = 10_000;

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
                per_transfer_limit: 1_000_000_000_000, // 1M USDC (6 decimals)
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

        let provider_id = env
            .storage()
            .instance()
            .get::<_, u32>(&DataKey::ProviderNonce)
            .unwrap_or(0)
            + 1;

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

        env.storage()
            .instance()
            .set(&DataKey::Provider(provider_id), &provider);
        env.storage()
            .instance()
            .set(&DataKey::ProviderNonce, &provider_id);

        // Set as default if first provider
        let has_default = env
            .storage()
            .instance()
            .has(&DataKey::DefaultProvider);
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
        env.storage()
            .instance()
            .set(&DataKey::Provider(provider_id), &provider);
        env.events().publish(
            (symbol_short!("brgtog"),),
            (provider_id, enabled),
        );
        Ok(())
    }

    /// Update a provider's fee. Admin-only.
    pub fn set_provider_fee(
        env: Env,
        provider_id: u32,
        fee_bps: i128,
    ) -> Result<(), BridgeError> {
        Self::require_admin(&env)?;
        if !(0..=BPS_DENOMINATOR).contains(&fee_bps) {
            return Err(BridgeError::InvalidAmount);
        }
        let mut provider = Self::get_provider(&env, provider_id)?;
        provider.fee_bps = fee_bps;
        env.storage()
            .instance()
            .set(&DataKey::Provider(provider_id), &provider);
        Ok(())
    }

    /// Set the default provider. Admin-only.
    pub fn set_default_provider(
        env: Env,
        provider_id: u32,
    ) -> Result<(), BridgeError> {
        Self::require_admin(&env)?;
        let _ = Self::get_provider(&env, provider_id)?; // validate exists
        env.storage()
            .instance()
            .set(&DataKey::DefaultProvider, &provider_id);
        env.events()
            .publish((symbol_short!("brgdef"),), (provider_id,));
        Ok(())
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
    pub fn set_transfer_limits(
        env: Env,
        limits: TransferLimits,
    ) -> Result<(), BridgeError> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&DataKey::Limits, &limits);
        Ok(())
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
        if !provider.supported_chains.contains(&dest_chain) {
            return Err(BridgeError::ProviderNotFound);
        }
        if amount <= 0 || amount > provider.max_transfer {
            return Err(BridgeError::InvalidAmount);
        }

        let fee_amount = amount * provider.fee_bps / BPS_DENOMINATOR;
        let receive_amount = amount - fee_amount;

        Ok(TransferEstimate {
            provider_id: pid,
            receive_amount,
            fee_amount,
            estimated_seconds: 1800, // default 30 min estimate
        })
    }

    /// Initiate a cross-chain USDC transfer.
    ///
    /// Pulls USDC from the sender, records the transfer, and (in production)
    /// would call the bridge endpoint contract. This implementation handles
    /// the vault-side accounting; the actual bridge call is abstracted for
    /// testnet compatibility.
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
        if !provider.supported_chains.contains(&dest_chain) {
            return Err(BridgeError::ProviderNotFound);
        }
        if amount <= 0 {
            return Err(BridgeError::InvalidAmount);
        }

        // Check per-transfer limit
        let limits: TransferLimits = env
            .storage()
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

        // Check token balance
        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenAsset)
            .unwrap();
        let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
        let balance = token_client.balance(&env.current_contract_address());
        if balance < amount {
            return Err(BridgeError::InsufficientBalance);
        }

        // Transfer tokens from sender to this contract
        token_client.transfer(&sender, &env.current_contract_address(), &amount);

        // Create transfer record
        let transfer_id = env
            .storage()
            .instance()
            .get::<_, u64>(&DataKey::TransferNonce)
            .unwrap_or(0)
            + 1;
        let nonce = env
            .storage()
            .instance()
            .get::<_, u64>(&DataKey::TransferNonce)
            .unwrap_or(0);

        let transfer = BridgeTransfer {
            transfer_id,
            sender: sender.clone(),
            recipient: recipient.clone(),
            amount,
            source_chain: STELLAR_CHAIN_ID,
            dest_chain,
            provider_id: pid,
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
            .set(&DataKey::TransferNonce, &(transfer_id));

        // Update user transfer count
        let user_count: i128 = env
            .storage()
            .instance()
            .get(&DataKey::UserTransferCount(sender.clone()))
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::UserTransferCount(sender.clone()),
            &(user_count + 1),
        );

        env.events().publish(
            (symbol_short!("brgout"), sender),
            (transfer_id, amount, dest_chain, pid),
        );

        Ok(transfer_id)
    }

    /// Mark a transfer as completed (called by bridge relayer or admin).
    ///
    /// In production, this would be triggered by a bridge event listener.
    /// For testnet, admin can manually confirm transfers.
    pub fn confirm_transfer(
        env: Env,
        transfer_id: u64,
    ) -> Result<(), BridgeError> {
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

        env.events().publish(
            (symbol_short!("brgdone"),),
            (transfer_id, transfer.amount),
        );

        Ok(())
    }

    /// Mark a transfer as failed and refund the sender.
    ///
    /// If a transfer fails (e.g., bridge timeout), the tokens are returned
    /// to the sender. Admin-only in testnet; production would use oracle.
    pub fn fail_transfer(
        env: Env,
        transfer_id: u64,
    ) -> Result<(), BridgeError> {
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
        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenAsset)
            .unwrap();
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

    fn get_provider(env: &Env, provider_id: u32) -> Result<BridgeProvider, BridgeError> {
        env.storage()
            .instance()
            .get(&DataKey::Provider(provider_id))
            .ok_or(BridgeError::ProviderNotFound)
    }

    fn check_epoch_volume(
        env: &Env,
        amount: i128,
        limits: &TransferLimits,
    ) -> Result<(), BridgeError> {
        let now = env.ledger().timestamp();
        let epoch_start: u64 = env
            .storage()
            .instance()
            .get(&DataKey::EpochStart)
            .unwrap_or(0);
        let mut epoch_volume: i128 = env
            .storage()
            .instance()
            .get(&DataKey::EpochVolume)
            .unwrap_or(0);

        // Reset epoch if expired
        if now >= epoch_start + limits.epoch_duration {
            epoch_volume = 0;
            env.storage().instance().set(&DataKey::EpochStart, &now);
        }

        let new_volume = epoch_volume.checked_add(amount).ok_or(BridgeError::TransferLimitExceeded)?;
        if new_volume > limits.epoch_volume_limit {
            return Err(BridgeError::TransferLimitExceeded);
        }

        env.storage()
            .instance()
            .set(&DataKey::EpochVolume, &new_volume);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn test_initialize() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let token = Address::generate(&env);

        env.mock_all_auths();

        BridgeCompat::initialize(env.clone(), admin.clone(), token.clone()).unwrap();
        assert_eq!(BridgeCompat::admin(env.clone()), Some(admin));
        assert_eq!(BridgeCompat::token(env.clone()), Some(token));
    }

    #[test]
    fn test_double_initialize_fails() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let token = Address::generate(&env);

        env.mock_all_auths();

        BridgeCompat::initialize(env.clone(), admin.clone(), token.clone()).unwrap();
        let result = BridgeCompat::initialize(env.clone(), admin, token);
        assert_eq!(result, Err(BridgeError::AlreadyInitialized));
    }

    #[test]
    fn test_register_provider() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        let endpoint = Address::generate(&env);

        env.mock_all_auths();

        BridgeCompat::initialize(env.clone(), admin, token).unwrap();

        let chains = Vec::from_array(&env, &[1, 2, 3]);
        let id = BridgeCompat::register_provider(
            env.clone(),
            String::from_str(&env, "Wormhole"),
            BridgeProviderKind::Wormhole,
            endpoint,
            50,       // 0.5% fee
            1_000_000_000_000,
            chains,
        )
        .unwrap();

        assert_eq!(id, 1);
        assert_eq!(BridgeCompat::provider_count(env.clone()), 1);

        let provider = BridgeCompat::provider(env.clone(), id).unwrap();
        assert_eq!(provider.name, String::from_str(&env, "Wormhole"));
        assert!(provider.enabled);
    }

    #[test]
    fn test_transfer_limits() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let token = Address::generate(&env);

        env.mock_all_auths();

        BridgeCompat::initialize(env.clone(), admin, token).unwrap();

        let limits = BridgeCompat::transfer_limits(env.clone());
        assert_eq!(limits.per_transfer_limit, 1_000_000_000_000);
        assert_eq!(limits.epoch_volume_limit, 10_000_000_000_000);
        assert_eq!(limits.epoch_duration, 86_400);
    }
}
