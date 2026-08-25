//! Permission Matrix and Access Control
//!
//! This module defines the authorization requirements for all vault operations.
//!
//! See [`docs/CONTRACTS_ARCHITECTURE.md`](../../docs/CONTRACTS_ARCHITECTURE.md) for the full
//! permission matrix and security model.
//!
//! ## Multi-Signer Governance
//!
//! For critical operations, the vault supports M-of-N multisig governance:
//! - Configure a set of authorized signers
//! - Set a threshold (M) for required approvals
//! - Migration-safe updates: old and new signer sets coexist during transition
//! - Operations require threshold signatures from the current active set

use soroban_sdk::{Address, Vec};

/// Verifies that the caller is the admin
///
/// # Examples
///
/// ```ignore
/// require_admin_auth(&env, &admin)?;
/// ```
pub fn require_admin_auth(admin: &Address) {
    admin.require_auth();
}

/// Verifies that the caller is an authorized address
pub fn require_caller_auth(caller: &Address) {
    caller.require_auth();
}

/// Verifies that the caller is a specific strategy (external call validation)
pub fn require_strategy_auth(caller: &Address, expected_strategy: &Address) {
    caller.require_auth();
    assert_eq!(caller, expected_strategy, "unauthorized strategy");
}

/// Verifies that the caller is authorized for pausability operations (either Admin or Pauser role)
pub fn require_pauser_or_admin_auth(caller: &Address, admin: &Address, pauser: Option<&Address>) {
    caller.require_auth();
    let is_admin = caller == admin;
    let is_pauser = pauser.map_or(false, |p| caller == p);
    assert!(is_admin || is_pauser, "unauthorized: caller must be admin or pauser");
}

/// Multi-signer threshold validator for governance operations.
/// Ensures M of N signers have authorized a critical operation.
///
/// Trust assumptions:
/// - Every approval is treated as a single-use signature and must be unique.
/// - Duplicate entries are rejected to prevent replay of the same signer weight.
/// - The calling operation still owns the action-state checks (proposal status,
///   timelock expiry, pending queue lifecycle) so stale approvals cannot be re-used
///   out of order.
pub struct MultiSignerValidator;

impl MultiSignerValidator {
    /// Verify that threshold signatures are satisfied.
    ///
    /// ### Parameters
    /// * `signers` - Set of authorized signers for this operation
    /// * `threshold` - Number of required signatures (M of N)
    /// * `approvals` - Vector of addresses that have approved (deduplicated, sorted)
    ///
    /// ### Returns
    /// Ok if number of approvals >= threshold, Err otherwise
    pub fn verify_threshold(
        signers: &Vec<Address>,
        threshold: u32,
        approvals: &Vec<Address>,
    ) -> Result<(), &'static str> {
        if threshold == 0 {
            return Err("threshold must be > 0");
        }
        if threshold > signers.len() {
            return Err("threshold exceeds signer set size");
        }

        // Reject duplicate approvals before counting toward the threshold.
        // This prevents a single signer from replaying the same authorization
        // multiple times to satisfy an M-of-N requirement.
        for i in 0..approvals.len() {
            let first = approvals.get(i).unwrap();
            for j in (i + 1)..approvals.len() {
                let second = approvals.get(j).unwrap();
                if first == second {
                    return Err("duplicate signer approval");
                }
            }
        }

        if approvals.len() < threshold {
            return Err("insufficient approvals");
        }

        // Verify all approvers are in the signer set.
        for approver in approvals.iter() {
            if !signers.iter().any(|s| s == approver) {
                return Err("unauthorized signer");
            }
        }

        Ok(())
    }

    /// Compute migration status between old and new signer sets.
    /// Returns true if both old and new sets should be accepted (during transition).
    pub fn is_migration_active(
        old_set_hash: Option<u64>,
        new_set_hash: Option<u64>,
        migration_deadline: u64,
        current_time: u64,
    ) -> bool {
        old_set_hash.is_some() && new_set_hash.is_some() && current_time < migration_deadline
    }
}

#[cfg(test)]
mod tests {

    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn test_permission_matrix_documentation_exists() {
        // This test documents that the permission matrix is defined
        // Actual enforcement is tested in lib.rs via role gating tests
    }

    #[test]
    fn test_threshold_valid_approvals() {
        let env = soroban_sdk::Env::default();
        let signers = Vec::from_array(
            &env,
            [
                Address::generate(&env),
                Address::generate(&env),
                Address::generate(&env),
            ],
        );
        let approvals = Vec::from_array(&env, [signers.get(0).unwrap(), signers.get(1).unwrap()]);
        assert!(MultiSignerValidator::verify_threshold(&signers, 2, &approvals).is_ok());
    }

    #[test]
    fn test_threshold_insufficient_approvals() {
        let env = soroban_sdk::Env::default();
        let signers = Vec::from_array(&env, [Address::generate(&env), Address::generate(&env)]);
        let approvals = Vec::from_array(&env, [signers.get(0).unwrap()]);
        assert!(MultiSignerValidator::verify_threshold(&signers, 2, &approvals).is_err());
    }

    #[test]
    fn test_migration_active() {
        let result = MultiSignerValidator::is_migration_active(Some(1), Some(2), 1000, 500);
        assert!(result);
    }

    #[test]
    fn test_migration_inactive_expired() {
        let result = MultiSignerValidator::is_migration_active(Some(1), Some(2), 1000, 1500);
        assert!(!result);
    }
}
