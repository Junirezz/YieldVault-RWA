# Protocol Risk Limits (Issue #1173)

Hard caps on vault exposure. They sit **on top of** per-strategy
`set_strategy_cap` / `set_strategy_risk_threshold` and are defined in
`contracts/vault/src/risk_limits.rs`.

Defaults are unlimited so existing deployments keep working. Operators opt in
by setting non-zero / sub-100% caps.

## Thresholds

| Limit | Storage | Default | Meaning |
| --- | --- | --- | --- |
| Max vault TVL | `Risk(MaxTvl)` | `0` (unlimited) | Hard cap on accounting `total_assets` for new deposits |
| Max strategy concentration | `Risk(MaxConc)` | `10_000` (100%) | Max share of TVL in the strategy being invested into |
| Max deployed capital | `Risk(MaxDep)` | `10_000` (100%) | Max share of TVL allocated out of idle |
| Stress concentration | `Risk(StrConc)` | `5_000` (50%) | Used when stress mode is on |
| Stress deployed | `Risk(StrDep)` | `7_000` (70%) | Used when stress mode is on |
| Stress mode | `Risk(Stress)` | `false` | Selects the tighter of normal vs stress caps |

Per-strategy caps still apply:

- `StrategyCap(strategy)` — absolute token units
- `StrategyRiskThreshold(strategy)` — bps of TVL, default 100%

An invest must pass **both** the per-strategy checks and the protocol checks.

## Enforcement

| Action | Check | Error |
| --- | --- | --- |
| `deposit` / `gasless_deposit` / `batch_deposit` | `current_tvl + amount > max_vault_tvl` | `ExceedsRiskThreshold` |
| `invest` | concentration or deployed BPS exceeded | `ExceedsRiskThreshold` |
| `invest` | per-strategy absolute cap | `ExceedsStrategyCap` |
| `invest` | per-strategy BPS threshold | `ExceedsRiskThreshold` |
| `rebalance` into `to_strategy` | same protocol invest check | `ExceedsRiskThreshold` |
| Setter BPS outside `0..=10000` | `validate_bps` | `InvalidRiskThreshold` |
| Negative TVL | | `InvalidAmount` |

Stress mode takes `min(normal_cap, stress_cap)` so it can only tighten limits.

## Override conditions

These are the only ways to raise or bypass a bound:

1. **Admin raises the cap** — `set_max_vault_tvl`, `set_max_conc_bps`,
   `set_max_deployed_bps`. Setting TVL back to `0` restores unlimited TVL.
2. **Admin disables stress mode** — `set_stress_mode(false)` after volatility
   subsides. This is the intended recovery path; it does not require a new cap
   if the normal cap already allows the position.
3. **Reduce exposure first** — `withdraw` (TVL) or `divest` (concentration).
   Once the position is back under the cap, the same operation is allowed
   again. There is no "force invest" flag.
4. **Pause** — `pause(PauseReason::LiquidityCrisis | OracleFailure | …)` blocks
   deposits and withdrawals entirely. Emergency approvers can pause independently
   of admin. Pause is a halt, not a cap override.
5. **Governance / admin strategy switch** — changing strategy does not raise
   caps; `rebalance` still has to fit the destination strategy under the
   protocol concentration cap.

There is **no** runtime backdoor that lets an invest exceed a configured hard
cap while the vault is live.

## Recovery tests

`contracts/vault/src/risk_limits_tests.rs` covers:

- TVL overrun then withdraw then deposit
- Strategy-cap overrun then divest then invest
- Protocol concentration overrun then divest then invest
- Stress mode tightening then `set_stress_mode(false)` override

```bash
cargo test -p vault risk_limits
```
