use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{contract, symbol_short};

/// Test endpoint: counts `send` calls, or panics when configured to fail.
#[contract]
pub struct MockEndpoint;

#[contractimpl]
impl MockEndpoint {
    pub fn set_fail(env: Env, fail: bool) {
        env.storage().instance().set(&symbol_short!("fail"), &fail);
    }

    pub fn calls(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&symbol_short!("calls"))
            .unwrap_or(0)
    }

    pub fn send(
        env: Env,
        _transfer_id: u64,
        _token: Address,
        _amount: i128,
        _dest_chain: u32,
        _recipient: Bytes,
    ) {
        if env
            .storage()
            .instance()
            .get(&symbol_short!("fail"))
            .unwrap_or(false)
        {
            panic!("endpoint down");
        }
        let calls = Self::calls(env.clone()) + 1;
        env.storage()
            .instance()
            .set(&symbol_short!("calls"), &calls);
    }
}

fn mock_endpoint(env: &Env, fail: bool) -> Address {
    let id = env.register(MockEndpoint, ());
    MockEndpointClient::new(env, &id).set_fail(&fail);
    id
}

/// Register the contract and return a client for it.
fn setup() -> (Env, BridgeCompatClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(BridgeCompat, ());
    let client = BridgeCompatClient::new(&env, &id);
    (env, client)
}

/// Register the contract with a live Stellar Asset Contract (SAC) token.
fn setup_with_token() -> (Env, BridgeCompatClient<'static>, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_addr = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    let id = env.register(BridgeCompat, ());
    let client = BridgeCompatClient::new(&env, &id);
    client.initialize(&admin, &token_addr);

    (env, client, admin, token_addr, id)
}

#[test]
fn test_initialize() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let token = Address::generate(&env);

    client.initialize(&admin, &token);
    assert_eq!(client.admin(), Some(admin));
    assert_eq!(client.token(), Some(token));
}

#[test]
fn test_double_initialize_fails() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let token = Address::generate(&env);

    client.initialize(&admin, &token);
    let result = client.try_initialize(&admin, &token);
    assert_eq!(result, Err(Ok(BridgeError::AlreadyInitialized)));
}

#[test]
fn test_register_provider() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let endpoint = Address::generate(&env);

    client.initialize(&admin, &token);

    let chains = Vec::from_array(&env, [1, 2, 3]);
    let id = client.register_provider(
        &String::from_str(&env, "Wormhole"),
        &BridgeProviderKind::Wormhole,
        &endpoint,
        &50, // 0.5% fee
        &1_000_000_000_000,
        &chains,
    );

    assert_eq!(id, 1);
    assert_eq!(client.provider_count(), 1);

    let provider = client.provider(&id).unwrap();
    assert_eq!(provider.name, String::from_str(&env, "Wormhole"));
    assert!(provider.enabled);
}

#[test]
fn test_transfer_limits() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let token = Address::generate(&env);

    client.initialize(&admin, &token);

    let limits = client.transfer_limits();
    assert_eq!(limits.per_transfer_limit, 1_000_000_000_000);
    assert_eq!(limits.epoch_volume_limit, 10_000_000_000_000);
    assert_eq!(limits.epoch_duration, 86_400);
}

#[test]
fn test_epoch_accounting_uses_one_packed_entry() {
    let env = Env::default();
    let contract_id = env.register(BridgeCompat, ());
    env.as_contract(&contract_id, || {
        let limits = TransferLimits {
            per_transfer_limit: 100,
            epoch_volume_limit: 1_000,
            epoch_duration: 86_400,
        };
        BridgeCompat::check_epoch_volume(&env, 25, &limits).unwrap();

        let accounting: EpochAccounting = env
            .storage()
            .persistent()
            .get(&DataKey::EpochAccounting)
            .unwrap();
        assert_eq!(accounting.volume, 25);
        assert!(!env.storage().instance().has(&DataKey::EpochStart));
        assert!(!env.storage().instance().has(&DataKey::EpochVolume));
    });
}

