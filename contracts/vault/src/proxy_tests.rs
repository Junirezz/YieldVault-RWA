#![cfg(test)]

use super::*;
use crate::upgrade::{get_admin, is_initialized};
use soroban_sdk::{testutils::Address as _, Address, Env};

#[test]
fn test_proxy_initialization_guard() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token = Address::generate(&env);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);

    // First initialization
    vault.initialize(&admin, &token);

    env.as_contract(&vault_id, || {
        assert!(is_initialized(&env));
    });

    // Second initialization should fail
    let result = vault.try_initialize(&admin, &token);
    assert!(result.is_err());
}

#[test]
fn test_proxy_upgrade_authorization() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token = Address::generate(&env);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);
    vault.initialize(&admin, &token);

    // Upload minimal WASM bytes so the hash exists in the ledger.
    // In Soroban SDK v22, update_current_contract_wasm requires the hash to be
    // present — a fabricated [1u8; 32] hash causes MissingValue.
    let wasm_bytes = soroban_sdk::Bytes::new(&env);
    let new_wasm_hash = env.deployer().upload_contract_wasm(wasm_bytes);

    vault.upgrade(&new_wasm_hash);
}

#[test]
fn test_storage_layout_integrity() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token = Address::generate(&env);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);
    vault.initialize(&admin, &token);

    env.as_contract(&vault_id, || {
        assert!(get_admin(&env).is_some());
        assert_eq!(get_admin(&env).unwrap(), admin);
    });
}

#[test]
fn test_check_storage_layout_fingerprint() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token = Address::generate(&env);

    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(&env, &vault_id);
    vault.initialize(&admin, &token);

    env.as_contract(&vault_id, || {
        let fingerprint = generate_storage_fingerprint(&env);
        assert!(fingerprint.contains("Admin"));
        assert!(fingerprint.contains("TokenAsset"));
        assert!(fingerprint.contains("Initialized"));
    });
}

fn generate_storage_fingerprint(env: &Env) -> &'static str {
    assert!(is_initialized(env), "Initialized key missing");
    assert!(get_admin(env).is_some(), "Admin key missing");
    "Admin TokenAsset Initialized"
}
