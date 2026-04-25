#![no_std]

pub mod benji_strategy;
pub mod external_calls;
#[cfg(test)]
mod fuzz_math;
pub mod permissions;
pub mod strategy;
pub mod upgrade;
#[cfg(test)]
pub mod proxy_tests;
mod test;

use crate::strategy::StrategyClient;
use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, symbol_short, token,
    Address, Env, Vec, BytesN,
};
use crate::upgrade::{get_admin, set_admin, is_initialized, set_initialized};

const MAX_PAGE_SIZE: u32 = 50;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ShipmentStatus {
    Pending,
    InTransit,
    Delivered,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShipmentPage {
    pub shipment_ids: Vec<u64>,
    pub next_cursor: Option<u64>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
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
    Proposal(u32),
    Vote(u32, Address),
    ShareBalance(Address),
    ShipmentByStatus(ShipmentStatus),
    ShipmentStatusOf(u64),
    UserDeposit(Address),
    PerUserCap,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StrategyProposal {
    pub strategy: Address,
    pub yes_votes: i128,
    pub no_votes: i128,
    pub executed: bool,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VaultError {
    AlreadyInitialized = 1,
    InsufficientShares = 2,
    InvalidAmount = 3,
    ContractPaused = 4,
    ExceedsUserCap = 5,
}

#[contractclient(name = "KoreanDebtStrategyClient")]
pub trait KoreanDebtStrategy {
    fn harvest_yield(env: Env) -> i128;
}

#[contract]
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
        
        env.storage().instance().set(&DataKey::TokenAsset, &token);
        env.storage().instance().set(&DataKey::TotalAssets, &0i128);
        env.storage().instance().set(&DataKey::DaoThreshold, &1i128);
        env.storage().instance().set(&DataKey::ProposalNonce, &0u32);
        Ok(())
    }

    /// Upgrades the contract code to a new WASM hash.
    /// Only the Admin can call this.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin = get_admin(&env).expect("Admin not set");
        admin.require_auth();

        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    /// Set or update the active strategy connector.
    pub fn set_strategy(env: Env, strategy: Address) {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();
        env.storage().instance().set(&DataKey::Strategy, &strategy);
    }

    /// Read the active strategy address.
    pub fn strategy(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Strategy)
    }

    pub fn set_pause(env: Env, paused: bool) {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();

        let mut state = Self::get_state(&env);
        state.is_paused = paused;
        env.storage().instance().set(&DataKey::State, &state);
    }

    pub fn is_paused(env: Env) -> bool {
        Self::get_state(&env).is_paused
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

        idle_assets + strategy_assets
    }

    pub fn balance(env: Env, user: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::ShareBalance(user))
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
        state.total_assets += harvested;
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
        next_nonce += 1;
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
            proposal.yes_votes += weight;
        } else {
            proposal.no_votes += weight;
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

    pub fn calculate_shares(env: Env, assets: i128) -> i128 {
        let state = Self::get_state(&env);
        if state.total_assets == 0 || state.total_shares == 0 {
            assets
        } else {
            assets * state.total_shares / state.total_assets
        }
    }

    pub fn calculate_assets(env: Env, shares: i128) -> i128 {
        let state = Self::get_state(&env);
        if state.total_shares == 0 {
            0
        } else {
            shares * state.total_assets / state.total_shares
        }
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

        let token_addr: Address = env.storage().instance().get(&DataKey::TokenAsset).unwrap();
        let token_client = token::Client::new(&env, &token_addr);

        let shares_to_mint = if state.total_assets == 0 || state.total_shares == 0 {
            amount
        } else {
            amount * state.total_shares / state.total_assets
        };

        // Prevent silent loss of funds if shares round down to 0
        if shares_to_mint == 0 {
            return Err(VaultError::InvalidAmount);
        }

        let deposit_key = DataKey::UserDeposit(user.clone());
        let current_deposit: i128 = env.storage().instance().get(&deposit_key).unwrap_or(0);
        let new_deposit = current_deposit + amount;

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
        env.storage()
            .instance()
            .set(&DataKey::TotalAssets, &(ta + amount));

        let ts = Self::total_shares(env.clone());
        env.storage()
            .instance()
            .set(&DataKey::TotalShares, &(ts + shares_to_mint));
        state.total_assets += amount;
        state.total_shares += shares_to_mint;
        env.storage().instance().set(&DataKey::State, &state);

        let user_key = DataKey::ShareBalance(user.clone());
        let user_shares: i128 = env.storage().instance().get(&user_key).unwrap_or(0);
        env.storage()
            .instance()
            .set(&user_key, &(user_shares + shares_to_mint));

        env.events()
            .publish((symbol_short!("deposit"),), (amount, shares_to_mint));
        Ok(shares_to_mint)
    }

    /// Redeems vault shares for the proportional amount of underlying assets.
    ///
    /// ### Parameters
    /// * `user` - The share holder (requires auth).
    /// * `shares` - The number of shares to burn.
    ///
    /// ### Returns
    /// The quantity of underlying tokens returned to the user.
    pub fn withdraw(env: Env, user: Address, shares: i128) -> Result<i128, VaultError> {
        let mut state = Self::get_state(&env);
        if state.is_paused {
            return Err(VaultError::ContractPaused);
        }

        user.require_auth();
        if shares <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        let user_key = DataKey::ShareBalance(user.clone());
        let user_shares = env.storage().instance().get(&user_key).unwrap_or(0);
        if user_shares < shares {
            return Err(VaultError::InsufficientShares);
        }

        let assets_to_return = if state.total_shares == 0 {
            0
        } else {
            shares * state.total_assets / state.total_shares
        };

        let token_addr = Self::token(env.clone());
        let token_client = token::Client::new(&env, &token_addr);

        // Check if vault has enough idle assets, otherwise divest from strategy
        let mut idle_ta = env
            .storage()
            .instance()
            .get::<_, i128>(&DataKey::TotalAssets)
            .unwrap_or(0);
        if idle_ta < assets_to_return {
            let needed = assets_to_return - idle_ta;
            Self::divest(env.clone(), needed);
            idle_ta = env
                .storage()
                .instance()
                .get::<_, i128>(&DataKey::TotalAssets)
                .unwrap_or(0);
        }

        // Transfer assets from vault to user
        token_client.transfer(&env.current_contract_address(), &user, &assets_to_return);

        // Update state
        env.storage()
            .instance()
            .set(&DataKey::TotalAssets, &(idle_ta - assets_to_return));

        let ts = Self::total_shares(env.clone());
        env.storage()
            .instance()
            .set(&DataKey::TotalShares, &(ts - shares));

        let vault_balance = Self::balance(env.clone(), user.clone());
        env.storage().instance().set(
            &DataKey::ShareBalance(user.clone()),
            &(vault_balance - shares),
        );

        state.total_assets -= assets_to_return;
        state.total_shares -= shares;
        env.storage().instance().set(&DataKey::State, &state);

        env.storage()
            .instance()
            .set(&user_key, &(user_shares - shares));

        let deposit_key = DataKey::UserDeposit(user.clone());
        let current_deposit: i128 = env.storage().instance().get(&deposit_key).unwrap_or(0);
        let new_deposit = if current_deposit > assets_to_return {
            current_deposit - assets_to_return
        } else {
            0
        };
        env.storage().instance().set(&deposit_key, &new_deposit);

        env.events().publish(
            (symbol_short!("withdraw"), user),
            (assets_to_return, shares),
        );
        Ok(assets_to_return)
    }

    /// Move idle funds to the strategy.
    pub fn invest(env: Env, amount: i128) {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();

        let strategy_addr = Self::strategy(env.clone()).expect("no strategy set");
        let strategy_client = StrategyClient::new(&env, &strategy_addr);

        let idle_ta = env
            .storage()
            .instance()
            .get::<_, i128>(&DataKey::TotalAssets)
            .unwrap_or(0);
        if idle_ta < amount {
            panic!("insufficient idle assets");
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

        // Update idle assets
        env.storage()
            .instance()
            .set(&DataKey::TotalAssets, &(idle_ta - amount));
    }

    /// Recall funds from the strategy.
    pub fn divest(env: Env, amount: i128) {
        // Can be called by admin or internally by withdraw
        let strategy_addr = Self::strategy(env.clone()).expect("no strategy set");
        let strategy_client = StrategyClient::new(&env, &strategy_addr);

        strategy_client.withdraw(&amount);

        // The strategy contract should have transferred funds back to the vault
        let idle_ta = env
            .storage()
            .instance()
            .get::<_, i128>(&DataKey::TotalAssets)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalAssets, &(idle_ta + amount));
    }

    /// Admin function to artificially accrue yield (legacy, but updated for strategy).
    pub fn accrue_yield(env: Env, amount: i128) {
        let admin: Address = get_admin(&env).expect("Admin not set");
        admin.require_auth();

        let token_addr = Self::token(env.clone());
        let token_client = token::Client::new(&env, &token_addr);

        token_client.transfer(&admin, &env.current_contract_address(), &amount);

        let ta = env
            .storage()
            .instance()
            .get::<_, i128>(&DataKey::TotalAssets)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalAssets, &(ta + amount));

        let mut state = Self::get_state(&env);
        state.total_assets += amount;
        env.storage().instance().set(&DataKey::State, &state);
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

        let ta = env
            .storage()
            .instance()
            .get::<_, i128>(&DataKey::TotalAssets)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalAssets, &(ta + amount));

        let mut state = Self::get_state(&env);
        state.total_assets += amount;
        env.storage().instance().set(&DataKey::State, &state);
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
}