#[test]
fn transfer_ids_are_context_bound_and_duplicate_ids_are_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let bridge_id = env.register(BridgeCompat, ());
    let client = BridgeCompatClient::new(&env, &bridge_id);
    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_id = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    client.initialize(&admin, &token_id);

    let sender_a = Address::generate(&env);
    let sender_b = Address::generate(&env);
    token_admin_client.mint(&bridge_id, &1_000);
    token_admin_client.mint(&sender_a, &300);
    token_admin_client.mint(&sender_b, &300);

    let endpoint_a = mock_endpoint(&env, false);
    let endpoint_b = mock_endpoint(&env, false);
    let chains = Vec::from_array(&env, [1u32]);
    let provider_a = client.register_provider(
        &String::from_str(&env, "provider-a"),
        &BridgeProviderKind::Wormhole,
        &endpoint_a,
        &0,
        &1_000,
        &chains,
    );
    let provider_b = client.register_provider(
        &String::from_str(&env, "provider-b"),
        &BridgeProviderKind::LayerZero,
        &endpoint_b,
        &0,
        &1_000,
        &chains,
    );
    let recipient = Bytes::new(&env);

    let id_a = client.transfer_out(&sender_a, &recipient, &100, &1, &Some(provider_a));
    let id_b = client.transfer_out(&sender_b, &recipient, &100, &1, &Some(provider_b));
    let id_a_next = client.transfer_out(&sender_a, &recipient, &100, &1, &Some(provider_a));

    let transfer_a = client.transfer(&id_a).unwrap();
    let transfer_b = client.transfer(&id_b).unwrap();
    let transfer_a_next = client.transfer(&id_a_next).unwrap();
    assert_eq!(transfer_a.nonce, 1);
    assert_eq!(transfer_b.nonce, 1);
    assert_eq!(transfer_a_next.nonce, 2);
    assert_ne!(id_a, transfer_a.nonce);
    assert_ne!(id_a, id_b);
    assert_ne!(id_a, id_a_next);
    assert_eq!(transfer_a.transfer_id, id_a);

    // Simulate replayed nonce state: the derived ID is already occupied,
    // so a transfer must fail instead of replacing the original record.
    env.as_contract(&bridge_id, || {
        env.storage().instance().set(
            &DataKey::TransferNonceFor(sender_a.clone(), provider_a),
            &0u64,
        );
    });
    let duplicate = client.try_transfer_out(&sender_a, &recipient, &100, &1, &Some(provider_a));
    assert_eq!(duplicate, Err(Ok(BridgeError::NonceAlreadyUsed)));
    assert_eq!(client.transfer(&id_a), Some(transfer_a));
}

// ── Acceptance Criteria Tests ────────────────────────────────────────────

#[test]
fn test_epoch_limit_exceeded() {
    let (env, client, _admin, token_addr, contract_id) = setup_with_token();
    let endpoint = mock_endpoint(&env, false);
    let sender = Address::generate(&env);
    let recipient = Bytes::from_slice(&env, &[1, 2, 3, 4]);

    // Configure limits: 50,000 per transfer, 80,000 per epoch (duration: 3,600s)
    let limits = TransferLimits {
        per_transfer_limit: 50_000,
        epoch_volume_limit: 80_000,
        epoch_duration: 3_600,
    };
    client.set_transfer_limits(&limits);

    // Register a provider supporting dest_chain 1
    let chains = Vec::from_array(&env, [1]);
    let provider_id = client.register_provider(
        &String::from_str(&env, "LayerZero"),
        &BridgeProviderKind::LayerZero,
        &endpoint,
        &50,
        &100_000,
        &chains,
    );

    // Fund sender and contract liquidity
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);
    token_admin.mint(&sender, &200_000);
    token_admin.mint(&contract_id, &200_000);

    // First transfer: 50,000 (epoch volume becomes 50,000 <= 80,000) -> succeeds
    let tx1 = client.transfer_out(&sender, &recipient, &50_000, &1, &Some(provider_id));
    assert_eq!(client.transfer(&tx1).unwrap().nonce, 1);

    // Second transfer: 40,000
    // Epoch volume would be 50,000 + 40,000 = 90,000 > 80,000 (epoch_volume_limit)
    // Must reject with TransferLimitExceeded
    let err = client.try_transfer_out(&sender, &recipient, &40_000, &1, &Some(provider_id));
    assert_eq!(err, Err(Ok(BridgeError::TransferLimitExceeded)));

    // Advance ledger timestamp beyond epoch_duration to reset epoch
    env.ledger().set_timestamp(env.ledger().timestamp() + 3_601);

    // Once epoch has reset, 40,000 transfer succeeds
    let tx2 = client.transfer_out(&sender, &recipient, &40_000, &1, &Some(provider_id));
    assert_eq!(client.transfer(&tx2).unwrap().nonce, 2);
}

