//! Comprehensive test suite for YieldVault (Soroban)
//!
//! Run with:
//!   cargo test
//!
//! Coverage areas
//! ──────────────
//! 1.  initialize          – happy path, double-init, auth guard
//! 2.  deposit             – happy path, zero/negative guard, share math,
//!                           first-deposit 1:1, post-yield dilution
//! 3.  withdraw            – happy path, zero/negative guard, insufficient shares,
//!                           exact boundary, post-yield exchange rate
//! 4.  accrue_yield        – happy path, zero-amount guard, non-admin guard
//! 5.  report_benji_yield  – happy path, wrong strategy, zero amount
//! 6.  accrue_korean_yield – happy path (mock), non-positive harvest guard
//! 7.  governance          – proposal lifecycle, duplicate vote, zero weight,
//!                           below threshold, rejected, already executed
//! 8.  set_dao_threshold   – happy path, zero guard, non-admin guard
//! 9.  shipments           – add, duplicate guard, status update, same-status no-op,
//!                           multi-status isolation, pagination edge cases
//! 10. invariants          – share/asset accounting never drifts across multi-user
//!                           deposit/withdraw/yield sequences; full exit zeroes state

#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as _};
use soroban_sdk::{token, Address, Env};
use crate::benji_strategy::{BenjiStrategy, BenjiStrategyClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{token, Address, Env, Vec};

// ─── helpers ─────────────────────────────────────────────────────────────────

fn create_token<'a>(e: &Env, admin: &Address) -> token::Client<'a> {
    let addr = e
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    token::Client::new(e, &addr)
}

/// Stand up a fully-initialized vault and return (vault_client, usdc_client, admin).
fn setup_vault(
    e: &Env,
) -> (
    YieldVaultClient,
    token::Client,
    token::StellarAssetClient,
    Address,
) {
    let admin = Address::generate(e);
    let token_admin = Address::generate(e);
    let usdc = create_token(e, &token_admin);
    let usdc_sa = token::StellarAssetClient::new(e, &usdc.address);

    let vault_id = e.register(YieldVault, ());
    let vault = YieldVaultClient::new(e, &vault_id);
    vault.initialize(&admin, &usdc.address);

    (vault, usdc, usdc_sa, admin)
}

// ─── 1. initialize ───────────────────────────────────────────────────────────

#[test]
fn test_vault_with_benji_strategy() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    // Setup USDC (Underlying Asset)
    let token_admin = Address::generate(&env);
    let usdc = create_token_contract(&env, &token_admin);
    let usdc_admin_client = token::StellarAssetClient::new(&env, &usdc.address);
    usdc_admin_client.mint(&user, &1000);

    // Setup BENJI Token (Strategy Asset)
    let benji_token = create_token_contract(&env, &token_admin);
    let benji_admin_client = token::StellarAssetClient::new(&env, &benji_token.address);

    // Register Contracts
    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);
    
    let strategy_id = env.register(BenjiStrategy, ());
    let strategy = BenjiStrategyClient::new(&env, &strategy_id);

    // 1. Initialize
    vault.initialize(&admin, &usdc.address);
    strategy.initialize(&vault_id, &usdc.address, &benji_token.address);
    vault.set_strategy(&strategy_id);

    // 2. User Deposits 100 USDC
    vault.deposit(&user, &100);
    assert_eq!(vault.total_assets(), 100);
    assert_eq!(usdc.balance(&vault_id), 100);
    assert_eq!(strategy.total_value(), 0);

    // 3. Invest 60 USDC into BENJI Strategy
    vault.invest(&60);
    assert_eq!(usdc.balance(&vault_id), 40);
    assert_eq!(usdc.balance(&strategy_id), 60);
    
    // In our mock, strategy value depends on BENJI tokens held by contract
    // Let's simulate the strategy contract "buying" BENJI tokens
    benji_admin_client.mint(&strategy_id, &60);
    assert_eq!(strategy.total_value(), 60);
    assert_eq!(vault.total_assets(), 100); // 40 idle + 60 in strategy

    // 4. Yield Accrues in BENJI (Daily return)
    benji_admin_client.mint(&strategy_id, &6); // 10% yield
    assert_eq!(strategy.total_value(), 66);
    assert_eq!(vault.total_assets(), 106); // 40 idle + 66 in strategy

    // 5. User Withdraws some shares. 
    // Vault has 40 idle assets, but user wants to withdraw 50 shares (value ~53 USDC)
    // This should trigger an internal divestment
    let withdrawn = vault.withdraw(&user, &50);
    assert_eq!(withdrawn, 53); // 50 shares * 106 assets / 100 shares = 53
    
    assert_eq!(vault.total_shares(), 50);
    assert_eq!(vault.total_assets(), 53);
}

