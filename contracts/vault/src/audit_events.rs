//! Audit events for vault state changes.
//!
//! Emits timestamped events for deposits, withdrawals, strategy switches,
//! and parameter changes to support an on-chain audit log.

use soroban_sdk::{symbol_short, Address, Env, String};

/// Emitted when a user deposits assets into the vault.
pub fn emit_deposit(env: &Env, user: &Address, amount: i128, shares: i128, timestamp: u64) {
    env.events().publish(
        (symbol_short!("audit_dep"),),
        (user.clone(), amount, shares, timestamp),
    );
}

/// Emitted when a user withdraws assets from the vault.
pub fn emit_withdrawal(env: &Env, user: &Address, shares: i128, assets: i128, timestamp: u64) {
    env.events().publish(
        (symbol_short!("audit_wdr"),),
        (user.clone(), shares, assets, timestamp),
    );
}

/// Emitted when the active strategy is changed.
pub fn emit_strategy_switch(
    env: &Env,
    admin: &Address,
    old_strategy: &Option<Address>,
    new_strategy: &Address,
    timestamp: u64,
) {
    env.events().publish(
        (symbol_short!("audit_str"),),
        (
            admin.clone(),
            old_strategy.clone(),
            new_strategy.clone(),
            timestamp,
        ),
    );
}

/// Emitted when a sensitive parameter is changed.
pub fn emit_parameter_change(env: &Env, admin: &Address, param_name: &str, timestamp: u64) {
    env.events().publish(
        (symbol_short!("audit_pmt"),),
        (admin.clone(), String::from_str(env, param_name), timestamp),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn test_emit_deposit() {
        let env = Env::default();
        let user = Address::generate(&env);
        emit_deposit(&env, &user, 1000, 990, 1000u64);
    }

    #[test]
    fn test_emit_withdrawal() {
        let env = Env::default();
        let user = Address::generate(&env);
        emit_withdrawal(&env, &user, 500, 505, 1000u64);
    }

    #[test]
    fn test_emit_strategy_switch() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let old = Some(Address::generate(&env));
        let new = Address::generate(&env);
        emit_strategy_switch(&env, &admin, &old, &new, 1000u64);
    }

    #[test]
    fn test_emit_parameter_change() {
        let env = Env::default();
        let admin = Address::generate(&env);
        emit_parameter_change(&env, &admin, "min_deposit", 1000u64);
    }
}
