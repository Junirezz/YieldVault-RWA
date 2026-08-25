//! Governance validation for policy updates and state transitions.
//!
//! This module ensures that governance operations are only executed when all
//! required conditions are met, preventing stale proposals and invalid state transitions.

use soroban_sdk::{Address, Env, Vec};
use crate::VaultError;

/// Configuration for governance validation.
///
/// Specifies the quorum and voting requirements for proposals.
#[derive(Clone, Debug)]
pub struct GovernanceConfig {
    /// Required number of signers to approve a proposal
    pub quorum: u32,
    /// Total number of authorized signers
    pub total_signers: u32,
    /// Maximum age of a proposal before it becomes stale (in seconds)
    pub proposal_max_age_seconds: u64,
    /// Minimum voting period required before execution (in seconds)
    pub min_voting_period_seconds: u64,
}

/// Proposal state tracking.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalState {
    /// Proposal is active and accepting votes
    Active,
    /// Proposal has reached quorum and can be executed
    Approved,
    /// Proposal has expired due to age
    Stale,
    /// Proposal has been rejected or cancelled
    Rejected,
    /// Proposal has been executed
    Executed,
}

/// Governance validator for policy updates.
pub struct GovernanceValidator;

impl GovernanceValidator {
    /// Validates that a proposal satisfies quorum requirements.
    ///
    /// # Parameters
    /// - `votes_received`: Number of votes/approvals received
    /// - `config`: Governance configuration with quorum requirement
    ///
    /// # Errors
    /// - Returns `VaultError::InsufficientGovernanceVotes` if quorum not met
    ///
    /// # Examples
    /// ```ignore
    /// GovernanceValidator::validate_quorum(5, &config)?;
    /// ```
    pub fn validate_quorum(votes_received: u32, config: &GovernanceConfig) -> Result<(), VaultError> {
        if votes_received < config.quorum {
            return Err(VaultError::InsufficientGovernanceVotes);
        }
        Ok(())
    }

    /// Validates that a proposal has not exceeded its maximum age.
    ///
    /// # Parameters
    /// - `proposal_created_at`: Timestamp when proposal was created
    /// - `current_timestamp`: Current ledger timestamp
    /// - `max_age_seconds`: Maximum allowed age of proposal
    ///
    /// # Errors
    /// - Returns `VaultError::ProposalStale` if proposal is too old
    ///
    /// # Examples
    /// ```ignore
    /// GovernanceValidator::validate_proposal_freshness(
    ///     1000,      // created at
    ///     2000,      // now at
    ///     86400      // max age: 1 day
    /// )?;
    /// ```
    pub fn validate_proposal_freshness(
        proposal_created_at: u64,
        current_timestamp: u64,
        max_age_seconds: u64,
    ) -> Result<(), VaultError> {
        let age = current_timestamp.saturating_sub(proposal_created_at);
        if age > max_age_seconds {
            return Err(VaultError::ProposalStale);
        }
        Ok(())
    }

    /// Validates that sufficient voting period has elapsed before execution.
    ///
    /// # Parameters
    /// - `voting_started_at`: When voting commenced
    /// - `current_timestamp`: Current ledger timestamp
    /// - `min_voting_period`: Minimum seconds that must elapse
    ///
    /// # Errors
    /// - Returns `VaultError::ProposalNotReady` if minimum period has not elapsed
    pub fn validate_minimum_voting_period(
        voting_started_at: u64,
        current_timestamp: u64,
        min_voting_period: u64,
    ) -> Result<(), VaultError> {
        let elapsed = current_timestamp.saturating_sub(voting_started_at);
        if elapsed < min_voting_period {
            return Err(VaultError::ProposalNotReady);
        }
        Ok(())
    }

    /// Validates that a proposal state transition is legal.
    ///
    /// # State Machine
    /// ```text
    /// Initial (None)
    ///   ↓
    /// Active → [Approved] → Executed
    ///   ↓
    /// [Stale/Rejected] (terminal)
    /// ```
    ///
    /// # Valid Transitions
    /// - None → Active (create)
    /// - Active → Approved (when quorum met)
    /// - Active → Stale (when too old)
    /// - Approved → Executed (execute)
    /// - Active → Rejected (cancel)
    ///
    /// # Errors
    /// - Returns `VaultError::InvalidProposalTransition` if transition is invalid
    pub fn validate_state_transition(
        from: ProposalState,
        to: ProposalState,
    ) -> Result<(), VaultError> {
        let valid = match (&from, &to) {
            // Initial creation
            (ProposalState::Active, _) => matches!(
                to,
                ProposalState::Approved | ProposalState::Stale | ProposalState::Rejected
            ),
            // Execution from approved state
            (ProposalState::Approved, ProposalState::Executed) => true,
            // Terminal states cannot transition
            (ProposalState::Stale, _) | (ProposalState::Rejected, _) | (ProposalState::Executed, _) => {
                false
            }
            _ => false,
        };

        if valid {
            Ok(())
        } else {
            Err(VaultError::InvalidProposalTransition)
        }
    }

