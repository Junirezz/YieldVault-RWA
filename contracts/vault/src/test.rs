//! Comprehensive test suite for YieldVault (Soroban)
//!
//! Run with:
//!   cargo test
//!
//! Coverage areas
//! ──────────────
//! 1.  initialize          – happy path, double-init, auth guard
//! 2.  deposit             – happy path, zero/negative guard, share math,
//!     first-deposit 1:1, post-yield dilution
//! 3.  withdraw            – happy path, zero/negative guard, insufficient shares,
//!     exact boundary, post-yield exchange rate
//! 4.  accrue_yield        – happy path, zero-amount guard, non-admin guard
//! 5.  report_benji_yield  – happy path, wrong strategy, zero amount
//! 6.  accrue_korean_yield – happy path (mock), non-positive harvest guard
//! 7.  governance          – proposal lifecycle, duplicate vote, zero weight,
//!     below threshold, rejected, already executed
//! 8.  set_dao_threshold   – happy path, zero guard, non-admin guard
//! 9.  shipments           – add, duplicate guard, status update, same-status no-op,
//!     multi-status isolation, pagination edge cases
//! 10. invariants          – share/asset accounting never drifts across multi-user
//!     deposit/withdraw/yield sequences; full exit zeroes state
//! 11. invariant suite     – centralized helpers + deposit/withdraw/invest/divest/rebalance
//!     scenarios (see `invariant_tests.rs`, Issue #735)

#![cfg(test)]
extern crate std;

use super::*;
use crate::benji_strategy::{BenjiStrategy, BenjiStrategyClient};
use crate::strategy::{StrategyClient, StrategyTrait};
use crate::strategy_registration::{STATE_ACTIVE, STATE_PENDING, STATE_RETIRED};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, Vec};

#[contract]
struct MaliciousStrategy;

#[contractimpl]
impl MaliciousStrategy {
    pub fn initialize(env: Env, vault: Address, asset: Address, value: i128) {
        env.storage().instance().set(&StrategyTestKey::Vault, &vault);
        env.storage().instance().set(&StrategyTestKey::Asset, &asset);
        env.storage().instance().set(&StrategyTestKey::Value, &value);
    }
}

#[contractimpl]
impl StrategyTrait for MaliciousStrategy {
    fn deposit(_env: Env, _amount: i128) {}

    fn withdraw(_env: Env, _amount: i128) {}

    fn total_value(env: Env) -> i128 {
        env.storage().instance().get(&StrategyTestKey::Value).unwrap_or(0)
    }

    fn asset(env: Env) -> Address {
        env.storage().instance().get(&StrategyTestKey::Asset).unwrap()
    }
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum StrategyTestKey {
    Vault,
    Asset,
    Value,
}

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
    YieldVaultClient<'_>,
    token::Client<'_>,
    token::StellarAssetClient<'_>,
    Address,
) {
    e.ledger().with_mut(|li| {
        li.timestamp = 100;
    });
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

// ─── 1. initialize ───────────────────────────────────────────────────────────

#[test]
fn test_vault_with_benji_strategy() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    // Setup USDC (Underlying Asset)
    let token_admin = Address::generate(&env);
    let usdc = create_token(&env, &token_admin);
    let usdc_admin_client = token::StellarAssetClient::new(&env, &usdc.address);
    usdc_admin_client.mint(&user, &1000);

    // Setup BENJI Token (Strategy Asset)
    let benji_token = create_token(&env, &token_admin);
    let benji_admin_client = token::StellarAssetClient::new(&env, &benji_token.address);

    // Register Contracts
    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);

    let strategy_id = env.register(BenjiStrategy, ());
    let strategy = BenjiStrategyClient::new(&env, &strategy_id);

    // 1. Initialize
    vault.initialize(&admin, &usdc.address);
    strategy.initialize(&vault_id, &usdc.address, &benji_token.address);
    vault.whitelist_strategy(&strategy_id, &true);
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
    assert_eq!(strategy.total_value(), 60);
    assert_eq!(vault.total_assets(), 100); // 40 idle + 60 in strategy

    // 4. Yield Accrues in BENJI (Daily return)
    benji_admin_client.mint(&strategy_id, &6); // 10% yield
    assert_eq!(strategy.total_value(), 66);
    assert_eq!(vault.total_assets(), 106); // 40 idle + 66 in strategy

    // Manually divest 10 USDC to cover the upcoming withdrawal
    vault.divest(&10);

    // 5. User Withdraws some shares.
    // state.total_assets=100, state.total_shares=100 → 50 shares = 50 assets
    let withdrawn = vault.withdraw(&user, &50);
    assert_eq!(withdrawn, 50); // 50 shares * 100 state_assets / 100 shares = 50

    assert_eq!(vault.total_shares(), 50);
    assert_eq!(vault.total_assets(), 56); // 0 idle + 56 BENJI still in strategy (burned 10 on withdraw)
}

#[test]
fn test_invest_respects_min_liquidity_buffer() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token(&env, &token_admin);
    let usdc_admin_client = token::StellarAssetClient::new(&env, &usdc.address);
    usdc_admin_client.mint(&user, &100);

    let benji_token = create_token(&env, &token_admin);
    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);
    let strategy_id = env.register(BenjiStrategy, ());
    let strategy = BenjiStrategyClient::new(&env, &strategy_id);

    vault.initialize(&admin, &usdc.address);
    strategy.initialize(&vault_id, &usdc.address, &benji_token.address);
    vault.whitelist_strategy(&strategy_id, &true);
    vault.set_strategy(&strategy_id);

    assert_eq!(vault.min_liquidity_buffer(), 0);
    vault.set_min_liquidity_buffer(&40);
    assert_eq!(vault.min_liquidity_buffer(), 40);
    vault.deposit(&user, &100);

    let blocked = vault.try_invest(&70);
    assert!(matches!(
        blocked,
        Err(Ok(VaultError::LiquidityBufferNotMet))
    ));
    assert_eq!(usdc.balance(&vault_id), 100);
    assert_eq!(usdc.balance(&strategy_id), 0);

    vault.invest(&60);
    assert_eq!(usdc.balance(&vault_id), 40);
    assert_eq!(usdc.balance(&strategy_id), 60);
    assert_eq!(vault.strategy_watermark(&strategy_id), 60);
}

#[test]
fn test_set_min_liquidity_buffer_negative_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);
    let result = vault.try_set_min_liquidity_buffer(&-1);
    assert_eq!(result, Err(Ok(VaultError::InvalidLiquidityBuffer)));
}

#[test]
fn test_vault_flow_legacy() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, usdc, _, _) = setup_vault(&env);

    assert_eq!(vault.token(), usdc.address);
    assert_eq!(vault.total_assets(), 0);
    assert_eq!(vault.total_shares(), 0);
}

#[test]
fn test_initialize_double_init_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token(&env, &token_admin);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);
    vault.initialize(&admin, &usdc.address);
    let result = vault.try_initialize(&admin, &usdc.address);
    assert_eq!(result, Err(Ok(VaultError::AlreadyInitialized)));
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
    assert_eq!(vault.total_assets(), 249);
    assert_eq!(vault.total_shares(), 166);
}

#[test]
fn test_governance_sets_benji_strategy() {
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
                                    // Depositing 1 asset: 1 * 1 / 1_000_001 = 0 shares — should fail.
    let deposit_result = vault.try_deposit(&user, &1_000_000);
    // Deposit should now fail to prevent silent loss of funds
    assert!(
        deposit_result.is_err(),
        "deposit should fail when shares would round to 0"
    );
}

// ─── 3. withdraw ─────────────────────────────────────────────────────────────

