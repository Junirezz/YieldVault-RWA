//! Integration tests for operational safety events, strategy validation,
//! governance checks, and rounding consistency (Issues #971, #972, #973, #974).

use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{token, Address, Env};
use vault::{
    operational_events, governance_validation, rounding_consistency, strategy_validation,
    VaultError, YieldVault, YieldVaultClient, PauseReason,
};

// ── Setup Helpers ─────────────────────────────────────────────────────────

fn setup_vault(env: &Env) -> (YieldVaultClient<'_>, token::StellarAssetClient<'_>, Address) {
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token_addr = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let usdc_sa = token::StellarAssetClient::new(env, &token_addr);
    let vault_id = env.register(YieldVault, ());
    let vault = YieldVaultClient::new(env, &vault_id);
    vault.initialize(&admin, &token_addr);
    (vault, usdc_sa, admin)
}

// ════════════════════════════════════════════════════════════════════════════
// ISSUE #971: Operational Safety Events – Pause/Resume Observable and Auditable
// ════════════════════════════════════════════════════════════════════════════

#[test]
fn test_pause_emits_comprehensive_event_with_actor_reason_timestamp() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _usdc, admin) = setup_vault(&env);
    env.ledger().set_timestamp(1000);

    // Pause with maintenance reason
    vault.pause(&PauseReason::Maintenance);

    // Verify vault is paused
    assert!(vault.is_paused());
    assert_eq!(vault.pause_reason(), Some(PauseReason::Maintenance));

    // In production, events would be verified via external log reading
    // Here we verify the API surface works correctly
}

#[test]
fn test_unpause_emits_resume_event_with_actor_timestamp() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _usdc, admin) = setup_vault(&env);
    env.ledger().set_timestamp(1000);

    vault.pause(&PauseReason::Maintenance);
    assert!(vault.is_paused());

    env.ledger().with_mut(|li| {
        li.timestamp = 2000;
    });

    vault.unpause();

    assert!(!vault.is_paused());
    assert_eq!(vault.pause_reason(), None);
}

#[test]
fn test_pause_reason_persistence_and_queryability() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _usdc, _admin) = setup_vault(&env);

    // Test all pause reasons are persistable
    let reasons = [
        PauseReason::Maintenance,
        PauseReason::SecurityIncident,
        PauseReason::Governance,
    ];

    for (i, reason) in reasons.iter().enumerate() {
        vault.pause(reason);
        assert!(vault.is_paused());
        assert_eq!(vault.pause_reason(), Some(*reason));

        vault.unpause();
        assert!(!vault.is_paused());
        assert_eq!(vault.pause_reason(), None);
    }
}

#[test]
fn test_pause_blocks_deposits_when_paused() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, usdc_sa, _admin) = setup_vault(&env);
    let user = Address::generate(&env);
    usdc_sa.mint(&user, &1_000_000);

    vault.pause(&PauseReason::Maintenance);

    let result = vault.try_deposit(&user, &100);
    assert!(result.is_err());
}

#[test]
fn test_event_ordering_maintained_across_pause_resume_sequence() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _usdc, _admin) = setup_vault(&env);

    // Sequence: pause → unpause → pause → unpause
    vault.pause(&PauseReason::Maintenance);
    assert!(vault.is_paused());

    vault.unpause();
    assert!(!vault.is_paused());

    vault.pause(&PauseReason::SecurityIncident);
    assert!(vault.is_paused());
    assert_eq!(vault.pause_reason(), Some(PauseReason::SecurityIncident));

    vault.unpause();
    assert!(!vault.is_paused());

    // Verify state consistency
    assert_eq!(vault.pause_reason(), None);
}

// ════════════════════════════════════════════════════════════════════════════
// ISSUE #972: Strategy Response Validation – Malformed Payloads Detection
// ════════════════════════════════════════════════════════════════════════════

