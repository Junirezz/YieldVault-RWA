//! # Secure Whitelist Module
//!
//! Manages approved strategy contract IDs for allocation operations.
//!
//! ## Features
//! - Add/remove strategy from whitelist
//! - Check if strategy is whitelisted
//! - Query whitelist status
//! - Admin-only access control
//! - Storage-backed persistence

use soroban_sdk::{Address, Env};

use crate::upgrade::get_admin;
use crate::DataKey;

/// Errors that can occur during whitelist operations
#[derive(Debug, Clone, Copy)]
pub enum WhitelistError {
    /// Caller is not authorized to perform whitelist operations
    Unauthorized,
    /// Strategy address is invalid
    InvalidStrategy,
    /// Whitelist operation failed
    OperationFailed,
}

/// Whitelist management for strategy contract IDs
///
/// This module provides secure operations for maintaining an approved list
/// of strategy contract addresses. Only the vault admin can modify the whitelist.
///
/// # Authorization
/// - **Required Role:** Admin
/// - **Protected Operations:**
///   - Adding strategy to whitelist
///   - Removing strategy from whitelist
///   - Updating whitelist status
///
/// # Example
/// ```ignore
/// // Check if strategy is whitelisted
/// if SecureWhitelist::is_strategy_whitelisted(&env, &strategy_addr) {
///     // Use strategy for allocation
/// }
///
/// // Admin adds strategy to whitelist
/// SecureWhitelist::add_strategy(&env, &admin, &new_strategy)?;
///
/// // Admin removes strategy from whitelist
/// SecureWhitelist::remove_strategy(&env, &admin, &old_strategy)?;
/// ```
pub struct SecureWhitelist;

impl SecureWhitelist {
    /// Adds a strategy address to the whitelist.
    ///
    /// Only the admin can add strategies to the whitelist.
    ///
    /// # Arguments
    /// * `env` - Soroban environment
    /// * `caller` - Must be the vault admin
    /// * `strategy` - Strategy address to whitelist
    ///
    /// # Authorization
    /// Caller must be the vault admin and provide valid authentication.
    ///
    /// # Returns
    /// - `Ok(())` if the strategy was successfully added
    /// - `Err(WhitelistError)` if unauthorized or operation failed
    ///
    /// # Example
    /// ```ignore
    /// SecureWhitelist::add_strategy(&env, &admin, &strategy)?;
    /// ```
    pub fn add_strategy(
        env: &Env,
        caller: &Address,
        strategy: &Address,
    ) -> Result<(), WhitelistError> {
        // Verify caller is the admin
        let admin = get_admin(env).ok_or(WhitelistError::Unauthorized)?;
        if caller != &admin {
            caller.require_auth();
            return Err(WhitelistError::Unauthorized);
        }
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::StrategyWhitelist(strategy.clone()), &true);

        Ok(())
    }

    /// Removes a strategy address from the whitelist.
    ///
    /// Only the admin can remove strategies from the whitelist.
    ///
    /// # Arguments
    /// * `env` - Soroban environment
    /// * `caller` - Must be the vault admin
    /// * `strategy` - Strategy address to remove
    ///
    /// # Authorization
    /// Caller must be the vault admin and provide valid authentication.
    ///
    /// # Returns
    /// - `Ok(())` if the strategy was successfully removed
    /// - `Err(WhitelistError)` if unauthorized or operation failed
    ///
    /// # Example
    /// ```ignore
    /// SecureWhitelist::remove_strategy(&env, &admin, &strategy)?;
    /// ```
    pub fn remove_strategy(
        env: &Env,
        caller: &Address,
        strategy: &Address,
    ) -> Result<(), WhitelistError> {
        // Verify caller is the admin
        let admin = get_admin(env).ok_or(WhitelistError::Unauthorized)?;
        if caller != &admin {
            caller.require_auth();
            return Err(WhitelistError::Unauthorized);
        }
        admin.require_auth();

        env.storage()
            .instance()
            .remove(&DataKey::StrategyWhitelist(strategy.clone()));

        Ok(())
    }

    /// Checks if a strategy is whitelisted.
    ///
    /// This is a read-only operation and does not require authentication.
    ///
    /// # Arguments
    /// * `env` - Soroban environment
    /// * `strategy` - Strategy address to check
    ///
    /// # Returns
    /// `true` if the strategy is whitelisted, `false` otherwise
    ///
    /// # Example
    /// ```ignore
    /// if SecureWhitelist::is_strategy_whitelisted(&env, &strategy) {
    ///     // Strategy is approved for allocation
    /// }
    /// ```
    pub fn is_strategy_whitelisted(env: &Env, strategy: &Address) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::StrategyWhitelist(strategy.clone()))
            .unwrap_or(false)
    }

    /// Gets the whitelist status of a strategy with defaults.
    ///
    /// Returns the whitelist status, or `false` if not set.
    ///
    /// # Arguments
    /// * `env` - Soroban environment
    /// * `strategy` - Strategy address
    ///
    /// # Returns
    /// Whitelist status (true = whitelisted, false = not whitelisted)
    pub fn get_whitelist_status(env: &Env, strategy: &Address) -> bool {
        Self::is_strategy_whitelisted(env, strategy)
    }

    /// Updates the whitelist status of a strategy.
    ///
    /// Only the admin can update the whitelist status.
    ///
    /// # Arguments
    /// * `env` - Soroban environment
    /// * `caller` - Must be the vault admin
    /// * `strategy` - Strategy address
    /// * `approved` - true to approve, false to revoke
    ///
    /// # Authorization
    /// Caller must be the vault admin and provide valid authentication.
    ///
    /// # Returns
    /// - `Ok(())` if the status was successfully updated
    /// - `Err(WhitelistError)` if unauthorized
    pub fn set_whitelist_status(
        env: &Env,
        caller: &Address,
        strategy: &Address,
        approved: bool,
    ) -> Result<(), WhitelistError> {
        // Verify caller is the admin
        let admin = get_admin(env).ok_or(WhitelistError::Unauthorized)?;
        if caller != &admin {
            caller.require_auth();
            return Err(WhitelistError::Unauthorized);
        }
        admin.require_auth();

        if approved {
            Self::add_strategy(env, caller, strategy)?;
        } else {
            Self::remove_strategy(env, caller, strategy)?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_whitelist_documentation_exists() {
        // This test documents that the whitelist module is implemented
        // Actual enforcement is tested in lib.rs via integration tests
    }
}