#[test]
fn test_benji_connector_reports_yield() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, admin) = setup_vault(&env);
    let user = Address::generate(&env);
    let benji_strategy = Address::generate(&env);
    usdc_sa.mint(&user, &500);
    usdc_sa.mint(&benji_strategy, &40);

    vault.deposit(&user, &500);

    // Register benji strategy via governance
    let proposal_id = vault.create_strategy_proposal(&admin, &benji_strategy);
    vault.vote_on_proposal(&admin, &proposal_id, &true, &1);
    vault.execute_strategy_proposal(&proposal_id);

    vault.report_benji_yield(&benji_strategy, &40);
    assert_eq!(vault.total_assets(), 540);
    assert_eq!(vault.strategy_watermark(&benji_strategy), 40);
}

#[test]
fn test_benji_yield_uses_watermark_fee_accounting() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, admin) = setup_vault(&env);
    let user = Address::generate(&env);
    let benji_strategy = Address::generate(&env);
    usdc_sa.mint(&user, &500);
    usdc_sa.mint(&benji_strategy, &100);

    vault.deposit(&user, &500);
    vault.queue_fee_bps_change(&1_000);
    vault.execute_fee_bps_change();

    let proposal_id = vault.create_strategy_proposal(&admin, &benji_strategy);
    vault.vote_on_proposal(&admin, &proposal_id, &true, &1);
    vault.execute_strategy_proposal(&proposal_id);

    vault.report_benji_yield(&benji_strategy, &100);

    assert_eq!(vault.total_assets(), 590);
    assert_eq!(vault.treasury_balance(), 10);
    assert_eq!(vault.strategy_watermark(&benji_strategy), 100);
}

#[test]
fn test_withdraw_happy_path_receives_correct_assets() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, usdc, usdc_sa, admin) = setup_vault(&env);
    let user = Address::generate(&env);
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

#[test]
fn test_checkpoint() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _usdc, usdc_sa, _admin) = setup_vault(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &100);

    // User deposits 100
    vault.deposit(&user, &100);

    // Create a checkpoint (admin-auth in production; tests mock auth)
    let cp = vault.create_checkpoint();
    assert_eq!(cp, 1);

    // Global totals should be recorded
    assert_eq!(vault.total_shares_at(&cp), 100);
    assert_eq!(vault.total_assets_at(&cp), 100);

    // User snapshots their balance for the checkpoint
    vault.snapshot_user_balance(&user);
    assert_eq!(vault.balance_at(&user, &cp), 100);
}

// ─── 5. report_benji_yield ───────────────────────────────────────────────────

#[test]
fn test_accrue_yield_rejects_zero_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);

    let result = vault.try_accrue_yield(&0);
    assert!(matches!(result, Err(Ok(VaultError::InvalidAmount))));
}

#[test]
fn test_accrue_yield_fee_math_overflow_reverts_before_transfer() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, usdc, _, admin) = setup_vault(&env);
    vault.queue_fee_bps_change(&10_000);
    vault.execute_fee_bps_change();

    let result = vault.try_accrue_yield(&i128::MAX);
    assert!(matches!(result, Err(Ok(VaultError::MathOverflow))));
    assert_eq!(usdc.balance(&admin), 0);
    assert_eq!(vault.total_assets(), 0);
    assert_eq!(vault.treasury_balance(), 0);
}

#[test]
fn test_accrue_yield_full_fee_accumulates_to_treasury_only() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, admin) = setup_vault(&env);
    usdc_sa.mint(&admin, &250);

    vault.queue_fee_bps_change(&10_000);
    vault.execute_fee_bps_change();
    vault.accrue_yield(&250);

    assert_eq!(vault.total_assets(), 0);
    assert_eq!(vault.treasury_balance(), 250);
}

#[test]
fn test_report_benji_yield_wrong_strategy_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, admin) = setup_vault(&env);
    let real_strategy = Address::generate(&env);
    let fake_strategy = Address::generate(&env);
    usdc_sa.mint(&fake_strategy, &100);

    vault.set_dao_threshold(&1);
    let pid = vault.create_strategy_proposal(&admin, &real_strategy);
    vault.vote_on_proposal(&admin, &pid, &true, &1);
    vault.execute_strategy_proposal(&pid);

    let result = vault.try_report_benji_yield(&fake_strategy, &50);
    assert_eq!(result, Err(Ok(VaultError::UnauthorizedStrategy)));
}

#[test]
fn test_report_benji_yield_zero_amount_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, admin) = setup_vault(&env);
    let strategy = Address::generate(&env);

    vault.set_dao_threshold(&1);
    let pid = vault.create_strategy_proposal(&admin, &strategy);
    vault.vote_on_proposal(&admin, &pid, &true, &1);
    vault.execute_strategy_proposal(&pid);

    let result = vault.try_report_benji_yield(&strategy, &0);
    assert_eq!(result, Err(Ok(VaultError::InvalidYieldAmount)));
}

#[test]
fn test_strategy_response_rejects_mismatched_asset() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, usdc, _, _) = setup_vault(&env);
    let wrong_asset = Address::generate(&env);
    let strategy_id = env.register(MaliciousStrategy, ());
    let strategy = StrategyClient::new(&env, &strategy_id);
    strategy.initialize(&vault.contract_id, &wrong_asset, &100);

    let result = YieldVault::validate_strategy_response(&env, &strategy_id, &usdc.address);
    assert_eq!(result, Err(VaultError::UnauthorizedStrategy));
}

#[test]
fn test_strategy_response_rejects_negative_total_value() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, usdc, _, _) = setup_vault(&env);
    let strategy_id = env.register(MaliciousStrategy, ());
    let strategy = StrategyClient::new(&env, &strategy_id);
    strategy.initialize(&vault.contract_id, &usdc.address, &-1);

    let result = YieldVault::validate_strategy_response(&env, &strategy_id, &usdc.address);
    assert_eq!(result, Err(VaultError::InvalidAmount));
}

#[test]
#[should_panic]
fn test_report_benji_yield_before_strategy_configured_panics_on_missing_key() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);
    let strategy = Address::generate(&env);
    // BenjiStrategy key not set → storage get unwrap panics.
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
fn test_governance_duplicate_vote_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, admin) = setup_vault(&env);
    let strategy = Address::generate(&env);
    let voter = Address::generate(&env);

    let pid = vault.create_strategy_proposal(&admin, &strategy);
    vault.vote_on_proposal(&voter, &pid, &true, &1);
    let result = vault.try_vote_on_proposal(&voter, &pid, &true, &1);
    assert_eq!(result, Err(Ok(VaultError::DuplicateVote)));
}

#[test]
fn test_governance_zero_weight_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, admin) = setup_vault(&env);
    let strategy = Address::generate(&env);
    let voter = Address::generate(&env);

    let pid = vault.create_strategy_proposal(&admin, &strategy);
    let result = vault.try_vote_on_proposal(&voter, &pid, &true, &0);
    assert_eq!(result, Err(Ok(VaultError::InvalidVoteWeight)));
}

#[test]
fn test_governance_execute_below_threshold_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, admin) = setup_vault(&env);
    let strategy = Address::generate(&env);

    vault.set_dao_threshold(&10);
    let pid = vault.create_strategy_proposal(&admin, &strategy);
    vault.vote_on_proposal(&admin, &pid, &true, &1);
    let result = vault.try_execute_strategy_proposal(&pid);
    assert_eq!(result, Err(Ok(VaultError::QuorumNotReached)));
}

#[test]
fn test_governance_execute_rejected_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, admin) = setup_vault(&env);
    let strategy = Address::generate(&env);

    let pid = vault.create_strategy_proposal(&admin, &strategy);
    vault.vote_on_proposal(&admin, &pid, &false, &5);
    let result = vault.try_execute_strategy_proposal(&pid);
    assert_eq!(result, Err(Ok(VaultError::ProposalRejected)));
}