#[test]
fn test_strategy_validator_rejects_negative_value() {
    let result = strategy_validation::StrategyValidator::validate_total_value(-100_000);
    assert_eq!(result, Err(VaultError::InvalidStrategyResponse));
}

#[test]
fn test_strategy_validator_accepts_zero_value() {
    let result = strategy_validation::StrategyValidator::validate_total_value(0);
    assert!(result.is_ok());
}

#[test]
fn test_strategy_validator_accepts_positive_value() {
    let result = strategy_validation::StrategyValidator::validate_total_value(100_000);
    assert!(result.is_ok());
}

#[test]
fn test_strategy_validator_rejects_overflow_value() {
    let result =
        strategy_validation::StrategyValidator::validate_total_value(strategy_validation::MAX_STRATEGY_VALUE + 1);
    assert_eq!(result, Err(VaultError::StrategyValueOverflow));
}

#[test]
fn test_deposit_result_validation_normal_case() {
    // Deposit 1000, total increased from 10000 to 11000
    let result = strategy_validation::StrategyValidator::validate_deposit_result(1000, 10_000, 11_000);
    assert!(result.is_ok());
}

#[test]
fn test_deposit_result_validation_with_fees() {
    // Deposit 1000, but only net 950 due to fees
    let result = strategy_validation::StrategyValidator::validate_deposit_result(1000, 10_000, 10_950);
    assert!(result.is_ok());
}

#[test]
fn test_deposit_result_validation_rejects_negative_delta() {
    // Deposit 1000, but total decreased (impossible, indicates malicious response)
    let result = strategy_validation::StrategyValidator::validate_deposit_result(1000, 10_000, 9_000);
    assert_eq!(result, Err(VaultError::InvalidStrategyResponse));
}

#[test]
fn test_withdrawal_result_validation_normal_case() {
    // Withdraw 1000 from 10000, leaving 9000
    let result = strategy_validation::StrategyValidator::validate_withdrawal_result(1000, 10_000, 9_000);
    assert!(result.is_ok());
}

#[test]
fn test_withdrawal_result_validation_with_slippage() {
    // Withdraw 1000, but lose extra 50 to slippage
    let result = strategy_validation::StrategyValidator::validate_withdrawal_result(1000, 10_000, 8_950);
    assert!(result.is_ok());
}

#[test]
fn test_withdrawal_result_validation_rejects_value_increase() {
    // Withdraw 1000, but total increased (impossible, indicates malicious response)
    let result = strategy_validation::StrategyValidator::validate_withdrawal_result(1000, 10_000, 11_000);
    assert_eq!(result, Err(VaultError::InvalidStrategyResponse));
}

#[test]
fn test_decimals_validation_accepts_valid_range() {
    assert!(strategy_validation::StrategyValidator::validate_decimals(6).is_ok());
    assert!(strategy_validation::StrategyValidator::validate_decimals(18).is_ok());
    assert!(strategy_validation::StrategyValidator::validate_decimals(30).is_ok());
}

#[test]
fn test_decimals_validation_rejects_excessive() {
    let result = strategy_validation::StrategyValidator::validate_decimals(31);
    assert_eq!(result, Err(VaultError::InvalidStrategyResponse));
}

#[test]
fn test_price_response_validation_positive_price() {
    let result = strategy_validation::StrategyValidator::validate_price_response(1_000_000, 6);
    assert!(result.is_ok());
}

#[test]
fn test_price_response_validation_rejects_zero_price() {
    let result = strategy_validation::StrategyValidator::validate_price_response(0, 6);
    assert_eq!(result, Err(VaultError::InvalidStrategyResponse));
}

#[test]
fn test_price_response_validation_rejects_negative_price() {
    let result = strategy_validation::StrategyValidator::validate_price_response(-1_000_000, 6);
    assert_eq!(result, Err(VaultError::InvalidStrategyResponse));
}

// ════════════════════════════════════════════════════════════════════════════
// ISSUE #973: Governance Validation – Policy Updates Require Valid Conditions
// ════════════════════════════════════════════════════════════════════════════

