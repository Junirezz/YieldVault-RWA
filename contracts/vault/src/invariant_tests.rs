//! Invariant suite for total-assets / total-shares accounting consistency.
//!
//! Issue #735: centralized helpers and scenario tests that assert share/asset
//! invariants hold across deposit, withdraw, invest, divest, and rebalance flows.
//!
//! Run with:
//!   cargo test -p vault invariant

#![cfg(test)]

use crate::benji_strategy::{BenjiStrategy, BenjiStrategyClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{token, Address, Env};

use crate::{YieldVault, YieldVaultClient};

// ─── helpers ─────────────────────────────────────────────────────────────────

fn create_token<'a>(e: &Env, admin: &Address) -> token::Client<'a> {
    let addr = e
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    token::Client::new(e, &addr)
}

fn setup_vault(
    e: &Env,
) -> (
    YieldVaultClient<'_>,
    token::Client<'_>,
    token::StellarAssetClient<'_>,
    Address,
) {
    let admin = Address::generate(e);
    let token_admin = Address::generate(e);
    let usdc = create_token(e, &token_admin);
    let usdc_sa = token::StellarAssetClient::new(e, &usdc.address);

    let vault_id = e.register(YieldVault, ());
    let vault = YieldVaultClient::new(e, &vault_id);
    vault.initialize(&admin, &usdc.address);
    vault.set_admin_param_change_interval(&0);

    (vault, usdc, usdc_sa, admin)
}

fn setup_vault_with_strategy(
    e: &Env,
) -> (
    YieldVaultClient<'_>,
    token::Client<'_>,
    token::StellarAssetClient<'_>,
    BenjiStrategyClient<'_>,
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

    (vault, usdc, usdc_sa, strategy, admin, vault_id)
}

fn setup_vault_with_two_strategies(
    e: &Env,
) -> (
    YieldVaultClient<'_>,
    token::Client<'_>,
    token::StellarAssetClient<'_>,
    BenjiStrategyClient<'_>,
    BenjiStrategyClient<'_>,
    Address,
    Address,
) {
    let admin = Address::generate(e);
    let token_admin = Address::generate(e);
    let usdc = create_token(e, &token_admin);
    let usdc_sa = token::StellarAssetClient::new(e, &usdc.address);
    let benji_token_a = create_token(e, &token_admin);
    let benji_token_b = create_token(e, &token_admin);

    let vault_id = e.register(YieldVault, ());
    let vault = YieldVaultClient::new(e, &vault_id);
    vault.initialize(&admin, &usdc.address);
    vault.set_admin_param_change_interval(&0);

    let strategy_a_id = e.register(BenjiStrategy, ());
    let strategy_a = BenjiStrategyClient::new(e, &strategy_a_id);
    strategy_a.initialize(&vault_id, &usdc.address, &benji_token_a.address);
    vault.whitelist_strategy(&strategy_a_id, &true);

    let strategy_b_id = e.register(BenjiStrategy, ());
    let strategy_b = BenjiStrategyClient::new(e, &strategy_b_id);
    strategy_b.initialize(&vault_id, &usdc.address, &benji_token_b.address);
    vault.whitelist_strategy(&strategy_b_id, &true);

    vault.set_strategy(&strategy_a_id);

    (
        vault, usdc, usdc_sa, strategy_a, strategy_b, admin, vault_id,
    )
}

/// Snapshot of on-chain accounting fields that drive share math.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct AccountingSnapshot {
    total_shares: i128,
    share_price: i128,
}

fn accounting_snapshot(vault: &YieldVaultClient<'_>) -> AccountingSnapshot {
    AccountingSnapshot {
        total_shares: vault.total_shares(),
        share_price: vault.share_price(),
    }
}

/// Assert that invest/divest/rebalance did not touch share accounting.
fn assert_accounting_unchanged(before: AccountingSnapshot, after: AccountingSnapshot) {
    assert_eq!(
        before.total_shares, after.total_shares,
        "total_shares changed across a non-accounting operation"
    );
    assert_eq!(
        before.share_price, after.share_price,
        "share_price changed across a non-accounting operation"
    );
}

