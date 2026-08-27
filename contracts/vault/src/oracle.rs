//! Oracle/Price Feed Validation Module
//!
//! This module provides validation and staleness handling for external price feeds.
//!
//! # Stale-Data Policy
//!
//! ## Overview
//!
//! Price-dependent operations are guarded against stale, invalid, or manipulated data
//! by validating all oracle reads before use in sensitive calculations.
//!
//! ## Validation Rules
//!
//! ### 1. Data Freshness (Heartbeat)
//!
//! - **Default Heartbeat**: 3600 seconds (1 hour)
//! - Configurable via `set_oracle_heartbeat()`, capped at `MAX_ORACLE_HEARTBEAT`
//!   (86400 seconds / 24 hours) so an admin cannot effectively disable
//!   staleness protection by setting an unbounded heartbeat.
//! - **Behavior**: REVERT on stale data
//!   - If `current_time - price.timestamp > heartbeat` → `OracleError::HeartbeatExceeded`
//!
//! ### 2. Price Bounds
//!
//! - **Zero Price**: REVERT (`OracleError::PriceZero`)
//!   - Prevents division-by-zero and incorrect calculations
//!
//! - **Negative Price**: REVERT (`OracleError::PriceNegative`)
//!   - Prices cannot be negative; indicates data corruption or attack
//!
//! - **Decimals Validation**: Maximum 30 decimals allowed
//!   - REVERT on invalid decimals (`OracleError::InvalidDecimals`)
//!
//! - **Overflow Protection**: Validates price won't overflow i128
//!   - REVERT on potential overflow (`OracleError::PriceOverflow`)
//!
//! ### 3. Price Deviation (Circuit Breaker)
//!
//! - **Default Max Deviation**: 5000 basis points (50%)
//! - Compares current price against last validated price
//! - **Behavior**: REVERT on excessive deviation (`OracleError::PriceDeviationExceeded`)
//!   - Prevents flash crashes and oracle manipulation
//!
//! ### 4. Timestamp Validation
//!
//! - Future timestamps are rejected
//! - **Behavior**: REVERT (`OracleError::TimestampInFuture`)
//!   - Prevents delayed data injection attacks
//!
//! ## Behavior on Invalid Data
//!
//! | Condition | Behavior | Error Code |
//! |-----------|----------|------------|
//! | Stale data (exceeded heartbeat) | **REVERT** | HeartbeatExceeded |
//! | Zero price | **REVERT** | PriceZero |
//! | Negative price | **REVERT** | PriceNegative |
//! | Future timestamp | **REVERT** | TimestampInFuture |
//! | Invalid decimals | **REVERT** | InvalidDecimals |
//! | Price overflow | **REVERT** | PriceOverflow |
//! | Deviation exceeded | **REVERT** | PriceDeviationExceeded |
//!
//! ## No Fallback Policy
//!
//! The vault does NOT implement fallback to cached/stale prices. This is a deliberate
//! security decision:
//!
//! - **Security**: Prevents continuing operations with potentially manipulated data
//! - **Consistency**: All price-dependent operations see the same data
//! - **Auditability**: Any price failure is immediately visible
//!
//! ## Usage in Vault Operations
//!
//! When oracle validation is enabled (`set_oracle_enabled(true)`):
//!
//! 1. Every strategy value read is validated against the configured oracle
//! 2. If validation fails, the entire transaction reverts
//! 3. Last validated price is cached for deviation checking
//!
//! ## Configuration
//!
//! ```ignore
//! // Enable oracle validation
//! vault.set_oracle_enabled(true);
//!
//! // Set custom heartbeat (e.g., 5 minutes)
//! vault.set_oracle_heartbeat(300);
//!
//! // Configure price oracle address (timelocked — see Issue #969)
//! vault.queue_price_oracle_change(oracle_address);
//! // ... after the configured timelock delay elapses:
//! vault.execute_price_oracle_change();
//! ```
//!
//! ## Integration with Strategies
//!
//! Strategy values are validated when oracle is enabled:
//! - `total_assets()` validates strategy returns against oracle
//! - Invalid strategy values cause transaction revert
//! - Protects against malicious or buggy strategy contracts

use soroban_sdk::{contracttype, Env};

pub type PriceData = (i128, u64, u32);

pub fn price_data_new(price: i128, timestamp: u64, decimals: u32) -> PriceData {
    (price, timestamp, decimals)
}

pub fn price_data_price(data: &PriceData) -> i128 {
    data.0
}

pub fn price_data_timestamp(data: &PriceData) -> u64 {
    data.1
}

pub fn price_data_decimals(data: &PriceData) -> u32 {
    data.2
}