#[test]
fn test_fail_transfer_refund() {
    let (env, client, _admin, token_addr, contract_id) = setup_with_token();
    let endpoint = mock_endpoint(&env, false);
    let sender = Address::generate(&env);
    let recipient = Bytes::from_slice(&env, &[9, 8, 7]);

    let chains = Vec::from_array(&env, [1, 2]);
    let provider_id = client.register_provider(
        &String::from_str(&env, "Wormhole"),
        &BridgeProviderKind::Wormhole,
        &endpoint,
        &100,
        &500_000,
        &chains,
    );

    let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);

    let initial_sender_balance = 100_000i128;
    let transfer_amount = 30_000i128;
    token_admin.mint(&sender, &initial_sender_balance);
    token_admin.mint(&contract_id, &100_000);

    // 1. Initiate transfer_out
    let transfer_id = client.transfer_out(
        &sender,
        &recipient,
        &transfer_amount,
        &1,
        &Some(provider_id),
    );
    assert_eq!(
        client.transfer(&transfer_id).unwrap().provider_id,
        provider_id
    );

    // Verify sender debited by transfer_amount
    assert_eq!(
        token_client.balance(&sender),
        initial_sender_balance - transfer_amount
    );

    // Verify initial transfer status is InFlight
    let transfer_record = client.transfer(&transfer_id).unwrap();
    assert_eq!(transfer_record.status, TransferStatus::InFlight);
    assert_eq!(transfer_record.completed_at, 0);

    // Advance timestamp
    let fail_timestamp = env.ledger().timestamp() + 300;
    env.ledger().set_timestamp(fail_timestamp);

    // 2. Admin fails the transfer to trigger refund
    client.fail_transfer(&transfer_id);

    // Verify sender received full refund
    assert_eq!(token_client.balance(&sender), initial_sender_balance);

    // Verify status updated to Refunded and completed_at recorded
    let refunded_record = client.transfer(&transfer_id).unwrap();
    assert_eq!(refunded_record.status, TransferStatus::Refunded);
    assert_eq!(refunded_record.completed_at, fail_timestamp);

    // 3. Repeated fail_transfer must fail because status is no longer InFlight
    let re_fail = client.try_fail_transfer(&transfer_id);
    assert_eq!(re_fail, Err(Ok(BridgeError::TransferInFlight)));

    // 4. Confirming an already refunded transfer must also fail
    let re_confirm = client.try_confirm_transfer(&transfer_id);
    assert_eq!(re_confirm, Err(Ok(BridgeError::TransferInFlight)));
}

#[test]
fn test_disabled_provider_rejection() {
    let (env, client, _admin, token_addr, contract_id) = setup_with_token();
    let endpoint = mock_endpoint(&env, false);
    let sender = Address::generate(&env);
    let recipient = Bytes::from_slice(&env, &[4, 5, 6]);

    let chains = Vec::from_array(&env, [1, 2]);
    let provider_id = client.register_provider(
        &String::from_str(&env, "CustomBridge"),
        &BridgeProviderKind::Custom,
        &endpoint,
        &25,
        &500_000,
        &chains,
    );

    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);
    token_admin.mint(&sender, &100_000);
    token_admin.mint(&contract_id, &100_000);

    // Provider is initially enabled
    assert!(client.provider(&provider_id).unwrap().enabled);

    // Estimate succeeds while enabled
    let estimate = client.estimate_transfer(&10_000, &1, &Some(provider_id));
    assert_eq!(estimate.provider_id, provider_id);

    // Disable provider via admin
    client.set_provider_enabled(&provider_id, &false);
    assert!(!client.provider(&provider_id).unwrap().enabled);

    // 1. estimate_transfer with explicit disabled provider_id returns ProviderDisabled
    let est_err = client.try_estimate_transfer(&10_000, &1, &Some(provider_id));
    assert_eq!(est_err, Err(Ok(BridgeError::ProviderDisabled)));

    // 2. estimate_transfer using default provider (which is disabled) returns ProviderDisabled
    let est_def_err = client.try_estimate_transfer(&10_000, &1, &None);
    assert_eq!(est_def_err, Err(Ok(BridgeError::ProviderDisabled)));

    // 3. transfer_out with explicit disabled provider_id returns ProviderDisabled
    let tx_err = client.try_transfer_out(&sender, &recipient, &10_000, &1, &Some(provider_id));
    assert_eq!(tx_err, Err(Ok(BridgeError::ProviderDisabled)));

    // 4. transfer_out using default provider (which is disabled) returns ProviderDisabled
    let tx_def_err = client.try_transfer_out(&sender, &recipient, &10_000, &1, &None);
    assert_eq!(tx_def_err, Err(Ok(BridgeError::ProviderDisabled)));

    // Re-enable provider and verify transfers and estimates resume
    client.set_provider_enabled(&provider_id, &true);
    assert!(client.provider(&provider_id).unwrap().enabled);

    let estimate_ok = client.estimate_transfer(&10_000, &1, &Some(provider_id));
    assert_eq!(estimate_ok.provider_id, provider_id);

    let tx_id = client.transfer_out(&sender, &recipient, &10_000, &1, &Some(provider_id));
    assert_eq!(client.transfer(&tx_id).unwrap().provider_id, provider_id);
}