/// Core invariant checks for total_assets / total_shares consistency.
fn assert_vault_invariants(vault: &YieldVaultClient<'_>, users: &[Address]) {
    let total_shares = vault.total_shares();
    let sum_balances: i128 = users.iter().map(|u| vault.balance(u)).sum();
    assert_eq!(
        total_shares, sum_balances,
        "total_shares must equal sum of user balances"
    );

    if total_shares == 0 {
        assert_eq!(
            vault.share_price(),
            0,
            "empty vault must have zero share price"
        );
        return;
    }

    let state_assets = vault.calculate_assets(&total_shares);
    assert!(
        state_assets > 0,
        "non-zero shares require positive accounting assets"
    );

    let mut sum_redeemable = 0i128;
    for user in users {
        let user_shares = vault.balance(user);
        if user_shares > 0 {
            sum_redeemable += vault.calculate_assets(&user_shares);
        }
    }

    // Solvency: aggregate redemption claims cannot exceed accounting assets.
    assert!(
        sum_redeemable <= state_assets,
        "sum of redeemable assets ({sum_redeemable}) exceeds accounting total ({state_assets})"
    );

    // Integer truncation may leave at most one unit of dust per holder.
    let dust = state_assets - sum_redeemable;
    assert!(
        dust <= users.len() as i128,
        "accounting dust ({dust}) exceeds per-holder truncation bound"
    );

    // Share price must match accounting total_assets / total_shares (scaled).
    let expected_price = crate::invariants::share_price_from_totals(state_assets, total_shares)
        .expect("share-price invariant");
    assert_eq!(
        vault.share_price(),
        expected_price,
        "share_price inconsistent with accounting assets/shares ratio"
    );
}

// ─── Issue #735: asset/share invariant suite ─────────────────────────────────

#[test]
fn test_invariant_suite_deposit_withdraw_sequence() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, admin) = setup_vault(&env);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    let users = [user_a.clone(), user_b.clone()];

    usdc_sa.mint(&user_a, &2_000);
    usdc_sa.mint(&user_b, &1_500);
    usdc_sa.mint(&admin, &500);

    vault.deposit(&user_a, &1_000);
    assert_vault_invariants(&vault, &users);

    vault.deposit(&user_b, &800);
    assert_vault_invariants(&vault, &users);

    vault.accrue_yield(&300);
    assert_vault_invariants(&vault, &users);

    vault.deposit(&user_a, &400);
    assert_vault_invariants(&vault, &users);

    let partial = vault.balance(&user_b) / 2;
    vault.withdraw(&user_b, &partial);
    assert_vault_invariants(&vault, &users);

    let remaining = vault.balance(&user_b);
    vault.withdraw(&user_b, &remaining);
    assert_vault_invariants(&vault, &users);
}

#[test]
fn test_invariant_suite_invest_divest_preserves_accounting() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (vault, _, usdc_sa, _strategy, _admin, _vault_id) = setup_vault_with_strategy(&env);
    let user = Address::generate(&env);
    let users = [user.clone()];

    usdc_sa.mint(&user, &5_000);
    vault.deposit(&user, &3_000);
    assert_vault_invariants(&vault, &users);

    let before = accounting_snapshot(&vault);
    vault.invest(&2_000);
    assert_accounting_unchanged(before, accounting_snapshot(&vault));
    assert_vault_invariants(&vault, &users);

    vault.divest(&1_000);
    assert_accounting_unchanged(before, accounting_snapshot(&vault));
    assert_vault_invariants(&vault, &users);

    let shares = vault.balance(&user) / 4;
    vault.withdraw(&user, &shares);
    assert_vault_invariants(&vault, &users);
}