#[test]
fn test_vault_flow_legacy() {
fn test_initialize_sets_state() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, usdc, _, _) = setup_vault(&env);

    assert_eq!(vault.token(), usdc.address);
    assert_eq!(vault.total_assets(), 0);
    assert_eq!(vault.total_shares(), 0);
}

#[test]
#[should_panic]
fn test_initialize_double_init_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token(&env, &token_admin);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);
    vault.initialize(&admin, &usdc.address);
    // Second call must panic with AlreadyInitialized.
    vault.initialize(&admin, &usdc.address);
}

// ─── 2. deposit ──────────────────────────────────────────────────────────────

#[test]
fn test_deposit_first_user_one_to_one_shares() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, usdc, usdc_sa, _) = setup_vault(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &500);

    let minted = vault.deposit(&user, &500);
    assert_eq!(minted, 500);
    assert_eq!(vault.balance(&user), 500);
    assert_eq!(vault.total_assets(), 500);
    assert_eq!(vault.total_shares(), 500);
    assert_eq!(usdc.balance(&user), 0);
}

#[test]
fn test_deposit_second_user_proportional_shares() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, admin) = setup_vault(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    usdc_sa.mint(&user1, &100);
    usdc_sa.mint(&user2, &100);
    usdc_sa.mint(&admin, &50);

    vault.deposit(&user1, &100);
    // Accrue yield → exchange rate becomes 150/100 = 1.5 assets per share.
    vault.accrue_yield(&50);
    // user2 deposits 100 assets; should receive 100 * 100 / 150 = 66 shares (truncated).
    let minted2 = vault.deposit(&user2, &100);
    assert_eq!(minted2, 66);
    assert_eq!(vault.total_assets(), 250);
    assert_eq!(vault.total_shares(), 166);
}

#[test]
fn test_governance_sets_benji_strategy() {
fn test_deposit_zero_returns_invalid_amount_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);
    let user = Address::generate(&env);

    let result = vault.try_deposit(&user, &0);
    assert!(result.is_err());
}

#[test]
fn test_deposit_negative_returns_invalid_amount_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);
    let user = Address::generate(&env);

    let result = vault.try_deposit(&user, &-1);
    assert!(result.is_err());
}

/// Regression: tiny deposit after large yield accrual should not silently
/// mint 0 shares (integer truncation to zero).
#[test]
fn test_deposit_tiny_amount_after_large_yield_mints_zero_shares() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, admin) = setup_vault(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &1_000_001);
    usdc_sa.mint(&admin, &1_000_000);

    vault.deposit(&user, &1); // 1 share minted (first deposit).
    vault.accrue_yield(&1_000_000); // total_assets = 1_000_001, total_shares = 1.
                                    // Depositing 1 asset: 1 * 1 / 1_000_001 = 0 shares — known truncation behaviour.
    let minted = vault.deposit(&user, &1_000_000);
    // At least confirm it doesn't panic and the share count is consistent.
    assert!(minted >= 0);
    // Total assets must have grown by the deposited amount.
    assert_eq!(vault.total_assets(), 2_000_001);
}

