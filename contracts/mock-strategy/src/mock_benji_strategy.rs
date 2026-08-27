use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MockBenjiDataKey {
    Admin,
    Vault,
    Asset,
    BenjiToken,
    BaseNav,
    Epoch,
}

/// Mock BENJI strategy connector for integration testing.
///
/// Simulates the Franklin Templeton BENJI fund token strategy with a
/// configurable NAV (Net Asset Value) that can be adjusted per-epoch
/// to test yield accrual, deposit/withdrawal flows, and vault integration
/// without requiring a real BENJI token contract on testnet.
///
/// # Integration
///
/// Follows the same `StrategyTrait` interface as the production
/// `BenjiStrategy` in `contracts/vault/src/benji_strategy.rs`, making
/// it a drop-in replacement for local Soroban testing.
#[contract]
pub struct MockBenjiStrategy;

#[contractimpl]
impl MockBenjiStrategy {
    pub fn initialize(
        env: Env,
        admin: Address,
        vault: Address,
        asset: Address,
        benji_token: Address,
        base_nav: i128,
    ) {
        if env.storage().instance().has(&MockBenjiDataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();

        env.storage()
            .instance()
            .set(&MockBenjiDataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&MockBenjiDataKey::Vault, &vault);
        env.storage()
            .instance()
            .set(&MockBenjiDataKey::Asset, &asset);
        env.storage()
            .instance()
            .set(&MockBenjiDataKey::BenjiToken, &benji_token);
        env.storage()
            .instance()
            .set(&MockBenjiDataKey::BaseNav, &base_nav);
        env.storage()
            .instance()
            .set(&MockBenjiDataKey::Epoch, &0u32);
    }

    /// Admin sets a new NAV multiplier.
    ///
    /// Allows simulating yield accrual by bumping the NAV between epochs.
    pub fn set_nav(env: Env, base_nav: i128) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&MockBenjiDataKey::Admin)
            .unwrap();
        admin.require_auth();