#[test]
fn test_invariant_suite_rebalance_preserves_accounting() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (vault, _, usdc_sa, strategy_a, strategy_b, _admin, _vault_id) =
        setup_vault_with_two_strategies(&env);
    let user = Address::generate(&env);
    let users = [user.clone()];

    usdc_sa.mint(&user, &10_000);
    vault.deposit(&user, &5_000);
    assert_vault_invariants(&vault, &users);

    vault.invest(&3_500);
    let before = accounting_snapshot(&vault);
    assert_vault_invariants(&vault, &users);

    vault.rebalance(&strategy_a.address, &strategy_b.address, &1_500, &0, &0);
    assert_accounting_unchanged(before, accounting_snapshot(&vault));
    assert_vault_invariants(&vault, &users);

    vault.rebalance(&strategy_a.address, &strategy_b.address, &500, &0, &0);
    assert_accounting_unchanged(before, accounting_snapshot(&vault));
    assert_vault_invariants(&vault, &users);

    vault.divest(&800);
    assert_vault_invariants(&vault, &users);

    let withdraw_shares = vault.balance(&user) / 5;
    vault.withdraw(&user, &withdraw_shares);
    assert_vault_invariants(&vault, &users);
}

#[test]
fn test_invariant_suite_full_flow_deposit_invest_rebalance_withdraw_yield() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (vault, _, usdc_sa, strategy_a, strategy_b, admin, _vault_id) =
        setup_vault_with_two_strategies(&env);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    let users = [user_a.clone(), user_b.clone()];

    usdc_sa.mint(&user_a, &4_000);
    usdc_sa.mint(&user_b, &3_000);
    usdc_sa.mint(&admin, &1_000);

    vault.deposit(&user_a, &2_000);
    assert_vault_invariants(&vault, &users);

    vault.deposit(&user_b, &1_500);
    assert_vault_invariants(&vault, &users);

    vault.invest(&2_500);
    assert_vault_invariants(&vault, &users);

    vault.rebalance(&strategy_a.address, &strategy_b.address, &1_000, &0, &0);
    assert_vault_invariants(&vault, &users);

    vault.accrue_yield(&500);
    assert_vault_invariants(&vault, &users);

    vault.divest(&600);
    assert_vault_invariants(&vault, &users);

    vault.withdraw(&user_a, &200);
    assert_vault_invariants(&vault, &users);

    vault.withdraw(&user_b, &100);
    assert_vault_invariants(&vault, &users);
}

#[test]
fn test_invariant_suite_multi_user_after_strategy_liquidity_moves() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (vault, _, usdc_sa, _strategy, admin, _vault_id) = setup_vault_with_strategy(&env);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    let user_c = Address::generate(&env);
    let users = [user_a.clone(), user_b.clone(), user_c.clone()];

    usdc_sa.mint(&user_a, &3_000);
    usdc_sa.mint(&user_b, &2_000);
    usdc_sa.mint(&user_c, &1_500);
    usdc_sa.mint(&admin, &500);

    vault.deposit(&user_a, &1_200);
    vault.deposit(&user_b, &900);
    vault.deposit(&user_c, &600);
    assert_vault_invariants(&vault, &users);

    let before = accounting_snapshot(&vault);
    vault.invest(&1_800);
    assert_accounting_unchanged(before, accounting_snapshot(&vault));
    assert_vault_invariants(&vault, &users);

    vault.divest(&900);
    assert_accounting_unchanged(before, accounting_snapshot(&vault));
    assert_vault_invariants(&vault, &users);

    vault.accrue_yield(&200);
    assert_vault_invariants(&vault, &users);

    vault.withdraw(&user_a, &100);
    vault.withdraw(&user_b, &50);
    assert_vault_invariants(&vault, &users);
}

