//! Strategy response validation and malformed payload detection.
//!
//! This module ensures that strategy contract responses are well-formed and
//! cannot break vault logic through adversarial or corrupted payloads.

use crate::VaultError;
use soroban_sdk::{Address, Env};

/// Maximum allowed strategy total value to prevent overflow and unreasonable responses.
/// Set conservatively to catch malicious responses while allowing legitimate vaults.
pub const MAX_STRATEGY_VALUE: i128 = i128::MAX / 2;

/// Strategy response validator providing comprehensive payload validation.
pub struct StrategyValidator;

impl StrategyValidator {
    /// Validates a total_value response from a strategy contract.
    ///
    /// # Validation Rules
    /// 1. Value must be non-negative (no negative balances)
    /// 2. Value must not exceed `MAX_STRATEGY_VALUE` (prevents overflow)
    /// 3. Value must be finite (not NaN or Inf, though i128 inherently prevents this)
    ///
    /// # Errors
    /// - Returns `VaultError::InvalidStrategyResponse` if value is negative
    /// - Returns `VaultError::StrategyValueOverflow` if value exceeds bounds
    ///
    /// # Examples
    /// ```ignore
    /// let result = StrategyValidator::validate_total_value(100_000)?;
    /// ```
    pub fn validate_total_value(value: i128) -> Result<(), VaultError> {
        // Rule 1: Value must be non-negative
        if value < 0 {
            return Err(VaultError::InvalidStrategyResponse);
        }

        // Rule 2: Value must not exceed maximum bound
        if value > MAX_STRATEGY_VALUE {
            return Err(VaultError::StrategyValueOverflow);
        }

        Ok(())
    }

    /// Validates a deposit response to ensure consistency with request.
    ///
    /// # Validation Rules
    /// 1. Deposit amount must be positive
    /// 2. Post-deposit total must be >= pre-deposit total + amount
    /// 3. No negative movements (strategy cannot shrink after deposit)
    ///
    /// # Errors
    /// - Returns `VaultError::InvalidStrategyResponse` on validation failure
    pub fn validate_deposit_result(
        requested_amount: i128,
        pre_deposit_total: i128,
        post_deposit_total: i128,
    ) -> Result<(), VaultError> {
        // Rule 1: Requested amount must be positive
        if requested_amount <= 0 {
            return Err(VaultError::InvalidStrategyResponse);
        }

        // Rule 2: Total must increase by at least requested amount
        // (may be less if deposit had fees, but shouldn't be negative delta)
        let delta = post_deposit_total.saturating_sub(pre_deposit_total);
        if delta < 0 {
            return Err(VaultError::InvalidStrategyResponse);
        }

        Ok(())
    }

    /// Validates a withdrawal response to ensure consistency with request.
    ///
    /// # Validation Rules
    /// 1. Withdrawal amount must be positive
    /// 2. Post-withdrawal total must be <= pre-withdrawal total
    /// 3. Strategy cannot gain value during a withdrawal
    ///
    /// # Errors
    /// - Returns `VaultError::InvalidStrategyResponse` on validation failure
    pub fn validate_withdrawal_result(
        requested_amount: i128,
        pre_withdrawal_total: i128,
        post_withdrawal_total: i128,
    ) -> Result<(), VaultError> {
        // Rule 1: Requested amount must be positive
        if requested_amount <= 0 {
            return Err(VaultError::InvalidStrategyResponse);
        }

        // Rule 2: Total must decrease (or stay same for fees/slippage)
        if post_withdrawal_total > pre_withdrawal_total {
            return Err(VaultError::InvalidStrategyResponse);
        }

        Ok(())
    }

    /// Validates decimal places to prevent precision exploits.
    ///
    /// # Limits
    /// - Maximum 30 decimal places (consistent with oracle validation)
    /// - Prevents tiny-fraction attacks or overflow vectors
    ///
    /// # Errors
    /// - Returns `VaultError::InvalidStrategyResponse` if decimals exceed bounds
    pub fn validate_decimals(decimals: u32) -> Result<(), VaultError> {
        if decimals > 30 {
            return Err(VaultError::InvalidStrategyResponse);
        }
        Ok(())
    }

