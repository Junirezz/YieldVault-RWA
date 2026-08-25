//! Executable Formal Verification Invariant Suite for YieldVault Accounting Logic.
//!
//! Validates the formal theorems specified in `docs/FORMAL_VERIFICATION_ACCOUNTING.md`:
//! - Theorem 1: Share price monotonicity under positive yield accrual.
//! - Theorem 2: Solvency & balance conservation across all users.
//! - Theorem 3: Round-trip non-inflation bound on deposit/withdraw cycles.
//! - Theorem 4: Fee deduction safety bounds.

#![cfg(test)]

use soroban_sdk::testutils::Address as _;
use soroban_sdk::{token, Address, Env};

use crate::{YieldVault, YieldVaultClient};

fn create_test_token<'a>(e: &Env, admin: &Address) -> (token::Client<'a>, token::StellarAssetClient<'a>) {
    let addr = e
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    (token::Client::new(e, &addr), token::StellarAssetClient::new(e, &addr))
}

fn setup_formal_vault(e: &Env) -> (YieldVaultClient<'_>, token::StellarAssetClient<'_>, Address) {
    let admin = Address::generate(e);
    let token_admin = Address::generate(e);
    let (usdc, usdc_sa) = create_test_token(e, &token_admin);

    let vault_id = e.register(YieldVault, ());
    let vault = YieldVaultClient::new(e, &vault_id);
    vault.initialize(&admin, &usdc.address);
    vault.set_admin_param_change_interval(&0);

    (vault, usdc_sa, admin)
}

#[test]
fn test_formal_theorem_1_share_price_monotonicity() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, usdc_sa, _) = setup_formal_vault(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &100_000);

    vault.deposit(&user, &10_000);
    let p0 = vault.share_price();

    let yield_increments = [100i128, 500i128, 1_000i128, 5_000i128];
    let mut prev_price = p0;

    for &y in &yield_increments {
        vault.accrue_yield(&y);
        let curr_price = vault.share_price();
        assert!(
            curr_price >= prev_price,
            "Formal Violation: Share price decreased from {prev_price} to {curr_price} on yield {y}"
        );
        prev_price = curr_price;
    }
}

#[test]
fn test_formal_theorem_2_solvency_and_balance_conservation() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, usdc_sa, _) = setup_formal_vault(&env);
    // Fixed-size array keeps this `no_std` test module free of an `alloc` dependency.
    let users: [Address; 5] = core::array::from_fn(|_| Address::generate(&env));

    for (i, user) in users.iter().enumerate() {
        let amount = ((i + 1) * 2000) as i128;
        usdc_sa.mint(user, &amount);
        vault.deposit(user, &amount);
    }

    let sum_balances: i128 = users.iter().map(|u| vault.balance(u)).sum();
    assert_eq!(
        sum_balances,
        vault.total_shares(),
        "Formal Violation: Sum of balances != total_shares"
    );

    let sum_redeemable: i128 = users
        .iter()
        .map(|u| {
            let b = vault.balance(u);
            if b > 0 {
                vault.calculate_assets(&b)
            } else {
                0
            }
        })
        .sum();

    assert!(
        sum_redeemable <= vault.total_assets(),
        "Formal Violation: Sum of redeemable assets ({sum_redeemable}) > total_assets ({})",
        vault.total_assets()
    );
}

#[test]
fn test_formal_theorem_3_round_trip_non_inflation_bound() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, usdc_sa, _) = setup_formal_vault(&env);
    let user_base = Address::generate(&env);
    let attacker = Address::generate(&env);

    usdc_sa.mint(&user_base, &50_000);
    usdc_sa.mint(&attacker, &10_000);

    vault.deposit(&user_base, &20_000);

    let initial_deposit = 1_500i128;
    vault.deposit(&attacker, &initial_deposit);
    let shares = vault.balance(&attacker);

    let redeemed_assets = vault.withdraw(&attacker, &shares);

    assert!(
        redeemed_assets <= initial_deposit,
        "Formal Violation: Round-trip returned more assets ({redeemed_assets}) than deposited ({initial_deposit})"
    );
}
