# Performance Fee Switch: Governance Process

**Issue:** #1230  
**Status:** Implemented  

## Overview

The performance fee switch allows vault administrators to redirect a portion of strategy yield to a performance incentive pool. This document describes the governance process for activating and managing this feature.

## Configuration Parameters

| Parameter | Type | Range | Default | Description |
|-----------|------|-------|---------|-------------|
| `performance_fee_bps` | i128 | 0–10000 | 0 | Fee in basis points on yield above high-water mark |
| `performance_incentive_pool` | Address | — | None | Destination address for performance fees |
| `performance_fee_enabled` | bool | — | false | Master toggle for the fee switch |

## Activation Process

### Step 1: Configure the Incentive Pool

```
Admin calls: set_performance_incentive_pool(pool_address)
```

The pool address must be a valid Stellar address. This is typically a DAO treasury, team multisig, or dedicated incentive contract.

### Step 2: Set the Performance Fee Rate

```
Admin calls: set_performance_fee_bps(bps)
```

The fee is expressed in basis points (0–10000). For example:
- 100 bps = 1% of yield above HWM
- 500 bps = 5% of yield above HWM
- 1000 bps = 10% of yield above HWM

**Recommendation:** Start with a conservative rate (100–200 bps) and adjust based on performance.

### Step 3: Enable the Fee Switch

```
Admin calls: set_performance_fee_enabled(true)
```

This will fail if the incentive pool has not been configured.

## How It Works

1. **Yield reporting:** When a strategy reports yield (via `report_benji_yield` or `accrue_korean_debt_yield`), the contract checks if the performance fee switch is enabled.

2. **High-water mark comparison:** The yield amount is compared against the strategy's high-water mark. Only yield ABOVE the high-water mark is subject to the performance fee.

3. **Fee calculation:** `perf_fee = yield_above_hwm × perf_fee_bps / 10_000`

4. **Transfer:** The performance fee is transferred to the incentive pool address.

5. **Event emission:** A `pperffee` event is emitted with the fee amount and yield above HWM.

## Important Notes

- **No timelock required:** Unlike protocol fee changes, the performance fee switch can be toggled immediately. This is because it affects only new yield, not existing balances.
- **Protocol fee applies first:** The standard protocol fee (`fee_bps`) is deducted before the performance fee. The performance fee is calculated on the net yield after protocol fees.
- **Watermark-based:** Only yield above the high-water mark is subject to the fee. This means early performance that recovers previous losses is not charged.
- **Admin-only:** All configuration changes require admin authorization.

## Events

| Event | Symbol | Data | Description |
|-------|--------|------|-------------|
| Pool set | `pperfpool` | (pool_address) | Incentive pool address was changed |
| Fee rate changed | `pperfchg` | (bps) | Performance fee rate was updated |
| Toggle changed | `pperftog` | (enabled) | Fee switch was toggled |
| Fee charged | `pperffee` | (strategy, amount, yield_above_hwm) | Performance fee was collected |

## Example Governance Proposal

```
Title: Activate Performance Fee for Strategy Incentives
Description: Enable a 2% performance fee on yield above the high-water mark,
             directing fees to the team incentive pool for strategy development.

Actions:
1. set_performance_incentive_pool(TTEAM_MULTISIG_ADDRESS)
2. set_performance_fee_bps(200)
3. set_performance_fee_enabled(true)

Expected Impact:
- 2% of incremental yield directed to strategy development fund
- No impact on existing depositor balances
- Only applies to new yield above previous peak
```

## Risk Considerations

1. **Admin key compromise:** A compromised admin key could set the fee to 100% (10000 bps). Mitigation: use multi-sig for admin, monitor events.
2. **No depositor governance:** Performance fee changes don't require depositor vote. Mitigation: transparent configuration, event monitoring.
3. **Strategy gaming:** An admin could manipulate watermarks to avoid fees. Mitigation: watermarks are cumulative and cannot be lowered.

## Future Enhancements

- Governance vote requirement for fee changes above a threshold
- Maximum fee cap enforced at the contract level
- Automatic fee distribution to multiple recipients
- Time-weighted average performance fee (reduce gaming)