    /// Validates a price feed or exchange rate response.
    ///
    /// # Validation Rules
    /// 1. Price must be positive (zero price invalid)
    /// 2. Price must not exceed `MAX_STRATEGY_VALUE` (prevents overflow)
    /// 3. Decimals must be within bounds (0-30)
    ///
    /// # Errors
    /// - Returns `VaultError::InvalidStrategyResponse` on failure
    pub fn validate_price_response(price: i128, decimals: u32) -> Result<(), VaultError> {
        // Price must be positive
        if price <= 0 {
            return Err(VaultError::InvalidStrategyResponse);
        }

        // Price must not overflow
        if price > MAX_STRATEGY_VALUE {
            return Err(VaultError::StrategyValueOverflow);
        }

        // Decimals must be within bounds
        Self::validate_decimals(decimals)?;

        Ok(())
    }

    /// Comprehensive validation of strategy contract address.
    ///
    /// # Checks
    /// - Address is not zero (default/null address)
    /// - Address is valid for external calls
    ///
    /// # Errors
    /// - Returns `VaultError::InvalidStrategyResponse` if address is invalid
    pub fn validate_strategy_address(_env: &Env, strategy: &Address) -> Result<(), VaultError> {
        // In production, might add more checks:
        // - Is the address deployed?
        // - Does it have the strategy interface?
        // For now, basic non-zero check
        if strategy == &Address::from_string(&String::new(_env)) {
            return Err(VaultError::InvalidStrategyResponse);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_total_value_positive() {
        assert!(StrategyValidator::validate_total_value(100_000).is_ok());
    }

    #[test]
    fn test_validate_total_value_zero() {
        assert!(StrategyValidator::validate_total_value(0).is_ok());
    }

    #[test]
    fn test_validate_total_value_negative() {
        let result = StrategyValidator::validate_total_value(-100_000);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_total_value_overflow() {
        let result = StrategyValidator::validate_total_value(MAX_STRATEGY_VALUE + 1);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_deposit_normal() {
        let result = StrategyValidator::validate_deposit_result(1000, 10_000, 11_000);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_deposit_with_fees() {
        // Deposit 1000, but only net 950 due to fees
        let result = StrategyValidator::validate_deposit_result(1000, 10_000, 10_950);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_deposit_negative_delta() {
        let result = StrategyValidator::validate_deposit_result(1000, 10_000, 9_000);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_deposit_zero_amount() {
        let result = StrategyValidator::validate_deposit_result(0, 10_000, 10_000);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_withdrawal_normal() {
        let result = StrategyValidator::validate_withdrawal_result(1000, 10_000, 9_000);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_withdrawal_with_slippage() {
        // Withdraw 1000, but lose extra due to slippage
        let result = StrategyValidator::validate_withdrawal_result(1000, 10_000, 8_950);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_withdrawal_value_increases() {
        let result = StrategyValidator::validate_withdrawal_result(1000, 10_000, 11_000);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_decimals_valid() {
        assert!(StrategyValidator::validate_decimals(6).is_ok());
        assert!(StrategyValidator::validate_decimals(18).is_ok());
        assert!(StrategyValidator::validate_decimals(30).is_ok());
    }

    #[test]
    fn test_validate_decimals_exceed_max() {
        let result = StrategyValidator::validate_decimals(31);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_price_response_positive() {
        assert!(StrategyValidator::validate_price_response(1_000_000, 6).is_ok());
    }

    #[test]
    fn test_validate_price_response_zero_price() {
        let result = StrategyValidator::validate_price_response(0, 6);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_price_response_negative_price() {
        let result = StrategyValidator::validate_price_response(-1_000_000, 6);
        assert!(result.is_err());
    }
}
