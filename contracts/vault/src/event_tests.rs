#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{token, Address, Env, symbol_short};

fn create_token_contract<'a>(env: &Env, admin: &Address) -> token::Client<'a> {
    let token_address = env.register_stellar_asset_contract_v2(admin.clone()).address();
    token::Client::new(env, &token_address)
}

fn find_event_by_name(env: &Env, event_name: &str) -> bool {
    env.events()
        .all()
        .iter()
        .any(|e| e.topics.get(0) == Some(&symbol_short!(event_name)))
}

#[test]
fn test_deposit_emits_event() {
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
    assert!(find_event_by_name(&env, "deposit"));
}

#[test]
fn test_withdraw_emits_event() {
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

    assert!(find_event_by_name(&env, "withdraw"));
}

#[test]
fn test_set_pause_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token_contract(&env, &token_admin);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);
    vault.initialize(&admin, &usdc.address);

    vault.set_pause(&true);
    assert!(find_event_by_name(&env, "vault_paused"));
}

#[test]
fn test_strategy_proposal_created_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let strategy = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token_contract(&env, &token_admin);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);
    vault.initialize(&admin, &usdc.address);

    vault.create_strategy_proposal(&admin, &strategy);
    assert!(find_event_by_name(&env, "strategy_proposal_created"));
}

#[test]
fn test_distribute_yield_emits_event() {
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

    vault.distribute_yield(&100);
    assert!(find_event_by_name(&env, "yield_distributed"));
}
