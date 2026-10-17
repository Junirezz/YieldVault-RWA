//! Strategy registration lifecycle with explicit states and transition guards.
//!
//! State is persisted as `u32` in the existing `StrategyWhitelist` storage slot:
//! `1` = Pending, `2` = Active, `3` = Retired.

use soroban_sdk::{Address, Env};

use crate::upgrade::get_admin;
use crate::DataKey;

pub const STATE_PENDING: u32 = 1;
pub const STATE_ACTIVE: u32 = 2;
pub const STATE_RETIRED: u32 = 3;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StrategyRegistrationError {
    Unauthorized,
    AlreadyRegistered,
    NotRegistered,
    InvalidTransition,
    ActiveStrategyInUse,
    StrategyNotActive,
}

pub fn read_registration_state(env: &Env, strategy: &Address) -> Option<u32> {
    env.storage()
        .instance()
        .get(&DataKey::StrategyWhitelist(strategy.clone()))
}

fn write_registration_state(env: &Env, strategy: &Address, state: u32) {
    env.storage()
        .instance()
        .set(&DataKey::StrategyWhitelist(strategy.clone()), &state);
}

fn remove_registration_state(env: &Env, strategy: &Address) {
    env.storage()
        .instance()
        .remove(&DataKey::StrategyWhitelist(strategy.clone()));
}

pub fn is_allowed_transition(from: Option<u32>, to: u32) -> bool {
    matches!(
        (from, to),
        (None, STATE_PENDING)
            | (Some(STATE_PENDING), STATE_ACTIVE)
            | (Some(STATE_PENDING), STATE_RETIRED)
            | (Some(STATE_ACTIVE), STATE_RETIRED)
    )
}

fn transition(env: &Env, strategy: &Address, to: u32) -> Result<u32, StrategyRegistrationError> {
    let from = read_registration_state(env, strategy);
    if !is_allowed_transition(from, to) {
        return Err(StrategyRegistrationError::InvalidTransition);
    }
    write_registration_state(env, strategy, to);
    Ok(to)
}

fn require_admin(env: &Env, caller: &Address) -> Result<(), StrategyRegistrationError> {
    let admin = get_admin(env).ok_or(StrategyRegistrationError::Unauthorized)?;
    if caller != &admin {
        caller.require_auth();
        return Err(StrategyRegistrationError::Unauthorized);
    }
    admin.require_auth();
    Ok(())
}

pub(crate) fn register_strategy_internal(
    env: &Env,
    strategy: &Address,
) -> Result<u32, StrategyRegistrationError> {
    if read_registration_state(env, strategy).is_some() {
        return Err(StrategyRegistrationError::AlreadyRegistered);
    }
    transition(env, strategy, STATE_PENDING)
}

pub(crate) fn activate_strategy_internal(
    env: &Env,
    strategy: &Address,
) -> Result<u32, StrategyRegistrationError> {
    transition(env, strategy, STATE_ACTIVE)
}

pub(crate) fn retire_strategy_internal(
    env: &Env,
    strategy: &Address,
    active_vault_strategy: Option<Address>,
) -> Result<u32, StrategyRegistrationError> {
    if active_vault_strategy.as_ref() == Some(strategy) {
        return Err(StrategyRegistrationError::ActiveStrategyInUse);
    }
    transition(env, strategy, STATE_RETIRED)
}

pub fn register_strategy(
    env: &Env,
    caller: &Address,
    strategy: &Address,
) -> Result<u32, StrategyRegistrationError> {
    require_admin(env, caller)?;
    register_strategy_internal(env, strategy)
}

pub fn activate_strategy(
    env: &Env,
    caller: &Address,
    strategy: &Address,
) -> Result<u32, StrategyRegistrationError> {
    require_admin(env, caller)?;
    activate_strategy_internal(env, strategy)
}

pub fn retire_strategy(
    env: &Env,
    caller: &Address,
    strategy: &Address,
    active_vault_strategy: Option<Address>,
) -> Result<u32, StrategyRegistrationError> {
    require_admin(env, caller)?;
    retire_strategy_internal(env, strategy, active_vault_strategy)
}

pub fn is_eligible_for_allocation(env: &Env, strategy: &Address) -> bool {
    matches!(
        read_registration_state(env, strategy),
        Some(STATE_PENDING) | Some(STATE_ACTIVE)
    )
}

