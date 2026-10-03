//! Operational safety events for pause/resume transitions.
//!
//! This module ensures all pause and resume actions are observable and auditable
//! by emitting comprehensive events with metadata including actor, reason, and timestamp.

use soroban_sdk::{symbol_short, Address, Env, String};

/// Emitted when the vault is paused.
///
/// The topic is `vpaused` / `vunpause` rather than the longer
/// `vault_pause` / `vault_unpause`: `symbol_short!` rejects topic strings
/// longer than 9 characters, and these match the `paused` / `unpaused`
/// topics that `pause` / `unpause` in `lib.rs` already publish for the same
/// transitions.
///
/// # Fields
/// - `actor`: The address that initiated the pause (typically admin)
/// - `reason`: Enumerated pause reason code (0=None, 1=SecurityIncident, 2=OracleFailure, 3=LiquidityCrisis, 4=Governance, 5=Maintenance, 6=Other)
/// - `timestamp`: Ledger timestamp when pause was enacted
pub fn emit_pause_event(env: &Env, actor: &Address, reason_code: u32, timestamp: u64) {
    env.events().publish(
        (symbol_short!("vpaused"),),
        (actor.clone(), reason_code, timestamp),
    );
}

/// Emitted when the vault is resumed.
///
/// # Fields
/// - `actor`: The address that initiated the unpause (typically admin)
/// - `timestamp`: Ledger timestamp when resume was enacted
pub fn emit_unpause_event(env: &Env, actor: &Address, timestamp: u64) {
    env.events()
        .publish((symbol_short!("vunpause"),), (actor.clone(), timestamp));
}

/// Emitted when a pause transition is attempted but fails (e.g., already paused).
///
/// # Fields
/// - `actor`: The address that attempted the transition
/// - `reason`: Error message or code
/// - `current_state`: Boolean indicating if vault is currently paused
/// - `timestamp`: Ledger timestamp of the attempt
pub fn emit_pause_transition_failed(
    env: &Env,
    actor: &Address,
    reason: &str,
    current_state: bool,
    timestamp: u64,
) {
    env.events().publish(
        (symbol_short!("paufail"),),
        (
            actor.clone(),
            String::from_str(env, reason),
            current_state,
            timestamp,
        ),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn test_emit_pause_event() {
        let env = Env::default();
        let actor = Address::generate(&env);
        emit_pause_event(&env, &actor, 1, 1000u64);
        // Event emitted successfully
    }

    #[test]
    fn test_emit_unpause_event() {
        let env = Env::default();
        let actor = Address::generate(&env);
        emit_unpause_event(&env, &actor, 1000u64);
        // Event emitted successfully
    }

    #[test]
    fn test_emit_pause_transition_failed() {
        let env = Env::default();
        let actor = Address::generate(&env);
        emit_pause_transition_failed(&env, &actor, "already_paused", true, 1000u64);
        // Event emitted successfully
    }
}