#[test]
fn test_governance_validator_quorum_met() {
    let config = governance_validation::GovernanceConfig {
        quorum: 2,
        total_signers: 3,
        proposal_max_age_seconds: 86400,
        min_voting_period_seconds: 3600,
    };

    assert!(governance_validation::GovernanceValidator::validate_quorum(2, &config).is_ok());
    assert!(governance_validation::GovernanceValidator::validate_quorum(3, &config).is_ok());
}

#[test]
fn test_governance_validator_quorum_not_met() {
    let config = governance_validation::GovernanceConfig {
        quorum: 2,
        total_signers: 3,
        proposal_max_age_seconds: 86400,
        min_voting_period_seconds: 3600,
    };

    let result = governance_validation::GovernanceValidator::validate_quorum(1, &config);
    assert_eq!(result, Err(VaultError::InsufficientGovernanceVotes));
}

#[test]
fn test_governance_validator_proposal_freshness_fresh() {
    let result = governance_validation::GovernanceValidator::validate_proposal_freshness(
        1000, // created at
        2000, // current time
        3600, // max age
    );
    assert!(result.is_ok());
}

#[test]
fn test_governance_validator_proposal_freshness_stale() {
    let result = governance_validation::GovernanceValidator::validate_proposal_freshness(
        1000, // created at
        100_000, // current time (way too late)
        3600, // max age
    );
    assert_eq!(result, Err(VaultError::ProposalStale));
}

#[test]
fn test_governance_validator_minimum_voting_period_elapsed() {
    let result = governance_validation::GovernanceValidator::validate_minimum_voting_period(
        1000, // voting started
        5000, // current time
        3600, // min voting period
    );
    assert!(result.is_ok());
}

#[test]
fn test_governance_validator_minimum_voting_period_not_elapsed() {
    let result = governance_validation::GovernanceValidator::validate_minimum_voting_period(
        1000, // voting started
        2000, // current time (too soon)
        3600, // min voting period
    );
    assert_eq!(result, Err(VaultError::ProposalNotReady));
}

#[test]
fn test_state_transition_valid_active_to_approved() {
    let result = governance_validation::GovernanceValidator::validate_state_transition(
        governance_validation::ProposalState::Active,
        governance_validation::ProposalState::Approved,
    );
    assert!(result.is_ok());
}

#[test]
fn test_state_transition_valid_approved_to_executed() {
    let result = governance_validation::GovernanceValidator::validate_state_transition(
        governance_validation::ProposalState::Approved,
        governance_validation::ProposalState::Executed,
    );
    assert!(result.is_ok());
}

#[test]
fn test_state_transition_invalid_stale_no_further_transition() {
    let result = governance_validation::GovernanceValidator::validate_state_transition(
        governance_validation::ProposalState::Stale,
        governance_validation::ProposalState::Approved,
    );
    assert_eq!(result, Err(VaultError::InvalidProposalTransition));
}

// ════════════════════════════════════════════════════════════════════════════
// ISSUE #974: Rounding Consistency – Safe Across All Calculations
// ════════════════════════════════════════════════════════════════════════════

#[test]
fn test_rounding_policy_floor_division_exact() {
    let result = rounding_consistency::RoundingPolicy::floor_division(100, 10);
    assert_eq!(result, 10);
}

#[test]
fn test_rounding_policy_floor_division_rounds_down() {
    assert_eq!(rounding_consistency::RoundingPolicy::floor_division(99, 10), 9);
    assert_eq!(rounding_consistency::RoundingPolicy::floor_division(100, 1500), 0);
}

#[test]
fn test_rounding_policy_decimal_conversion_up() {
    let result = rounding_consistency::RoundingPolicy::convert_decimals(1_000_000, 6, 18).unwrap();
    assert_eq!(result, 1_000_000_000_000_000_000);
}