    /// Validates that a proposal's signer set is unchanged.
    ///
    /// # Purpose
    /// Prevents execution of proposals using a different signer set than when
    /// the proposal was created. This prevents:
    /// - Executing proposals with different signers than originally approved
    /// - Accepting additional signers mid-voting
    ///
    /// # Parameters
    /// - `original_signers`: Signers when proposal was created (sorted, deduplicated)
    /// - `current_signers`: Signers at execution time (sorted, deduplicated)
    ///
    /// # Errors
    /// - Returns `VaultError::GovernanceSignersChanged` if signer set differs
    pub fn validate_signer_set_unchanged(
        original_signers: &Vec<Address>,
        current_signers: &Vec<Address>,
    ) -> Result<(), VaultError> {
        if original_signers.len() != current_signers.len() {
            return Err(VaultError::GovernanceSignersChanged);
        }

        for (orig, curr) in original_signers.iter().zip(current_signers.iter()) {
            if orig != curr {
                return Err(VaultError::GovernanceSignersChanged);
            }
        }

        Ok(())
    }

    /// Validates a complete policy update proposal.
    ///
    /// # Comprehensive Validation Checklist
    /// 1. Quorum met: `votes_received >= quorum`
    /// 2. Proposal not stale: `age <= max_age_seconds`
    /// 3. Minimum voting period elapsed: `elapsed >= min_voting_period`
    /// 4. Valid state transition: Active → Approved
    /// 5. Signer set unchanged (if applicable)
    /// 6. Proposal not already executed
    ///
    /// # Parameters
    /// - `votes_received`: Votes/approvals received
    /// - `proposal_created_at`: Creation timestamp
    /// - `current_timestamp`: Current ledger time
    /// - `config`: Governance configuration
    /// - `already_executed`: Whether proposal has been executed
    /// - `original_signers`: Signer set at proposal creation
    /// - `current_signers`: Current signer set
    ///
    /// # Errors
    /// Returns first validation failure encountered
    pub fn validate_policy_update_proposal(
        votes_received: u32,
        proposal_created_at: u64,
        current_timestamp: u64,
        config: &GovernanceConfig,
        already_executed: bool,
        original_signers: &Vec<Address>,
        current_signers: &Vec<Address>,
    ) -> Result<(), VaultError> {
        // Check 1: Quorum
        Self::validate_quorum(votes_received, config)?;

        // Check 2: Not stale
        Self::validate_proposal_freshness(proposal_created_at, current_timestamp, config.proposal_max_age_seconds)?;

        // Check 3: Minimum voting period elapsed
        Self::validate_minimum_voting_period(
            proposal_created_at,
            current_timestamp,
            config.min_voting_period_seconds,
        )?;

        // Check 4: Valid state transition (implicitly Active → Executed)
        // Caller should verify state before calling

        // Check 5: Already executed?
        if already_executed {
            return Err(VaultError::ProposalAlreadyExecuted);
        }

        // Check 6: Signer set consistency
        Self::validate_signer_set_unchanged(original_signers, current_signers)?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    fn create_test_config() -> GovernanceConfig {
        GovernanceConfig {
            quorum: 2,
            total_signers: 3,
            proposal_max_age_seconds: 86400,      // 1 day
            min_voting_period_seconds: 3600,      // 1 hour
        }
    }

    #[test]
    fn test_validate_quorum_met() {
        let config = create_test_config();
        assert!(GovernanceValidator::validate_quorum(2, &config).is_ok());
        assert!(GovernanceValidator::validate_quorum(3, &config).is_ok());
    }

    #[test]
    fn test_validate_quorum_not_met() {
        let config = create_test_config();
        let result = GovernanceValidator::validate_quorum(1, &config);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_proposal_freshness_fresh() {
        let result = GovernanceValidator::validate_proposal_freshness(1000, 2000, 3600);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_proposal_freshness_stale() {
        let result = GovernanceValidator::validate_proposal_freshness(1000, 100_000, 3600);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_minimum_voting_period_elapsed() {
        let result = GovernanceValidator::validate_minimum_voting_period(1000, 5000, 3600);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_minimum_voting_period_not_elapsed() {
        let result = GovernanceValidator::validate_minimum_voting_period(1000, 2000, 3600);
        assert!(result.is_err());
    }

    #[test]
    fn test_state_transition_active_to_approved() {
        let result = GovernanceValidator::validate_state_transition(
            ProposalState::Active,
            ProposalState::Approved,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_state_transition_approved_to_executed() {
        let result = GovernanceValidator::validate_state_transition(
            ProposalState::Approved,
            ProposalState::Executed,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_state_transition_stale_no_transition() {
        let result = GovernanceValidator::validate_state_transition(
            ProposalState::Stale,
            ProposalState::Approved,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_signer_set_unchanged() {
        let env = Env::default();
        let addr1 = Address::generate(&env);
        let addr2 = Address::generate(&env);
        let signers: Vec<Address> = [addr1.clone(), addr2.clone()].into_iter().collect(&env);
        let signers_same: Vec<Address> = [addr1.clone(), addr2.clone()].into_iter().collect(&env);

        let result = GovernanceValidator::validate_signer_set_unchanged(&signers, &signers_same);
        assert!(result.is_ok());
    }

    #[test]
    fn test_signer_set_changed() {
        let env = Env::default();
        let addr1 = Address::generate(&env);
        let addr2 = Address::generate(&env);
        let addr3 = Address::generate(&env);
        let signers: Vec<Address> = [addr1.clone(), addr2.clone()].into_iter().collect(&env);
        let signers_changed: Vec<Address> = [addr1, addr3].into_iter().collect(&env);

        let result = GovernanceValidator::validate_signer_set_unchanged(&signers, &signers_changed);
        assert!(result.is_err());
    }
}