// ── Issue #1528: sender balance + amount bounds in transfer_out ─────────

fn provider_with_max(client: &BridgeCompatClient, env: &Env, max_transfer: i128) -> u32 {
    let endpoint = mock_endpoint(env, false);
    client.register_provider(
        &String::from_str(env, "p"),
        &BridgeProviderKind::Custom,
        &endpoint,
        &0,
        &max_transfer,
        &Vec::from_array(env, [1u32]),
    )
}

// ── Provider removal / fallback routing / endpoint invocation ───────────

fn register(client: &BridgeCompatClient, env: &Env, endpoint: &Address) -> u32 {
    client.register_provider(
        &String::from_str(env, "p"),
        &BridgeProviderKind::Custom,
        endpoint,
        &0,
        &1_000_000,
        &Vec::from_array(env, [1u32]),
    )
}

#[test]
fn test_transfer_out_rejects_amount_above_provider_max() {
    let (env, client, _admin, token_addr, _id) = setup_with_token();
    let pid = provider_with_max(&client, &env, 1_000);
    let sender = Address::generate(&env);
    soroban_sdk::token::StellarAssetClient::new(&env, &token_addr).mint(&sender, &10_000);

    let res = client.try_transfer_out(&sender, &Bytes::new(&env), &1_001, &1, &Some(pid));
    assert_eq!(res, Err(Ok(BridgeError::InvalidAmount)));
    assert_eq!(
        client.try_estimate_transfer(&1_001, &1, &Some(pid)),
        Err(Ok(BridgeError::InvalidAmount))
    );

    // Exactly max_transfer is accepted.
    client.transfer_out(&sender, &Bytes::new(&env), &1_000, &1, &Some(pid));
}

#[test]
fn test_transfer_out_rejects_amount_below_min_transfer() {
    let (env, client, _admin, token_addr, _id) = setup_with_token();
    let pid = provider_with_max(&client, &env, 1_000);
    let sender = Address::generate(&env);
    soroban_sdk::token::StellarAssetClient::new(&env, &token_addr).mint(&sender, &10_000);

    assert_eq!(client.min_transfer(), 1);
    assert_eq!(
        client.try_transfer_out(&sender, &Bytes::new(&env), &0, &1, &Some(pid)),
        Err(Ok(BridgeError::InvalidAmount))
    );

    client.set_min_transfer(&100);
    assert_eq!(
        client.try_transfer_out(&sender, &Bytes::new(&env), &99, &1, &Some(pid)),
        Err(Ok(BridgeError::InvalidAmount))
    );
    assert_eq!(
        client.try_estimate_transfer(&99, &1, &Some(pid)),
        Err(Ok(BridgeError::InvalidAmount))
    );
    client.transfer_out(&sender, &Bytes::new(&env), &100, &1, &Some(pid));

    assert_eq!(
        client.try_set_min_transfer(&0),
        Err(Ok(BridgeError::InvalidAmount))
    );
}