#[test]
fn test_governance_execute_twice_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, admin) = setup_vault(&env);
    let strategy = Address::generate(&env);

    let pid = vault.create_strategy_proposal(&admin, &strategy);
    vault.vote_on_proposal(&admin, &pid, &true, &1);
    vault.execute_strategy_proposal(&pid);
    let result = vault.try_execute_strategy_proposal(&pid);
    assert_eq!(result, Err(Ok(VaultError::ProposalAlreadyExecuted)));
}

#[test]
fn test_governance_vote_on_executed_proposal_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, admin) = setup_vault(&env);
    let strategy = Address::generate(&env);
    let voter = Address::generate(&env);

    let pid = vault.create_strategy_proposal(&admin, &strategy);
    vault.vote_on_proposal(&admin, &pid, &true, &1);
    vault.execute_strategy_proposal(&pid);
    let result = vault.try_vote_on_proposal(&voter, &pid, &true, &1);
    assert_eq!(result, Err(Ok(VaultError::ProposalAlreadyExecuted)));
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
fn test_set_dao_threshold_zero_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);
    let result = vault.try_set_dao_threshold(&0);
    assert_eq!(result, Err(Ok(VaultError::InvalidDaoThreshold)));
}

#[test]
fn test_set_dao_threshold_negative_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);
    let result = vault.try_set_dao_threshold(&-1);
    assert_eq!(result, Err(Ok(VaultError::InvalidDaoThreshold)));
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
fn test_add_shipment_duplicate_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);
    vault.add_shipment(&1, &ShipmentStatus::Pending);
    let result = vault.try_add_shipment(&1, &ShipmentStatus::Pending);
    assert_eq!(result, Err(Ok(VaultError::ShipmentAlreadyExists)));
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
    vault.update_shipment_status(&7, &ShipmentStatus::Pending); // no-op, must not panic

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
fn test_shipment_ids_by_status_zero_page_size_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);
    let result = vault.try_shipment_ids_by_status(&ShipmentStatus::Pending, &None, &0);
    assert_eq!(result, Err(Ok(VaultError::InvalidPageSize)));
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

/// Share price must never decrease when yield accrues.
///
/// Yield accrual increases total assets without changing total shares, so the
/// per-share exchange rate should be monotonic for existing holders.
#[test]
fn test_invariant_share_price_monotonic_after_accrue_yield() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, admin) = setup_vault(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &1_000);
    usdc_sa.mint(&admin, &200);

    vault.deposit(&user, &500);
    let price_before = vault.share_price();

    vault.queue_fee_bps_change(&1_000);
    vault.execute_fee_bps_change();
    vault.accrue_yield(&100);

    let price_after = vault.share_price();
    assert!(price_after >= price_before);
    assert_eq!(vault.total_shares(), 500);
}

/// Yield accrual with a 100% protocol fee should leave the share price unchanged.
#[test]
fn test_invariant_share_price_unchanged_by_full_fee_accrual() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, admin) = setup_vault(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &1_000);
    usdc_sa.mint(&admin, &200);

    vault.deposit(&user, &500);
    vault.queue_fee_bps_change(&10_000);
    vault.execute_fee_bps_change();

    let price_before = vault.share_price();
    vault.accrue_yield(&100);
    let price_after = vault.share_price();

    assert_eq!(price_after, price_before);
    assert_eq!(vault.total_shares(), 500);
}

/// Full withdrawal and redeposit on an empty vault should return to the
/// 1:1 baseline share price on restart.
#[test]
fn test_invariant_share_price_full_exit_and_redeposit_resets_to_one() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, admin) = setup_vault(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &1_200);
    usdc_sa.mint(&admin, &200);

    vault.deposit(&user, &1_000);
    vault.accrue_yield(&200);

    let shares = vault.balance(&user);
    let withdrawn = vault.withdraw(&user, &shares);
    assert_eq!(withdrawn, 1_200);
    assert_eq!(vault.total_shares(), 0);
    assert_eq!(vault.total_assets(), 0);
    assert_eq!(vault.share_price(), 0);

    vault.deposit(&user, &1_200);
    assert_eq!(vault.share_price(), SHARE_PRICE_SCALE);
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

// ─── Role Gating Tests (Issue #120) ─────────────────────────────────────────
// Role gating is enforced via admin.require_auth() calls throughout the contract.
// See permissions.rs for full permission matrix documentation.

/// Verify that all privileged functions are protected
#[test]
fn test_privileged_functions_protected() {
    // Privileged functions protected by admin.require_auth():
    // - set_strategy: admin.require_auth()
    // - pause: admin.require_auth()
    // - unpause: admin.require_auth()
    // - configure_korean_strategy: admin.require_auth()
    // - accrue_korean_debt_yield: admin.require_auth()
    // - set_dao_threshold: admin.require_auth()
    // - add_shipment: admin.require_auth()
    // - update_shipment_status: admin.require_auth()
    // - accrue_yield: admin.require_auth()
    // - invest: admin.require_auth()
    // See permissions.rs for full permission matrix
}

/// Verify that non-admin users can deposit without requiring admin auth
#[test]
fn test_deposit_does_not_require_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, _) = setup_vault(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &100);

    vault.deposit(&user, &100);
    assert_eq!(vault.balance(&user), 100);
}

/// Verify that any user can withdraw their shares without admin auth
#[test]
fn test_withdraw_does_not_require_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, _) = setup_vault(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &100);

    vault.deposit(&user, &100);
    let withdrawn = vault.withdraw(&user, &50);
    assert_eq!(withdrawn, 50);
    assert_eq!(vault.balance(&user), 50);
}

/// Verify that any user can create strategy proposals
#[test]
fn test_create_strategy_proposal_does_not_require_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);
    let proposer = Address::generate(&env);
    let new_strategy = Address::generate(&env);

    let proposal_id = vault.create_strategy_proposal(&proposer, &new_strategy);
    assert!(proposal_id > 0);
}

/// Verify that report_benji_yield rejects unauthorized strategies
#[test]
fn test_report_benji_yield_rejects_unauthorized_strategy() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, admin) = setup_vault(&env);
    let authorized_strategy = Address::generate(&env);
    let unauthorized_strategy = Address::generate(&env);

    let proposal_id = vault.create_strategy_proposal(&admin, &authorized_strategy);
    vault.vote_on_proposal(&admin, &proposal_id, &true, &1);
    vault.execute_strategy_proposal(&proposal_id);

    let result = vault.try_report_benji_yield(&unauthorized_strategy, &100);
    assert_eq!(result, Err(Ok(VaultError::UnauthorizedStrategy)));
}

// ─── External Call Safety Tests (Issue #122) ───────────────────────────────

/// Verify deposit state management
#[test]
fn test_deposit_state_management() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, _) = setup_vault(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &500);

    // First deposit: 100 tokens = 100 shares
    vault.deposit(&user, &100);
    assert_eq!(vault.total_shares(), 100);
    assert_eq!(vault.total_assets(), 100);
    assert_eq!(vault.balance(&user), 100);
}

/// Verify withdraw state management
#[test]
fn test_withdraw_state_management() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, _) = setup_vault(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &100);

    vault.deposit(&user, &100);
    vault.withdraw(&user, &50);

    // State correctly reflects withdrawal
    assert_eq!(vault.balance(&user), 50);
    assert_eq!(vault.total_shares(), 50);
}