#[test]
fn test_invariant_suite_full_exit_zeroes_accounting_after_strategy_ops() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (vault, _, usdc_sa, _strategy, admin, _vault_id) = setup_vault_with_strategy(&env);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    let users = [user_a.clone(), user_b.clone()];

    usdc_sa.mint(&user_a, &2_000);
    usdc_sa.mint(&user_b, &2_000);
    usdc_sa.mint(&admin, &500);

    vault.deposit(&user_a, &1_000);
    vault.deposit(&user_b, &1_000);
    vault.invest(&1_500);
    assert_vault_invariants(&vault, &users);

    vault.divest(&1_500);
    vault.accrue_yield(&300);
    assert_vault_invariants(&vault, &users);

    let shares_a = vault.balance(&user_a);
    let shares_b = vault.balance(&user_b);
    vault.withdraw(&user_a, &shares_a);
    vault.withdraw(&user_b, &shares_b);

    assert_eq!(vault.total_shares(), 0);
    assert_eq!(vault.share_price(), 0);
    assert_vault_invariants(&vault, &users);
}

#[test]
fn test_invariant_share_price_monotonicity_under_yield_accrual() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, admin) = setup_vault(&env);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    let users = [user_a.clone(), user_b.clone()];

    usdc_sa.mint(&user_a, &10_000);
    usdc_sa.mint(&user_b, &10_000);
    usdc_sa.mint(&admin, &5_000);

    vault.deposit(&user_a, &2_000);
    vault.deposit(&user_b, &3_000);

    let price_0 = vault.share_price();
    assert!(price_0 > 0);

    vault.accrue_yield(&500);
    let price_1 = vault.share_price();
    assert!(
        price_1 >= price_0,
        "share price must not decrease on yield accrual"
    );

    vault.accrue_yield(&1_200);
    let price_2 = vault.share_price();
    assert!(
        price_2 >= price_1,
        "share price must not decrease on subsequent yield accrual"
    );

    assert_vault_invariants(&vault, &users);
}

#[test]
fn test_invariant_share_price_monotonicity_under_deposits_and_withdrawals() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, admin) = setup_vault(&env);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    let users = [user_a.clone(), user_b.clone()];

    usdc_sa.mint(&user_a, &20_000);
    usdc_sa.mint(&user_b, &20_000);
    usdc_sa.mint(&admin, &5_000);

    vault.deposit(&user_a, &5_000);
    let price_after_dep_1 = vault.share_price();

    vault.deposit(&user_b, &5_000);
    let price_after_dep_2 = vault.share_price();
    assert!(
        price_after_dep_2 >= price_after_dep_1 - 1,
        "deposit at current exchange rate must preserve share price"
    );

    vault.accrue_yield(&1_000);
    let price_after_yield = vault.share_price();
    assert!(price_after_yield >= price_after_dep_2);

    let withdraw_shares = vault.balance(&user_a) / 2;
    vault.withdraw(&user_a, &withdraw_shares);
    let price_after_withdraw = vault.share_price();
    assert!(
        price_after_withdraw >= price_after_yield - 1,
        "withdrawal at current exchange rate must preserve share price"
    );

    assert_vault_invariants(&vault, &users);
}

// ─── Issue #1166: contract-level total-supply / share-price enforcement ──────

#[test]
fn test_contract_invariants_hold_across_deposit_yield_withdraw() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, admin) = setup_vault(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &5_000);
    usdc_sa.mint(&admin, &1_000);

    vault.deposit(&user, &1_000);
    assert_eq!(
        crate::invariants::assert_vault_state_invariants(&crate::VaultState {
            total_shares: vault.total_shares(),
            total_assets: vault.calculate_assets(&vault.total_shares()),
            is_paused: false,
        }),
        Ok(())
    );

    vault.accrue_yield(&250);
    let shares = vault.total_shares();
    let assets = vault.calculate_assets(&shares);
    assert_eq!(
        vault.share_price(),
        crate::invariants::share_price_from_totals(assets, shares).unwrap()
    );

    vault.withdraw(&user, &vault.balance(&user));
    assert_eq!(vault.total_shares(), 0);
    assert_eq!(vault.share_price(), 0);
}

#[test]
fn test_unbacked_shares_snapshot_is_rejected() {
    let broken = crate::VaultState {
        total_shares: 100,
        total_assets: 0,
        is_paused: false,
    };
    assert_eq!(
        crate::invariants::assert_vault_state_invariants(&broken),
        Err(crate::VaultError::MathOverflow)
    );
}
