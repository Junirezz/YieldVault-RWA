//! Admin rotation proposals with deterministic nonces and replay protection.

use soroban_sdk::{contracttype, Address, Env};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminProposal {
    pub new_admin: Address,
    pub proposer: Address,
    pub accepted: bool,
    pub cancelled: bool,
    pub created_at: u64,
}

pub fn read_proposal(env: &Env, id: u32) -> Option<AdminProposal> {
    env.storage()
        .instance()
        .get(&crate::DataKey::AdminProposal(id))
}

pub fn write_proposal(env: &Env, id: u32, proposal: &AdminProposal) {
    env.storage()
        .instance()
        .set(&crate::DataKey::AdminProposal(id), proposal);
}

pub fn next_proposal_id(env: &Env) -> u32 {
    let nonce: u32 = env
        .storage()
        .instance()
        .get(&crate::DataKey::AdminProposalNonce)
        .unwrap_or(0);
    let next = nonce.checked_add(1).expect("admin proposal nonce overflow");
    env.storage()
        .instance()
        .set(&crate::DataKey::AdminProposalNonce, &next);
    next
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env};

    #[test]
    fn test_admin_proposal_nonce_is_monotonic() {
        let env = Env::default();
        let contract_id = env.register(crate::YieldVault, ());
        env.as_contract(&contract_id, || {
            assert_eq!(next_proposal_id(&env), 1);
            assert_eq!(next_proposal_id(&env), 2);
            assert_eq!(next_proposal_id(&env), 3);
        });
    }

    #[test]
    fn test_admin_proposal_round_trip() {
        let env = Env::default();
        let contract_id = env.register(crate::YieldVault, ());
        let proposer = Address::generate(&env);
        let new_admin = Address::generate(&env);
        let proposal = AdminProposal {
            new_admin: new_admin.clone(),
            proposer: proposer.clone(),
            accepted: false,
            cancelled: false,
            created_at: 42,
        };
        env.as_contract(&contract_id, || {
            write_proposal(&env, 1, &proposal);
            let loaded = read_proposal(&env, 1).expect("proposal stored");
            assert_eq!(loaded, proposal);
        });
    }
}
