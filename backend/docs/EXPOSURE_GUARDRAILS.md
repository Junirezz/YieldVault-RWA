# Exposure Guardrails & Risk Management

## Overview

YieldVault implements max exposure guardrails to enforce concentration risk limits across strategy allocations. These limits protect both vaults and the platform from excessive risk exposure.

## Exposure Model

### Core Concepts

**Exposure:** The percentage of AUM (Assets Under Management) allocated to a particular strategy or investment.

**Calculation:**
```
Exposure % = (Allocated Amount / Vault AUM) × 100
```

**Three levels of exposure limits:**

1. **Per-Vault Exposure:** Maximum allocation to any single strategy within a vault
2. **Per-Strategy Exposure:** Maximum total allocation to a strategy across all vaults
3. **Cross-Vault Exposure:** Total platform exposure in any strategy

### Example Scenario

```
Platform AUM: $100M

Vault A: $30M AUM
├─ Strategy X: $9M (30% of Vault A) ✓ Within limit
└─ Strategy Y: $6M (20% of Vault A) ✓ Within limit

Vault B: $20M AUM
├─ Strategy X: $8M (40% of Vault B) ❌ Exceeds 30% per-vault limit
└─ Strategy Y: $4M (20% of Vault B) ✓ Within limit

Platform Strategy X: $9M + $8M = $17M
├─ Percentage of total platform AUM: (17M / 100M) × 100 = 17% ✓ Within 20% limit
```

## Default Exposure Limits

| Limit Type | Default | Configuration |
|---|---|---|
| Per-Vault Maximum | 30% | MAX_SINGLE_VAULT_EXPOSURE_PCT |
| Per-Strategy Maximum | 20% | MAX_STRATEGY_EXPOSURE_PCT |
| Cross-Vault Maximum | 50% | MAX_CROSS_VAULT_EXPOSURE_PCT |
| Exposure Calculation | Notional | EXPOSURE_TYPE |

### Exposure Types

**Notional:** Simple percentage of AUM (default)
```
exposure = allocation_amount / vault_aum * 100
```

**Risk-Weighted:** Adjusts for strategy risk profile
```
exposure = (allocation_amount * risk_factor) / vault_aum * 100
```

**Value-at-Risk (VAR):** Conservative worst-case estimate
```
exposure = (allocation_amount * var_factor) / vault_aum * 100
```

## Validation Flow

```
User attempts allocation
         ↓
Validate exposure within limits
    ├─ Per-vault check
    ├─ Per-strategy check
    └─ Cross-vault check
         ↓
    ┌─────────────┐
    │   All OK?   │
    └─────────────┘
      /           \
    YES            NO
    ↓              ↓
Success         Error response
                + Record breach
                + Suggest safe amount
                + Trigger alert
```

## API Usage

### Check Exposure Before Allocation

```typescript
import { validateExposure } from './exposureGuardrails';
import Decimal from 'decimal.js';

const result = await validateExposure(
  'vault_123',
  'strategy_456',
  new Decimal('1000000') // $1M allocation
);

if (!result.canAllocate) {
  res.status(400).json({
    error: 'Exposure limit exceeded',
    message: result.message,
    currentExposure: result.currentExposurePct,
    availableCapacity: result.availableCapacityPct,
    maxAllowable: result.remainingCapacity.toString(),
  });
} else {
  // Proceed with allocation
}
```

### Get Vault Exposure Summary

```typescript
import { getVaultExposureSummary } from './exposureGuardrails';

const summary = await getVaultExposureSummary('vault_123');
// {
//   vaultId: 'vault_123',
//   vaultAum: Decimal('30000000'),
//   allocations: [
//     { strategyId: 'strat_1', exposure: Decimal('9000000'), exposurePct: 30 },
//     { strategyId: 'strat_2', exposure: Decimal('5000000'), exposurePct: 16.67 }
//   ],
//   totalExposure: Decimal('14000000'),
//   totalExposurePct: 46.67,
//   headroom: Decimal('16000000'),
//   headroomPct: 53.33
// }
```

## Endpoint Integration

### Strategy Allocation Endpoint

