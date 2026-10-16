//! # Secure Whitelist Module
//!
//! Manages approved strategy contract IDs and their registration lifecycle state.

use soroban_sdk::{Address, Env};

use crate::strategy_registration::{self, STATE_RETIRED};
use crate::upgrade::get_admin;

/// Errors that can occur during whitelist operations
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WhitelistError {
    Unauthorized,
    InvalidStrategy,
    OperationFailed,
}

pub struct SecureWhitelist;

impl SecureWhitelist {
    pub fn add_strategy(
        env: &Env,
        caller: &Address,
        strategy: &Address,
    ) -> Result<(), WhitelistError> {
        let admin = get_admin(env).ok_or(WhitelistError::Unauthorized)?;
        if caller != &admin {
            return Err(WhitelistError::Unauthorized);
        }

        match strategy_registration::read_registration_state(env, strategy) {
            None => {
                let _ = strategy_registration::register_strategy_internal(env, strategy);
            }
            Some(STATE_RETIRED) => {
                return Err(WhitelistError::OperationFailed);
            }
            Some(_) => {}
        }

        Ok(())
    }

    pub fn remove_strategy(
        env: &Env,
        caller: &Address,
        strategy: &Address,
    ) -> Result<(), WhitelistError> {
        let admin = get_admin(env).ok_or(WhitelistError::Unauthorized)?;
        if caller != &admin {
            return Err(WhitelistError::Unauthorized);
        }

        strategy_registration::remove_registration(env, strategy);
        Ok(())
    }

    pub fn is_strategy_whitelisted(env: &Env, strategy: &Address) -> bool {
        strategy_registration::is_eligible_for_allocation(env, strategy)
    }

    pub fn get_whitelist_status(env: &Env, strategy: &Address) -> bool {
        Self::is_strategy_whitelisted(env, strategy)
    }

    pub fn set_whitelist_status(
        env: &Env,
        caller: &Address,
        strategy: &Address,
        approved: bool,
    ) -> Result<(), WhitelistError> {
        if approved {
            Self::add_strategy(env, caller, strategy)
        } else {
            Self::remove_strategy(env, caller, strategy)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::strategy_registration::{
        activate_strategy_internal, read_registration_state, retire_strategy_internal,
        STATE_ACTIVE, STATE_PENDING, STATE_RETIRED,
    };
    use crate::upgrade::set_admin;
    use crate::DataKey;
    use soroban_sdk::{testutils::Address as _, Address, Env};

    #[test]
    fn test_whitelist_documentation_exists() {}

    #[test]
    fn test_add_strategy_admin_success() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(crate::YieldVault, ());

        env.as_contract(&contract_id, || {
            let admin = Address::generate(&env);
            let strategy = Address::generate(&env);
            set_admin(&env, &admin);

            assert!(!SecureWhitelist::is_strategy_whitelisted(&env, &strategy));
            assert!(!SecureWhitelist::get_whitelist_status(&env, &strategy));
            assert_eq!(read_registration_state(&env, &strategy), None);

            let res = SecureWhitelist::add_strategy(&env, &admin, &strategy);
            assert_eq!(res, Ok(()));

            assert_eq!(read_registration_state(&env, &strategy), Some(STATE_PENDING));
            assert!(SecureWhitelist::is_strategy_whitelisted(&env, &strategy));
            assert!(SecureWhitelist::get_whitelist_status(&env, &strategy));
        });
    }

    #[test]
    fn test_add_strategy_idempotent_for_pending_and_active() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(crate::YieldVault, ());

        env.as_contract(&contract_id, || {
            let admin = Address::generate(&env);
            let strategy = Address::generate(&env);
            set_admin(&env, &admin);

            // Add first time -> pending
            assert_eq!(SecureWhitelist::add_strategy(&env, &admin, &strategy), Ok(()));
            assert_eq!(read_registration_state(&env, &strategy), Some(STATE_PENDING));

            // Adding again while pending is a no-op success
            assert_eq!(SecureWhitelist::add_strategy(&env, &admin, &strategy), Ok(()));
            assert_eq!(read_registration_state(&env, &strategy), Some(STATE_PENDING));

            // Advance to active
            assert_eq!(activate_strategy_internal(&env, &strategy), Ok(STATE_ACTIVE));
            assert_eq!(read_registration_state(&env, &strategy), Some(STATE_ACTIVE));

            // Adding while active preserves active state and succeeds
            assert_eq!(SecureWhitelist::add_strategy(&env, &admin, &strategy), Ok(()));
            assert_eq!(read_registration_state(&env, &strategy), Some(STATE_ACTIVE));
            assert!(SecureWhitelist::is_strategy_whitelisted(&env, &strategy));
        });
    }