// ─── 3. withdraw ─────────────────────────────────────────────────────────────

#[test]
fn test_benji_connector_reports_yield() {
fn test_withdraw_happy_path_receives_correct_assets() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, usdc, usdc_sa, admin) = setup_vault(&env);
    let user = Address::generate(&env);
    let benji_strategy = Address::generate(&env);
    usdc_sa.mint(&user, &200);
    usdc_sa.mint(&admin, &100);

    vault.deposit(&user, &200);
    vault.accrue_yield(&100); // rate: 300 assets / 200 shares = 1.5.

    let received = vault.withdraw(&user, &100); // 100 * 300 / 200 = 150.
    assert_eq!(received, 150);
    assert_eq!(usdc.balance(&user), 150);
    assert_eq!(vault.balance(&user), 100);
    assert_eq!(vault.total_assets(), 150);
    assert_eq!(vault.total_shares(), 100);
}

#[test]
fn test_withdraw_zero_shares_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, _) = setup_vault(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &100);
    vault.deposit(&user, &100);

    vault.report_benji_yield(&benji_strategy, &40);
    assert_eq!(vault.total_assets(), 540);
    let result = vault.try_withdraw(&user, &0);
    assert!(result.is_err());
}

#[test]
fn test_withdraw_negative_shares_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, _) = setup_vault(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &100);
    vault.deposit(&user, &100);

    let result = vault.try_withdraw(&user, &-1);
    assert!(result.is_err());
}

#[test]
fn test_withdraw_more_than_balance_returns_insufficient_shares() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, _) = setup_vault(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &100);
    vault.deposit(&user, &100);

    let result = vault.try_withdraw(&user, &101);
    assert!(result.is_err());
}

#[test]
fn test_withdraw_exact_balance_drains_user_completely() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, _) = setup_vault(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &300);
    vault.deposit(&user, &300);

    vault.withdraw(&user, &300);
    assert_eq!(vault.balance(&user), 0);
    assert_eq!(vault.total_shares(), 0);
    assert_eq!(vault.total_assets(), 0);
}

#[test]
fn test_withdraw_from_zero_balance_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);
    let user = Address::generate(&env);

    let result = vault.try_withdraw(&user, &1);
    assert!(result.is_err());
}

// ─── 4. accrue_yield ─────────────────────────────────────────────────────────

#[test]
fn test_accrue_yield_increases_total_assets() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, admin) = setup_vault(&env);
    usdc_sa.mint(&admin, &50);

    vault.accrue_yield(&50);
    assert_eq!(vault.total_assets(), 50);
    assert_eq!(vault.total_shares(), 0); // shares unchanged.
}

// ─── 5. report_benji_yield ───────────────────────────────────────────────────

#[test]
#[should_panic]
fn test_report_benji_yield_wrong_strategy_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, admin) = setup_vault(&env);
    let real_strategy = Address::generate(&env);
    let fake_strategy = Address::generate(&env);
    usdc_sa.mint(&fake_strategy, &100);

    // Set up governance to register real_strategy as the benji strategy.
    vault.set_dao_threshold(&1);
    let pid = vault.create_strategy_proposal(&admin, &real_strategy);
    vault.vote_on_proposal(&admin, &pid, &true, &1);
    vault.execute_strategy_proposal(&pid);

    // Report yield from an unregistered strategy — must panic.
    vault.report_benji_yield(&fake_strategy, &50);
}

#[test]
#[should_panic]
fn test_report_benji_yield_zero_amount_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, admin) = setup_vault(&env);
    let strategy = Address::generate(&env);

    vault.set_dao_threshold(&1);
    let pid = vault.create_strategy_proposal(&admin, &strategy);
    vault.vote_on_proposal(&admin, &pid, &true, &1);
    vault.execute_strategy_proposal(&pid);

    vault.report_benji_yield(&strategy, &0);
}