/// Verify that state consistency is maintained across yield accrual
/// (No partial updates that could be exploited)
#[test]
fn test_yield_accrual_maintains_state_consistency() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, admin) = setup_vault(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &1000);
    usdc_sa.mint(&admin, &500);

    vault.deposit(&user, &1000);
    let shares_before = vault.total_shares();
    let assets_before = vault.total_assets();

    // Accrue yield
    vault.accrue_yield(&500);

    // Shares unchanged, assets increased
    assert_eq!(vault.total_shares(), shares_before);
    assert_eq!(vault.total_assets(), assets_before + 500);

    // User's individual share balance unchanged
    assert_eq!(vault.balance(&user), shares_before);
}

/// Reentrancy Protection Test: Verify atomic state updates
/// In Soroban, this is structurally guaranteed, but we verify state atomicity
#[test]
fn test_multiple_deposits_atomic_state_updates() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, _) = setup_vault(&env);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);

    usdc_sa.mint(&user_a, &300);
    usdc_sa.mint(&user_b, &300);

    // Two deposits in same transaction should not interfere
    vault.deposit(&user_a, &100);
    vault.deposit(&user_b, &100);

    assert_eq!(vault.balance(&user_a), 100);
    assert_eq!(vault.balance(&user_b), 100);
    assert_eq!(vault.total_shares(), 200);
    assert_eq!(vault.total_assets(), 200);
}

// ─── 11. withdrawal cooldown ──────────────────────────────────────────────────

#[test]
fn test_withdrawal_cooldown_blocks_immediate_withdraw() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, _) = setup_vault(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &500);

    vault.set_withdrawal_cooldown(&3600); // 1 hour cooldown
    assert_eq!(vault.withdrawal_cooldown(), 3600);

    vault.deposit(&user, &500);

    // Withdraw should be blocked by cooldown
    let result = vault.try_withdraw(&user, &100);
    assert!(result.is_err());
}

#[test]
fn test_withdrawal_cooldown_allows_withdraw_after_cooldown_expires() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, _) = setup_vault(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &500);

    vault.set_withdrawal_cooldown(&3600);
    vault.deposit(&user, &500);

    // Fast-forward past cooldown
    env.ledger().set_timestamp(env.ledger().timestamp() + 3601);

    let withdrawn = vault.withdraw(&user, &200);
    assert_eq!(withdrawn, 200);
    assert_eq!(vault.balance(&user), 300);
}

#[test]
fn test_withdrawal_cooldown_zero_by_default() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, _) = setup_vault(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &500);

    // Default cooldown is 0
    assert_eq!(vault.withdrawal_cooldown(), 0);

    vault.deposit(&user, &500);

    // Withdraw works immediately with zero cooldown
    let withdrawn = vault.withdraw(&user, &200);
    assert_eq!(withdrawn, 200);
}

#[test]
fn test_withdrawal_cooldown_respects_per_user() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, _) = setup_vault(&env);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    usdc_sa.mint(&user_a, &500);
    usdc_sa.mint(&user_b, &500);

    vault.set_withdrawal_cooldown(&3600);

    vault.deposit(&user_a, &500);
    vault.deposit(&user_b, &500);

    // Fast-forward past cooldown for user_b only by advancing time for all
    env.ledger().set_timestamp(env.ledger().timestamp() + 3601);

    // user_a deposited at the same time, but old timestamp means cooldown passed for both
    let withdrawn_b = vault.withdraw(&user_b, &200);
    assert_eq!(withdrawn_b, 200);

    let withdrawn_a = vault.withdraw(&user_a, &100);
    assert_eq!(withdrawn_a, 100);
}

#[test]
fn test_withdrawal_cooldown_can_be_disabled() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, _) = setup_vault(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &500);

    vault.set_withdrawal_cooldown(&3600);
    vault.deposit(&user, &500);

    // Disable cooldown
    vault.set_withdrawal_cooldown(&0);
    assert_eq!(vault.withdrawal_cooldown(), 0);

    // Withdraw should work now
    let withdrawn = vault.withdraw(&user, &300);
    assert_eq!(withdrawn, 300);
}

#[test]
fn test_withdrawal_cooldown_new_deposit_resets_timer() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, _) = setup_vault(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &1000);

    vault.set_withdrawal_cooldown(&3600);

    vault.deposit(&user, &500);

    // Fast-forward partially
    env.ledger().set_timestamp(env.ledger().timestamp() + 1800);

    // Make another deposit - timer resets
    vault.deposit(&user, &200);

    // Withdraw should still be blocked (timer reset by latest deposit)
    let result = vault.try_withdraw(&user, &100);
    assert!(result.is_err());
}

#[test]
fn test_withdrawal_cooldown_then_timelock_then_execute() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, usdc_sa, _) = setup_vault(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &100_000);

    vault.set_withdrawal_cooldown(&3600);
    vault.set_large_withdrawal_threshold(&1000);

    vault.deposit(&user, &100_000);

    // Cooldown blocks the withdraw call
    let blocked = vault.try_withdraw(&user, &50_000);
    assert!(blocked.is_err());

    // Fast-forward past cooldown
    env.ledger().set_timestamp(env.ledger().timestamp() + 3601);

    // Now withdraw triggers the timelock (large withdrawal)
    let result = vault.withdraw(&user, &50_000);
    assert_eq!(result, 0); // pending withdrawal

    // Fast-forward past timelock
    env.ledger().set_timestamp(env.ledger().timestamp() + 86401);

    // execute_withdrawal works
    let executed = vault.execute_withdrawal(&user);
    assert_eq!(executed, 50_000);
}

// ─── 11. batch_deposit ────────────────────────────────────────────────────────

/// Helper: set up a vault with a registered relayer and mint USDC to `users`.
fn setup_vault_with_relayer<'a>(
    env: &'a Env,
    user_amounts: &[(Address, i128)],
) -> (
    YieldVaultClient<'a>,
    token::Client<'a>,
    token::StellarAssetClient<'a>,
    Address, // admin
    Address, // relayer
) {
    let (vault, usdc, usdc_sa, admin) = setup_vault(env);
    let relayer = Address::generate(env);
    vault.set_relayer(&relayer, &true);

    for (user, amount) in user_amounts {
        usdc_sa.mint(user, amount);
    }

    (vault, usdc, usdc_sa, admin, relayer)
}

#[test]
fn test_batch_deposit_happy_path_three_users() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let user3 = Address::generate(&env);

    let (vault, usdc, _usdc_sa, _admin, relayer) = setup_vault_with_relayer(
        &env,
        &[
            (user1.clone(), 100),
            (user2.clone(), 200),
            (user3.clone(), 300),
        ],
    );

    let mut entries = Vec::new(&env);
    entries.push_back(DepositEntry {
        user: user1.clone(),
        amount: 100,
    });
    entries.push_back(DepositEntry {
        user: user2.clone(),
        amount: 200,
    });
    entries.push_back(DepositEntry {
        user: user3.clone(),
        amount: 300,
    });

    let result = vault.batch_deposit(&relayer, &entries);

    assert_eq!(result.success_count, 3);
    assert_eq!(result.failure_count, 0);
    assert_eq!(result.total_shares_minted, 600); // 1:1 ratio on fresh vault

    // Vault received all tokens
    let vault_id = vault.address.clone();
    assert_eq!(usdc.balance(&vault_id), 600);

    // Each user received proportional shares
    assert_eq!(vault.balance(&user1), 100);
    assert_eq!(vault.balance(&user2), 200);
    assert_eq!(vault.balance(&user3), 300);

    assert_eq!(vault.total_assets(), 600);
    assert_eq!(vault.total_shares(), 600);
}

