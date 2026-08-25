# Strategy Response Validation (Issue #972)

## Overview

The vault validates all responses from strategy contracts to prevent malformed or adversarial payloads from breaking vault logic. This module provides comprehensive validation rules, ensuring that strategy contracts cannot exploit the vault through unexpected return values, overflow vectors, or corrupted data.

## Validation Framework

### 1. Total Value Validation

Strategy contracts return `total_value()` indicating the sum of:
- Deposited assets
- Accrued yield and interest
- Any pending distributions

**Validation Rules**:

| Rule | Check | Rejection Condition |
|------|-------|---------------------|
| Non-negative | `value >= 0` | Negative balance (impossible) |
| Bounded | `value <= MAX_STRATEGY_VALUE` | Exceeds safe limit (i128::MAX / 2) |
| Overflow | No arithmetic overflow | Result would overflow i128 |

**Examples**:

```rust
// ✓ Valid responses
validate_total_value(0)?;           // Empty strategy
validate_total_value(1_000_000)?;   // Normal balance
validate_total_value(i128::MAX / 2)?; // Maximum allowed

// ✗ Rejected responses
validate_total_value(-1)?;          // Negative balance
validate_total_value(i128::MAX)?;   // Overflow risk
```

### 2. Deposit Result Validation

After requesting a deposit, the vault verifies:
- Deposit was accepted
- Strategy total increased by expected amount (or less with fees)
- No paradoxical decreases in value

**Validation Rules**:

```rust
validate_deposit_result(
    requested_amount: i128,
    pre_deposit_total: i128,
    post_deposit_total: i128,
)?
```

| Condition | Valid | Invalid |
|-----------|-------|---------|
| `requested_amount > 0` | ✓ | ✗ Zero or negative requests |
| `post_total >= pre_total` | ✓ | ✗ Total decreased (stole funds) |
| `delta = post - pre >= 0` | ✓ | ✗ Negative delta |
| `delta >= requested * 0.95` | ✓ | ✗ Excessive fee slippage (>5%) |

**Examples**:

```rust
// ✓ Valid: deposit accepted and total increased
validate_deposit_result(1000, 10_000, 11_000)?;

// ✓ Valid: deposit with fees (800 net received)
validate_deposit_result(1000, 10_000, 10_800)?;

// ✗ Invalid: strategy reported decrease (stole funds)
validate_deposit_result(1000, 10_000, 9_000)?;

// ✗ Invalid: zero deposit
validate_deposit_result(0, 10_000, 10_000)?;
```

### 3. Withdrawal Result Validation

After requesting a withdrawal, the vault verifies:
- Withdrawal was processed
- Strategy total decreased by expected amount (or more with slippage)
- No value generation during withdrawal

**Validation Rules**:

```rust
validate_withdrawal_result(
    requested_amount: i128,
    pre_withdrawal_total: i128,
    post_withdrawal_total: i128,
)?
```

| Condition | Valid | Invalid |
|-----------|-------|---------|
| `requested_amount > 0` | ✓ | ✗ Zero or negative requests |
| `post_total <= pre_total` | ✓ | ✗ Total increased (yield during withdrawal?) |
| `loss = pre - post >= 0` | ✓ | ✗ Strategy gained value |
| `loss <= requested * 1.05` | ✓ | ✗ Excessive slippage (>5% loss) |

**Examples**:

```rust
// ✓ Valid: normal withdrawal
validate_withdrawal_result(1000, 10_000, 9_000)?;

// ✓ Valid: withdrawal with slippage (lost 50 to fees)
validate_withdrawal_result(1000, 10_000, 8_950)?;

// ✗ Invalid: strategy gained value during withdrawal
validate_withdrawal_result(1000, 10_000, 11_000)?;

// ✗ Invalid: zero withdrawal
validate_withdrawal_result(0, 10_000, 10_000)?;
```

### 4. Decimal Places Validation

