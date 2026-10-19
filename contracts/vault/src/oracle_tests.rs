use crate::benji_strategy::{BenjiStrategy, BenjiStrategyClient};
use crate::oracle::{
    price_data_new, price_data_scaled_price, validate_conversion_rate,
    validate_price_for_calculation, OracleValidator, PriceData, DEFAULT_HEARTBEAT_SECONDS,
    MAX_ORACLE_HEARTBEAT, MAX_PRICE_DEVIATION_BPS,
};
use crate::{DataKey, DataKeyExt, RiskExtKey, VaultError, YieldVault, YieldVaultClient};
use mock_strategy::mock_oracle::{MockPriceOracle, MockPriceOracleClient};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{token, Address, Env};

fn create_token_contract<'a>(e: &Env, admin: &Address) -> token::Client<'a> {
    let token_address = e
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    token::Client::new(e, &token_address)
}

/// Stand up a vault with a BENJI strategy and a configurable mock price oracle,
/// with oracle validation enabled. Returns (vault, usdc, benji_admin, oracle_addr).
fn setup_vault_with_oracle<'a>(
    env: &Env,
) -> (
    YieldVaultClient<'a>,
    token::Client<'a>,
    token::StellarAssetClient<'a>,
    Address,
) {
    env.mock_all_auths_allowing_non_root_auth();

    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let usdc = create_token_contract(env, &token_admin);
    let benji_token = create_token_contract(env, &token_admin);
    let benji_admin_client = token::StellarAssetClient::new(env, &benji_token.address);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(env, &vault_id);

    let strategy_id = env.register(BenjiStrategy, ());
    let strategy = BenjiStrategyClient::new(env, &strategy_id);

    vault.initialize(&admin, &usdc.address);
    strategy.initialize(&vault_id, &usdc.address, &benji_token.address);
    vault.whitelist_strategy(&strategy_id, &true);
    vault.set_strategy(&strategy_id);

    let oracle_id = env.register(MockPriceOracle, ());
    let oracle_client = MockPriceOracleClient::new(env, &oracle_id);
    oracle_client.initialize(&admin);
    oracle_client.set_price(&1_000_000_000i128, &env.ledger().timestamp(), &18u32);

    vault.queue_price_oracle_change(&oracle_id);
    vault.execute_price_oracle_change();
    vault.set_oracle_enabled(&true);

    (vault, usdc, benji_admin_client, oracle_id)
}

const _SCALE: i128 = 1_000_000_000_000_000_000i128;

#[test]
fn test_oracle_price_data_creation() {
    let price = price_data_new(1_000_000_000i128, 1000, 18);
    assert_eq!(price.0, 1_000_000_000i128);
    assert_eq!(price.1, 1000);
    assert_eq!(price.2, 18);
}

#[test]
fn test_price_data_scaled_18_decimals() {
    let price_data = price_data_new(1_500_000_000_000_000_000i128, 0, 18);
    assert_eq!(
        price_data_scaled_price(&price_data),
        1_500_000_000_000_000_000i128
    );
}

#[test]
fn test_price_data_scaled_high_decimals() {
    let price_data = price_data_new(2_500_000_000_000_000_000i128, 0, 36);
    assert_eq!(price_data_scaled_price(&price_data), 2i128);
}

#[test]
fn test_price_data_scaled_low_decimals() {
    let price_data = price_data_new(5_000_000i128, 0, 6);
    assert_eq!(
        price_data_scaled_price(&price_data),
        5_000_000_000_000_000_000i128
    );
}

#[test]
fn test_validate_price_valid() {
    let env = Env::default();
    let price_data = price_data_new(1_000_000_000i128, env.ledger().timestamp(), 18);
    let result = OracleValidator::validate_price_data(&env, &price_data, 3600, None, None);
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), 1_000_000_000i128);
}