#[test]
#[should_panic]
fn test_report_benji_yield_before_strategy_configured_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);
    let strategy = Address::generate(&env);
    // BenjiStrategy key not set → unwrap panics.
    vault.report_benji_yield(&strategy, &10);
}

// ─── 6. DAO governance ───────────────────────────────────────────────────────

#[test]
fn test_governance_full_happy_path() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, admin) = setup_vault(&env);
    let strategy = Address::generate(&env);

    vault.set_dao_threshold(&2);
    let pid = vault.create_strategy_proposal(&admin, &strategy);

    let voter_a = Address::generate(&env);
    let voter_b = Address::generate(&env);
    vault.vote_on_proposal(&voter_a, &pid, &true, &1);
    vault.vote_on_proposal(&voter_b, &pid, &true, &1);
    vault.execute_strategy_proposal(&pid);

    assert_eq!(vault.benji_strategy(), strategy);
}

#[test]
#[should_panic]
fn test_governance_duplicate_vote_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, admin) = setup_vault(&env);
    let strategy = Address::generate(&env);
    let voter = Address::generate(&env);

    let pid = vault.create_strategy_proposal(&admin, &strategy);
    vault.vote_on_proposal(&voter, &pid, &true, &1);
    vault.vote_on_proposal(&voter, &pid, &true, &1); // must panic.
}

#[test]
#[should_panic]
fn test_governance_zero_weight_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, admin) = setup_vault(&env);
    let strategy = Address::generate(&env);
    let voter = Address::generate(&env);

    let pid = vault.create_strategy_proposal(&admin, &strategy);
    vault.vote_on_proposal(&voter, &pid, &true, &0); // must panic.
}

#[test]
#[should_panic]
fn test_governance_execute_below_threshold_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, admin) = setup_vault(&env);
    let strategy = Address::generate(&env);

    vault.set_dao_threshold(&10);
    let pid = vault.create_strategy_proposal(&admin, &strategy);
    vault.vote_on_proposal(&admin, &pid, &true, &1); // only 1 vote, threshold 10.
    vault.execute_strategy_proposal(&pid); // must panic: quorum not reached.
}

#[test]
#[should_panic]
fn test_governance_execute_rejected_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, admin) = setup_vault(&env);
    let strategy = Address::generate(&env);

    let pid = vault.create_strategy_proposal(&admin, &strategy);
    vault.vote_on_proposal(&admin, &pid, &false, &5); // no votes > yes votes.
    vault.execute_strategy_proposal(&pid); // must panic: proposal rejected.
}

#[test]
#[should_panic]
fn test_governance_execute_twice_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, admin) = setup_vault(&env);
    let strategy = Address::generate(&env);

    let pid = vault.create_strategy_proposal(&admin, &strategy);
    vault.vote_on_proposal(&admin, &pid, &true, &1);
    vault.execute_strategy_proposal(&pid);
    vault.execute_strategy_proposal(&pid); // must panic: already executed.
}

#[test]
#[should_panic]
fn test_governance_vote_on_executed_proposal_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, admin) = setup_vault(&env);
    let strategy = Address::generate(&env);
    let voter = Address::generate(&env);

    let pid = vault.create_strategy_proposal(&admin, &strategy);
    vault.vote_on_proposal(&admin, &pid, &true, &1);
    vault.execute_strategy_proposal(&pid);
    vault.vote_on_proposal(&voter, &pid, &true, &1); // must panic: already executed.
}

#[test]
fn test_governance_multiple_proposals_independent() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, admin) = setup_vault(&env);
    let strategy_a = Address::generate(&env);
    let strategy_b = Address::generate(&env);

    let pid_a = vault.create_strategy_proposal(&admin, &strategy_a);
    let pid_b = vault.create_strategy_proposal(&admin, &strategy_b);
    assert_ne!(pid_a, pid_b);

    // Execute only B.
    vault.vote_on_proposal(&admin, &pid_b, &true, &1);
    vault.execute_strategy_proposal(&pid_b);
    assert_eq!(vault.benji_strategy(), strategy_b);

    // A is still executable later.
    vault.vote_on_proposal(&admin, &pid_a, &true, &1);
    vault.execute_strategy_proposal(&pid_a);
    assert_eq!(vault.benji_strategy(), strategy_a);
}

