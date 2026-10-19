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

use crate::VaultError;
use soroban_sdk::{Address, Env, Map, Vec};

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
    assert!(
        is_admin || is_pauser,
        "unauthorized: caller must be admin or pauser"
    );
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
    /// Verify that threshold signatures are satisfied and that every approver
    /// actually authorized this invocation.
    ///
    /// Runs [`Self::check_threshold`] first, then calls `require_auth` on each
    /// approver, so an address listed in `approvals` without its signature
    /// cannot count toward the threshold.
    ///
    /// ### Parameters
    /// * `signers` - Set of authorized signers for this operation
    /// * `threshold` - Number of required signatures (M of N)
    /// * `approvals` - Addresses that have approved; each must sign the call
    ///
    /// ### Errors
    /// See [`Self::check_threshold`]; a missing signature aborts the call.
    pub fn verify_threshold(
        env: &Env,
        signers: &Vec<Address>,
        threshold: u32,
        approvals: &Vec<Address>,
    ) -> Result<(), VaultError> {
        Self::check_threshold(env, signers, threshold, approvals)?;
        for approver in approvals.iter() {
            approver.require_auth();
        }
        Ok(())
    }

    /// Validates `approvals` against `signers` and `threshold` without
    /// checking signatures.
    ///
    /// ### Errors
    /// * `VaultError::InvalidGovernanceThreshold` - threshold is 0 or exceeds the signer set
    /// * `VaultError::DuplicateVote` - the same approver appears more than once
    /// * `VaultError::GovernanceThresholdNotMet` - an approver is not a signer,
    ///   or there are fewer approvals than `threshold`
    pub fn check_threshold(
        env: &Env,
        signers: &Vec<Address>,
        threshold: u32,
        approvals: &Vec<Address>,
    ) -> Result<(), VaultError> {
        if threshold == 0 || threshold > signers.len() {
            return Err(VaultError::InvalidGovernanceThreshold);
        }

        // Map-backed sets give logarithmic membership / duplicate checks
        // instead of the previous O(n^2) pairwise scans.
        let mut signer_set: Map<Address, ()> = Map::new(env);
        for signer in signers.iter() {
            signer_set.set(signer, ());
        }

        // Reject duplicate approvals before counting toward the threshold.
        // This prevents a single signer from replaying the same authorization
        // multiple times to satisfy an M-of-N requirement.
        let mut seen: Map<Address, ()> = Map::new(env);
        for approver in approvals.iter() {
            if seen.contains_key(approver.clone()) {
                return Err(VaultError::DuplicateVote);
            }
            if !signer_set.contains_key(approver.clone()) {
                return Err(VaultError::GovernanceThresholdNotMet);
            }
            seen.set(approver, ());
        }

        if approvals.len() < threshold {
            return Err(VaultError::GovernanceThresholdNotMet);
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

    fn signers(env: &soroban_sdk::Env, n: usize) -> Vec<Address> {
        let mut v = Vec::new(env);
        for _ in 0..n {
            v.push_back(Address::generate(env));
        }
        v
    }

    #[test]
    fn test_threshold_valid_approvals() {
        let env = soroban_sdk::Env::default();
        let signers = signers(&env, 3);
        let approvals = Vec::from_array(&env, [signers.get(0).unwrap(), signers.get(1).unwrap()]);
        assert_eq!(
            MultiSignerValidator::check_threshold(&env, &signers, 2, &approvals),
            Ok(())
        );
    }

    #[test]
    fn test_threshold_insufficient_approvals() {
        let env = soroban_sdk::Env::default();
        let signers = signers(&env, 2);
        let approvals = Vec::from_array(&env, [signers.get(0).unwrap()]);
        assert_eq!(
            MultiSignerValidator::check_threshold(&env, &signers, 2, &approvals),
            Err(VaultError::GovernanceThresholdNotMet)
        );
    }

    #[test]
    fn test_threshold_rejects_invalid_threshold() {
        let env = soroban_sdk::Env::default();
        let signers = signers(&env, 2);
        let approvals = signers.clone();
        assert_eq!(
            MultiSignerValidator::check_threshold(&env, &signers, 0, &approvals),
            Err(VaultError::InvalidGovernanceThreshold)
        );
        assert_eq!(
            MultiSignerValidator::check_threshold(&env, &signers, 3, &approvals),
            Err(VaultError::InvalidGovernanceThreshold)
        );
    }

    #[test]
    fn test_threshold_rejects_duplicate_approval() {
        let env = soroban_sdk::Env::default();
        let signers = signers(&env, 3);
        let first = signers.get(0).unwrap();
        let approvals = Vec::from_array(&env, [first.clone(), first]);
        assert_eq!(
            MultiSignerValidator::check_threshold(&env, &signers, 2, &approvals),
            Err(VaultError::DuplicateVote)
        );
    }

    #[test]
    fn test_threshold_rejects_non_signer_approval() {
        let env = soroban_sdk::Env::default();
        let signers = signers(&env, 3);
        let approvals = Vec::from_array(&env, [signers.get(0).unwrap(), Address::generate(&env)]);
        assert_eq!(
            MultiSignerValidator::check_threshold(&env, &signers, 2, &approvals),
            Err(VaultError::GovernanceThresholdNotMet)
        );
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

    /// Contract-level spoof rejection: approvals only count for signers that
    /// actually signed the `require_governance_threshold` invocation.
    #[test]
    fn test_require_governance_threshold_needs_each_approver_signature() {
        use crate::{YieldVault, YieldVaultClient};
        use soroban_sdk::testutils::{MockAuth, MockAuthInvoke};
        use soroban_sdk::IntoVal;

        let env = soroban_sdk::Env::default();
        let vault_id = env.register(YieldVault, ());
        let vault = YieldVaultClient::new(&env, &vault_id);
        let admin = Address::generate(&env);
        let signers = signers(&env, 3);

        env.mock_all_auths();
        vault.initialize(&admin, &Address::generate(&env));
        vault.set_governance_signers(&signers, &2, &0);

        let approvals = Vec::from_array(&env, [signers.get(0).unwrap(), signers.get(1).unwrap()]);
        let args = (approvals.clone(),).into_val(&env);
        let invoke = MockAuthInvoke {
            contract: &vault_id,
            fn_name: "require_governance_threshold",
            args,
            sub_invokes: &[],
        };
        let first = signers.get(0).unwrap();
        let second = signers.get(1).unwrap();

        // Only the first approver signed: the second is a spoofed entry.
        env.mock_auths(&[MockAuth {
            address: &first,
            invoke: &invoke,
        }]);
        assert!(vault.try_require_governance_threshold(&approvals).is_err());

        // Both approvers signed.
        env.mock_auths(&[
            MockAuth {
                address: &first,
                invoke: &invoke,
            },
            MockAuth {
                address: &second,
                invoke: &invoke,
            },
        ]);
        assert_eq!(
            vault.try_require_governance_threshold(&approvals),
            Ok(Ok(()))
        );
    }
}