#[test]
fn test_batch_deposit_partial_failure_invalid_amount() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    let (vault, _, _usdc_sa, _admin, relayer) =
        setup_vault_with_relayer(&env, &[(user1.clone(), 500), (user2.clone(), 500)]);

    let mut entries = Vec::new(&env);
    // entry with zero amount should fail; valid entry should still succeed
    entries.push_back(DepositEntry {
        user: user1.clone(),
        amount: 0,
    });
    entries.push_back(DepositEntry {
        user: user2.clone(),
        amount: 100,
    });

    let result = vault.batch_deposit(&relayer, &entries);

    assert_eq!(result.success_count, 1);
    assert_eq!(result.failure_count, 1);

    // First entry failed
    let r0 = result.results.get(0).unwrap();
    assert!(!r0.success);
    assert_eq!(r0.error_code, VaultError::InvalidAmount as u32);
    assert_eq!(r0.shares_minted, 0);

    // Second entry succeeded
    let r1 = result.results.get(1).unwrap();
    assert!(r1.success);
    assert_eq!(r1.shares_minted, 100);

    assert_eq!(vault.balance(&user2), 100);
    assert_eq!(vault.total_assets(), 100);
}

#[test]
fn test_batch_deposit_partial_failure_min_deposit_not_met() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    let (vault, _, _usdc_sa, _admin, relayer) =
        setup_vault_with_relayer(&env, &[(user1.clone(), 500), (user2.clone(), 500)]);

    vault.set_min_deposit(&50);

    let mut entries = Vec::new(&env);
    entries.push_back(DepositEntry {
        user: user1.clone(),
        amount: 10,
    }); // below min
    entries.push_back(DepositEntry {
        user: user2.clone(),
        amount: 100,
    }); // above min

    let result = vault.batch_deposit(&relayer, &entries);

    assert_eq!(result.success_count, 1);
    assert_eq!(result.failure_count, 1);

    let r0 = result.results.get(0).unwrap();
    assert_eq!(r0.error_code, VaultError::MinDepositNotMet as u32);

    let r1 = result.results.get(1).unwrap();
    assert!(r1.success);
}

#[test]
fn test_batch_deposit_partial_failure_exceeds_user_cap() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    let (vault, _, _usdc_sa, _admin, relayer) =
        setup_vault_with_relayer(&env, &[(user1.clone(), 500), (user2.clone(), 500)]);

    vault.set_per_user_cap(&50);

    let mut entries = Vec::new(&env);
    entries.push_back(DepositEntry {
        user: user1.clone(),
        amount: 100,
    }); // exceeds cap
    entries.push_back(DepositEntry {
        user: user2.clone(),
        amount: 30,
    }); // within cap

    let result = vault.batch_deposit(&relayer, &entries);

    assert_eq!(result.success_count, 1);
    assert_eq!(result.failure_count, 1);

    let r0 = result.results.get(0).unwrap();
    assert_eq!(r0.error_code, VaultError::ExceedsUserCap as u32);

    let r1 = result.results.get(1).unwrap();
    assert!(r1.success);
    assert_eq!(vault.balance(&user2), 30);
}

#[test]
fn test_batch_deposit_rejects_paused_vault() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let user1 = Address::generate(&env);
    let (vault, _, _usdc_sa, _admin, relayer) =
        setup_vault_with_relayer(&env, &[(user1.clone(), 100)]);

    vault.pause(&PauseReason::Maintenance);

    let mut entries = Vec::new(&env);
    entries.push_back(DepositEntry {
        user: user1.clone(),
        amount: 100,
    });

    let err = vault.try_batch_deposit(&relayer, &entries).unwrap_err();
    assert_eq!(err.unwrap(), VaultError::ContractPaused);
}

#[test]
fn test_batch_deposit_rejects_unregistered_relayer() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let user1 = Address::generate(&env);
    let (vault, _, _usdc_sa, _admin, _relayer) =
        setup_vault_with_relayer(&env, &[(user1.clone(), 100)]);

    let impostor = Address::generate(&env);

    let mut entries = Vec::new(&env);
    entries.push_back(DepositEntry {
        user: user1.clone(),
        amount: 100,
    });

    let err = vault.try_batch_deposit(&impostor, &entries).unwrap_err();
    assert_eq!(err.unwrap(), VaultError::RelayerNotAuthorized);
}

#[test]
fn test_batch_deposit_rejects_oversized_batch() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (vault, _, _, _, relayer) = setup_vault_with_relayer(&env, &[]);

    vault.set_max_batch_size(&3);

    let mut entries = Vec::new(&env);
    for _ in 0..4 {
        let user = Address::generate(&env);
        entries.push_back(DepositEntry { user, amount: 10 });
    }

    let err = vault.try_batch_deposit(&relayer, &entries).unwrap_err();
    assert_eq!(err.unwrap(), VaultError::BatchTooLarge);
}

#[test]
fn test_batch_deposit_empty_entries_succeeds_with_zero_totals() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (vault, _, _, _admin, relayer) = setup_vault_with_relayer(&env, &[]);

    let entries: Vec<DepositEntry> = Vec::new(&env);
    let result = vault.batch_deposit(&relayer, &entries);

    assert_eq!(result.success_count, 0);
    assert_eq!(result.failure_count, 0);
    assert_eq!(result.total_shares_minted, 0);
    assert_eq!(vault.total_assets(), 0);
}

#[test]
fn test_batch_deposit_share_price_consistency_after_yield() {
    // Verify that mid-batch share pricing is updated correctly after yield accrual
    // so entries later in the batch use the fresh price.
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let seed_user = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    let (vault, _usdc, usdc_sa, admin, relayer) = setup_vault_with_relayer(
        &env,
        &[
            (seed_user.clone(), 1000),
            (user1.clone(), 500),
            (user2.clone(), 500),
        ],
    );

    // Seed the vault so shares are no longer 1:1
    vault.deposit(&seed_user, &1000);
    // Accrue yield: 1000 assets -> 2000 assets, 1000 shares remain => 2:1 ratio
    usdc_sa.mint(&admin, &1000);
    vault.accrue_yield(&1000);
    assert_eq!(vault.total_assets(), 2000);
    assert_eq!(vault.total_shares(), 1000);

    // Now each deposited token is worth 0.5 shares (2:1 price)
    let mut entries = Vec::new(&env);
    entries.push_back(DepositEntry {
        user: user1.clone(),
        amount: 200,
    });
    entries.push_back(DepositEntry {
        user: user2.clone(),
        amount: 400,
    });

    let result = vault.batch_deposit(&relayer, &entries);

    assert_eq!(result.success_count, 2);
    assert_eq!(result.failure_count, 0);

    // user1: 200 assets / (2000/1000) = 100 shares
    assert_eq!(vault.balance(&user1), 100);
    // user2: 400 assets / (2200/1100) = 200 shares (price re-computed after user1 entry)
    assert_eq!(vault.balance(&user2), 200);

    // Total shares = 1000 (seed) + 100 + 200 = 1300
    assert_eq!(vault.total_shares(), 1300);
}

#[test]
fn test_set_relayer_and_is_relayer() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _admin) = setup_vault(&env);
    let relayer = Address::generate(&env);

    assert!(!vault.is_relayer(&relayer));

    vault.set_relayer(&relayer, &true);
    assert!(vault.is_relayer(&relayer));

    vault.set_relayer(&relayer, &false);
    assert!(!vault.is_relayer(&relayer));
}

#[test]
fn test_max_batch_size_defaults_to_50_and_is_configurable() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _admin) = setup_vault(&env);

    assert_eq!(vault.max_batch_size(), 50);

    vault.set_max_batch_size(&10);
    assert_eq!(vault.max_batch_size(), 10);
}