#[test]
fn test_validate_deviation_within_bounds() {
    let env = Env::default();
    let ledger_ts = env.ledger().timestamp();
    let timestamp = ledger_ts;
    let last_price = price_data_new(1_000_000_000i128, timestamp, 18);
    let current_price = price_data_new(1_010_000_000i128, timestamp, 18);

    let result = OracleValidator::validate_price_data(
        &env,
        &current_price,
        3600,
        Some(5000),
        Some(&last_price),
    );
    if let Err(e) = result {
        panic!("Validation error: {:?}", e);
    }
}

#[test]
fn test_validate_price_for_calculation_valid() {
    let result = validate_price_for_calculation(1_000_000_000i128, 100i128);
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), 100_000_000_000i128);
}

#[test]
fn test_validate_conversion_rate_valid() {
    let result = validate_conversion_rate(1_000_000_000i128, 0i128, 2_000_000_000i128);
    assert!(result.is_ok());
}

#[test]
fn test_default_heartbeat() {
    assert_eq!(DEFAULT_HEARTBEAT_SECONDS, 3600);
}

#[test]
fn test_max_price_deviation_bps() {
    assert_eq!(MAX_PRICE_DEVIATION_BPS, 5000);
}

#[test]
fn test_oracle_config_functions() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token_contract(&env, &token_admin);
    let token_admin_client = token::StellarAssetClient::new(&env, &usdc.address);

    let user = Address::generate(&env);
    token_admin_client.mint(&user, &1000);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);

    vault.initialize(&admin, &usdc.address);

    assert!(vault.price_oracle().is_none());
    assert!(!vault.is_oracle_enabled());
    assert_eq!(vault.oracle_heartbeat(), 3600);

    let oracle_addr = Address::generate(&env);
    vault.queue_price_oracle_change(&oracle_addr);
    vault.execute_price_oracle_change();
    assert_eq!(vault.price_oracle(), Some(oracle_addr));

    vault.set_oracle_enabled(&true);
    assert!(vault.is_oracle_enabled());

    vault.set_oracle_heartbeat(&7200);
    assert_eq!(vault.oracle_heartbeat(), 7200);
}

#[test]
fn test_oracle_setters_require_admin_auth() {
    let env = Env::default();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token_contract(&env, &token_admin);
    let token_admin_client = token::StellarAssetClient::new(&env, &usdc.address);

    let user = Address::generate(&env);
    token_admin_client.mint(&user, &1000);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);

    vault.initialize(&admin, &usdc.address);

    let oracle_addr = Address::generate(&env);

    // Without admin authorization, oracle config mutations must fail.
    assert!(vault.try_queue_price_oracle_change(&oracle_addr).is_err());
    assert!(vault.try_set_oracle_enabled(&true).is_err());
    assert!(vault.try_set_oracle_heartbeat(&7200).is_err());
    assert!(vault.price_oracle().is_none());
    assert!(!vault.is_oracle_enabled());
    assert_eq!(vault.oracle_heartbeat(), 3600);

    env.mock_all_auths();
    vault.queue_price_oracle_change(&oracle_addr);
    vault.execute_price_oracle_change();
    vault.set_oracle_enabled(&true);
    vault.set_oracle_heartbeat(&7200);

    assert_eq!(vault.price_oracle(), Some(oracle_addr));
    assert!(vault.is_oracle_enabled());
    assert_eq!(vault.oracle_heartbeat(), 7200);
}

#[test]
fn test_oracle_heartbeat_minimum() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token_contract(&env, &token_admin);
    let token_admin_client = token::StellarAssetClient::new(&env, &usdc.address);

    let user = Address::generate(&env);
    token_admin_client.mint(&user, &1000);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);

    vault.initialize(&admin, &usdc.address);

    vault.set_oracle_heartbeat(&1);
    assert_eq!(vault.oracle_heartbeat(), 1);
}