Strategy contracts may communicate prices or balances with varying decimal precision.

**Validation Rules**:

| Rule | Limit | Purpose |
|------|-------|---------|
| Minimum | 0 decimals | Allow integers |
| Maximum | 30 decimals | Prevent precision exploits |

**Examples**:

```rust
// ✓ Valid decimal places
validate_decimals(0)?;   // Integer amounts
validate_decimals(6)?;   // USD-like (USDC)
validate_decimals(18)?;  // Ethereum-like (USDT)
validate_decimals(30)?;  // Maximum (prevents overflow) |

// ✗ Invalid: excessive precision
validate_decimals(31)?;  // Exceeds limit
validate_decimals(255)?; // Way out of range
```

### 5. Price Feed Validation

Strategy contracts may return price feeds or exchange rates.

**Validation Rules**:

```
1. Price must be positive (zero price invalid)
2. Price must not exceed MAX_STRATEGY_VALUE
3. Decimals must be in valid range (0-30)
```

**Examples**:

```rust
// ✓ Valid price
validate_price_response(1_000_000, 6)?;  // $1M with 6 decimals

// ✗ Invalid: zero price
validate_price_response(0, 6)?;

// ✗ Invalid: negative price
validate_price_response(-1_000_000, 6)?;

// ✗ Invalid: excessive decimals
validate_price_response(1_000_000, 31)?;
```

## Safety Guarantees

1. **No Overflow**: All validations prevent i128 overflow
2. **No Negative Balances**: Strategy cannot report negative totals
3. **Atomicity**: Deposit/withdraw or fail, no partial states
4. **Determinism**: Same inputs always produce same validation result
5. **Fail-Safe**: Contract reverts on validation failure (partial execution prevention)

## Integration Pattern

### Calling a Strategy

```rust
fn call_strategy_total_value(strategy: &Address) -> Result<i128, VaultError> {
    let client = StrategyClient::new(&env, strategy);
    
    // Call strategy
    let value = client.total_value();
    
    // Validate response before using
    strategy_validation::StrategyValidator::validate_total_value(value)?;
    
    Ok(value)
}

fn deposit_to_strategy(
    strategy: &Address,
    amount: i128,
) -> Result<(), VaultError> {
    let client = StrategyClient::new(&env, strategy);
    
    // Get pre-state
    let pre_total = client.total_value();
    strategy_validation::StrategyValidator::validate_total_value(pre_total)?;
    
    // Execute deposit
    client.deposit(amount);
    
    // Get post-state and validate
    let post_total = client.total_value();
    strategy_validation::StrategyValidator::validate_deposit_result(
        amount,
        pre_total,
        post_total,
    )?;
    
    Ok(())
}
```

## Error Codes

| Error | Cause | Recovery |
|-------|-------|----------|
| `InvalidStrategyResponse` | Response violates validation rules | Retry or pause vault |
| `StrategyValueOverflow` | Value exceeds safe bounds | Manual intervention |
| `DecimalConversionOverflow` | Precision conversion would overflow | Change decimal handling |

## Testing Strategy

### Unit Tests

Test each validation rule independently:
- Positive/zero/negative values
- Boundary values (MAX_STRATEGY_VALUE)
- Valid decimal ranges
- Deposit/withdrawal consistency

### Property-Based Tests

Generate random inputs and verify:
- No validation allows negative balances
- No validation allows overflow
- Deposit increases total (or fees decrease it)
- Withdrawal decreases total

### Integration Tests

Test with actual strategy mock:
- Deposit → validate → withdraw sequence
- Multiple deposits in sequence
- Strategy returning edge-case values

See `tests/operational_safety_tests.rs` for comprehensive test suite.

## Future Enhancements

1. **Dynamic validation thresholds**: Adjust based on asset class
2. **Strategy reputation scoring**: Track validation failure history
3. **Degraded-mode operation**: Handle validation failures gracefully
4. **Extended metrics**: Collect and alert on pattern violations
