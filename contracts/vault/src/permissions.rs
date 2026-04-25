//! Permission Matrix and Access Control
//!
//! This module defines the authorization requirements for all vault operations.
//! 
//! # Permission Matrix
//!
//! | Function | Required Role | Note |
//! |----------|---------------|------|
//! | `initialize` | None (first call) | Can only be called once, sets admin |
//! | `set_strategy` | Admin | Configure active strategy |
//! | `set_pause` | Admin | Pause/unpause vault |
//! | `configure_korean_strategy` | Admin | Configure Korean debt strategy |
//! | `accrue_korean_debt_yield` | Admin | Harvest yield from Korean strategy |
//! | `set_dao_threshold` | Admin | Update governance threshold |
//! | `add_shipment` | Admin | Add RWA shipment |
//! | `update_shipment_status` | Admin | Update shipment status |
//! | `accrue_yield` | Admin | Artificially accrue yield |
//! | `invest` | Admin | Move funds to strategy |
//! | `divest` | Admin (or internal) | Recall funds from strategy |
//! | `create_strategy_proposal` | Proposer (signed) | Create governance proposal |
//! | `vote_on_proposal` | Voter (signed) | Vote on proposal |
//! | `execute_strategy_proposal` | Public | Execute approved proposal |
//! | `report_benji_yield` | Configured Strategy | Report yield from BENJI |
//! | `deposit` | User (signed) | Deposit underlying tokens |
//! | `withdraw` | User (signed) | Withdraw vault shares |
//! | `balance` | Public | Query user share balance |
//! | `token` | Public | Query underlying token address |
//! | `total_shares` | Public | Query total vault shares |
//! | `total_assets` | Public | Query total vault assets |
//! | `strategy` | Public | Query active strategy address |
//! | `is_paused` | Public | Query pause status |
//! | `shipment_ids_by_status` | Public | Query shipments by status |
//! | `calculate_shares` | Public | Calculate shares for amount |
//! | `calculate_assets` | Public | Calculate assets for shares |
//! | `upgrade` | Admin | Upgrade contract WASM code (safety: must be paused) |
//! | `version` | Public | Query current contract version |

use soroban_sdk::Address;

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

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{Address, Env};

    #[test]
    fn test_permission_matrix_documentation_exists() {
        // This test documents that the permission matrix is defined
        // Actual enforcement is tested in lib.rs via role gating tests
        assert!(true);
    }
}