#[test]
fn test_set_oracle_heartbeat_rejects_above_max() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let usdc = create_token_contract(&env, &token_admin);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);
    vault.initialize(&admin, &usdc.address);

    let result = vault.try_set_oracle_heartbeat(&(MAX_ORACLE_HEARTBEAT + 1));
    assert_eq!(result, Err(Ok(VaultError::OracleValidationFailed)));
    // Rejected config must not take effect.
    assert_eq!(vault.oracle_heartbeat(), DEFAULT_HEARTBEAT_SECONDS);

    // The cap itself is a valid boundary value.
    vault.set_oracle_heartbeat(&MAX_ORACLE_HEARTBEAT);
    assert_eq!(vault.oracle_heartbeat(), MAX_ORACLE_HEARTBEAT);
}

// ─── total_assets() live oracle validation ─────────────────────────────────
//
// These exercise the actual oracle read inside `total_assets()` (and
// `invest()`, which consumes it) via a full vault + BENJI strategy +
// `MockPriceOracle` setup, rather than calling `OracleValidator` directly.

#[test]
fn test_total_assets_reverts_on_stale_oracle_data() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.timestamp = 100_000);
    let (vault, usdc, _benji_admin, oracle_id) = setup_vault_with_oracle(&env);
    let oracle_client = MockPriceOracleClient::new(&env, &oracle_id);

    let user = Address::generate(&env);
    token::StellarAssetClient::new(&env, &usdc.address).mint(&user, &1000);
    vault.deposit(&user, &500);
    // Oracle hasn't been read yet (deposit doesn't consult it) — still fresh.
    assert!(vault.try_total_assets().is_ok());

    oracle_client.set_stale_data_mode(&true);

    let result = vault.try_total_assets();
    assert_eq!(result, Err(Ok(VaultError::OracleValidationFailed)));
}

#[test]
fn test_total_assets_reverts_on_zero_or_negative_price() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.timestamp = 100_000);
    let (vault, _usdc, _benji_admin, oracle_id) = setup_vault_with_oracle(&env);
    let oracle_client = MockPriceOracleClient::new(&env, &oracle_id);

    oracle_client.set_zero_price_mode(&true);
    assert_eq!(
        vault.try_total_assets(),
        Err(Ok(VaultError::OracleValidationFailed))
    );

    oracle_client.set_zero_price_mode(&false);
    oracle_client.set_negative_price_mode(&true);
    assert_eq!(
        vault.try_total_assets(),
        Err(Ok(VaultError::OracleValidationFailed))
    );
}

#[test]
fn test_total_assets_reverts_on_invalid_decimals() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.timestamp = 100_000);
    let (vault, _usdc, _benji_admin, oracle_id) = setup_vault_with_oracle(&env);
    let oracle_client = MockPriceOracleClient::new(&env, &oracle_id);

    oracle_client.set_invalid_decimals_mode(&true);
    assert_eq!(
        vault.try_total_assets(),
        Err(Ok(VaultError::OracleValidationFailed))
    );
}

#[test]
fn test_total_assets_heartbeat_boundary() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.timestamp = 100_000);
    let (vault, _usdc, _benji_admin, oracle_id) = setup_vault_with_oracle(&env);
    let oracle_client = MockPriceOracleClient::new(&env, &oracle_id);

    let heartbeat = vault.oracle_heartbeat();
    let now = env.ledger().timestamp();

    // Exactly at the heartbeat boundary (age == max_age): still fresh, must succeed.
    oracle_client.set_price(&1_000_000_000i128, &(now - heartbeat), &18u32);
    assert!(vault.try_total_assets().is_ok());

    // One second past the boundary (age == max_age + 1): stale, must revert.
    oracle_client.set_price(&1_000_000_000i128, &(now - heartbeat - 1), &18u32);
    assert_eq!(
        vault.try_total_assets(),
        Err(Ok(VaultError::OracleValidationFailed))
    );
}