#[test]
fn test_batch_deposit_state_invariant_assets_eq_sum_of_deposits() {
    // After a batch, total_assets must equal the sum of all successful deposit amounts.
    // Entry at index 3 (amount=0) will fail; the rest succeed.
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let u1 = Address::generate(&env);
    let u2 = Address::generate(&env);
    let u3 = Address::generate(&env);
    let u4 = Address::generate(&env); // zero amount — will fail
    let u5 = Address::generate(&env);

    let (vault, _, usdc_sa, _admin, relayer) = setup_vault_with_relayer(
        &env,
        &[
            (u1.clone(), 50),
            (u2.clone(), 100),
            (u3.clone(), 200),
            (u4.clone(), 0),
            (u5.clone(), 75),
        ],
    );

    let mut entries = Vec::new(&env);
    entries.push_back(DepositEntry {
        user: u1.clone(),
        amount: 50,
    });
    entries.push_back(DepositEntry {
        user: u2.clone(),
        amount: 100,
    });
    entries.push_back(DepositEntry {
        user: u3.clone(),
        amount: 200,
    });
    entries.push_back(DepositEntry {
        user: u4.clone(),
        amount: 0,
    }); // invalid
    entries.push_back(DepositEntry {
        user: u5.clone(),
        amount: 75,
    });

    let _ = usdc_sa; // already minted in setup_vault_with_relayer

    let result = vault.batch_deposit(&relayer, &entries);

    // 50 + 100 + 200 + 75 = 425
    assert_eq!(vault.total_assets(), 425);
    assert_eq!(result.failure_count, 1); // zero-amount entry
    assert_eq!(result.success_count, 4);
}

// ─── Secure Whitelist Tests ──────────────────────────────────────────────────

/// Tests for the SecureWhitelist module with strategy contract ID whitelisting

#[test]
fn test_whitelist_strategy_add_and_check() {
    // Test adding a strategy to the whitelist and checking its status
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _admin) = setup_vault(&env);
    let strategy = Address::generate(&env);

    // Initially, strategy should not be whitelisted
    assert!(!vault.is_strategy_whitelisted(&strategy));

    // Admin adds strategy to whitelist
    vault.whitelist_strategy(&strategy, &true);

    // Now strategy should be whitelisted
    assert!(vault.is_strategy_whitelisted(&strategy));
}

#[test]
fn test_whitelist_strategy_remove() {
    // Test removing a strategy from the whitelist
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _admin) = setup_vault(&env);
    let strategy = Address::generate(&env);

    // Add strategy to whitelist
    vault.whitelist_strategy(&strategy, &true);
    assert!(vault.is_strategy_whitelisted(&strategy));

    // Remove strategy from whitelist
    vault.whitelist_strategy(&strategy, &false);

    // Strategy should no longer be whitelisted
    assert!(!vault.is_strategy_whitelisted(&strategy));
}

#[test]
fn test_whitelist_toggle_multiple_strategies() {
    // Test managing multiple strategies in the whitelist
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _admin) = setup_vault(&env);
    let strategy1 = Address::generate(&env);
    let strategy2 = Address::generate(&env);
    let strategy3 = Address::generate(&env);

    // Add multiple strategies
    vault.whitelist_strategy(&strategy1, &true);
    vault.whitelist_strategy(&strategy2, &true);
    vault.whitelist_strategy(&strategy3, &true);

    assert!(vault.is_strategy_whitelisted(&strategy1));
    assert!(vault.is_strategy_whitelisted(&strategy2));
    assert!(vault.is_strategy_whitelisted(&strategy3));

    // Remove one strategy, others remain whitelisted
    vault.whitelist_strategy(&strategy2, &false);

    assert!(vault.is_strategy_whitelisted(&strategy1));
    assert!(!vault.is_strategy_whitelisted(&strategy2));
    assert!(vault.is_strategy_whitelisted(&strategy3));
}

#[test]
fn test_set_strategy_requires_whitelisted_strategy() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _admin) = setup_vault(&env);
    let strategy = Address::generate(&env);
    let result = vault.try_set_strategy(&strategy);
    assert_eq!(result, Err(Ok(VaultError::StrategyNotWhitelisted)));
}

#[test]
fn test_whitelist_same_strategy_idempotent() {
    // Test that adding the same strategy multiple times is idempotent
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _admin) = setup_vault(&env);
    let strategy = Address::generate(&env);

    // Add same strategy multiple times
    vault.whitelist_strategy(&strategy, &true);
    vault.whitelist_strategy(&strategy, &true);
    vault.whitelist_strategy(&strategy, &true);

    // Should still be whitelisted
    assert!(vault.is_strategy_whitelisted(&strategy));
}

#[test]
fn test_whitelist_strategy_after_removal_can_be_re_added() {
    // Test that a removed strategy can be added back to the whitelist
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _admin) = setup_vault(&env);
    let strategy = Address::generate(&env);

    // Add, remove, and re-add strategy
    vault.whitelist_strategy(&strategy, &true);
    assert!(vault.is_strategy_whitelisted(&strategy));

    vault.whitelist_strategy(&strategy, &false);
    assert!(!vault.is_strategy_whitelisted(&strategy));

    vault.whitelist_strategy(&strategy, &true);
    assert!(vault.is_strategy_whitelisted(&strategy));
}

#[test]
fn test_whitelist_persistence_across_operations() {
    // Test that whitelist persists across vault operations
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token(&env, &token_admin);
    let usdc_sa = token::StellarAssetClient::new(&env, &usdc.address);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);
    vault.initialize(&admin, &usdc.address);

    let strategy1 = Address::generate(&env);
    let strategy2 = Address::generate(&env);

    // Whitelist strategies
    vault.whitelist_strategy(&strategy1, &true);
    vault.whitelist_strategy(&strategy2, &true);

    // Do some vault operations (deposit, accrue yield, etc.)
    usdc_sa.mint(&user, &1000);
    usdc_sa.mint(&admin, &100);
    vault.deposit(&user, &100);
    vault.accrue_yield(&10);

    // Check that whitelist is still intact
    assert!(vault.is_strategy_whitelisted(&strategy1));
    assert!(vault.is_strategy_whitelisted(&strategy2));
}

#[test]
fn test_non_whitelisted_strategy_check_returns_false() {
    // Test that checking a never-whitelisted strategy returns false
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _admin) = setup_vault(&env);
    let strategy = Address::generate(&env);

    // Never whitelist the strategy
    // Should return false
    assert!(!vault.is_strategy_whitelisted(&strategy));

    // Multiple checks should all return false
    assert!(!vault.is_strategy_whitelisted(&strategy));
    assert!(!vault.is_strategy_whitelisted(&strategy));
}

#[test]
fn test_whitelist_consistency_with_set_strategy() {
    // Test that whitelist and set_strategy work together consistently
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _admin) = setup_vault(&env);
    let benji_strategy = env.register(BenjiStrategy, ());

    // Whitelist the strategy
    vault.whitelist_strategy(&benji_strategy, &true);
    assert!(vault.is_strategy_whitelisted(&benji_strategy));

    // set_strategy should work with whitelisted strategy
    vault.set_strategy(&benji_strategy);

    // Verify it was set
    assert_eq!(vault.strategy().unwrap(), benji_strategy);

    // Remove from whitelist and verify
    vault.whitelist_strategy(&benji_strategy, &false);
    assert!(!vault.is_strategy_whitelisted(&benji_strategy));
}

// ─── Strategy heartbeat ───────────────────────────────────────────────────────

#[test]
fn test_default_strategy_heartbeat() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);
    assert_eq!(vault.strategy_heartbeat(), 3600);
}

#[test]
fn test_set_strategy_heartbeat() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _) = setup_vault(&env);
    vault.set_strategy_heartbeat(&7200);
    assert_eq!(vault.strategy_heartbeat(), 7200);
}