#[test]
fn test_transfer_out_checks_sender_balance_not_contract_balance() {
    let (env, client, _admin, token_addr, contract_id) = setup_with_token();
    let pid = provider_with_max(&client, &env, 1_000_000);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);
    let token = soroban_sdk::token::Client::new(&env, &token_addr);
    let sender = Address::generate(&env);
    token_admin.mint(&sender, &500);
    // Contract liquidity must not let an underfunded sender pass the check.
    token_admin.mint(&contract_id, &1_000_000);

    let res = client.try_transfer_out(&sender, &Bytes::new(&env), &501, &1, &Some(pid));
    assert_eq!(res, Err(Ok(BridgeError::InsufficientBalance)));
    assert_eq!(token.balance(&sender), 500);

    // A funded sender succeeds even when the contract holds nothing.
    let (env2, client2, _admin2, token_addr2, contract_id2) = setup_with_token();
    let pid2 = provider_with_max(&client2, &env2, 1_000_000);
    let sender2 = Address::generate(&env2);
    soroban_sdk::token::StellarAssetClient::new(&env2, &token_addr2).mint(&sender2, &500);
    client2.transfer_out(&sender2, &Bytes::new(&env2), &500, &1, &Some(pid2));
    let token2 = soroban_sdk::token::Client::new(&env2, &token_addr2);
    assert_eq!(token2.balance(&sender2), 0);
    assert_eq!(token2.balance(&contract_id2), 500);
}

#[test]
fn test_transfer_out_invokes_provider_endpoint() {
    let (env, client, _admin, token_addr, contract_id) = setup_with_token();
    let endpoint = mock_endpoint(&env, false);
    let pid = register(&client, &env, &endpoint);
    let sender = Address::generate(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);
    token_admin.mint(&sender, &1_000);
    token_admin.mint(&contract_id, &1_000);

    let id = client.transfer_out(&sender, &Bytes::new(&env), &500, &1, &None);

    assert_eq!(MockEndpointClient::new(&env, &endpoint).calls(), 1);
    assert_eq!(client.transfer(&id).unwrap().provider_id, pid);
    let token = soroban_sdk::token::Client::new(&env, &token_addr);
    assert_eq!(token.balance(&sender), 500);
    assert_eq!(token.balance(&contract_id), 1_500);
}

#[test]
fn test_transfer_out_falls_back_when_primary_fails() {
    let (env, client, _admin, token_addr, contract_id) = setup_with_token();
    let primary = mock_endpoint(&env, true);
    let disabled = mock_endpoint(&env, false);
    let fallback = mock_endpoint(&env, false);
    let primary_id = register(&client, &env, &primary);
    let disabled_id = register(&client, &env, &disabled);
    let fallback_id = register(&client, &env, &fallback);
    client.set_provider_enabled(&disabled_id, &false);
    let sender = Address::generate(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);
    token_admin.mint(&sender, &1_000);
    token_admin.mint(&contract_id, &1_000);

    let id = client.transfer_out(&sender, &Bytes::new(&env), &500, &1, &Some(primary_id));

    let record = client.transfer(&id).unwrap();
    assert_eq!(record.provider_id, fallback_id);
    assert_eq!(record.nonce, 1);
    assert_eq!(MockEndpointClient::new(&env, &disabled).calls(), 0);
    assert_eq!(MockEndpointClient::new(&env, &fallback).calls(), 1);
}

#[test]
fn test_transfer_out_reverts_when_no_provider_succeeds() {
    let (env, client, _admin, token_addr, contract_id) = setup_with_token();
    let primary = mock_endpoint(&env, true);
    let backup = mock_endpoint(&env, true);
    register(&client, &env, &primary);
    register(&client, &env, &backup);
    let sender = Address::generate(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);
    token_admin.mint(&sender, &1_000);
    token_admin.mint(&contract_id, &1_000);

    let res = client.try_transfer_out(&sender, &Bytes::new(&env), &500, &1, &None);

    assert_eq!(res, Err(Ok(BridgeError::NoFallbackAvailable)));
    let token = soroban_sdk::token::Client::new(&env, &token_addr);
    assert_eq!(token.balance(&sender), 1_000);
    assert_eq!(client.user_transfer_count(&sender), 0);
}

