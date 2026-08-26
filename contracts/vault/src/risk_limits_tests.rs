//! Integration tests for protocol-level exposure caps (Issue #1173).

#![cfg(test)]

use crate::benji_strategy::{BenjiStrategy, BenjiStrategyClient};
use crate::{VaultError, YieldVault, YieldVaultClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{token, Address, Env};

fn create_token<'a>(e: &Env, admin: &Address) -> token::Client<'a> {
    let addr = e
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    token::Client::new(e, &addr)
}

fn setup_vault_with_strategy(
    e: &Env,
) -> (
    YieldVaultClient<'_>,
    token::StellarAssetClient<'_>,
    Address,
    Address,
) {
    let admin = Address::generate(e);
    let token_admin = Address::generate(e);
    let usdc = create_token(e, &token_admin);
    let usdc_sa = token::StellarAssetClient::new(e, &usdc.address);
    let benji_token = create_token(e, &token_admin);

    let vault_id = e.register(YieldVault, ());
    let vault = YieldVaultClient::new(e, &vault_id);
    vault.initialize(&admin, &usdc.address);
    vault.set_admin_param_change_interval(&0);

    let strategy_id = e.register(BenjiStrategy, ());
    let strategy = BenjiStrategyClient::new(e, &strategy_id);
    strategy.initialize(&vault_id, &usdc.address, &benji_token.address);
    vault.whitelist_strategy(&strategy_id, &true);
    vault.set_strategy(&strategy_id);
    vault.set_strategy_heartbeat(&0);

    (vault, usdc_sa, admin, strategy_id)
}

#[test]
fn test_max_vault_tvl_blocks_overrun_and_recovers_after_withdraw() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, usdc_sa, _admin, _strategy) = setup_vault_with_strategy(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &10_000);

    vault.set_max_vault_tvl(&1_000);
    vault.deposit(&user, &1_000);
    assert_eq!(
        vault.try_deposit(&user, &1),
        Err(Ok(VaultError::ExceedsRiskThreshold))
    );

    vault.withdraw(&user, &vault.balance(&user));
    vault.deposit(&user, &400);
    assert_eq!(vault.total_shares(), 400);
}

#[test]
fn test_strategy_cap_blocks_overrun_and_recovers_after_divest() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let (vault, usdc_sa, _admin, strategy) = setup_vault_with_strategy(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &10_000);

    vault.deposit(&user, &5_000);
    vault.set_strategy_cap(&strategy, &1_000);
    assert_eq!(vault.strategy_cap(&strategy), 1_000);

    vault.invest(&1_000);
    assert_eq!(
        vault.try_invest(&1),
        Err(Ok(VaultError::ExceedsStrategyCap))
    );

    vault.divest(&1_000);
    vault.invest(&500);
}

#[test]
fn test_protocol_concentration_blocks_overrun() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let (vault, usdc_sa, _admin, _strategy) = setup_vault_with_strategy(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &10_000);

    vault.deposit(&user, &10_000);
    vault.set_max_conc_bps(&5_000);
    vault.set_max_deployed_bps(&5_000);

    vault.invest(&5_000);
    assert_eq!(
        vault.try_invest(&1),
        Err(Ok(VaultError::ExceedsRiskThreshold))
    );

    vault.divest(&2_000);
    vault.invest(&1_000);
}

#[test]
fn test_stress_mode_tightens_then_override_restores_capacity() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let (vault, usdc_sa, _admin, _strategy) = setup_vault_with_strategy(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &10_000);

    vault.deposit(&user, &10_000);
    vault.set_max_conc_bps(&8_000);
    vault.set_max_deployed_bps(&8_000);
    vault.set_stress_limits(&3_000, &3_000);

    vault.invest(&5_000);

    vault.set_stress_mode(&true);
    assert_eq!(
        vault.try_invest(&1),
        Err(Ok(VaultError::ExceedsRiskThreshold))
    );

    // Override: leave stress mode. 50% is under the 80% normal cap.
    vault.set_stress_mode(&false);
    vault.invest(&1_000);

    assert!(!vault.stress_mode());
    assert_eq!(vault.max_conc_bps(), 8_000);
}

#[test]
fn test_invalid_protocol_limit_params_are_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _usdc_sa, _admin, _strategy) = setup_vault_with_strategy(&env);

    assert_eq!(
        vault.try_set_max_vault_tvl(&-1),
        Err(Ok(VaultError::InvalidAmount))
    );
    assert_eq!(
        vault.try_set_max_conc_bps(&10_001),
        Err(Ok(VaultError::InvalidRiskThreshold))
    );
    assert_eq!(
        vault.try_set_max_deployed_bps(&-1),
        Err(Ok(VaultError::InvalidRiskThreshold))
    );
}

#[test]
fn test_unlimited_defaults_do_not_block_existing_flows() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let (vault, usdc_sa, _admin, _strategy) = setup_vault_with_strategy(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &2_000);

    assert_eq!(vault.max_vault_tvl(), 0);
    assert!(!vault.stress_mode());

    vault.deposit(&user, &2_000);
    vault.invest(&1_000);
}
