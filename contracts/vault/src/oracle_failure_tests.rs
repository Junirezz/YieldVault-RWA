//! Comprehensive oracle failure suite (Issue #1231).
//!
//! Covers heartbeat failures, deviation spikes, network partitions,
//! timeouts, and vault fail-closed behaviour when the mock oracle is
//! wired in as the live price feed.
//!
//! Run with:
//!   cargo test -p vault oracle

#![cfg(test)]

use crate::oracle::{
    price_data_new, validate_conversion_rate, validate_price_for_calculation, OracleError,
    OracleValidator, MAX_PRICE_DEVIATION_BPS,
};
use crate::{YieldVault, YieldVaultClient};
use mock_strategy::mock_oracle::{MockPriceOracle, MockPriceOracleClient, OracleFailureMode};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{token, Address, Env};

fn create_token<'a>(e: &Env, admin: &Address) -> token::Client<'a> {
    let token_address = e
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    token::Client::new(e, &token_address)
}

fn setup_vault_with_oracle(
    env: &Env,
) -> (
    YieldVaultClient<'_>,
    MockPriceOracleClient<'_>,
    token::Client<'_>,
    Address,
) {
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let usdc = create_token(env, &token_admin);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(env, &vault_id);
    vault.initialize(&admin, &usdc.address);
    vault.set_admin_param_change_interval(&0);

    let oracle_id = env.register(MockPriceOracle, ());
    let oracle = MockPriceOracleClient::new(env, &oracle_id);
    oracle.initialize(&admin);
    oracle.set_price(&1_000_000_000, &env.ledger().timestamp(), &18);

    vault.queue_price_oracle_change(&oracle_id);
    vault.execute_price_oracle_change();
    vault.set_oracle_enabled(&true);
    vault.set_oracle_heartbeat(&3600);

    (vault, oracle, usdc, admin)
}

// ── Validator unit coverage (heartbeat / deviation / bounds) ─────────────────

#[test]
fn test_oracle_heartbeat_exceeded() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.timestamp = 10_000);
    let price_data = price_data_new(1_000_000_000, 10_000 - 3_601, 18);
    let result = OracleValidator::validate_price_data(&env, &price_data, 3600, None, None);
    assert_eq!(result, Err(OracleError::HeartbeatExceeded));
}

#[test]
fn test_oracle_heartbeat_exactly_at_limit_passes() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.timestamp = 10_000);
    let price_data = price_data_new(1_000_000_000, 10_000 - 3600, 18);
    assert!(OracleValidator::validate_price_data(&env, &price_data, 3600, None, None).is_ok());
}

#[test]
fn test_oracle_timestamp_in_the_future() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.timestamp = 1_000);
    let price_data = price_data_new(1_000_000_000, 1_001, 18);
    assert_eq!(
        OracleValidator::validate_price_data(&env, &price_data, 3600, None, None),
        Err(OracleError::TimestampInFuture)
    );
}

#[test]
fn test_oracle_zero_price_rejected() {
    let env = Env::default();
    let price_data = price_data_new(0, env.ledger().timestamp(), 18);
    assert_eq!(
        OracleValidator::validate_price_data(&env, &price_data, 3600, None, None),
        Err(OracleError::PriceZero)
    );
}

#[test]
fn test_oracle_negative_price_rejected() {
    let env = Env::default();
    let price_data = price_data_new(-1, env.ledger().timestamp(), 18);
    assert_eq!(
        OracleValidator::validate_price_data(&env, &price_data, 3600, None, None),
        Err(OracleError::PriceZero)
    );
}

#[test]
fn test_oracle_invalid_decimals_rejected() {
    let env = Env::default();
    let price_data = price_data_new(1_000_000_000, env.ledger().timestamp(), 31);
    assert_eq!(
        OracleValidator::validate_price_data(&env, &price_data, 3600, None, None),
        Err(OracleError::InvalidDecimals)
    );
}

#[test]
fn test_oracle_deviation_spike_rejected() {
    let env = Env::default();
    let ts = env.ledger().timestamp();
    let last = price_data_new(1_000_000_000, ts, 18);
    // 60% jump vs 50% default circuit breaker
    let current = price_data_new(1_600_000_000, ts, 18);
    assert_eq!(
        OracleValidator::validate_price_data(
            &env,
            &current,
            3600,
            Some(MAX_PRICE_DEVIATION_BPS),
            Some(&last),
        ),
        Err(OracleError::PriceDeviationExceeded)
    );
}

#[test]
fn test_oracle_deviation_at_exactly_max_passes() {
    let env = Env::default();
    let ts = env.ledger().timestamp();
    let last = price_data_new(10_000, ts, 18);
    // 50% = 5000 bps
    let current = price_data_new(15_000, ts, 18);
    assert!(OracleValidator::validate_price_data(
        &env,
        &current,
        3600,
        Some(MAX_PRICE_DEVIATION_BPS),
        Some(&last),
    )
    .is_ok());
}

#[test]
fn test_oracle_price_for_calculation_zero_and_overflow() {
    assert_eq!(
        validate_price_for_calculation(0, 10),
        Err(OracleError::PriceZero)
    );
    assert_eq!(
        validate_price_for_calculation(-5, 10),
        Err(OracleError::PriceZero)
    );
    assert_eq!(
        validate_price_for_calculation(i128::MAX, 2),
        Err(OracleError::PriceOverflow)
    );
}