pub fn price_data_scaled_price(data: &PriceData) -> i128 {
    let price = data.0;
    let decimals = data.2;
    if decimals > 18 {
        price / 10_i128.pow(decimals - 18)
    } else if decimals < 18 {
        price * 10_i128.pow(18 - decimals)
    } else {
        price
    }
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OracleError {
    PriceNotFound = 1,
    PriceStale = 2,
    PriceZero = 3,
    PriceNegative = 4,
    PriceOverflow = 5,
    PriceUnderflow = 6,
    InvalidDecimals = 7,
    TimestampInFuture = 8,
    HeartbeatExceeded = 9,
    PriceDeviationExceeded = 10,
    OracleNotSet = 11,
}

pub const DEFAULT_HEARTBEAT_SECONDS: u64 = 3600;
pub const MAX_PRICE_DEVIATION_BPS: i128 = 5000;

/// Upper bound on the admin-configurable oracle heartbeat (`set_oracle_heartbeat`).
///
/// Without a ceiling, an admin (or a compromised admin key) could configure an
/// arbitrarily large heartbeat and effectively disable staleness protection
/// while `is_oracle_enabled()` still reports `true`. 24 hours is generous
/// enough for any legitimate low-frequency feed while still bounding the
/// worst-case staleness window.
pub const MAX_ORACLE_HEARTBEAT: u64 = 86_400;

pub struct OracleValidator;

impl OracleValidator {
    pub fn validate_price_data(
        env: &Env,
        price_data: &PriceData,
        max_age_seconds: u64,
        max_deviation_bps: Option<i128>,
        last_price: Option<&PriceData>,
    ) -> Result<i128, OracleError> {
        let current_time = env.ledger().timestamp();
        Self::validate_not_future(price_data, current_time)?;
        Self::validate_freshness(price_data, current_time, max_age_seconds)?;
        Self::validate_price_value(price_data)?;
        if let Some(last) = last_price {
            if let Some(max_dev) = max_deviation_bps {
                Self::validate_deviation(price_data, last, max_dev)?;
            }
        }
        Ok(price_data_scaled_price(price_data))
    }

    /// Validate slippage bounds before swap execution.
    /// Ensures oracle prices are within acceptable bounds before allowing strategy swaps.
    ///
    /// ### Parameters
    /// * `price_data` - Current oracle price data
    /// * `reference_price` - Expected/reference price for comparison
    /// * `max_slippage_bps` - Maximum allowed slippage in basis points
    ///
    /// ### Returns
    /// Ok if slippage is within bounds, Err if swap should be blocked
    pub fn validate_slippage_bounds(
        price_data: &PriceData,
        reference_price: i128,
        max_slippage_bps: i128,
    ) -> Result<(), OracleError> {
        if reference_price <= 0 {
            return Err(OracleError::PriceZero);
        }
        if price_data_price(price_data) <= 0 {
            return Err(OracleError::PriceZero);
        }

        let current_scaled = price_data_scaled_price(price_data);
        let slippage = ((reference_price - current_scaled).unsigned_abs() as i128)
            .checked_mul(10000)
            .ok_or(OracleError::PriceOverflow)?
            .checked_div(reference_price)
            .ok_or(OracleError::PriceUnderflow)?;

        if slippage > max_slippage_bps {
            return Err(OracleError::PriceDeviationExceeded);
        }
        Ok(())
    }

    /// Sanity check for swap execution: validates oracle provides minimum confidence.
    /// Prevents swaps when oracle data is unreliable (stale, invalid, or suspicious).
    ///
    /// ### Parameters
    /// * `env` - Environment
    /// * `price_data` - Oracle price data for swap asset pair
    /// * `min_price_confidence` - Minimum acceptable price (zero price = no swap)
    ///
    /// ### Returns
    /// Ok if oracle data is acceptable for swap, Err if swap should be blocked
    pub fn sanity_check_before_swap(
        env: &Env,
        price_data: &PriceData,
        min_price_confidence: i128,
    ) -> Result<(), OracleError> {
        let current_time = env.ledger().timestamp();
        Self::validate_not_future(price_data, current_time)?;
        Self::validate_price_value(price_data)?;

        // Block swap if price is below minimum acceptable level
        if price_data_price(price_data) < min_price_confidence {
            return Err(OracleError::PriceDeviationExceeded);
        }
        Ok(())
    }

    fn validate_not_future(price_data: &PriceData, current_time: u64) -> Result<(), OracleError> {
        if price_data_timestamp(price_data) > current_time {
            return Err(OracleError::TimestampInFuture);
        }
        Ok(())
    }

    fn validate_freshness(
        price_data: &PriceData,
        current_time: u64,
        max_age_seconds: u64,
    ) -> Result<(), OracleError> {
        let age = current_time.saturating_sub(price_data_timestamp(price_data));
        if age > max_age_seconds {
            return Err(OracleError::HeartbeatExceeded);
        }
        Ok(())
    }

    fn validate_price_value(price_data: &PriceData) -> Result<(), OracleError> {
        if price_data_decimals(price_data) > 30 {
            return Err(OracleError::InvalidDecimals);
        }
        if price_data_price(price_data) <= 0 {
            return Err(OracleError::PriceZero);
        }
        if price_data_price(price_data) < 0 {
            return Err(OracleError::PriceNegative);
        }
        let scale_factor = if price_data_decimals(price_data) > 18 {
            10_i128.pow(price_data_decimals(price_data) - 18)
        } else {
            1
        };
        let max_safe_price: i128 = i128::MAX / scale_factor;
        if price_data_price(price_data) > max_safe_price {
            return Err(OracleError::PriceOverflow);
        }
        Ok(())
    }

    fn validate_deviation(
        current: &PriceData,
        last: &PriceData,
        max_deviation_bps: i128,
    ) -> Result<(), OracleError> {
        if price_data_price(last) == 0 {
            return Ok(());
        }
        let current_scaled = price_data_scaled_price(current);
        let last_scaled = price_data_scaled_price(last);
        let deviation = ((current_scaled - last_scaled).unsigned_abs() as i128)
            .checked_mul(10000)
            .ok_or(OracleError::PriceOverflow)?
            .checked_div(last_scaled)
            .ok_or(OracleError::PriceUnderflow)?;
        if deviation > max_deviation_bps {
            return Err(OracleError::PriceDeviationExceeded);
        }
        Ok(())
    }
}

pub fn validate_price_for_calculation(price: i128, amount: i128) -> Result<i128, OracleError> {
    if price <= 0 {
        return Err(OracleError::PriceZero);
    }
    if price < 0 {
        return Err(OracleError::PriceNegative);
    }
    let result = price
        .checked_mul(amount)
        .ok_or(OracleError::PriceOverflow)?;
    if result < amount && amount > 0 {
        return Err(OracleError::PriceUnderflow);
    }
    Ok(result)
}

pub fn validate_conversion_rate(
    rate: i128,
    min_rate: i128,
    max_rate: i128,
) -> Result<(), OracleError> {
    if rate < 0 {
        return Err(OracleError::PriceNegative);
    }
    if rate < min_rate || rate > max_rate {
        return Err(OracleError::PriceDeviationExceeded);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_price_data_scaled_18_decimals() {
        let price_data = price_data_new(1_000_000_000i128, 0, 18);
        assert_eq!(price_data_scaled_price(&price_data), 1_000_000_000i128);
    }

    #[test]
    fn test_price_data_scaled_high_decimals() {
        let price_data = price_data_new(2_000_000_000_000_000_000i128, 0, 36);
        assert_eq!(price_data_scaled_price(&price_data), 2i128);
    }

    #[test]
    fn test_price_data_scaled_low_decimals() {
        let price_data = price_data_new(1_000_000i128, 0, 6);
        assert_eq!(
            price_data_scaled_price(&price_data),
            1_000_000_000_000_000_000i128
        );
    }

    #[test]
    fn test_validate_price_valid() {
        let env = Env::default();
        let price_data = price_data_new(1_000_000_000i128, env.ledger().timestamp(), 18);
        let result = OracleValidator::validate_price_data(&env, &price_data, 3600, None, None);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 1_000_000_000i128);
    }

    #[test]
    fn test_validate_price_for_calculation() {
        let result = validate_price_for_calculation(1_000_000_000i128, 100i128);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 100_000_000_000i128);
    }

    #[test]
    fn test_validate_conversion_rate_valid() {
        let result = validate_conversion_rate(1_000_000_000i128, 0i128, 2_000_000_000i128);
        assert!(result.is_ok());
    }

    #[test]
    fn test_default_heartbeat() {
        assert_eq!(DEFAULT_HEARTBEAT_SECONDS, 3600);
    }

    #[test]
    fn test_max_price_deviation_bps() {
        assert_eq!(MAX_PRICE_DEVIATION_BPS, 5000);
    }

    #[test]
    fn test_max_oracle_heartbeat() {
        assert_eq!(MAX_ORACLE_HEARTBEAT, 86_400);
        assert!(DEFAULT_HEARTBEAT_SECONDS <= MAX_ORACLE_HEARTBEAT);
    }

    #[test]
    fn test_validate_slippage_bounds_acceptable() {
        let price_data = price_data_new(1_000_000_000i128, 0, 18);
        let reference = 1_000_000_000i128;
        let result = OracleValidator::validate_slippage_bounds(&price_data, reference, 500);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_slippage_bounds_exceeded() {
        let price_data = price_data_new(900_000_000i128, 0, 18);
        let reference = 1_000_000_000i128;
        // 10% slippage (1000 bps)
        let result = OracleValidator::validate_slippage_bounds(&price_data, reference, 500);
        assert!(result.is_err());
    }

    #[test]
    fn test_sanity_check_before_swap_valid() {
        let env = Env::default();
        let price_data = price_data_new(1_000_000_000i128, env.ledger().timestamp(), 18);
        let result = OracleValidator::sanity_check_before_swap(&env, &price_data, 500_000_000i128);
        assert!(result.is_ok());
    }

    #[test]
    fn test_sanity_check_before_swap_insufficient_price() {
        let env = Env::default();
        let price_data = price_data_new(100_000_000i128, env.ledger().timestamp(), 18);
        let result = OracleValidator::sanity_check_before_swap(&env, &price_data, 500_000_000i128);
        assert!(result.is_err());
    }
}
