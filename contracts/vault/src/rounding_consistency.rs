//! Standardized rounding behavior for all vault calculations.
//!
//! This module ensures consistent and safe rounding across share conversions,
//! fee calculations, and decimal conversion edge cases. All operations follow
//! a deterministic round-down (floor) policy to prevent value extraction attacks.

use crate::VaultError;

/// Rounding policy constant: always round down (floor).
/// This is the only safe policy for financial calculations.
pub const ROUNDING_MODE: &str = "round_down";

/// Standardized rounding rule enforcer for vault and fee calculations.
pub struct RoundingPolicy;

impl RoundingPolicy {
    /// Performs floor division (round-down) for share price conversions.
    ///
    /// # Formula
    /// ```text
    /// result = numerator / denominator (truncated, not rounded up)
    /// ```
    ///
    /// # Safety Guarantees
    /// - Result never exceeds exact fractional value
    /// - Prevents over-minting and over-withdrawal
    /// - Maintains vault solvency invariant
    ///
    /// # Panics
    /// - Panics if `denominator` is zero
    ///
    /// # Examples
    /// ```ignore
    /// let shares = RoundingPolicy::floor_division(100, 1500);  // (100 * 1000) / 1500 = 66
    /// ```
    pub fn floor_division(numerator: i128, denominator: i128) -> i128 {
        assert!(denominator != 0, "division by zero");
        numerator / denominator // Rust's / operator truncates toward zero for integer division
    }

    /// Performs floor division with validation for decimal conversion edge cases.
    ///
    /// # Parameters
    /// - `numerator`: Top value in division
    /// - `denominator`: Bottom value in division
    /// - `max_allowed_loss_bps`: Maximum acceptable rounding loss in basis points (e.g., 1 = 0.01%)
    ///
    /// # Validation
    /// - Checks that rounding loss does not exceed threshold
    /// - Useful for catching unexpectedly large round-trip losses
    ///
    /// # Errors
    /// - Returns `VaultError::RoundingLossTooHigh` if loss exceeds threshold
    ///
    /// # Examples
    /// ```ignore
    /// RoundingPolicy::floor_division_validated(99, 1000, 100)?;
    /// ```
    pub fn floor_division_validated(
        numerator: i128,
        denominator: i128,
        max_allowed_loss_bps: i128,
    ) -> Result<i128, VaultError> {
        assert!(denominator != 0, "division by zero");

        if numerator == 0 {
            return Ok(0);
        }

        // Exact result using extended precision (i128 * 2 represented as u128)
        let exact_numerator = numerator.abs() as u128;
        let exact_denominator = denominator.abs() as u128;

        // Compute exact quotient and remainder
        let quotient = exact_numerator / exact_denominator;
        let remainder = exact_numerator % exact_denominator;

        // Compute rounding loss in basis points
        // loss_bps = (remainder * 10_000) / exact_numerator
        if remainder > 0 {
            let loss_bps = (remainder * 10_000) / exact_numerator;
            if loss_bps > max_allowed_loss_bps as u128 {
                return Err(VaultError::RoundingLossTooHigh);
            }
        }

        let result = quotient as i128;
        if numerator < 0 {
            Ok(-result)
        } else {
            Ok(result)
        }
    }

    /// Converts between decimal places with safe rounding and overflow checking.
    ///
    /// # Use Cases
    /// 1. Converting token amounts between different decimals (e.g., USDC 6 → internal 18)
    /// 2. Price feed conversions (Oracle 8 decimals → internal 18)
    /// 3. Share price calculations with varying precision
    ///
    /// # Parameters
    /// - `amount`: The value to convert
    /// - `from_decimals`: Current decimal places
    /// - `to_decimals`: Target decimal places
    ///
    /// # Errors
    /// - Returns `VaultError::DecimalConversionOverflow` if result exceeds i128::MAX
    ///
    /// # Examples
    /// ```ignore
    /// // Convert 1 USDC (6 decimals) to internal representation (18 decimals)
    /// let internal = RoundingPolicy::convert_decimals(1_000_000, 6, 18)?;
    /// // Result: 1_000_000_000_000_000_000 (1e18)
    ///
    /// // Convert back
    /// let external = RoundingPolicy::convert_decimals(1_000_000_000_000_000_000, 18, 6)?;
    /// // Result: 1_000_000 (1e6)
    /// ```
    pub fn convert_decimals(
        amount: i128,
        from_decimals: u32,
        to_decimals: u32,
    ) -> Result<i128, VaultError> {
        if amount == 0 {
            return Ok(0);
        }

        if from_decimals == to_decimals {
            return Ok(amount);
        }

        if from_decimals > to_decimals {
            // Downscaling: divide and round down
            let scale_factor = 10i128
                .checked_pow(from_decimals - to_decimals)
                .ok_or(VaultError::DecimalConversionOverflow)?;
            Ok(amount / scale_factor)
        } else {
            // Upscaling: multiply carefully to avoid overflow
            let scale_factor = 10i128
                .checked_pow(to_decimals - from_decimals)
                .ok_or(VaultError::DecimalConversionOverflow)?;
            amount
                .checked_mul(scale_factor)
                .ok_or(VaultError::DecimalConversionOverflow)
        }
    }