        env.storage()
            .instance()
            .set(&MockBenjiDataKey::BaseNav, &base_nav);
    }

    /// Returns the current NAV multiplier.
    pub fn nav(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&MockBenjiDataKey::BaseNav)
            .unwrap_or(1_000_000_000_000_000_000)
    }

    /// Advances the epoch counter (for testing time-dependent logic).
    pub fn advance_epoch(env: Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&MockBenjiDataKey::Admin)
            .unwrap();
        admin.require_auth();

        let epoch: u32 = env
            .storage()
            .instance()
            .get(&MockBenjiDataKey::Epoch)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&MockBenjiDataKey::Epoch, &(epoch + 1));
    }

    pub fn epoch(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&MockBenjiDataKey::Epoch)
            .unwrap_or(0)
    }

    /// Deposits underlying asset into the strategy.
    ///
    /// Transfers `amount` of the asset token from the vault to this contract,
    /// then mints the same amount of mock BENJI tokens.
    pub fn deposit(env: Env, amount: i128) {
        let vault: Address = env
            .storage()
            .instance()
            .get(&MockBenjiDataKey::Vault)
            .unwrap();
        vault.require_auth();

        let asset_addr: Address = env
            .storage()
            .instance()
            .get(&MockBenjiDataKey::Asset)
            .unwrap();
        let benji_addr: Address = env
            .storage()
            .instance()
            .get(&MockBenjiDataKey::BenjiToken)
            .unwrap();

        let asset_client = token::Client::new(&env, &asset_addr);
        asset_client.transfer(&vault, &env.current_contract_address(), &amount);

        let benji_client = token::StellarAssetClient::new(&env, &benji_addr);
        benji_client.mint(&env.current_contract_address(), &amount);
    }

    /// Withdraws underlying asset from the strategy.
    ///
    /// Transfers `amount` of the asset token back to the vault.
    pub fn withdraw(env: Env, amount: i128) {
        let vault: Address = env
            .storage()
            .instance()
            .get(&MockBenjiDataKey::Vault)
            .unwrap();
        vault.require_auth();

        let asset_addr: Address = env
            .storage()
            .instance()
            .get(&MockBenjiDataKey::Asset)
            .unwrap();
        let asset_client = token::Client::new(&env, &asset_addr);
        asset_client.transfer(&env.current_contract_address(), &vault, &amount);
    }

    /// Returns the total value of assets held by this strategy.
    ///
    /// Measured as the mock BENJI token balance of this contract.
    pub fn total_value(env: Env) -> i128 {
        let benji_addr: Address = env
            .storage()
            .instance()
            .get(&MockBenjiDataKey::BenjiToken)
            .unwrap();
        let benji_client = token::Client::new(&env, &benji_addr);
        benji_client.balance(&env.current_contract_address())
    }

    /// Returns the address of the underlying asset token.
    pub fn asset(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&MockBenjiDataKey::Asset)
            .unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{token, Address, Env};

    fn create_token<'a>(e: &Env, admin: &Address) -> token::Client<'a> {
        let addr = e
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        token::Client::new(e, &addr)
    }

    fn setup() -> (Env, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        let admin = Address::generate(&env);
        let vault = Address::generate(&env);

        let token_admin = Address::generate(&env);
        let asset_client = create_token(&env, &token_admin);
        let benji_client = create_token(&env, &token_admin);

        // Mint some asset tokens to the vault so it can transfer on deposit
        let asset_sa = token::StellarAssetClient::new(&env, &asset_client.address);
        asset_sa.mint(&vault, &1_000_000_000i128);

        (
            env,
            admin,
            vault,
            asset_client.address,
            benji_client.address,
        )
    }

    #[test]
    fn test_initialize_and_query() {
        let (env, admin, vault, asset, benji_token) = setup();
        let contract_addr = env.register_contract(None, MockBenjiStrategy);
        let client = MockBenjiStrategyClient::new(&env, &contract_addr);

        client.initialize(
            &admin,
            &vault,
            &asset,
            &benji_token,
            &1_000_000_000_000_000_000i128,
        );

        assert_eq!(client.asset(), asset);
        assert_eq!(client.nav(), 1_000_000_000_000_000_000i128);
        assert_eq!(client.epoch(), 0);
        assert_eq!(client.total_value(), 0);
    }

    #[test]
    fn test_deposit_and_withdraw() {
        let (env, admin, vault, asset, benji_token) = setup();
        let contract_addr = env.register_contract(None, MockBenjiStrategy);
        let client = MockBenjiStrategyClient::new(&env, &contract_addr);

        client.initialize(
            &admin,
            &vault,
            &asset,
            &benji_token,
            &1_000_000_000_000_000_000i128,
        );

        let deposit_amount = 100_000_000i128;

        // Before deposit: no tokens
        assert_eq!(client.total_value(), 0);

        // Deposit: vault -> strategy (asset), strategy mints BENJI 1:1
        client.deposit(&deposit_amount);

        // total_value returns BENJI token balance
        assert_eq!(client.total_value(), deposit_amount);

        // Withdraw: strategy -> vault (asset). BENJI is NOT burned
        // (matches production BenjiStrategy behavior).
        client.withdraw(&deposit_amount);

        // BENJI balance unchanged after withdraw
        assert_eq!(client.total_value(), deposit_amount);

        // Asset was returned to vault: strategy holds 0 asset
        let asset_client = token::Client::new(&env, &asset);
        assert_eq!(asset_client.balance(&contract_addr), 0);
    }

    #[test]
    fn test_advance_epoch() {
        let (env, admin, vault, asset, benji_token) = setup();
        let contract_addr = env.register_contract(None, MockBenjiStrategy);
        let client = MockBenjiStrategyClient::new(&env, &contract_addr);

        client.initialize(
            &admin,
            &vault,
            &asset,
            &benji_token,
            &1_000_000_000_000_000_000i128,
        );

        assert_eq!(client.epoch(), 0);
        client.advance_epoch();
        assert_eq!(client.epoch(), 1);
        client.advance_epoch();
        assert_eq!(client.epoch(), 2);
    }

    #[test]
    fn test_set_nav() {
        let (env, admin, vault, asset, benji_token) = setup();
        let contract_addr = env.register_contract(None, MockBenjiStrategy);
        let client = MockBenjiStrategyClient::new(&env, &contract_addr);

        client.initialize(
            &admin,
            &vault,
            &asset,
            &benji_token,
            &1_000_000_000_000_000_000i128,
        );

        assert_eq!(client.nav(), 1_000_000_000_000_000_000i128);
        client.set_nav(&2_000_000_000_000_000_000i128);
        assert_eq!(client.nav(), 2_000_000_000_000_000_000i128);
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_double_initialize_panics() {
        let (env, admin, vault, asset, benji_token) = setup();
        let contract_addr = env.register_contract(None, MockBenjiStrategy);
        let client = MockBenjiStrategyClient::new(&env, &contract_addr);

        client.initialize(
            &admin,
            &vault,
            &asset,
            &benji_token,
            &1_000_000_000_000_000_000i128,
        );
        client.initialize(
            &admin,
            &vault,
            &asset,
            &benji_token,
            &1_000_000_000_000_000_000i128,
        );
    }
}