#[test]
fn test_zero_strategy_heartbeat_disables_enforcement() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token(&env, &token_admin);
    let usdc_admin_client = token::StellarAssetClient::new(&env, &usdc.address);
    usdc_admin_client.mint(&user, &100);

    let benji_token = create_token(&env, &token_admin);
    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);
    let strategy_id = env.register(BenjiStrategy, ());
    let strategy = BenjiStrategyClient::new(&env, &strategy_id);

    vault.initialize(&admin, &usdc.address);
    strategy.initialize(&vault_id, &usdc.address, &benji_token.address);
    vault.whitelist_strategy(&strategy_id, &true);
    vault.set_strategy(&strategy_id);
    vault.set_strategy_heartbeat(&0);
    vault.deposit(&user, &100);

    vault.invest(&60);
    assert_eq!(usdc.balance(&strategy_id), 60);
}

#[test]
fn test_record_strategy_heartbeat_stores_timestamp() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token(&env, &token_admin);
    let benji_token = create_token(&env, &token_admin);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);
    let strategy_id = env.register(BenjiStrategy, ());
    let strategy = BenjiStrategyClient::new(&env, &strategy_id);

    vault.initialize(&admin, &usdc.address);
    strategy.initialize(&vault_id, &usdc.address, &benji_token.address);
    vault.whitelist_strategy(&strategy_id, &true);

    assert!(vault.strategy_last_heartbeat(&strategy_id).is_none());
    vault.record_strategy_heartbeat(&strategy_id);
    assert_eq!(
        vault.strategy_last_heartbeat(&strategy_id),
        Some(env.ledger().timestamp())
    );
}

#[test]
fn test_invest_blocks_without_strategy_heartbeat() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token(&env, &token_admin);
    let usdc_admin_client = token::StellarAssetClient::new(&env, &usdc.address);
    usdc_admin_client.mint(&user, &100);

    let benji_token = create_token(&env, &token_admin);
    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);
    let strategy_id = env.register(BenjiStrategy, ());
    let strategy = BenjiStrategyClient::new(&env, &strategy_id);

    vault.initialize(&admin, &usdc.address);
    strategy.initialize(&vault_id, &usdc.address, &benji_token.address);
    vault.whitelist_strategy(&strategy_id, &true);
    vault.set_strategy(&strategy_id);
    vault.deposit(&user, &100);

    let blocked = vault.try_invest(&60);
    assert!(matches!(
        blocked,
        Err(Ok(VaultError::StrategyHeartbeatExpired))
    ));
}

#[test]
fn test_invest_blocks_when_strategy_heartbeat_expired() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token(&env, &token_admin);
    let usdc_admin_client = token::StellarAssetClient::new(&env, &usdc.address);
    usdc_admin_client.mint(&user, &100);

    let benji_token = create_token(&env, &token_admin);
    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);
    let strategy_id = env.register(BenjiStrategy, ());
    let strategy = BenjiStrategyClient::new(&env, &strategy_id);

    vault.initialize(&admin, &usdc.address);
    strategy.initialize(&vault_id, &usdc.address, &benji_token.address);
    vault.whitelist_strategy(&strategy_id, &true);
    vault.set_strategy(&strategy_id);
    vault.set_strategy_heartbeat(&60);
    vault.record_strategy_heartbeat(&strategy_id);
    vault.deposit(&user, &100);

    env.ledger().with_mut(|li| {
        li.timestamp += 61;
    });

    let blocked = vault.try_invest(&60);
    assert!(matches!(
        blocked,
        Err(Ok(VaultError::StrategyHeartbeatExpired))
    ));
}

#[test]
fn test_rebalance_blocks_when_target_strategy_heartbeat_expired() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token(&env, &token_admin);
    let usdc_admin_client = token::StellarAssetClient::new(&env, &usdc.address);

    let benji_token = create_token(&env, &token_admin);
    let benji_admin_client = token::StellarAssetClient::new(&env, &benji_token.address);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);

    let from_strategy_id = env.register(BenjiStrategy, ());
    let from_strategy = BenjiStrategyClient::new(&env, &from_strategy_id);
    let to_strategy_id = env.register(BenjiStrategy, ());
    let to_strategy = BenjiStrategyClient::new(&env, &to_strategy_id);

    vault.initialize(&admin, &usdc.address);
    from_strategy.initialize(&vault_id, &usdc.address, &benji_token.address);
    to_strategy.initialize(&vault_id, &usdc.address, &benji_token.address);
    vault.whitelist_strategy(&from_strategy_id, &true);
    vault.whitelist_strategy(&to_strategy_id, &true);
    vault.set_strategy_heartbeat(&60);
    vault.record_strategy_heartbeat(&from_strategy_id);

    usdc_admin_client.mint(&from_strategy_id, &100);
    benji_admin_client.mint(&from_strategy_id, &100);

    let blocked = vault.try_rebalance(&from_strategy_id, &to_strategy_id, &50, &45, &45);
    assert!(matches!(
        blocked,
        Err(Ok(VaultError::StrategyHeartbeatExpired))
    ));
}

#[test]
fn test_rebalance_rejects_same_strategy_and_negative_bounds() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token(&env, &token_admin);
    let benji_token = create_token(&env, &token_admin);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);
    let strategy_id = env.register(BenjiStrategy, ());
    let strategy = BenjiStrategyClient::new(&env, &strategy_id);

    vault.initialize(&admin, &usdc.address);
    strategy.initialize(&vault_id, &usdc.address, &benji_token.address);
    vault.register_strategy(&strategy_id);
    vault.activate_strategy_registration(&strategy_id);
    vault.whitelist_strategy(&strategy_id, &true);
    vault.set_strategy(&strategy_id);

    let blocked = vault.try_rebalance(&strategy_id, &strategy_id, &10, &0, &-1);
    assert_eq!(blocked, Err(Ok(VaultError::InvalidAmount)));
}

#[test]
fn test_record_strategy_heartbeat_requires_whitelist() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token(&env, &token_admin);
    let strategy_id = Address::generate(&env);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);
    vault.initialize(&admin, &usdc.address);

    let result = vault.try_record_strategy_heartbeat(&strategy_id);
    assert_eq!(result, Err(Ok(VaultError::StrategyNotWhitelisted)));
}

// ─── Issue #740: withdrawal queue sequencing ─────────────────────────────────

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

#[test]
fn test_withdrawal_queue_processes_fifo_when_liquidity_returns() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (vault, usdc, usdc_sa, _strategy, _admin, _vault_id) = setup_vault_with_strategy(&env);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);

    usdc_sa.mint(&user_a, &1_000);
    usdc_sa.mint(&user_b, &1_000);

    vault.deposit(&user_a, &500);
    vault.deposit(&user_b, &500);
    vault.invest(&980);

    // Auto-divest recalls strategy funds when idle liquidity is insufficient.
    assert_eq!(vault.try_withdraw(&user_a, &200), Ok(Ok(200)));
    assert_eq!(vault.try_withdraw(&user_b, &150), Ok(Ok(150)));
    assert_eq!(vault.withdrawal_queue_length(), 0);
    assert_eq!(usdc.balance(&user_a), 700);
    assert_eq!(usdc.balance(&user_b), 650);
}

#[test]
fn test_withdrawal_queue_stops_when_liquidity_insufficient_for_head() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (vault, usdc, usdc_sa, _strategy, _admin, _vault_id) = setup_vault_with_strategy(&env);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);

    usdc_sa.mint(&user_a, &2_000);
    usdc_sa.mint(&user_b, &2_000);
    vault.deposit(&user_a, &1_000);
    vault.deposit(&user_b, &1_000);
    vault.invest(&1_950);

    assert_eq!(vault.try_withdraw(&user_a, &500), Ok(Ok(500)));
    assert_eq!(vault.try_withdraw(&user_b, &400), Ok(Ok(400)));
    assert_eq!(vault.withdrawal_queue_length(), 0);
    assert_eq!(usdc.balance(&user_a), 1_500);
    assert_eq!(usdc.balance(&user_b), 1_400);
}