    /// Validates that a rounding loss is within acceptable bounds for the operation.
    ///
    /// # Parameters
    /// - `loss_amount`: Absolute value lost to rounding
    /// - `original_amount`: Original amount before rounding
    /// - `max_loss_bps`: Maximum acceptable loss in basis points
    ///
    /// # Returns
    /// - `Ok(())` if loss is acceptable
    /// - `Err(VaultError::RoundingLossTooHigh)` if loss exceeds threshold
    ///
    /// # Basis Points Formula
    /// ```text
    /// loss_bps = (loss_amount / original_amount) * 10_000
    /// ```
    pub fn validate_rounding_loss(
        loss_amount: i128,
        original_amount: i128,
        max_loss_bps: i128,
    ) -> Result<(), VaultError> {
        if loss_amount == 0 || original_amount == 0 {
            return Ok(());
        }

        // Compute loss in basis points
        // loss_bps = (loss * 10_000) / original
        let loss_bps = (loss_amount.abs() * 10_000) / original_amount.abs();

        if loss_bps > max_loss_bps {
            return Err(VaultError::RoundingLossTooHigh);
        }

        Ok(())
    }

    /// Ensures a rounding-down operation never over-allocates.
    ///
    /// # Invariant
    /// For deposit: `shares_received <= (assets / share_price)` (exact division)
    /// For withdrawal: `assets_received <= (shares / share_price)` (exact division)
    ///
    /// This is verified by checking that `result * denominator <= numerator`.
    pub fn verify_round_down_safety(numerator: i128, denominator: i128, result: i128) -> bool {
        if denominator == 0 {
            return false;
        }

        // Check: result * denominator <= numerator (within integer arithmetic)
        match result.checked_mul(denominator) {
            Some(product) => product <= numerator,
            None => false, // Overflow means we can't verify safety
        }
    }

    /// Standardizes rounding behavior across protocol fees and yield distributions.
    ///
    /// # Parameters
    /// - `amount`: Base amount for calculation
    /// - `basis_points`: Percentage as basis points (0-10000)
    ///
    /// # Formula
    /// ```text
    /// result = (amount * basis_points) / 10_000
    /// ```
    ///
    /// # Safety
    /// - Always rounds down (floor)
    /// - Remainder stays with vault/original holder
    /// - Used for protocol fees, performance fees, and yield distribution
    ///
    /// # Examples
    /// ```ignore
    /// // 5% = 500 basis points
    /// let fee = RoundingPolicy::calculate_basis_points_amount(1_000_000, 500)?;
    /// // Result: 50_000 (5% of 1M)
    /// ```
    pub fn calculate_basis_points_amount(
        amount: i128,
        basis_points: i128,
    ) -> Result<i128, VaultError> {
        if amount == 0 || basis_points == 0 {
            return Ok(0);
        }

        if basis_points < 0 || basis_points > 10_000 {
            return Err(VaultError::InvalidFeeBps);
        }

        let result = (amount * basis_points) / 10_000;
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_floor_division_exact() {
        assert_eq!(RoundingPolicy::floor_division(100, 10), 10);
    }

    #[test]
    fn test_floor_division_rounds_down() {
        assert_eq!(RoundingPolicy::floor_division(99, 10), 9);
        assert_eq!(RoundingPolicy::floor_division(100, 1500), 0);
    }

    #[test]
    fn test_convert_decimals_scale_up() {
        let result = RoundingPolicy::convert_decimals(1_000_000, 6, 18).unwrap();
        assert_eq!(result, 1_000_000_000_000_000_000);
    }

    #[test]
    fn test_convert_decimals_scale_down() {
        let result = RoundingPolicy::convert_decimals(1_000_000_000_000_000_000, 18, 6).unwrap();
        assert_eq!(result, 1_000_000);
    }

    #[test]
    fn test_convert_decimals_same() {
        let result = RoundingPolicy::convert_decimals(1_000_000, 6, 6).unwrap();
        assert_eq!(result, 1_000_000);
    }

    #[test]
    fn test_convert_decimals_zero() {
        let result = RoundingPolicy::convert_decimals(0, 6, 18).unwrap();
        assert_eq!(result, 0);
    }

    #[test]
    fn test_validate_rounding_loss_small() {
        // Loss of 1 bps is acceptable (0.01%)
        let result = RoundingPolicy::validate_rounding_loss(1, 10_000, 100);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_rounding_loss_exceeds_threshold() {
        // Loss of 200 bps exceeds 100 bps threshold
        let result = RoundingPolicy::validate_rounding_loss(200, 10_000, 100);
        assert!(result.is_err());
    }

    #[test]
    fn test_verify_round_down_safety_safe() {
        // (66 * 1500) = 99000 <= 100000 ✓
        assert!(RoundingPolicy::verify_round_down_safety(100_000, 1500, 66));
    }

    #[test]
    fn test_verify_round_down_safety_unsafe() {
        // (67 * 1500) = 100500 > 100000 ✗
        assert!(!RoundingPolicy::verify_round_down_safety(100_000, 1500, 67));
    }

    #[test]
    fn test_calculate_basis_points_amount_5_percent() {
        let result = RoundingPolicy::calculate_basis_points_amount(1_000_000, 500).unwrap();
        assert_eq!(result, 50_000);
    }

    #[test]
    fn test_calculate_basis_points_amount_rounds_down() {
        // (999 * 500) / 10000 = 49.95 → 49
        let result = RoundingPolicy::calculate_basis_points_amount(999, 500).unwrap();
        assert_eq!(result, 49);
    }

    #[test]
    fn test_calculate_basis_points_amount_zero() {
        let result = RoundingPolicy::calculate_basis_points_amount(1_000_000, 0).unwrap();
        assert_eq!(result, 0);
    }

    #[test]
    fn test_calculate_basis_points_amount_invalid_bps() {
        let result = RoundingPolicy::calculate_basis_points_amount(1_000_000, 10_001);
        assert!(result.is_err());
    }
}
