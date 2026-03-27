#![no_std]

mod test;
#[cfg(test)]
mod fuzz_math;
pub mod strategy;
pub mod benji_strategy;
pub mod permissions;
pub mod external_calls;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, Vec,
};
use crate::strategy::StrategyClient;

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
    ArithmeticError = 4,
    InsufficientAssets = 5,
    ContractPaused = 6,
}

#[contract]
pub struct YieldVault;

#[contractimpl]
impl YieldVault {
    fn checked_add(a: i128, b: i128) -> Result<i128, VaultError> {
        a.checked_add(b).ok_or(VaultError::ArithmeticError)
    }

    fn checked_sub(a: i128, b: i128) -> Result<i128, VaultError> {
        a.checked_sub(b).ok_or(VaultError::ArithmeticError)
    }

    fn checked_mul(a: i128, b: i128) -> Result<i128, VaultError> {
        a.checked_mul(b).ok_or(VaultError::ArithmeticError)
    }

    /// Initialize the vault with the underlying asset (USDC) and an admin who controls the strategy.
    pub fn initialize(env: Env, admin: Address, token: Address) -> Result<(), VaultError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(VaultError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TokenAsset, &token);
        env.storage().instance().set(&DataKey::TotalAssets, &0i128);
        env.storage().instance().set(&DataKey::TotalShares, &0i128);

        let state = VaultState {
            total_shares: 0,
            total_assets: 0,
            is_paused: false,
        };
        env.storage().instance().set(&DataKey::State, &state);
        env.storage().instance().set(&DataKey::DaoThreshold, &1i128);
        env.storage().instance().set(&DataKey::ProposalNonce, &0u32);