#[test]
fn test_unregister_provider_requires_timelock() {
    let (env, client, _admin, _token, _id) = setup_with_token();
    let pid = register(&client, &env, &mock_endpoint(&env, false));

    assert_eq!(
        client.try_unregister_provider(&pid),
        Err(Ok(BridgeError::NoPendingRemoval))
    );
    let eta = client.queue_unregister_provider(&pid);
    assert_eq!(eta, env.ledger().timestamp() + PROVIDER_REMOVAL_DELAY);
    assert_eq!(client.pending_unregister(&pid), Some(eta));
    assert_eq!(
        client.try_unregister_provider(&pid),
        Err(Ok(BridgeError::TimelockNotReady))
    );

    env.ledger().set_timestamp(eta);
    client.unregister_provider(&pid);

    assert_eq!(client.provider(&pid), None);
    assert_eq!(client.pending_unregister(&pid), None);
    assert_eq!(client.default_provider(), None);
    assert_eq!(
        client.try_queue_unregister_provider(&pid),
        Err(Ok(BridgeError::ProviderNotFound))
    );
}

#[test]
fn test_cancel_unregister_provider() {
    let (env, client, _admin, _token, _id) = setup_with_token();
    let pid = register(&client, &env, &mock_endpoint(&env, false));

    assert_eq!(
        client.try_cancel_unregister_provider(&pid),
        Err(Ok(BridgeError::NoPendingRemoval))
    );
    let eta = client.queue_unregister_provider(&pid);
    client.cancel_unregister_provider(&pid);
    env.ledger().set_timestamp(eta);

    assert_eq!(
        client.try_unregister_provider(&pid),
        Err(Ok(BridgeError::NoPendingRemoval))
    );
    assert!(client.provider(&pid).is_some());
}

#[test]
fn test_unregister_provider_requires_admin_auth() {
    let env = Env::default();
    let id = env.register(BridgeCompat, ());
    let client = BridgeCompatClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &Address::generate(&env));

    env.mock_all_auths();
    let pid = register(&client, &env, &Address::generate(&env));
    env.set_auths(&[]);

    assert!(client.try_queue_unregister_provider(&pid).is_err());
    assert!(client.try_cancel_unregister_provider(&pid).is_err());
    assert!(client.try_unregister_provider(&pid).is_err());
}

#[test]
fn test_removed_provider_skipped_by_fallback() {
    let (env, client, _admin, token_addr, contract_id) = setup_with_token();
    let primary = mock_endpoint(&env, true);
    let removed = mock_endpoint(&env, false);
    let backup = mock_endpoint(&env, false);
    let primary_id = register(&client, &env, &primary);
    let removed_id = register(&client, &env, &removed);
    let backup_id = register(&client, &env, &backup);
    let eta = client.queue_unregister_provider(&removed_id);
    env.ledger().set_timestamp(eta);
    client.unregister_provider(&removed_id);

    let sender = Address::generate(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);
    token_admin.mint(&sender, &1_000);
    token_admin.mint(&contract_id, &1_000);

    let id = client.transfer_out(&sender, &Bytes::new(&env), &500, &1, &Some(primary_id));

    assert_eq!(client.transfer(&id).unwrap().provider_id, backup_id);
    assert_eq!(MockEndpointClient::new(&env, &removed).calls(), 0);
}

#[test]
fn test_checked_math_and_limit_validation() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let endpoint = Address::generate(&env);
    client.initialize(&admin, &token);

    let chains = Vec::from_array(&env, [1]);
    let name = String::from_str(&env, "P");

    // max_transfer must be positive and bounded so fee math cannot overflow.
    for bad in [0, -1, i128::MAX] {
        let r = client.try_register_provider(
            &name,
            &BridgeProviderKind::Custom,
            &endpoint,
            &10_000,
            &bad,
            &chains,
        );
        assert_eq!(r, Err(Ok(BridgeError::InvalidLimits)));
    }
    let id = client.register_provider(
        &name,
        &BridgeProviderKind::Custom,
        &endpoint,
        &10_000,
        &(i128::MAX / BPS_DENOMINATOR),
        &chains,
    );

    // amount = i128::MAX returns an error instead of aborting.
    let r = client.try_estimate_transfer(&i128::MAX, &1, &Some(id));
    assert!(r.is_err());

    // epoch_duration = 0 and non-positive limits are rejected.
    let mut limits = client.transfer_limits();
    limits.epoch_duration = 0;
    assert_eq!(
        client.try_set_transfer_limits(&limits),
        Err(Ok(BridgeError::InvalidLimits))
    );
    let mut limits = client.transfer_limits();
    limits.per_transfer_limit = 0;
    assert_eq!(
        client.try_set_transfer_limits(&limits),
        Err(Ok(BridgeError::InvalidLimits))
    );
}
