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

    vault.pause(&PauseReason::Maintenance);
    assert!(vault.is_paused());
    assert_eq!(vault.pause_reason(), Some(PauseReason::Maintenance));
    vault.unpause();
    assert!(!vault.is_paused());
    assert_eq!(vault.pause_reason(), None);
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

#[test]
fn test_fee_accrual_event_emitted() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token_contract(&env, &token_admin);
    let usdc_admin = token::StellarAssetClient::new(&env, &usdc.address);
    usdc_admin.mint(&admin, &1000);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);
    vault.initialize(&admin, &usdc.address);

    // 500 bps = 5% fee
    vault.queue_fee_bps_change(&500);
    vault.execute_fee_bps_change();
    vault.accrue_yield(&1000);

    // fee = 1000 * 500 / 10000 = 50; net yield = 950
    assert_eq!(vault.treasury_balance(), 50);
    assert_eq!(vault.total_assets(), 950);
}

#[test]
fn test_fee_accrual_no_event_when_zero_fee() {
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

    // fee_bps defaults to 0 — no fee should accrue
    vault.accrue_yield(&500);
    assert_eq!(vault.treasury_balance(), 0);
    assert_eq!(vault.total_assets(), 500);
}

#[test]
fn test_claim_fees_transfers_to_treasury() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token_contract(&env, &token_admin);
    let usdc_admin = token::StellarAssetClient::new(&env, &usdc.address);
    usdc_admin.mint(&admin, &1000);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);
    vault.initialize(&admin, &usdc.address);
    vault.set_admin_param_change_interval(&0);

    vault.queue_fee_bps_change(&1000); // 10%
    vault.execute_fee_bps_change();
    vault.queue_treasury_change(&treasury);
    vault.execute_treasury_change();
    vault.accrue_yield(&1000); // fee = 100

    assert_eq!(vault.treasury_balance(), 100);
    vault.claim_fees();

    // Balance zeroed after claim
    assert_eq!(vault.treasury_balance(), 0);
    // Treasury address received the tokens
    assert_eq!(usdc.balance(&treasury), 100);
}

#[test]
fn test_claim_fees_returns_error_when_balance_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token_contract(&env, &token_admin);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);
    vault.initialize(&admin, &usdc.address);
    vault.queue_treasury_change(&treasury);
    vault.execute_treasury_change();

    let result = vault.try_claim_fees();
    assert_eq!(result, Err(Ok(VaultError::NoFeesToClaim)));
}

#[test]
fn test_pause_and_unpause_emit_state_transition_events() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token(&env, &token_admin);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);
    vault.initialize(&admin, &usdc.address);

    vault.pause(&PauseReason::Maintenance);
    assert!(!env.events().all().is_empty());

    vault.unpause();
    let events = env.events().all();
    assert!(events.len() >= 2);
}

#[test]
#[should_panic(expected = "treasury not set")]
fn test_claim_fees_panics_when_no_treasury() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token_contract(&env, &token_admin);
    let usdc_admin = token::StellarAssetClient::new(&env, &usdc.address);
    usdc_admin.mint(&admin, &1000);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);
    vault.initialize(&admin, &usdc.address);
    vault.queue_fee_bps_change(&500);
    vault.execute_fee_bps_change();
    vault.accrue_yield(&1000); // accrues 50 in treasury balance

    vault.claim_fees(); // should panic — no treasury set
}

#[test]
fn test_deposit_and_withdraw_emit_events() {
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
    
    let events = env.events().all();
    let mut deposit_found = false;
    for event in events.iter() {
        if event.1.len() > 0 {
            if let Ok(topic_0) = event.1.get(0).unwrap().try_into_val(&env) {
                let topic_sym: soroban_sdk::Symbol = topic_0;
                if topic_sym == symbol_short!("deposit") {
                    deposit_found = true;
                    // Check if second topic is the user
                    let topic_1: Address = event.1.get(1).unwrap().try_into_val(&env).unwrap();
                    assert_eq!(topic_1, user);
                }
            }
        }
    }
    assert!(deposit_found, "Deposit event not found");

    vault.withdraw(&user, &50);
    
    let events_after = env.events().all();
    let mut withdraw_found = false;
    for event in events_after.iter() {
        if event.1.len() > 0 {
            if let Ok(topic_0) = event.1.get(0).unwrap().try_into_val(&env) {
                let topic_sym: soroban_sdk::Symbol = topic_0;
                if topic_sym == symbol_short!("withdraw") {
                    withdraw_found = true;
                    // Check if second topic is the user
                    let topic_1: Address = event.1.get(1).unwrap().try_into_val(&env).unwrap();
                    assert_eq!(topic_1, user);
                }
            }
        }
    }
    assert!(withdraw_found, "Withdraw event not found");
}