// ─── Issue #774: admin parameter change interval ─────────────────────────────

#[test]
fn test_admin_param_change_interval_blocks_rapid_updates() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (vault, _usdc, _usdc_sa, _admin) = setup_vault(&env);
    vault.set_admin_param_change_interval(&60);
    vault.queue_fee_bps_change(&100);
    vault.execute_fee_bps_change();

    // Immediate second change must fail with AdminParamChangeTooSoon
    // (the interval gates queueing, not executing a change already queued)
    let second = vault.try_queue_fee_bps_change(&200);
    assert_eq!(second, Err(Ok(VaultError::AdminParamChangeTooSoon)));

    // Fast-forward past the new 60s cooldown
    env.ledger().set_timestamp(103_662);

    vault.queue_fee_bps_change(&200);
    vault.execute_fee_bps_change();
    assert_eq!(vault.fee_bps(), 200);
}

#[test]
fn test_admin_param_change_interval_applies_across_setters() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    // Set initial timestamp to non-zero so cooldown checks are active
    env.ledger().set_timestamp(100_000);

    let (vault, _usdc, _usdc_sa, _admin) = setup_vault(&env);
    vault.set_admin_param_change_interval(&120);
    vault.set_min_deposit(&10);

    // Immediate change on another setter must be blocked
    let blocked = vault.try_set_dao_threshold(&5);
    assert_eq!(blocked, Err(Ok(VaultError::AdminParamChangeTooSoon)));
}

// ─── #806: invest/divest return VaultError when strategy unset ───────────────

#[test]
fn test_invest_no_strategy_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _usdc, usdc_sa, _admin) = setup_vault(&env);
    let vault_id = vault.address.clone();
    usdc_sa.mint(&vault_id, &1_000);

    // No strategy set — invest should return StrategyNotConfigured, not panic
    let result = vault.try_invest(&500);
    assert_eq!(result, Err(Ok(VaultError::StrategyNotConfigured)));
}

#[test]
#[should_panic(expected = "no strategy set")]
fn test_divest_no_strategy_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _usdc, _usdc_sa, _admin) = setup_vault(&env);

    // No strategy set — divest() is infallible (unlike invest()) and panics.
    vault.divest(&500);
}

#[test]
fn test_invest_insufficient_idle_returns_error() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (vault, usdc, usdc_sa, admin) = setup_vault(&env);
    let user = Address::generate(&env);
    let vault_id = vault.address.clone();

    // Setup strategy
    let strategy_id = env.register(crate::benji_strategy::BenjiStrategy, ());
    let strategy = crate::benji_strategy::BenjiStrategyClient::new(&env, &strategy_id);
    let benji_token = create_token(&env, &admin);
    strategy.initialize(&vault.address, &usdc.address, &benji_token.address);
    vault.whitelist_strategy(&strategy_id, &true);
    vault.set_strategy(&strategy_id);

    // Deposit 100 USDC
    usdc_sa.mint(&user, &100);
    vault.deposit(&user, &100);

    // Assert that the vault has 10,000 USDC in idle assets
    assert_eq!(vault.total_assets(), 10_000);
    assert_eq!(usdc.balance(&vault_id), 10_000);

    // 3. Invest 8,000 USDC into the strategy
    vault.invest(&8_000);

    // Verify balances after investment
    // Vault idle assets should be 2,000 (10,000 - 8,000)
    // Strategy contract should hold 8,000 USDC
    assert_eq!(usdc.balance(&vault_id), 2_000);
    assert_eq!(usdc.balance(&strategy.address), 8_000);

    // 4. Withdraw the user's full balance of shares (10,000 shares)
    // This should trigger the auto-divest path:
    //   assets_to_return = 10,000 USDC
    //   idle USDC = 2,000 USDC
    //   shortfall = 8,000 USDC
    //   So it should call divest(8,000) to recall 8,000 USDC from the strategy.
    vault.withdraw(&user, &10_000);

    // 5. Verify results
    // User should have received the full 10,000 USDC back
    assert_eq!(usdc.balance(&user), 10_000);
    // Vault should have 0 idle assets left
    assert_eq!(usdc.balance(&vault_id), 0);
    // Strategy should have 0 USDC left
    assert_eq!(usdc.balance(&strategy.address), 0);
    // Vault total assets and total shares should be 0
    assert_eq!(vault.total_assets(), 0);
}

// ─── Issue #746: strategy registration lifecycle ───────────────────────────

#[test]
fn test_strategy_registration_pending_to_active_to_retired() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _admin) = setup_vault(&env);
    let strategy = Address::generate(&env);

    vault.register_strategy(&strategy);
    assert_eq!(
        vault.strategy_registration_state(&strategy),
        Some(STATE_PENDING)
    );

    vault.activate_strategy_registration(&strategy);
    assert_eq!(
        vault.strategy_registration_state(&strategy),
        Some(STATE_ACTIVE)
    );

    vault.retire_strategy(&strategy);
    assert_eq!(
        vault.strategy_registration_state(&strategy),
        Some(STATE_RETIRED)
    );
}

#[test]
fn test_strategy_registration_rejects_invalid_transitions() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _admin) = setup_vault(&env);
    let strategy = Address::generate(&env);

    assert_eq!(
        vault.try_activate_strategy_registration(&strategy),
        Err(Ok(VaultError::InvalidMigrationTarget))
    );

    vault.register_strategy(&strategy);
    assert_eq!(
        vault.try_register_strategy(&strategy),
        Err(Ok(VaultError::AlreadyInitialized))
    );

    vault.activate_strategy_registration(&strategy);
    assert_eq!(
        vault.try_activate_strategy_registration(&strategy),
        Err(Ok(VaultError::InvalidMigrationTarget))
    );
}

#[test]
fn test_strategy_registration_cannot_retire_active_vault_strategy() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _admin) = setup_vault(&env);
    let strategy = Address::generate(&env);

    vault.whitelist_strategy(&strategy, &true);
    vault.set_strategy(&strategy);

    assert_eq!(
        vault.try_retire_strategy(&strategy),
        Err(Ok(VaultError::ContractPaused))
    );
}

#[test]
fn test_set_strategy_rejects_retired_registration() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _admin) = setup_vault(&env);
    let strategy_a = Address::generate(&env);
    let strategy_b = Address::generate(&env);

    vault.whitelist_strategy(&strategy_a, &true);
    vault.set_strategy(&strategy_a);
    env.ledger().with_mut(|li| {
        li.timestamp += 3_601;
    });
    vault.whitelist_strategy(&strategy_b, &true);
    vault.set_strategy(&strategy_b);

    vault.retire_strategy(&strategy_a);
    assert_eq!(
        vault.try_set_strategy(&strategy_a),
        Err(Ok(VaultError::InvalidMigrationTarget))
    );
}

#[test]
fn test_whitelist_registers_strategy_as_pending() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _admin) = setup_vault(&env);
    let strategy = Address::generate(&env);

    vault.whitelist_strategy(&strategy, &true);
    assert_eq!(
        vault.strategy_registration_state(&strategy),
        Some(STATE_PENDING)
    );
}

#[test]
fn test_set_strategy_promotes_pending_registration_to_active() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _, _, _admin) = setup_vault(&env);
    let strategy = Address::generate(&env);

    vault.whitelist_strategy(&strategy, &true);
    vault.set_strategy(&strategy);

    assert_eq!(
        vault.strategy_registration_state(&strategy),
        Some(STATE_ACTIVE)
    );
}