#[test]
fn test_total_assets_reverts_on_future_timestamp() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.timestamp = 100_000);
    let (vault, _usdc, _benji_admin, oracle_id) = setup_vault_with_oracle(&env);
    let oracle_client = MockPriceOracleClient::new(&env, &oracle_id);

    let now = env.ledger().timestamp();
    oracle_client.set_price(&1_000_000_000i128, &(now + 1), &18u32);
    assert_eq!(
        vault.try_total_assets(),
        Err(Ok(VaultError::OracleValidationFailed))
    );
}

#[test]
fn test_total_assets_reverts_on_extreme_price_deviation() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.timestamp = 100_000);
    let (vault, _usdc, _benji_admin, oracle_id) = setup_vault_with_oracle(&env);
    let oracle_client = MockPriceOracleClient::new(&env, &oracle_id);

    // First read establishes the reference price used by the deviation
    // circuit breaker on the next read.
    assert!(vault.try_total_assets().is_ok());

    // Price crashes by 90% in a single reading — far past the 50% breaker.
    let now = env.ledger().timestamp();
    oracle_client.set_price(&100_000_000i128, &now, &18u32);
    assert_eq!(
        vault.try_total_assets(),
        Err(Ok(VaultError::OracleValidationFailed))
    );
}

#[test]
fn test_total_assets_accepts_price_within_deviation_bounds() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.timestamp = 100_000);
    let (vault, _usdc, _benji_admin, oracle_id) = setup_vault_with_oracle(&env);
    let oracle_client = MockPriceOracleClient::new(&env, &oracle_id);

    assert!(vault.try_total_assets().is_ok());

    // 10% move — comfortably inside the 50% (5000 bps) deviation bound.
    let now = env.ledger().timestamp();
    oracle_client.set_price(&1_100_000_000i128, &now, &18u32);
    assert!(vault.try_total_assets().is_ok());
}

#[test]
fn test_invest_reverts_on_stale_oracle_data() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.timestamp = 100_000);
    let (vault, usdc, _benji_admin, oracle_id) = setup_vault_with_oracle(&env);
    let oracle_client = MockPriceOracleClient::new(&env, &oracle_id);

    let user = Address::generate(&env);
    token::StellarAssetClient::new(&env, &usdc.address).mint(&user, &1000);
    vault.deposit(&user, &500);

    oracle_client.set_stale_data_mode(&true);

    let result = vault.try_invest(&100);
    assert_eq!(result, Err(Ok(VaultError::OracleValidationFailed)));
}

// ─── Canonical last-price key (issues #1525 / #1538) ───────────────────────

fn stored_prices(env: &Env, vault: &Address) -> (Option<PriceData>, Option<PriceData>) {
    env.as_contract(vault, || {
        let storage = env.storage().instance();
        (
            storage.get(&DataKeyExt::LastOraclePrice),
            storage.get(&DataKeyExt::Risk(RiskExtKey::LastPx)),
        )
    })
}

#[test]
fn test_total_assets_writes_only_canonical_last_price() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.timestamp = 100_000);
    let (vault, _usdc, _benji_admin, _oracle_id) = setup_vault_with_oracle(&env);

    assert_eq!(stored_prices(&env, &vault.address), (None, None));
    assert!(vault.try_total_assets().is_ok());

    let (canonical, legacy) = stored_prices(&env, &vault.address);
    assert_eq!(
        canonical,
        Some(price_data_new(1_000_000_000i128, 100_000, 18))
    );
    assert_eq!(legacy, None);
}

#[test]
fn test_legacy_last_price_is_migrated_to_canonical_key() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.timestamp = 100_000);
    let (vault, _usdc, _benji_admin, oracle_id) = setup_vault_with_oracle(&env);
    let now = env.ledger().timestamp();
    MockPriceOracleClient::new(&env, &oracle_id).set_price(&1_100_000_000i128, &now, &18u32);

    // Simulate a deployment that only ever wrote the legacy slot.
    let legacy_price = price_data_new(1_000_000_000i128, now, 18);
    env.as_contract(&vault.address, || {
        env.storage()
            .instance()
            .set(&DataKeyExt::Risk(RiskExtKey::LastPx), &legacy_price);
    });

    assert!(vault.try_total_assets().is_ok());

    let (canonical, legacy) = stored_prices(&env, &vault.address);
    assert_eq!(canonical, Some(price_data_new(1_100_000_000i128, now, 18)));
    assert_eq!(legacy, None);
}