    #[test]
    fn test_add_strategy_retired_rejection() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(crate::YieldVault, ());

        env.as_contract(&contract_id, || {
            let admin = Address::generate(&env);
            let strategy = Address::generate(&env);
            set_admin(&env, &admin);

            // Add and retire
            assert_eq!(SecureWhitelist::add_strategy(&env, &admin, &strategy), Ok(()));
            assert_eq!(retire_strategy_internal(&env, &strategy, None), Ok(STATE_RETIRED));
            assert_eq!(read_registration_state(&env, &strategy), Some(STATE_RETIRED));
            assert!(!SecureWhitelist::is_strategy_whitelisted(&env, &strategy));

            // Attempting to re-add a retired strategy must fail
            let res = SecureWhitelist::add_strategy(&env, &admin, &strategy);
            assert_eq!(res, Err(WhitelistError::OperationFailed));
            assert_eq!(read_registration_state(&env, &strategy), Some(STATE_RETIRED));
            assert!(!SecureWhitelist::is_strategy_whitelisted(&env, &strategy));
        });
    }

    #[test]
    fn test_remove_strategy_admin_success() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(crate::YieldVault, ());

        env.as_contract(&contract_id, || {
            let admin = Address::generate(&env);
            let strategy = Address::generate(&env);
            set_admin(&env, &admin);

            assert_eq!(SecureWhitelist::add_strategy(&env, &admin, &strategy), Ok(()));
            assert!(SecureWhitelist::is_strategy_whitelisted(&env, &strategy));

            // Admin removes strategy
            assert_eq!(SecureWhitelist::remove_strategy(&env, &admin, &strategy), Ok(()));
            assert_eq!(read_registration_state(&env, &strategy), None);
            assert!(!SecureWhitelist::is_strategy_whitelisted(&env, &strategy));
            assert!(!SecureWhitelist::get_whitelist_status(&env, &strategy));

            // Removing already removed strategy is safe/idempotent
            assert_eq!(SecureWhitelist::remove_strategy(&env, &admin, &strategy), Ok(()));
            assert_eq!(read_registration_state(&env, &strategy), None);
        });
    }

    #[test]
    fn test_set_whitelist_status_add_and_remove() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(crate::YieldVault, ());

        env.as_contract(&contract_id, || {
            let admin = Address::generate(&env);
            let strategy = Address::generate(&env);
            set_admin(&env, &admin);

            // Set approved = true -> adds to whitelist
            assert_eq!(
                SecureWhitelist::set_whitelist_status(&env, &admin, &strategy, true),
                Ok(())
            );
            assert!(SecureWhitelist::is_strategy_whitelisted(&env, &strategy));
            assert_eq!(read_registration_state(&env, &strategy), Some(STATE_PENDING));

            // Set approved = false -> removes from whitelist
            assert_eq!(
                SecureWhitelist::set_whitelist_status(&env, &admin, &strategy, false),
                Ok(())
            );
            assert!(!SecureWhitelist::is_strategy_whitelisted(&env, &strategy));
            assert_eq!(read_registration_state(&env, &strategy), None);

            // Can be re-added after removal
            assert_eq!(
                SecureWhitelist::set_whitelist_status(&env, &admin, &strategy, true),
                Ok(())
            );
            assert!(SecureWhitelist::is_strategy_whitelisted(&env, &strategy));
            assert_eq!(read_registration_state(&env, &strategy), Some(STATE_PENDING));
        });
    }

    #[test]
    fn test_set_whitelist_status_retired_rejection() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(crate::YieldVault, ());

        env.as_contract(&contract_id, || {
            let admin = Address::generate(&env);
            let strategy = Address::generate(&env);
            set_admin(&env, &admin);

            assert_eq!(
                SecureWhitelist::set_whitelist_status(&env, &admin, &strategy, true),
                Ok(())
            );
            assert_eq!(retire_strategy_internal(&env, &strategy, None), Ok(STATE_RETIRED));

            // Setting approved = true on retired strategy must fail with OperationFailed
            let res = SecureWhitelist::set_whitelist_status(&env, &admin, &strategy, true);
            assert_eq!(res, Err(WhitelistError::OperationFailed));
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

            // Non-admin add_strategy rejected
            assert_eq!(
                SecureWhitelist::add_strategy(&env, &non_admin, &strategy),
                Err(WhitelistError::Unauthorized)
            );
            assert_eq!(read_registration_state(&env, &strategy), None);

            // Admin adds strategy
            assert_eq!(SecureWhitelist::add_strategy(&env, &admin, &strategy), Ok(()));

            // Non-admin remove_strategy rejected
            assert_eq!(
                SecureWhitelist::remove_strategy(&env, &non_admin, &strategy),
                Err(WhitelistError::Unauthorized)
            );
            assert_eq!(read_registration_state(&env, &strategy), Some(STATE_PENDING));

            // Non-admin set_whitelist_status rejected (both true and false)
            assert_eq!(
                SecureWhitelist::set_whitelist_status(&env, &non_admin, &strategy, false),
                Err(WhitelistError::Unauthorized)
            );
            assert_eq!(
                SecureWhitelist::set_whitelist_status(&env, &non_admin, &strategy, true),
                Err(WhitelistError::Unauthorized)
            );
            assert_eq!(read_registration_state(&env, &strategy), Some(STATE_PENDING));
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
            // Admin is never set in storage

            assert_eq!(
                SecureWhitelist::add_strategy(&env, &caller, &strategy),
                Err(WhitelistError::Unauthorized)
            );
            assert_eq!(
                SecureWhitelist::remove_strategy(&env, &caller, &strategy),
                Err(WhitelistError::Unauthorized)
            );
            assert_eq!(
                SecureWhitelist::set_whitelist_status(&env, &caller, &strategy, true),
                Err(WhitelistError::Unauthorized)
            );
            assert_eq!(
                SecureWhitelist::set_whitelist_status(&env, &caller, &strategy, false),
                Err(WhitelistError::Unauthorized)
            );
        });
    }

    #[test]
    fn test_cooldown_interaction_with_whitelist() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(crate::YieldVault, ());

        env.as_contract(&contract_id, || {
            let admin = Address::generate(&env);
            let strategy_a = Address::generate(&env);
            let strategy_b = Address::generate(&env);
            set_admin(&env, &admin);

            // Configure strategy switch cooldown
            let cooldown_seconds = 3600u64;
            let last_switch_time = 10_000u64;
            env.storage().instance().set(&DataKey::StrategySwitchCooldown, &cooldown_seconds);
            env.storage().instance().set(&DataKey::LastStrategySwitchTime, &last_switch_time);

            // Set ledger timestamp inside the cooldown window (last_switch + 600 < last_switch + 3600)
            env.ledger().with_mut(|li| {
                li.timestamp = last_switch_time + 600;
            });

            // Whitelist management operations must succeed during active cooldown
            // allowing governance to prepare candidates in advance
            assert_eq!(SecureWhitelist::add_strategy(&env, &admin, &strategy_a), Ok(()));
            assert_eq!(SecureWhitelist::add_strategy(&env, &admin, &strategy_b), Ok(()));
            assert!(SecureWhitelist::is_strategy_whitelisted(&env, &strategy_a));
            assert!(SecureWhitelist::is_strategy_whitelisted(&env, &strategy_b));

            // Verify cooldown state variables in storage were not mutated or corrupted
            let cooldown_val: u64 = env
                .storage()
                .instance()
                .get(&DataKey::StrategySwitchCooldown)
                .unwrap();
            let last_switch_val: u64 = env
                .storage()
                .instance()
                .get(&DataKey::LastStrategySwitchTime)
                .unwrap();
            assert_eq!(cooldown_val, cooldown_seconds);
            assert_eq!(last_switch_val, last_switch_time);

            // Removing a strategy during cooldown also succeeds
            assert_eq!(SecureWhitelist::remove_strategy(&env, &admin, &strategy_b), Ok(()));
            assert!(!SecureWhitelist::is_strategy_whitelisted(&env, &strategy_b));

            // Advance ledger timestamp beyond the cooldown period
            env.ledger().with_mut(|li| {
                li.timestamp = last_switch_time + cooldown_seconds + 1;
            });

            // Strategy A remains whitelisted after cooldown expiration
            assert!(SecureWhitelist::is_strategy_whitelisted(&env, &strategy_a));

            // Retire strategy A and verify terminal state even after cooldown
            assert_eq!(retire_strategy_internal(&env, &strategy_a, None), Ok(STATE_RETIRED));
            assert!(!SecureWhitelist::is_strategy_whitelisted(&env, &strategy_a));
            assert_eq!(
                SecureWhitelist::add_strategy(&env, &admin, &strategy_a),
                Err(WhitelistError::OperationFailed)
            );
        });
    }
}