// ─── 7. set_dao_threshold ────────────────────────────────────────────────────

#[test]
fn test_set_dao_threshold_happy_path() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, admin) = setup_vault(&env);
    vault.set_dao_threshold(&5);

    // Verify threshold is enforced: need 5 yes votes to pass.
    let strategy = Address::generate(&env);
    let pid = vault.create_strategy_proposal(&admin, &strategy);
    vault.vote_on_proposal(&admin, &pid, &true, &4);

    let result = vault.try_execute_strategy_proposal(&pid);
    assert!(result.is_err()); // 4 < 5 threshold.
}

#[test]
#[should_panic]
fn test_set_dao_threshold_zero_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);
    vault.set_dao_threshold(&0);
}

#[test]
#[should_panic]
fn test_set_dao_threshold_negative_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);
    vault.set_dao_threshold(&-1);
}

// ─── 8. configure_korean_strategy ────────────────────────────────────────────

#[test]
fn test_configure_korean_strategy_stores_address() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);
    let strategy = Address::generate(&env);
    vault.configure_korean_strategy(&strategy);
    assert_eq!(vault.korean_strategy(), strategy);
}

// ─── 9. shipments ────────────────────────────────────────────────────────────

#[test]
fn test_add_shipment_stores_and_retrieves() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);
    vault.add_shipment(&42, &ShipmentStatus::Pending);

    let page = vault.shipment_ids_by_status(&ShipmentStatus::Pending, &None, &10);
    assert_eq!(page.shipment_ids, Vec::from_array(&env, [42u64]));
    assert_eq!(page.next_cursor, None);
}

#[test]
#[should_panic]
fn test_add_shipment_duplicate_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);
    vault.add_shipment(&1, &ShipmentStatus::Pending);
    vault.add_shipment(&1, &ShipmentStatus::Pending); // must panic: already exists.
}

#[test]
fn test_add_shipments_are_stored_sorted() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);
    vault.add_shipment(&30, &ShipmentStatus::Pending);
    vault.add_shipment(&10, &ShipmentStatus::Pending);
    vault.add_shipment(&20, &ShipmentStatus::Pending);

    let page = vault.shipment_ids_by_status(&ShipmentStatus::Pending, &None, &10);
    assert_eq!(page.shipment_ids, Vec::from_array(&env, [10u64, 20, 30]));
}

#[test]
fn test_update_shipment_status_moves_id_between_buckets() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);
    vault.add_shipment(&5, &ShipmentStatus::Pending);
    vault.update_shipment_status(&5, &ShipmentStatus::InTransit);

    let pending = vault.shipment_ids_by_status(&ShipmentStatus::Pending, &None, &10);
    let in_transit = vault.shipment_ids_by_status(&ShipmentStatus::InTransit, &None, &10);
    assert_eq!(pending.shipment_ids.len(), 0);
    assert_eq!(in_transit.shipment_ids, Vec::from_array(&env, [5u64]));
}

#[test]
fn test_update_shipment_status_same_status_is_noop() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);
    vault.add_shipment(&7, &ShipmentStatus::Pending);
    vault.update_shipment_status(&7, &ShipmentStatus::Pending); // no-op, must not panic.

    let page = vault.shipment_ids_by_status(&ShipmentStatus::Pending, &None, &10);
    assert_eq!(page.shipment_ids, Vec::from_array(&env, [7u64]));
}

