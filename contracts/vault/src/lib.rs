#![no_std]

mod test;

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, symbol_short, token,
    Address, Env, Vec,
};

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
pub enum DataKey {
    TokenAsset,
    TotalShares,
    TotalAssets,
    Admin,
    DaoThreshold,
    ProposalNonce,
    BenjiStrategy,
    KoreanDebtStrategy,
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
}

#[contractclient(name = "KoreanDebtStrategyClient")]
pub trait KoreanDebtStrategy {
    fn harvest_yield(env: Env) -> i128;
}

#[contract]
pub struct YieldVault;

#[contractimpl]
impl YieldVault {
    pub fn initialize(env: Env, admin: Address, token: Address) -> Result<(), VaultError> {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(VaultError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TokenAsset, &token);
        env.storage().instance().set(&DataKey::TotalAssets, &0i128);
        env.storage().instance().set(&DataKey::TotalShares, &0i128);
        env.storage().instance().set(&DataKey::DaoThreshold, &1i128);
        env.storage().instance().set(&DataKey::ProposalNonce, &0u32);

        Ok(())
    }

    pub fn token(env: Env) -> Address {
        env.storage().instance().get(&DataKey::TokenAsset).unwrap()
    }

    pub fn total_shares(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalShares).unwrap_or(0)
    }

    pub fn total_assets(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalAssets).unwrap_or(0)
    }

    pub fn balance(env: Env, user: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::ShareBalance(user))
            .unwrap_or(0)
    }

    pub fn benji_strategy(env: Env) -> Address {
        env.storage().instance().get(&DataKey::BenjiStrategy).unwrap()
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
        let strategy_client = KoreanDebtStrategyClient::new(&env, &strategy);
        let harvested = strategy_client.harvest_yield();

        if harvested <= 0 {
            panic!("yield amount must be > 0");
        }

        let ta = Self::total_assets(env.clone());
        env.storage()
            .instance()
            .set(&DataKey::TotalAssets, &(ta + harvested));

        harvested
    }

    pub fn set_dao_threshold(env: Env, threshold: i128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        if threshold <= 0 {
            panic!("threshold must be > 0");
        }
        env.storage().instance().set(&DataKey::DaoThreshold, &threshold);
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
        let ts = Self::total_shares(env.clone());
        let ta = Self::total_assets(env.clone());
        if ta == 0 || ts == 0 {
            assets
        } else {
            assets * ts / ta
        }
    }

    pub fn calculate_assets(env: Env, shares: i128) -> i128 {
        let ts = Self::total_shares(env.clone());
        let ta = Self::total_assets(env.clone());
        if ts == 0 {
            0
        } else {
            shares * ta / ts
        }
    }

    /// Returns the current share price scaled by 10^18 (1_000_000_000_000_000_000).
    ///
    /// Formula: share_price = (total_assets * 10^18) / total_shares
    ///
    /// To convert to a human-readable price, divide the result by 10^18.
    /// Examples:
    ///   1_000_000_000_000_000_000 → 1.0  (1 share = 1 token)
    ///   1_200_000_000_000_000_000 → 1.2  (1 share = 1.2 tokens, after yield accrual)
    ///   500_000_000_000_000_000  → 0.5  (1 share = 0.5 tokens)
    ///
    /// Returns 1:1 (10^18) when no shares have been minted yet (fresh vault).
    pub fn get_share_price(env: Env) -> i128 {
        let ts = Self::total_shares(env.clone());
        let ta = Self::total_assets(env.clone());

        if ts == 0 {
            // No shares minted yet — initial price is 1:1
            return 1_000_000_000_000_000_000i128;
        }

        // Scale TVL up before dividing to preserve decimal precision.
        // Using checked arithmetic to guard against overflow.
        ta.checked_mul(1_000_000_000_000_000_000i128)
            .expect("overflow in share price calculation")
            .checked_div(ts)
            .expect("division error in share price calculation")
    }

    pub fn deposit(env: Env, user: Address, amount: i128) -> Result<i128, VaultError> {
        user.require_auth();
        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        let token_addr = Self::token(env.clone());
        let token_client = token::Client::new(&env, &token_addr);

        let shares_to_mint = Self::calculate_shares(env.clone(), amount);

        token_client.transfer(&user, &env.current_contract_address(), &amount);

        env.events()
            .publish((symbol_short!("deposit"),), (amount, shares_to_mint));

        let ta = Self::total_assets(env.clone());
        env.storage()
            .instance()
            .set(&DataKey::TotalAssets, &(ta + amount));

        let ts = Self::total_shares(env.clone());
        env.storage()
            .instance()
            .set(&DataKey::TotalShares, &(ts + shares_to_mint));

        let user_shares = Self::balance(env.clone(), user.clone());
        env.storage().instance().set(
            &DataKey::ShareBalance(user.clone()),
            &(user_shares + shares_to_mint),
        );

        Ok(shares_to_mint)
    }

    pub fn withdraw(env: Env, user: Address, shares: i128) -> Result<i128, VaultError> {
        user.require_auth();
        if shares <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        let user_shares = Self::balance(env.clone(), user.clone());
        if user_shares < shares {
            return Err(VaultError::InsufficientShares);
        }

        let assets_to_return = Self::calculate_assets(env.clone(), shares);

        let token_addr = Self::token(env.clone());
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&env.current_contract_address(), &user, &assets_to_return);

        let ta = Self::total_assets(env.clone());
        env.storage()
            .instance()
            .set(&DataKey::TotalAssets, &(ta - assets_to_return));

        let ts = Self::total_shares(env.clone());
        env.storage()
            .instance()
            .set(&DataKey::TotalShares, &(ts - shares));

        let vault_balance = Self::balance(env.clone(), user.clone());
        env.storage()
            .instance()
            .set(&DataKey::ShareBalance(user.clone()), &(vault_balance - shares));

        env.events().publish(
            (symbol_short!("withdraw"), user.clone()),
            (assets_to_return, shares),
        );

        Ok(assets_to_return)
    }

    pub fn accrue_yield(env: Env, amount: i128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let token_addr = Self::token(env.clone());
        let token_client = token::Client::new(&env, &token_addr);

        token_client.transfer(&admin, &env.current_contract_address(), &amount);

        let ta = Self::total_assets(env.clone());
        env.storage()
            .instance()
            .set(&DataKey::TotalAssets, &(ta + amount));
    }

    pub fn report_benji_yield(env: Env, strategy: Address, amount: i128) {
        strategy.require_auth();
        if amount <= 0 {
            panic!("yield amount must be > 0");
        }

        let configured: Address = env.storage().instance().get(&DataKey::BenjiStrategy).unwrap();
        if strategy != configured {
            panic!("unauthorized strategy");
        }

        let token_addr = Self::token(env.clone());
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&strategy, &env.current_contract_address(), &amount);

        let ta = Self::total_assets(env.clone());
        env.storage()
            .instance()
            .set(&DataKey::TotalAssets, &(ta + amount));
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