```typescript
POST /api/vaults/{vaultId}/strategies/{strategyId}/allocate
Content-Type: application/json

{
  "amount": "1000000"
}
```

**Response (Success - 200 OK):**
```json
{
  "allocationId": "alloc_789",
  "vaultId": "vault_123",
  "strategyId": "strategy_456",
  "amount": "1000000",
  "allocatedAt": "2024-08-25T10:30:00Z",
  "vaultExposure": {
    "current": 35.5,
    "remaining": 14.5,
    "limit": 50
  }
}
```

**Response (Failure - 400 Bad Request):**
```json
{
  "error": "Exposure limit exceeded",
  "reason": "per_vault_limit",
  "message": "Allocation would exceed per-vault limit (40% > 30%)",
  "currentExposure": 35,
  "attemptedAmount": "1000000",
  "maxAllowable": "500000",
  "recommendation": {
    "maxSafeAllocation": "500000",
    "message": "Try allocating $500,000 or less to stay within limits"
  }
}
```

## Operational Monitoring

### Metrics

**Exposure Metrics:**
```promql
# Current exposure by strategy
strategy_exposure_pct{strategy_id="strat_1"}

# Exposure utilization (% of limit used)
strategy_exposure_utilization_pct{strategy_id="strat_1"}

# Breaches per strategy
exposure_breach_count_total{strategy_id="strat_1"}
```

### Grafana Dashboard Panels

**Panel 1: Strategy Exposure Gauge**
```promql
strategy_exposure_pct{strategy_id="strat_1"} / 20 * 100
```
Shows 0-100 gauge where 100 = at limit

**Panel 2: Exposure Heatmap**
```promql
strategy_exposure_pct
```
Shows all strategies, color intensity = exposure level

**Panel 3: Breach History**
```promql
increase(exposure_breach_count_total[1d])
```
Shows breaches per day

### Alerts

**Slack Alert on Breach Attempt:**
```
⚠️ Exposure Limit Breach

Strategy: Stellar LP Yield
Current Exposure: 19.8%
Limit: 20%
Attempted: +1.2%

User: wallet_abc...
Vault: Production Vault
Amount: $500,000
Time: 2024-08-25 10:30:00 UTC

Recommendation: Allocate to lower-exposure strategy
```

## Configuration

### Environment Variables

```bash
# Per-vault maximum exposure (default: 30%)
MAX_SINGLE_VAULT_EXPOSURE_PCT=30

# Per-strategy maximum exposure (default: 20%)
MAX_STRATEGY_EXPOSURE_PCT=20

# Cross-vault maximum (default: 50%)
MAX_CROSS_VAULT_EXPOSURE_PCT=50

# Exposure calculation method
EXPOSURE_TYPE=notional|risk_weighted|var_based

# Risk factor for risk-weighted exposure (default: 1.5)
RISK_WEIGHT_FACTOR=1.5

# VAR confidence level (default: 95%)
VAR_CONFIDENCE_LEVEL=95

# Alert threshold (% of limit before alert, default: 90%)
EXPOSURE_ALERT_THRESHOLD_PCT=90
```

### Per-Strategy Overrides

```json
{
  "strategyOverrides": {
    "strat_conservative": {
      "perVaultLimit": 40,
      "platformLimit": 30,
      "riskFactor": 1.0
    },
    "strat_aggressive": {
      "perVaultLimit": 20,
      "platformLimit": 15,
      "riskFactor": 2.5
    }
  }
}
```

## Risk Scenarios & Responses

### Scenario 1: User Tries to Exceed Per-Vault Limit

**Situation:**
- Vault AUM: $10M
- Current allocation to Strategy X: $3M (30% - at limit)
- User tries to allocate: $500K more to Strategy X

**System Response:**
1. Validates: $3.5M / $10M = 35% > 30% ❌
2. Blocks allocation
3. Returns error with max safe amount: $0
4. Suggests other strategies with available capacity
5. Records breach attempt in audit log

### Scenario 2: Cross-Vault Exposure Accumulation

**Situation:**
- Platform AUM: $100M
- Strategy X current exposure: $19M (19% - near 20% limit)
- Vault A wants to allocate: $1.5M to Strategy X

