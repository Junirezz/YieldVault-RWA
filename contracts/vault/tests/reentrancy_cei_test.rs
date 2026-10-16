use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};
use soroban_sdk::testutils::Address as _;
use vault::{YieldVault, YieldVaultClient};

#[contracttype]
#[derive(Clone)]
enum TokenKey {
    Balance(Address),
    CallbackDone,
    NestedAmount,
    ObservedAssets,
    ObservedShares,
    ObservedUserDeposit,
    ReentrySucceeded,
    User,
    Vault,
}

#[contract]
struct ReentrantToken;

#[contractimpl]
impl ReentrantToken {
    pub fn configure(env: Env, vault: Address, user: Address, nested_amount: i128) {
        env.storage().instance().set(&TokenKey::Vault, &vault);
        env.storage().instance().set(&TokenKey::User, &user);
        env.storage()
            .instance()
            .set(&TokenKey::NestedAmount, &nested_amount);
    }

    pub fn mint(env: Env, user: Address, amount: i128) {
        let key = TokenKey::Balance(user);
        let balance: i128 = env.storage().instance().get(&key).unwrap_or(0);
        env.storage()
            .instance()
            .set(&key, &balance.checked_add(amount).unwrap());
    }

    pub fn observed_user_deposit(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&TokenKey::ObservedUserDeposit)
            .unwrap_or(0)
    }

    pub fn observed_assets(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&TokenKey::ObservedAssets)
            .unwrap_or(0)
    }

    pub fn observed_shares(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&TokenKey::ObservedShares)
            .unwrap_or(0)
    }

    pub fn reentry_succeeded(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&TokenKey::ReentrySucceeded)
            .unwrap_or(false)
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        let from_key = TokenKey::Balance(from.clone());
        let from_balance: i128 = env.storage().instance().get(&from_key).unwrap_or(0);
        env.storage()
            .instance()
            .set(&from_key, &from_balance.checked_sub(amount).unwrap());

        let to_key = TokenKey::Balance(to);
        let to_balance: i128 = env.storage().instance().get(&to_key).unwrap_or(0);
        env.storage()
            .instance()
            .set(&to_key, &to_balance.checked_add(amount).unwrap());

        let callback_done: bool = env
            .storage()
            .instance()
            .get(&TokenKey::CallbackDone)
            .unwrap_or(false);
        if callback_done {
            return;
        }
        env.storage()
            .instance()
            .set(&TokenKey::CallbackDone, &true);

        let vault: Address = env.storage().instance().get(&TokenKey::Vault).unwrap();
        let user: Address = env.storage().instance().get(&TokenKey::User).unwrap();
        let vault_client = YieldVaultClient::new(&env, &vault);
        env.storage().instance().set(
            &TokenKey::ObservedUserDeposit,
            &vault_client.user_deposit(&user),
        );
        env.storage().instance().set(
            &TokenKey::ObservedAssets,
            &vault_client.total_assets().unwrap(),
        );
        env.storage().instance().set(
            &TokenKey::ObservedShares,
            &vault_client.total_shares(),
        );

        let nested_amount: i128 = env
            .storage()
            .instance()
            .get(&TokenKey::NestedAmount)
            .unwrap();
        let result = vault_client.try_deposit(&user, &nested_amount);
        env.storage().instance().set(
            &TokenKey::ReentrySucceeded,
            &matches!(result, Ok(Ok(_))),
        );
    }
}

#[test]
fn deposit_commits_accounting_before_malicious_token_callback() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token_id = env.register(ReentrantToken, ());
    let vault_id = env.register(YieldVault, ());
    let token = ReentrantTokenClient::new(&env, &token_id);
    let vault = YieldVaultClient::new(&env, &vault_id);

    vault.initialize(&admin, &token_id);
    token.configure(&vault_id, &user, &50);
    token.mint(&user, &150);

    vault.deposit(&user, &100);

    assert_eq!(token.observed_user_deposit(), 100);
    assert_eq!(token.observed_assets(), 100);
    assert_eq!(token.observed_shares(), 100);
    assert!(token.reentry_succeeded());
    assert_eq!(vault.user_deposit(&user), 150);
    assert_eq!(vault.total_assets().unwrap(), 150);
    assert_eq!(vault.total_shares(), 150);
}