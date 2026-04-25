#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{token, Address, Env};

fn create_token_contract<'a>(env: &Env, admin: &Address) -> token::Client<'a> {
    let token_address = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    token::Client::new(env, &token_address)
}

#[test]
fn test_deposit_works() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token_contract(&env, &token_admin);
    let usdc_admin = token::StellarAssetClient::new(&env, &usdc.address);
    usdc_admin.mint(&user, &1000);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);
    vault.initialize(&admin, &usdc.address);

    vault.deposit(&user, &100);
    assert_eq!(vault.balance(&user), 100);
}

#[test]
fn test_withdraw_works() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token_contract(&env, &token_admin);
    let usdc_admin = token::StellarAssetClient::new(&env, &usdc.address);
    usdc_admin.mint(&user, &200);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);
    vault.initialize(&admin, &usdc.address);

    vault.deposit(&user, &100);
    vault.withdraw(&user, &50);
    assert_eq!(vault.balance(&user), 50);
}

#[test]
fn test_pause_unpause_works() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token_contract(&env, &token_admin);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);
    vault.initialize(&admin, &usdc.address);

    vault.pause();
    assert!(vault.is_paused());
    vault.unpause();
    assert!(!vault.is_paused());
}

#[test]
fn test_strategy_proposal_created_works() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let strategy = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token_contract(&env, &token_admin);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);
    vault.initialize(&admin, &usdc.address);

    let proposal_id = vault.create_strategy_proposal(&admin, &strategy);
    assert_eq!(proposal_id, 1);
}

#[test]
fn test_distribute_yield_works() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token_contract(&env, &token_admin);
    let usdc_admin = token::StellarAssetClient::new(&env, &usdc.address);
    usdc_admin.mint(&admin, &500);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);
    vault.initialize(&admin, &usdc.address);

    vault.accrue_yield(&100);
    assert_eq!(vault.total_assets(), 100);
}
