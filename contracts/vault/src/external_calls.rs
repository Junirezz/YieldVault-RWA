//! External Calls and Transactional Safety
//!
//! This module documents all external calls made by the vault and ensures they follow
//! the Checks-Effects-Interactions (CEI) pattern to prevent reentrancy vulnerabilities.
//!
//! # CEI Ordering
//!
//! For every external interaction, finish validation first, persist all state
//! effects second, and invoke the external contract last. This keeps callbacks
//! from observing stale accounting. Transaction atomicity rolls these effects
//! back if the interaction fails; it does not replace correct call ordering.
//!
//! See [`docs/CONTRACTS_ARCHITECTURE.md`](../../docs/CONTRACTS_ARCHITECTURE.md) for details.

/// Validates an external call precondition
#[inline]
pub fn validate_external_call_precondition(condition: bool, msg: &str) {
    if !condition {
        panic!("{}", msg);
    }
}

/// Runs the three CEI phases in order: checks, effects, then interactions.
///
/// Keep external contract calls exclusively in the `interactions` block. The
/// scoped blocks make the order executable and testable, not just documentary.
#[macro_export]
macro_rules! cei_pattern {
    ($name:expr, checks: $checks:block, effects: $effects:block, interactions: $interactions:block) => {{
        let _cei_operation = $name;
        $checks
        $effects
        $interactions
    }};
}

#[cfg(test)]
mod tests {

    #[test]
    fn test_cei_phases_run_in_order() {
        let mut state_updated = false;

        crate::cei_pattern!(
            "test operation",
            checks: {
                assert!(!state_updated);
            },
            effects: {
                state_updated = true;
            },
            interactions: {
                assert!(state_updated);
            }
        );
    }
}
