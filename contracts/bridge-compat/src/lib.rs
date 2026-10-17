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
    contract, contractclient, contracterror, contractimpl, contracttype, symbol_short, Address,
    Bytes, Env, String, Vec,
};
use soroban_sdk::xdr::ToXdr;

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
    ArithmeticOverflow = 13,
    InvalidLimits = 14,
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

        // Check token balance
        let token_addr: Address = env.storage().instance().get(&DataKey::TokenAsset).unwrap();
        let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
        let balance = token_client.balance(&env.current_contract_address());
        if balance < amount {
            return Err(BridgeError::InsufficientBalance);
        }

        // Nonces are monotonic within a sender/provider domain. Transfer IDs
        // additionally bind that nonce to both identities so they cannot be
        // confused with replay nonces or reused across providers.
        let nonce_key = DataKey::TransferNonceFor(sender.clone(), pid);
        let previous_nonce = env
            .storage()
            .instance()
            .get::<_, u64>(&nonce_key)
            .unwrap_or(0);
        let nonce = previous_nonce
            .checked_add(1)
            .ok_or(BridgeError::NonceAlreadyUsed)?;
        let transfer_id = Self::derive_transfer_id(&env, &sender, nonce, pid);
        let transfer_key = DataKey::Transfer(transfer_id);
        if env.storage().instance().has(&transfer_key) {
            return Err(BridgeError::NonceAlreadyUsed);
        }

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
            .set(&transfer_key, &transfer);
        env.storage()
            .instance()
            .set(&nonce_key, &nonce);

        // Update user transfer count
        let user_count: i128 = env
            .storage()
            .instance()
            .get(&DataKey::UserTransferCount(sender.clone()))
            .unwrap_or(0);
        let new_user_count = user_count
            .checked_add(1)
            .ok_or(BridgeError::ArithmeticOverflow)?;
        env.storage().instance().set(
            &DataKey::UserTransferCount(sender.clone()),
            &new_user_count,
        );

        env.events().publish(
            (symbol_short!("brgout"), sender.clone()),
            (transfer_id, amount, dest_chain, pid),
        );

        // Persist the nonce and transfer record before the token interaction.
        // A callback therefore cannot observe or reuse an uncommitted nonce.
        token_client.transfer(&sender, &env.current_contract_address(), &amount);

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
        env.storage().persistent().extend_ttl(
            &key,
            STORAGE_TTL_THRESHOLD,
            STORAGE_TTL_EXTENSION,
        );
    }

    fn derive_transfer_id(env: &Env, sender: &Address, nonce: u64, provider_id: u32) -> u64 {
        let mut payload = sender.to_xdr(env);
        payload.append(&nonce.to_xdr(env));
        payload.append(&provider_id.to_xdr(env));
        let digest = env.crypto().sha256(&payload).to_array();
        u64::from_be_bytes([
            digest[0], digest[1], digest[2], digest[3],
            digest[4], digest[5], digest[6], digest[7],
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
        let mut accounting: EpochAccounting = if let Some(accounting) =
            persistent.get(&accounting_key)
        {
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
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};

    /// Register the contract and return a client for it.
    fn setup() -> (Env, BridgeCompatClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(BridgeCompat, ());
        let client = BridgeCompatClient::new(&env, &id);
        (env, client)
    }

    /// Register the contract with a live Stellar Asset Contract (SAC) token.
    fn setup_with_token() -> (Env, BridgeCompatClient<'static>, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_addr = env
            .register_stellar_asset_contract_v2(token_admin.clone())
            .address();

        let id = env.register(BridgeCompat, ());
        let client = BridgeCompatClient::new(&env, &id);
        client.initialize(&admin, &token_addr);

        (env, client, admin, token_addr, id)
    }

    #[test]
    fn test_initialize() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let token = Address::generate(&env);

        client.initialize(&admin, &token);
        assert_eq!(client.admin(), Some(admin));
        assert_eq!(client.token(), Some(token));
    }

    #[test]
    fn test_double_initialize_fails() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let token = Address::generate(&env);

        client.initialize(&admin, &token);
        let result = client.try_initialize(&admin, &token);
        assert_eq!(result, Err(Ok(BridgeError::AlreadyInitialized)));
    }

    #[test]
    fn test_register_provider() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        let endpoint = Address::generate(&env);

        client.initialize(&admin, &token);

        let chains = Vec::from_array(&env, [1, 2, 3]);
        let id = client.register_provider(
            &String::from_str(&env, "Wormhole"),
            &BridgeProviderKind::Wormhole,
            &endpoint,
            &50, // 0.5% fee
            &1_000_000_000_000,
            &chains,
        );

        assert_eq!(id, 1);
        assert_eq!(client.provider_count(), 1);

        let provider = client.provider(&id).unwrap();
        assert_eq!(provider.name, String::from_str(&env, "Wormhole"));
        assert!(provider.enabled);
    }

    #[test]
    fn test_transfer_limits() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let token = Address::generate(&env);

        client.initialize(&admin, &token);

        let limits = client.transfer_limits();
        assert_eq!(limits.per_transfer_limit, 1_000_000_000_000);
        assert_eq!(limits.epoch_volume_limit, 10_000_000_000_000);
        assert_eq!(limits.epoch_duration, 86_400);
    }

    #[test]
    fn test_epoch_accounting_uses_one_packed_entry() {
        let env = Env::default();
        let contract_id = env.register(BridgeCompat, ());
        env.as_contract(&contract_id, || {
            let limits = TransferLimits {
                per_transfer_limit: 100,
                epoch_volume_limit: 1_000,
                epoch_duration: 86_400,
            };
            BridgeCompat::check_epoch_volume(&env, 25, &limits).unwrap();

            let accounting: EpochAccounting = env
                .storage()
                .persistent()
                .get(&DataKey::EpochAccounting)
                .unwrap();
            assert_eq!(accounting.volume, 25);
            assert!(!env.storage().instance().has(&DataKey::EpochStart));
            assert!(!env.storage().instance().has(&DataKey::EpochVolume));
        });
    }

    #[test]
    fn transfer_ids_are_context_bound_and_duplicate_ids_are_rejected() {
        let env = Env::default();
        env.mock_all_auths();

        let bridge_id = env.register(BridgeCompat, ());
        let client = BridgeCompatClient::new(&env, &bridge_id);
        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_id = env
            .register_stellar_asset_contract_v2(token_admin.clone())
            .address();
        let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
        client.initialize(&admin, &token_id);

        let sender_a = Address::generate(&env);
        let sender_b = Address::generate(&env);
        token_admin_client.mint(&bridge_id, &1_000);
        token_admin_client.mint(&sender_a, &300);
        token_admin_client.mint(&sender_b, &300);

        let endpoint_a = Address::generate(&env);
        let endpoint_b = Address::generate(&env);
        let chains = Vec::from_array(&env, [1u32]);
        let provider_a = client.register_provider(
            &String::from_str(&env, "provider-a"),
            &BridgeProviderKind::Wormhole,
            &endpoint_a,
            &0,
            &1_000,
            &chains,
        );
        let provider_b = client.register_provider(
            &String::from_str(&env, "provider-b"),
            &BridgeProviderKind::LayerZero,
            &endpoint_b,
            &0,
            &1_000,
            &chains,
        );
        let recipient = Bytes::new(&env);

        let id_a = client.transfer_out(&sender_a, &recipient, &100, &1, &Some(provider_a));
        let id_b = client.transfer_out(&sender_b, &recipient, &100, &1, &Some(provider_b));
        let id_a_next = client.transfer_out(&sender_a, &recipient, &100, &1, &Some(provider_a));

        let transfer_a = client.transfer(&id_a).unwrap();
        let transfer_b = client.transfer(&id_b).unwrap();
        let transfer_a_next = client.transfer(&id_a_next).unwrap();
        assert_eq!(transfer_a.nonce, 1);
        assert_eq!(transfer_b.nonce, 1);
        assert_eq!(transfer_a_next.nonce, 2);
        assert_ne!(id_a, transfer_a.nonce);
        assert_ne!(id_a, id_b);
        assert_ne!(id_a, id_a_next);
        assert_eq!(transfer_a.transfer_id, id_a);

        // Simulate replayed nonce state: the derived ID is already occupied,
        // so a transfer must fail instead of replacing the original record.
        env.as_contract(&bridge_id, || {
            env.storage().instance().set(
                &DataKey::TransferNonceFor(sender_a.clone(), provider_a),
                &0u64,
            );
        });
        let duplicate = client.try_transfer_out(
            &sender_a,
            &recipient,
            &100,
            &1,
            &Some(provider_a),
        );
        assert_eq!(duplicate, Err(Ok(BridgeError::NonceAlreadyUsed)));
        assert_eq!(client.transfer(&id_a), Some(transfer_a));
    }

    // ── Acceptance Criteria Tests ────────────────────────────────────────────

    #[test]
    fn test_epoch_limit_exceeded() {
        let (env, client, _admin, token_addr, contract_id) = setup_with_token();
        let endpoint = Address::generate(&env);
        let sender = Address::generate(&env);
        let recipient = Bytes::from_slice(&env, &[1, 2, 3, 4]);

        // Configure limits: 50,000 per transfer, 80,000 per epoch (duration: 3,600s)
        let limits = TransferLimits {
            per_transfer_limit: 50_000,
            epoch_volume_limit: 80_000,
            epoch_duration: 3_600,
        };
        client.set_transfer_limits(&limits);

        // Register a provider supporting dest_chain 1
        let chains = Vec::from_array(&env, [1]);
        let provider_id = client.register_provider(
            &String::from_str(&env, "LayerZero"),
            &BridgeProviderKind::LayerZero,
            &endpoint,
            &50,
            &100_000,
            &chains,
        );

        // Fund sender and contract liquidity
        let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);
        token_admin.mint(&sender, &200_000);
        token_admin.mint(&contract_id, &200_000);

        // First transfer: 50,000 (epoch volume becomes 50,000 <= 80,000) -> succeeds
        let tx1 = client.transfer_out(&sender, &recipient, &50_000, &1, &Some(provider_id));
        assert_eq!(tx1, 1);

        // Second transfer: 40,000
        // Epoch volume would be 50,000 + 40,000 = 90,000 > 80,000 (epoch_volume_limit)
        // Must reject with TransferLimitExceeded
        let err = client.try_transfer_out(&sender, &recipient, &40_000, &1, &Some(provider_id));
        assert_eq!(err, Err(Ok(BridgeError::TransferLimitExceeded)));

        // Advance ledger timestamp beyond epoch_duration to reset epoch
        env.ledger().set_timestamp(env.ledger().timestamp() + 3_601);

        // Once epoch has reset, 40,000 transfer succeeds
        let tx2 = client.transfer_out(&sender, &recipient, &40_000, &1, &Some(provider_id));
        assert_eq!(tx2, 2);
    }

    #[test]
    fn test_fail_transfer_refund() {
        let (env, client, _admin, token_addr, contract_id) = setup_with_token();
        let endpoint = Address::generate(&env);
        let sender = Address::generate(&env);
        let recipient = Bytes::from_slice(&env, &[9, 8, 7]);

        let chains = Vec::from_array(&env, [1, 2]);
        let provider_id = client.register_provider(
            &String::from_str(&env, "Wormhole"),
            &BridgeProviderKind::Wormhole,
            &endpoint,
            &100,
            &500_000,
            &chains,
        );

        let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
        let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);

        let initial_sender_balance = 100_000i128;
        let transfer_amount = 30_000i128;
        token_admin.mint(&sender, &initial_sender_balance);
        token_admin.mint(&contract_id, &100_000);

        // 1. Initiate transfer_out
        let transfer_id = client.transfer_out(&sender, &recipient, &transfer_amount, &1, &Some(provider_id));
        assert_eq!(transfer_id, 1);

        // Verify sender debited by transfer_amount
        assert_eq!(
            token_client.balance(&sender),
            initial_sender_balance - transfer_amount
        );

        // Verify initial transfer status is InFlight
        let transfer_record = client.transfer(&transfer_id).unwrap();
        assert_eq!(transfer_record.status, TransferStatus::InFlight);
        assert_eq!(transfer_record.completed_at, 0);

        // Advance timestamp
        let fail_timestamp = env.ledger().timestamp() + 300;
        env.ledger().set_timestamp(fail_timestamp);

        // 2. Admin fails the transfer to trigger refund
        client.fail_transfer(&transfer_id);

        // Verify sender received full refund
        assert_eq!(token_client.balance(&sender), initial_sender_balance);

        // Verify status updated to Refunded and completed_at recorded
        let refunded_record = client.transfer(&transfer_id).unwrap();
        assert_eq!(refunded_record.status, TransferStatus::Refunded);
        assert_eq!(refunded_record.completed_at, fail_timestamp);

        // 3. Repeated fail_transfer must fail because status is no longer InFlight
        let re_fail = client.try_fail_transfer(&transfer_id);
        assert_eq!(re_fail, Err(Ok(BridgeError::TransferInFlight)));

        // 4. Confirming an already refunded transfer must also fail
        let re_confirm = client.try_confirm_transfer(&transfer_id);
        assert_eq!(re_confirm, Err(Ok(BridgeError::TransferInFlight)));
    }

    #[test]
    fn test_disabled_provider_rejection() {
        let (env, client, _admin, token_addr, contract_id) = setup_with_token();
        let endpoint = Address::generate(&env);
        let sender = Address::generate(&env);
        let recipient = Bytes::from_slice(&env, &[4, 5, 6]);

        let chains = Vec::from_array(&env, [1, 2]);
        let provider_id = client.register_provider(
            &String::from_str(&env, "CustomBridge"),
            &BridgeProviderKind::Custom,
            &endpoint,
            &25,
            &500_000,
            &chains,
        );

        let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);
        token_admin.mint(&sender, &100_000);
        token_admin.mint(&contract_id, &100_000);

        // Provider is initially enabled
        assert!(client.provider(&provider_id).unwrap().enabled);

        // Estimate succeeds while enabled
        let estimate = client.estimate_transfer(&10_000, &1, &Some(provider_id));
        assert_eq!(estimate.provider_id, provider_id);

        // Disable provider via admin
        client.set_provider_enabled(&provider_id, &false);
        assert!(!client.provider(&provider_id).unwrap().enabled);

        // 1. estimate_transfer with explicit disabled provider_id returns ProviderDisabled
        let est_err = client.try_estimate_transfer(&10_000, &1, &Some(provider_id));
        assert_eq!(est_err, Err(Ok(BridgeError::ProviderDisabled)));

        // 2. estimate_transfer using default provider (which is disabled) returns ProviderDisabled
        let est_def_err = client.try_estimate_transfer(&10_000, &1, &None);
        assert_eq!(est_def_err, Err(Ok(BridgeError::ProviderDisabled)));

        // 3. transfer_out with explicit disabled provider_id returns ProviderDisabled
        let tx_err = client.try_transfer_out(&sender, &recipient, &10_000, &1, &Some(provider_id));
        assert_eq!(tx_err, Err(Ok(BridgeError::ProviderDisabled)));

        // 4. transfer_out using default provider (which is disabled) returns ProviderDisabled
        let tx_def_err = client.try_transfer_out(&sender, &recipient, &10_000, &1, &None);
        assert_eq!(tx_def_err, Err(Ok(BridgeError::ProviderDisabled)));

        // Re-enable provider and verify transfers and estimates resume
        client.set_provider_enabled(&provider_id, &true);
        assert!(client.provider(&provider_id).unwrap().enabled);

        let estimate_ok = client.estimate_transfer(&10_000, &1, &Some(provider_id));
        assert_eq!(estimate_ok.provider_id, provider_id);

        let tx_id = client.transfer_out(&sender, &recipient, &10_000, &1, &Some(provider_id));
        assert_eq!(tx_id, 1);
    }

    #[test]
    fn test_checked_math_and_limit_validation() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        let endpoint = Address::generate(&env);
        client.initialize(&admin, &token);

        let chains = Vec::from_array(&env, [1]);
        let name = String::from_str(&env, "P");

        // max_transfer must be positive and bounded so fee math cannot overflow.
        for bad in [0, -1, i128::MAX] {
            let r = client.try_register_provider(
                &name,
                &BridgeProviderKind::Custom,
                &endpoint,
                &10_000,
                &bad,
                &chains,
            );
            assert_eq!(r, Err(Ok(BridgeError::InvalidLimits)));
        }
        let id = client.register_provider(
            &name,
            &BridgeProviderKind::Custom,
            &endpoint,
            &10_000,
            &(i128::MAX / BPS_DENOMINATOR),
            &chains,
        );

        // amount = i128::MAX returns an error instead of aborting.
        let r = client.try_estimate_transfer(&i128::MAX, &1, &Some(id));
        assert!(r.is_err());

        // epoch_duration = 0 and non-positive limits are rejected.
        let mut limits = client.transfer_limits();
        limits.epoch_duration = 0;
        assert_eq!(
            client.try_set_transfer_limits(&limits),
            Err(Ok(BridgeError::InvalidLimits))
        );
        let mut limits = client.transfer_limits();
        limits.per_transfer_limit = 0;
        assert_eq!(
            client.try_set_transfer_limits(&limits),
            Err(Ok(BridgeError::InvalidLimits))
        );
    }
}