**System Response:**
1. Validates: ($19M + $1.5M) / $100M = 20.5% > 20% ❌
2. Calculates max safe: $1M
3. Suggests allocation of $1M instead
4. User can proceed with $1M or choose different strategy

### Scenario 3: Risk-Weighted Exposure

**Situation:**
- Vault AUM: $50M
- Conservative Strategy (risk factor 0.8)
- Aggressive Strategy (risk factor 2.0)
- Allocation limit: 30%

**Calculations:**
```
Conservative: $15M × 0.8 = $12M exposure
Risk-adjusted: $12M / $50M = 24% of limit ✓

Aggressive: $15M × 2.0 = $30M exposure
Risk-adjusted: $30M / $50M = 60% of limit ❌ Blocked at $7.5M
```

## Guardrail Adjustment Process

### When to Adjust Limits

**Increase limits if:**
- Historical breaches < 1% of allocation attempts
- Risk management approves increased exposure
- Strategic rationale for broader allocation
- Market conditions support more diversification

**Decrease limits if:**
- Multiple breach attempts detected
- Strategy performance degradation
- Increased correlation with other allocations
- Regulatory or compliance requirement

### Adjustment Process

1. **Analysis Phase** (1 day)
   - Review breach patterns and rationale
   - Analyze strategy correlation matrix
   - Get risk committee approval

2. **Configuration Phase** (30 min)
   - Update environment variables or database
   - Document change and rationale
   - Set monitoring alerts on new limits

3. **Rollout Phase** (15 min)
   - Update in staging environment first
   - Validate monitoring alerts trigger correctly
   - Deploy to production during low-traffic window

4. **Monitoring Phase** (ongoing)
   - Track allocation patterns
   - Monitor for edge cases
   - Review weekly for first month

### Example: Adjusting Strategy Limits

**Before:**
```bash
MAX_STRATEGY_EXPOSURE_PCT=20
```

**After Analysis:** Risk team approves 25% for Stellar LP Yield (low volatility)
```bash
STRATEGY_OVERRIDES='{
  "stellar_lp_yield": {
    "platformLimit": 25,
    "perVaultLimit": 35
  }
}'
```

**Monitoring:**
```promql
# Alert if exposure exceeds 22.5% (90% of 25%)
ALERT exposure_high
  IF strategy_exposure_pct{strategy="stellar_lp_yield"} > 22.5
  FOR 5m
```

## Compliance & Audit

### Exposure Breach Audit Trail

```sql
SELECT 
  timestamp,
  vault_id,
  strategy_id,
  attempted_amount,
  current_exposure_pct,
  limit_pct,
  reason
FROM exposure_breaches
ORDER BY timestamp DESC;
```

### Reports

**Weekly Exposure Report:**
```
Strategy A: 18% exposure (limit: 20%) - 2 breach attempts
Strategy B: 12% exposure (limit: 20%) - 0 breach attempts
Strategy C: 45% exposure (limit: 50%) - 5 breach attempts

Top 5 strategies by exposure:
1. Stellar LP Yield: 18%
2. Yield Farming: 15%
3. Validator Staking: 12%
...

Recommendations:
- Strategy C approaching limit; consider rebalancing
- Diversify into lower-exposure strategies
```

## Testing

### Unit Tests for Exposure Validation

```typescript
describe('exposureGuardrails', () => {
  it('should allow allocation within per-vault limit', async () => {
    const result = await validateExposure(vaultId, strategyId, amount);
    expect(result.canAllocate).toBe(true);
  });

  it('should block allocation exceeding per-vault limit', async () => {
    const result = await validateExposure(vaultId, strategyId, excessiveAmount);
    expect(result.canAllocate).toBe(false);
    expect(result.message).toContain('per-vault');
  });

  it('should calculate cross-vault exposure correctly', async () => {
    // Test with multiple vaults
  });
});
```

## References

- [Modern Portfolio Theory](https://en.wikipedia.org/wiki/Modern_portfolio_theory)
- [Value at Risk (VaR)](https://en.wikipedia.org/wiki/Value_at_risk)
- [Concentration Risk Management](https://www.investopedia.com/terms/c/concentrationrisk.asp)