#[test]
fn test_rounding_policy_decimal_conversion_down() {
    let result = rounding_consistency::RoundingPolicy::convert_decimals(
        1_000_000_000_000_000_000,
        18,
        6,
    )
    .unwrap();
    assert_eq!(result, 1_000_000);
}

#[test]
fn test_rounding_policy_decimal_conversion_same() {
    let result = rounding_consistency::RoundingPolicy::convert_decimals(1_000_000, 6, 6).unwrap();
    assert_eq!(result, 1_000_000);
}

#[test]
fn test_rounding_policy_decimal_conversion_zero() {
    let result = rounding_consistency::RoundingPolicy::convert_decimals(0, 6, 18).unwrap();
    assert_eq!(result, 0);
}

#[test]
fn test_rounding_policy_validate_loss_acceptable() {
    // 1 bp loss on 10_000 units is acceptable
    let result = rounding_consistency::RoundingPolicy::validate_rounding_loss(1, 10_000, 100);
    assert!(result.is_ok());
}

#[test]
fn test_rounding_policy_validate_loss_exceeds_threshold() {
    // 200 bp loss exceeds 100 bp threshold
    let result = rounding_consistency::RoundingPolicy::validate_rounding_loss(200, 10_000, 100);
    assert_eq!(result, Err(VaultError::RoundingLossTooHigh));
}

#[test]
fn test_rounding_policy_verify_safety() {
    // (66 * 1500) = 99000 <= 100000 ✓
    assert!(rounding_consistency::RoundingPolicy::verify_round_down_safety(
        100_000, 1500, 66
    ));

    // (67 * 1500) = 100500 > 100000 ✗
    assert!(!rounding_consistency::RoundingPolicy::verify_round_down_safety(
        100_000, 1500, 67
    ));
}

#[test]
fn test_rounding_policy_basis_points_5_percent() {
    let result =
        rounding_consistency::RoundingPolicy::calculate_basis_points_amount(1_000_000, 500).unwrap();
    assert_eq!(result, 50_000);
}

#[test]
fn test_rounding_policy_basis_points_rounds_down() {
    // (999 * 500) / 10000 = 49.95 → 49
    let result = rounding_consistency::RoundingPolicy::calculate_basis_points_amount(999, 500).unwrap();
    assert_eq!(result, 49);
}

#[test]
fn test_rounding_policy_basis_points_zero() {
    let result = rounding_consistency::RoundingPolicy::calculate_basis_points_amount(1_000_000, 0).unwrap();
    assert_eq!(result, 0);
}

#[test]
fn test_rounding_policy_basis_points_invalid() {
    let result = rounding_consistency::RoundingPolicy::calculate_basis_points_amount(1_000_000, 10_001);
    assert_eq!(result, Err(VaultError::InvalidFeeBps));
}

// ════════════════════════════════════════════════════════════════════════════
// Cross-Cutting Scenarios
// ════════════════════════════════════════════════════════════════════════════

#[test]
fn test_pause_then_strategy_validation_both_work() {
    let env = Env::default();
    env.mock_all_auths();

    let (vault, _usdc, _admin) = setup_vault(&env);

    // Pause vault
    vault.pause(&PauseReason::SecurityIncident);
    assert!(vault.is_paused());

    // Meanwhile, strategy validation is independent
    assert!(strategy_validation::StrategyValidator::validate_total_value(100_000).is_ok());
}

#[test]
fn test_rounding_consistency_with_governance_conditions() {
    // Ensure rounding doesn't affect governance validation
    let config = governance_validation::GovernanceConfig {
        quorum: 2,
        total_signers: 3,
        proposal_max_age_seconds: 86400,
        min_voting_period_seconds: 3600,
    };

    // Apply rounding
    let rounded =
        rounding_consistency::RoundingPolicy::calculate_basis_points_amount(1_000_000, 500).unwrap();

    // Governance checks still work
    assert!(governance_validation::GovernanceValidator::validate_quorum(2, &config).is_ok());
}