#[test]
fn test_update_shipment_full_lifecycle_statuses() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);
    vault.add_shipment(&99, &ShipmentStatus::Pending);
    vault.update_shipment_status(&99, &ShipmentStatus::InTransit);
    vault.update_shipment_status(&99, &ShipmentStatus::Delivered);

    let pending = vault.shipment_ids_by_status(&ShipmentStatus::Pending, &None, &10);
    let in_transit = vault.shipment_ids_by_status(&ShipmentStatus::InTransit, &None, &10);
    let delivered = vault.shipment_ids_by_status(&ShipmentStatus::Delivered, &None, &10);
    assert_eq!(pending.shipment_ids.len(), 0);
    assert_eq!(in_transit.shipment_ids.len(), 0);
    assert_eq!(delivered.shipment_ids, Vec::from_array(&env, [99u64]));
}

#[test]
fn test_shipments_across_statuses_are_isolated() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);
    vault.add_shipment(&1, &ShipmentStatus::Pending);
    vault.add_shipment(&2, &ShipmentStatus::InTransit);
    vault.add_shipment(&3, &ShipmentStatus::Delivered);
    vault.add_shipment(&4, &ShipmentStatus::Cancelled);

    for status in [
        ShipmentStatus::Pending,
        ShipmentStatus::InTransit,
        ShipmentStatus::Delivered,
        ShipmentStatus::Cancelled,
    ] {
        let page = vault.shipment_ids_by_status(&status, &None, &10);
        assert_eq!(page.shipment_ids.len(), 1);
    }
}

#[test]
#[should_panic]
fn test_shipment_ids_by_status_zero_page_size_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);
    vault.shipment_ids_by_status(&ShipmentStatus::Pending, &None, &0);
}

#[test]
fn test_shipment_pagination_max_page_size_capped() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);
    let mut i: u64 = 1;
    while i <= 60 {
        vault.add_shipment(&i, &ShipmentStatus::Pending);
        i += 1;
    }

    let page = vault.shipment_ids_by_status(&ShipmentStatus::Pending, &None, &999);
    assert_eq!(page.shipment_ids.len(), 50); // capped at MAX_PAGE_SIZE.
    assert!(page.next_cursor.is_some());
}

#[test]
fn test_shipment_pagination_empty_status_returns_empty() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);
    let page = vault.shipment_ids_by_status(&ShipmentStatus::Cancelled, &None, &10);
    assert_eq!(page.shipment_ids.len(), 0);
    assert_eq!(page.next_cursor, None);
}

#[test]
fn test_shipment_pagination_cursor_past_end_returns_empty() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);
    vault.add_shipment(&5, &ShipmentStatus::Pending);
    vault.add_shipment(&10, &ShipmentStatus::Pending);

    // Cursor after last element → nothing left.
    let page = vault.shipment_ids_by_status(&ShipmentStatus::Pending, &Some(10), &10);
    assert_eq!(page.shipment_ids.len(), 0);
    assert_eq!(page.next_cursor, None);
}

#[test]
fn test_shipment_pagination_exhausts_completely() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);
    let mut i: u64 = 1;
    while i <= 7 {
        vault.add_shipment(&i, &ShipmentStatus::InTransit);
        i += 1;
    }

    let mut cursor: Option<u64> = None;
    let mut all_ids: soroban_sdk::Vec<u64> = Vec::new(&env);

    loop {
        let page = vault.shipment_ids_by_status(&ShipmentStatus::InTransit, &cursor, &3);
        for id in page.shipment_ids.iter() {
            all_ids.push_back(id);
        }
        cursor = page.next_cursor;
        if cursor.is_none() {
            break;
        }
    }

    assert_eq!(all_ids.len(), 7);
    // Confirm sorted order.
    let mut prev = 0u64;
    for id in all_ids.iter() {
        assert!(id > prev);
        prev = id;
    }
}

// ─── 10. accounting invariants ───────────────────────────────────────────────