pub fn require_active_registration(
    env: &Env,
    strategy: &Address,
) -> Result<(), StrategyRegistrationError> {
    match read_registration_state(env, strategy) {
        Some(STATE_ACTIVE) => Ok(()),
        Some(_) => Err(StrategyRegistrationError::StrategyNotActive),
        None => Err(StrategyRegistrationError::NotRegistered),
    }
}

pub fn remove_registration(env: &Env, strategy: &Address) {
    remove_registration_state(env, strategy);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::upgrade::set_admin;
    use crate::DataKey;
    use soroban_sdk::{testutils::{Address as _, Ledger as _}, Address, Env};

    #[test]
    fn test_allowed_transitions() {
        // Valid transitions
        assert!(is_allowed_transition(None, STATE_PENDING));
        assert!(is_allowed_transition(Some(STATE_PENDING), STATE_ACTIVE));
        assert!(is_allowed_transition(Some(STATE_PENDING), STATE_RETIRED));
        assert!(is_allowed_transition(Some(STATE_ACTIVE), STATE_RETIRED));

        // Invalid transitions: cannot jump directly from None to Active or Retired
        assert!(!is_allowed_transition(None, STATE_ACTIVE));
        assert!(!is_allowed_transition(None, STATE_RETIRED));

        // Invalid transitions: cannot self-transition
        assert!(!is_allowed_transition(Some(STATE_PENDING), STATE_PENDING));
        assert!(!is_allowed_transition(Some(STATE_ACTIVE), STATE_ACTIVE));
        assert!(!is_allowed_transition(Some(STATE_RETIRED), STATE_RETIRED));

        // Invalid transitions: cannot demote Active to Pending
        assert!(!is_allowed_transition(Some(STATE_ACTIVE), STATE_PENDING));

        // Invalid transitions: terminal state Retired cannot transition anywhere
        assert!(!is_allowed_transition(Some(STATE_RETIRED), STATE_ACTIVE));
        assert!(!is_allowed_transition(Some(STATE_RETIRED), STATE_PENDING));

        // Invalid transitions: arbitrary state numbers
        assert!(!is_allowed_transition(None, 0));
        assert!(!is_allowed_transition(None, 4));
        assert!(!is_allowed_transition(Some(STATE_ACTIVE), 99));
        assert!(!is_allowed_transition(Some(99), STATE_ACTIVE));
    }

    #[test]
    fn test_lifecycle_pending_active_retired_flow() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(crate::YieldVault, ());

        env.as_contract(&contract_id, || {
            let admin = Address::generate(&env);
            let strategy = Address::generate(&env);
            set_admin(&env, &admin);

            // Initially unregistered
            assert_eq!(read_registration_state(&env, &strategy), None);
            assert!(!is_eligible_for_allocation(&env, &strategy));
            assert_eq!(
                require_active_registration(&env, &strategy),
                Err(StrategyRegistrationError::NotRegistered)
            );

            // 1. None -> Pending via register_strategy
            let res_reg = register_strategy(&env, &admin, &strategy);
            assert_eq!(res_reg, Ok(STATE_PENDING));
            assert_eq!(read_registration_state(&env, &strategy), Some(STATE_PENDING));
            assert!(is_eligible_for_allocation(&env, &strategy));
            assert_eq!(
                require_active_registration(&env, &strategy),
                Err(StrategyRegistrationError::StrategyNotActive)
            );

            // 2. Pending -> Active via activate_strategy
            let res_act = activate_strategy(&env, &admin, &strategy);
            assert_eq!(res_act, Ok(STATE_ACTIVE));
            assert_eq!(read_registration_state(&env, &strategy), Some(STATE_ACTIVE));
            assert!(is_eligible_for_allocation(&env, &strategy));
            assert_eq!(require_active_registration(&env, &strategy), Ok(()));

            // 3. Active -> Retired via retire_strategy
            let res_ret = retire_strategy(&env, &admin, &strategy, None);
            assert_eq!(res_ret, Ok(STATE_RETIRED));
            assert_eq!(read_registration_state(&env, &strategy), Some(STATE_RETIRED));
            assert!(!is_eligible_for_allocation(&env, &strategy));
            assert_eq!(
                require_active_registration(&env, &strategy),
                Err(StrategyRegistrationError::StrategyNotActive)
            );
        });
    }

    #[test]
    fn test_lifecycle_direct_retire_from_pending() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(crate::YieldVault, ());

        env.as_contract(&contract_id, || {
            let admin = Address::generate(&env);
            let strategy = Address::generate(&env);
            set_admin(&env, &admin);

            assert_eq!(register_strategy(&env, &admin, &strategy), Ok(STATE_PENDING));
            assert_eq!(read_registration_state(&env, &strategy), Some(STATE_PENDING));

            // Pending -> Retired directly
            let res_ret = retire_strategy(&env, &admin, &strategy, None);
            assert_eq!(res_ret, Ok(STATE_RETIRED));
            assert_eq!(read_registration_state(&env, &strategy), Some(STATE_RETIRED));
            assert!(!is_eligible_for_allocation(&env, &strategy));
        });
    }

    #[test]
    fn test_duplicate_registration_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(crate::YieldVault, ());

        env.as_contract(&contract_id, || {
            let admin = Address::generate(&env);
            let strategy = Address::generate(&env);
            set_admin(&env, &admin);

            assert_eq!(register_strategy(&env, &admin, &strategy), Ok(STATE_PENDING));

            // Attempting to re-register while pending
            let res = register_strategy(&env, &admin, &strategy);
            assert_eq!(res, Err(StrategyRegistrationError::AlreadyRegistered));

            // Activate and attempt to re-register
            assert_eq!(activate_strategy(&env, &admin, &strategy), Ok(STATE_ACTIVE));
            let res_active = register_strategy(&env, &admin, &strategy);
            assert_eq!(res_active, Err(StrategyRegistrationError::AlreadyRegistered));

            // Retire and attempt to re-register
            assert_eq!(retire_strategy(&env, &admin, &strategy, None), Ok(STATE_RETIRED));
            let res_retired = register_strategy(&env, &admin, &strategy);
            assert_eq!(res_retired, Err(StrategyRegistrationError::AlreadyRegistered));
        });
    }

    #[test]
    fn test_invalid_transition_errors() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(crate::YieldVault, ());

        env.as_contract(&contract_id, || {
            let admin = Address::generate(&env);
            let strategy = Address::generate(&env);
            set_admin(&env, &admin);

            // Activating unregistered strategy
            assert_eq!(
                activate_strategy(&env, &admin, &strategy),
                Err(StrategyRegistrationError::InvalidTransition)
            );

            // Retiring unregistered strategy
            assert_eq!(
                retire_strategy(&env, &admin, &strategy, None),
                Err(StrategyRegistrationError::InvalidTransition)
            );

            // Register -> Pending
            assert_eq!(register_strategy(&env, &admin, &strategy), Ok(STATE_PENDING));

            // Activate -> Active
            assert_eq!(activate_strategy(&env, &admin, &strategy), Ok(STATE_ACTIVE));

            // Double activation (Active -> Active)
            assert_eq!(
                activate_strategy(&env, &admin, &strategy),
                Err(StrategyRegistrationError::InvalidTransition)
            );

            // Retire -> Retired
            assert_eq!(retire_strategy(&env, &admin, &strategy, None), Ok(STATE_RETIRED));

            // Cannot activate retired strategy
            assert_eq!(
                activate_strategy(&env, &admin, &strategy),
                Err(StrategyRegistrationError::InvalidTransition)
            );

            // Cannot retire retired strategy again
            assert_eq!(
                retire_strategy(&env, &admin, &strategy, None),
                Err(StrategyRegistrationError::InvalidTransition)
            );
        });
    }

    #[test]
    fn test_retire_active_strategy_in_use_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(crate::YieldVault, ());

        env.as_contract(&contract_id, || {
            let admin = Address::generate(&env);
            let strategy = Address::generate(&env);
            let other_strategy = Address::generate(&env);
            set_admin(&env, &admin);

            assert_eq!(register_strategy(&env, &admin, &strategy), Ok(STATE_PENDING));
            assert_eq!(activate_strategy(&env, &admin, &strategy), Ok(STATE_ACTIVE));

            // Attempt to retire while actively set as the vault strategy
            let res = retire_strategy(&env, &admin, &strategy, Some(strategy.clone()));
            assert_eq!(res, Err(StrategyRegistrationError::ActiveStrategyInUse));
            assert_eq!(read_registration_state(&env, &strategy), Some(STATE_ACTIVE));

            // Retiring succeeds when active vault strategy is different
            let res_other = retire_strategy(&env, &admin, &strategy, Some(other_strategy));
            assert_eq!(res_other, Ok(STATE_RETIRED));
            assert_eq!(read_registration_state(&env, &strategy), Some(STATE_RETIRED));
        });
    }

    #[test]
    fn test_negative_auth_non_admin_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(crate::YieldVault, ());

        env.as_contract(&contract_id, || {
            let admin = Address::generate(&env);
            let non_admin = Address::generate(&env);
            let strategy = Address::generate(&env);
            set_admin(&env, &admin);

            // Non-admin register_strategy rejected
            assert_eq!(
                register_strategy(&env, &non_admin, &strategy),
                Err(StrategyRegistrationError::Unauthorized)
            );
            assert_eq!(read_registration_state(&env, &strategy), None);

            // Admin registers
            assert_eq!(register_strategy(&env, &admin, &strategy), Ok(STATE_PENDING));

            // Non-admin activate_strategy rejected
            assert_eq!(
                activate_strategy(&env, &non_admin, &strategy),
                Err(StrategyRegistrationError::Unauthorized)
            );
            assert_eq!(read_registration_state(&env, &strategy), Some(STATE_PENDING));

            // Admin activates
            assert_eq!(activate_strategy(&env, &admin, &strategy), Ok(STATE_ACTIVE));

            // Non-admin retire_strategy rejected
            assert_eq!(
                retire_strategy(&env, &non_admin, &strategy, None),
                Err(StrategyRegistrationError::Unauthorized)
            );
            assert_eq!(read_registration_state(&env, &strategy), Some(STATE_ACTIVE));
        });
    }

    #[test]
    fn test_negative_auth_missing_admin_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(crate::YieldVault, ());

        env.as_contract(&contract_id, || {
            let caller = Address::generate(&env);
            let strategy = Address::generate(&env);
            // No admin set

            assert_eq!(
                register_strategy(&env, &caller, &strategy),
                Err(StrategyRegistrationError::Unauthorized)
            );
            assert_eq!(
                activate_strategy(&env, &caller, &strategy),
                Err(StrategyRegistrationError::Unauthorized)
            );
            assert_eq!(
                retire_strategy(&env, &caller, &strategy, None),
                Err(StrategyRegistrationError::Unauthorized)
            );
        });
    }

    #[test]
    fn test_remove_registration_resets_state() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(crate::YieldVault, ());

        env.as_contract(&contract_id, || {
            let admin = Address::generate(&env);
            let strategy = Address::generate(&env);
            set_admin(&env, &admin);

            assert_eq!(register_strategy(&env, &admin, &strategy), Ok(STATE_PENDING));
            assert_eq!(read_registration_state(&env, &strategy), Some(STATE_PENDING));

            // Remove registration
            remove_registration(&env, &strategy);
            assert_eq!(read_registration_state(&env, &strategy), None);
            assert!(!is_eligible_for_allocation(&env, &strategy));
            assert_eq!(
                require_active_registration(&env, &strategy),
                Err(StrategyRegistrationError::NotRegistered)
            );

            // After removal, re-registration is possible
            assert_eq!(register_strategy(&env, &admin, &strategy), Ok(STATE_PENDING));
            assert_eq!(read_registration_state(&env, &strategy), Some(STATE_PENDING));
        });
    }

    #[test]
    fn test_cooldown_interaction_with_registration() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(crate::YieldVault, ());

        env.as_contract(&contract_id, || {
            let admin = Address::generate(&env);
            let strategy = Address::generate(&env);
            set_admin(&env, &admin);

            // Configure strategy switch cooldown
            let cooldown = 1800u64;
            let start_time = 50_000u64;
            env.storage().instance().set(&DataKey::StrategySwitchCooldown, &cooldown);
            env.storage().instance().set(&DataKey::LastStrategySwitchTime, &start_time);

            // During active cooldown period (start_time + 300 < start_time + 1800)
            env.ledger().with_mut(|li| {
                li.timestamp = start_time + 300;
            });

            // Registration and activation are permitted during cooldown
            assert_eq!(register_strategy(&env, &admin, &strategy), Ok(STATE_PENDING));
            assert_eq!(activate_strategy(&env, &admin, &strategy), Ok(STATE_ACTIVE));
            assert_eq!(read_registration_state(&env, &strategy), Some(STATE_ACTIVE));

            // State persists through passage of cooldown
            env.ledger().with_mut(|li| {
                li.timestamp = start_time + cooldown + 100;
            });
            assert_eq!(read_registration_state(&env, &strategy), Some(STATE_ACTIVE));
            assert!(is_eligible_for_allocation(&env, &strategy));

            // Retirement works cleanly after cooldown window
            assert_eq!(retire_strategy(&env, &admin, &strategy, None), Ok(STATE_RETIRED));
            assert_eq!(read_registration_state(&env, &strategy), Some(STATE_RETIRED));
            assert!(!is_eligible_for_allocation(&env, &strategy));
        });
    }
}