#[test]
fn test_oracle_conversion_rate_bounds() {
    assert_eq!(
        validate_conversion_rate(-1, 0, 100),
        Err(OracleError::PriceNegative)
    );
    assert_eq!(
        validate_conversion_rate(5, 10, 20),
        Err(OracleError::PriceDeviationExceeded)
    );
    assert_eq!(
        validate_conversion_rate(25, 10, 20),
        Err(OracleError::PriceDeviationExceeded)
    );
    assert!(validate_conversion_rate(15, 10, 20).is_ok());
}

#[test]
fn test_oracle_slippage_zero_reference_rejected() {
    let price_data = price_data_new(1_000_000_000, 0, 18);
    assert_eq!(
        OracleValidator::validate_slippage_bounds(&price_data, 0, 500),
        Err(OracleError::PriceZero)
    );
}

// ── Mock oracle wired into the vault ─────────────────────────────────────────

#[test]
fn test_oracle_healthy_feed_allows_total_assets() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, _oracle, _usdc, _admin) = setup_vault_with_oracle(&env);
    assert_eq!(vault.total_assets(), 0);
}

#[test]
fn test_oracle_stale_heartbeat_fails_closed() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, oracle, _usdc, _admin) = setup_vault_with_oracle(&env);
    oracle.set_failure_mode(&OracleFailureMode::StaleHeartbeat);
    let result = vault.try_total_assets();
    assert!(result.is_err());
}

#[test]
fn test_oracle_zero_price_fails_closed() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, oracle, _usdc, _admin) = setup_vault_with_oracle(&env);
    oracle.set_failure_mode(&OracleFailureMode::ZeroPrice);
    assert!(vault.try_total_assets().is_err());
}

#[test]
fn test_oracle_negative_price_fails_closed() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, oracle, _usdc, _admin) = setup_vault_with_oracle(&env);
    oracle.set_failure_mode(&OracleFailureMode::NegativePrice);
    assert!(vault.try_total_assets().is_err());
}

#[test]
fn test_oracle_invalid_decimals_fails_closed() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, oracle, _usdc, _admin) = setup_vault_with_oracle(&env);
    oracle.set_failure_mode(&OracleFailureMode::InvalidDecimals);
    assert!(vault.try_total_assets().is_err());
}

#[test]
fn test_oracle_future_timestamp_fails_closed() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, oracle, _usdc, _admin) = setup_vault_with_oracle(&env);
    oracle.set_failure_mode(&OracleFailureMode::FutureTimestamp);
    assert!(vault.try_total_assets().is_err());
}

#[test]
fn test_oracle_deviation_spike_fails_closed_after_warm_cache() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, oracle, _usdc, _admin) = setup_vault_with_oracle(&env);

    // First successful read caches the last validated price.
    assert_eq!(vault.total_assets(), 0);

    oracle.set_failure_mode(&OracleFailureMode::DeviationSpike);
    assert!(
        vault.try_total_assets().is_err(),
        "a 3x spike must trip the deviation circuit breaker"
    );
}

#[test]
fn test_oracle_network_partition_fails_closed() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, oracle, _usdc, _admin) = setup_vault_with_oracle(&env);
    oracle.set_failure_mode(&OracleFailureMode::NetworkPartition);
    assert!(vault.try_total_assets().is_err());
}

#[test]
fn test_oracle_timeout_fails_closed() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, oracle, _usdc, _admin) = setup_vault_with_oracle(&env);
    oracle.set_failure_mode(&OracleFailureMode::Timeout);
    assert!(vault.try_total_assets().is_err());
}

#[test]
fn test_oracle_ledger_timeout_via_heartbeat_window() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, oracle, _usdc, _admin) = setup_vault_with_oracle(&env);

    oracle.set_price(&1_000_000_000, &env.ledger().timestamp(), &18);
    assert_eq!(vault.total_assets(), 0);

    // Advance past the 1h heartbeat without a new price update.
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp.saturating_add(3601);
    });
    assert!(
        vault.try_total_assets().is_err(),
        "a feed that stops updating must fail the heartbeat check"
    );
}

#[test]
fn test_oracle_recovers_after_failure_mode_cleared() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, oracle, _usdc, _admin) = setup_vault_with_oracle(&env);

    oracle.set_failure_mode(&OracleFailureMode::StaleHeartbeat);
    assert!(vault.try_total_assets().is_err());

    oracle.set_failure_mode(&OracleFailureMode::None);
    oracle.set_price(&1_000_000_000, &env.ledger().timestamp(), &18);
    assert_eq!(vault.total_assets(), 0);
}

#[test]
fn test_oracle_disabled_skips_feed_failures() {
    let env = Env::default();
    env.mock_all_auths();
    let (vault, oracle, _usdc, _admin) = setup_vault_with_oracle(&env);
    vault.set_oracle_enabled(&false);
    oracle.set_failure_mode(&OracleFailureMode::NetworkPartition);
    assert_eq!(
        vault.total_assets(),
        0,
        "a disabled oracle must not be consulted"
    );
}