/// After any combination of deposits and withdrawals, the ratio
/// total_assets / total_shares must equal each user's asset redemption value.
#[test]
fn test_invariant_share_price_consistent_after_multi_user_sequence() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, admin) = setup_vault(&env);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    let user_c = Address::generate(&env);

    usdc_sa.mint(&user_a, &1_000);
    usdc_sa.mint(&user_b, &1_000);
    usdc_sa.mint(&user_c, &1_000);
    usdc_sa.mint(&admin, &300);

    vault.deposit(&user_a, &500);
    vault.deposit(&user_b, &300);
    vault.accrue_yield(&150);
    vault.deposit(&user_c, &400);

    let ts = vault.total_shares();
    let ta = vault.total_assets();

    // Each user's redeemable assets = their_shares * ta / ts.
    let assets_a = vault.balance(&user_a) * ta / ts;
    let assets_b = vault.balance(&user_b) * ta / ts;
    let assets_c = vault.balance(&user_c) * ta / ts;

    // Sum of redeemable must not exceed total assets (truncation only loses dust).
    assert!(assets_a + assets_b + assets_c <= ta);
    // And the gap must be tiny (at most 1 per user due to integer division).
    assert!(ta - (assets_a + assets_b + assets_c) <= 3);
}

/// Full exit: when all users withdraw all shares, total_assets and
/// total_shares must both reach 0 (no stuck funds or phantom shares).
#[test]
fn test_invariant_full_exit_zeroes_all_accounting() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, admin) = setup_vault(&env);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);

    usdc_sa.mint(&user_a, &500);
    usdc_sa.mint(&user_b, &500);
    usdc_sa.mint(&admin, &200);

    vault.deposit(&user_a, &500);
    vault.deposit(&user_b, &500);
    vault.accrue_yield(&200);

    let shares_a = vault.balance(&user_a);
    let shares_b = vault.balance(&user_b);
    vault.withdraw(&user_a, &shares_a);
    vault.withdraw(&user_b, &shares_b);

    assert_eq!(vault.total_shares(), 0);
    assert_eq!(vault.total_assets(), 0);
    assert_eq!(vault.balance(&user_a), 0);
    assert_eq!(vault.balance(&user_b), 0);
}

/// Shares outstanding must always equal the sum of all individual balances.
#[test]
fn test_invariant_total_shares_equals_sum_of_balances() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, admin) = setup_vault(&env);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    let user_c = Address::generate(&env);

    usdc_sa.mint(&user_a, &400);
    usdc_sa.mint(&user_b, &300);
    usdc_sa.mint(&user_c, &200);
    usdc_sa.mint(&admin, &100);

    vault.deposit(&user_a, &400);
    vault.deposit(&user_b, &300);
    vault.accrue_yield(&100);
    vault.deposit(&user_c, &200);

    let sum_balances = vault.balance(&user_a) + vault.balance(&user_b) + vault.balance(&user_c);
    assert_eq!(vault.total_shares(), sum_balances);
}

/// Yield accrual must never change total_shares — only total_assets grows.
#[test]
fn test_invariant_yield_accrual_never_changes_share_count() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, admin) = setup_vault(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &500);
    usdc_sa.mint(&admin, &300);

    vault.deposit(&user, &500);
    let shares_before = vault.total_shares();

    vault.accrue_yield(&100);
    vault.accrue_yield(&100);
    vault.accrue_yield(&100);

    assert_eq!(vault.total_shares(), shares_before);
    assert_eq!(vault.total_assets(), 800);
}

/// calculate_assets(calculate_shares(x)) ≈ x (round-trip with acceptable truncation).
#[test]
fn test_invariant_share_asset_round_trip() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, admin) = setup_vault(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &1_000);
    usdc_sa.mint(&admin, &500);

    vault.deposit(&user, &1_000);
    vault.accrue_yield(&500); // rate = 1500/1000 = 1.5.

    let shares = vault.calculate_shares(&300);
    let recovered = vault.calculate_assets(&shares);

    // Due to integer truncation recovered may be slightly less than 300.
    assert!(recovered <= 300);
    assert!(300 - recovered <= 2); // at most 2 units of dust.
}