        Ok(())
    }

    /// Set or update the active strategy connector.
    pub fn set_strategy(env: Env, strategy: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::Strategy, &strategy);
    }

    /// Read the active strategy address.
    pub fn strategy(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Strategy)
    }

    pub fn set_pause(env: Env, paused: bool) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let mut state = Self::get_state(&env);
        state.is_paused = paused;
        env.storage().instance().set(&DataKey::State, &state);
    }

    pub fn is_paused(env: Env) -> bool {
        Self::get_state(&env).is_paused
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
        let idle_assets = env.storage().instance().get::<_, i128>(&DataKey::TotalAssets).unwrap_or(0);

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
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::KoreanDebtStrategy, &strategy);
    }

    pub fn accrue_korean_debt_yield(env: Env) -> i128 {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let strategy: Address = env
            .storage()
            .instance()
            .get(&DataKey::KoreanDebtStrategy)
            .unwrap();
        let strategy_client = StrategyClient::new(&env, &strategy);
        let harvested = strategy_client.total_value();

        if harvested <= 0 {
            panic!("yield amount must be > 0");
        }

        let mut state = Self::get_state(&env);
        state.total_assets += harvested;
        env.storage().instance().set(&DataKey::State, &state);

        harvested
    }

    pub fn set_dao_threshold(env: Env, threshold: i128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
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
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
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
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
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

    fn insert_sorted_unique(env: &Env, ids: Vec<u64>, shipment_id: u64) -> Vec<u64> {
        let mut result = Vec::new(env);
        let mut inserted = false;
        let mut idx = 0;

        while idx < ids.len() {
            let current = ids.get(idx).unwrap();
            if current == shipment_id {
                return ids;
            }

            if !inserted && shipment_id < current {
                result.push_back(shipment_id);
                inserted = true;
            }

            result.push_back(current);
            idx += 1;
        }

        if !inserted {
            result.push_back(shipment_id);
        }

        result
    }

    fn remove_id(env: &Env, ids: Vec<u64>, shipment_id: u64) -> Vec<u64> {
        let mut result = Vec::new(env);
        let mut idx = 0;

        while idx < ids.len() {
            let current = ids.get(idx).unwrap();
            if current != shipment_id {
                result.push_back(current);
            }
            idx += 1;
        }

        result
    }

    fn index_after_cursor(ids: &Vec<u64>, cursor: Option<u64>) -> u32 {
        let Some(cursor_id) = cursor else {
            return 0;
        };

        let mut idx = 0;
        while idx < ids.len() {
            if ids.get(idx).unwrap() > cursor_id {
                return idx;
            }
            idx += 1;
        }

        ids.len()
    }

    fn divest(env: Env, amount: i128) {
        if amount <= 0 {
            return;
        }

        if let Some(strategy_addr) = Self::strategy(env.clone()) {
            let strategy_client = StrategyClient::new(&env, &strategy_addr);
            strategy_client.withdraw(&amount);

            let idle_assets = env
                .storage()
                .instance()
                .get::<_, i128>(&DataKey::TotalAssets)
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&DataKey::TotalAssets, &(idle_assets + amount));
        }
    }

    /// Calculates the number of shares given an asset amount based on the current exchange rate.
    pub fn calculate_shares(env: Env, assets: i128) -> Result<i128, VaultError> {
        let ts = Self::total_shares(env.clone());
        let ta = Self::total_assets(env.clone());
        if ta == 0 || ts == 0 {
            Ok(assets)
        } else {
            Ok(Self::checked_mul(assets, ts)? / ta)
        }
    }

    /// Calculates the underlying asset value given an amount of shares.
    pub fn calculate_assets(env: Env, shares: i128) -> Result<i128, VaultError> {
        let ts = Self::total_shares(env.clone());
        let ta = Self::total_assets(env.clone());
        if ts == 0 {
            Ok(0)
        } else {
            Ok(Self::checked_mul(shares, ta)? / ts)
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

        let shares_to_mint = Self::calculate_shares(env.clone(), amount)?;
        
        // Transfer assets from user to vault
        token_client.transfer(&user, &env.current_contract_address(), &amount);

        token_client.transfer(&user, &env.current_contract_address(), &amount);

        // Update state
        let ta = Self::total_assets(env.clone());
        env.storage()
            .instance()
            .set(&DataKey::TotalAssets, &Self::checked_add(ta, amount)?);
        
        let ts = Self::total_shares(env.clone());
        env.storage()
            .instance()
            .set(&DataKey::TotalShares, &Self::checked_add(ts, shares_to_mint)?);

        let user_shares = Self::balance(env.clone(), user.clone());
        env.storage().instance().set(
            &DataKey::ShareBalance(user.clone()),
            &Self::checked_add(user_shares, shares_to_mint)?,
        );
        
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

        let assets_to_return = Self::calculate_assets(env.clone(), shares)?;

        let token_addr = Self::token(env.clone());
        let token_client = token::Client::new(&env, &token_addr);
        let vault_address = env.current_contract_address();
        let vault_token_balance = token_client.balance(&vault_address);
        if vault_token_balance < assets_to_return {
            return Err(VaultError::InsufficientAssets);
        }

        // Check if vault has enough idle assets, otherwise divest from strategy
        let mut idle_ta = env.storage().instance().get::<_, i128>(&DataKey::TotalAssets).unwrap_or(0);
        if idle_ta < assets_to_return {
            let needed = assets_to_return - idle_ta;
            Self::divest(env.clone(), needed);
            idle_ta = env.storage().instance().get::<_, i128>(&DataKey::TotalAssets).unwrap_or(0);
        }

        // Transfer assets from vault to user
        token_client.transfer(&vault_address, &user, &assets_to_return);

        // Update state
        let ta = Self::total_assets(env.clone());
        env.storage()
            .instance()
            .set(&DataKey::TotalAssets, &Self::checked_sub(ta, assets_to_return)?);
        
        let ts = Self::total_shares(env.clone());
        env.storage()
            .instance()
            .set(&DataKey::TotalShares, &Self::checked_sub(ts, shares)?);

        env.storage().instance().set(
            &DataKey::ShareBalance(user.clone()),
            &Self::checked_sub(user_shares, shares)?,
        );

        env.storage()
            .instance()
            .set(&user_key, &(user_shares - shares));

        env.events().publish(
            (symbol_short!("withdraw"), user),
            (assets_to_return, shares),
        );
        Ok(assets_to_return)
    }

    /// Admin function to artificially accrue yield, simulating returns from an RWA strategy.
    /// This simply bumps the `total_assets` tracked by the vault, immediately increasing the
    /// exchange rate for all share holders. Real implementation would pull this from an RWA protocol.
    pub fn accrue_yield(env: Env, amount: i128) -> Result<(), VaultError> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        let token_addr = Self::token(env.clone());
        let token_client = token::Client::new(&env, &token_addr);

        token_client.transfer(&admin, &env.current_contract_address(), &amount);

        let ta = Self::total_assets(env.clone());
        env.storage()
            .instance()
            .set(&DataKey::TotalAssets, &Self::checked_add(ta, amount)?);

        Ok(())
    }
}