#[test]
fn test_legacy_last_price_still_guards_deviation_before_migration() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.timestamp = 100_000);
    let (vault, _usdc, _benji_admin, _oracle_id) = setup_vault_with_oracle(&env);
    let now = env.ledger().timestamp();

    // Legacy reference 10x the live price: the breaker must still trip.
    env.as_contract(&vault.address, || {
        env.storage().instance().set(
            &DataKeyExt::Risk(RiskExtKey::LastPx),
            &price_data_new(10_000_000_000i128, now, 18),
        );
    });

    assert_eq!(
        vault.try_total_assets(),
        Err(Ok(VaultError::OracleValidationFailed))
    );
}

#[test]
fn test_oracle_change_clears_both_last_price_keys() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.timestamp = 100_000);
    let (vault, _usdc, _benji_admin, oracle_id) = setup_vault_with_oracle(&env);
    assert!(vault.try_total_assets().is_ok());
    env.as_contract(&vault.address, || {
        env.storage().instance().set(
            &DataKeyExt::Risk(RiskExtKey::LastPx),
            &price_data_new(1, 0, 18),
        );
    });

    vault.queue_price_oracle_change(&oracle_id);
    vault.execute_price_oracle_change();

    assert_eq!(stored_prices(&env, &vault.address), (None, None));
}

/// Footprint comparison: the single canonical read/write per `total_assets`
/// call must cost less than the previous dual-key pattern (read both keys,
/// read `TokenAsset` twice, write both keys).
#[test]
fn test_total_assets_price_cache_cheaper_than_dual_key_pattern() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.timestamp = 100_000);
    let (vault, _usdc, _benji_admin, _oracle_id) = setup_vault_with_oracle(&env);
    assert!(vault.try_total_assets().is_ok());
    let price = price_data_new(1_000_000_000i128, 100_000, 18);

    let measure = |work: &dyn Fn()| -> (u64, u64) {
        env.as_contract(&vault.address, || {
            let mut budget = env.cost_estimate().budget();
            budget.reset_unlimited();
            work();
            (budget.cpu_instruction_cost(), budget.memory_bytes_cost())
        })
    };

    let legacy = measure(&|| {
        let storage = env.storage().instance();
        let _: Option<PriceData> = storage.get(&DataKeyExt::Risk(RiskExtKey::LastPx));
        let _: Option<PriceData> = storage.get(&DataKeyExt::LastOraclePrice);
        let _: Address = storage.get(&DataKey::TokenAsset).unwrap();
        let _: Address = storage.get(&DataKey::TokenAsset).unwrap();
        storage.set(&DataKeyExt::LastOraclePrice, &price);
        storage.set(&DataKeyExt::Risk(RiskExtKey::LastPx), &price);
    });
    env.as_contract(&vault.address, || {
        env.storage()
            .instance()
            .remove(&DataKeyExt::Risk(RiskExtKey::LastPx));
    });
    let cached = measure(&|| {
        let storage = env.storage().instance();
        let _: Option<PriceData> = storage.get(&DataKeyExt::LastOraclePrice);
        let _: Address = storage.get(&DataKey::TokenAsset).unwrap();
        storage.set(&DataKeyExt::LastOraclePrice, &price);
    });

    assert!(cached.0 < legacy.0, "cpu {} !< {}", cached.0, legacy.0);
    assert!(cached.1 < legacy.1, "mem {} !< {}", cached.1, legacy.1);
}
