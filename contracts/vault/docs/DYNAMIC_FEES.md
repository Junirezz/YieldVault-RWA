# Dynamic Fee Adjustment (Issue #1243)

## Why

The protocol fee (`DataKey::FeeBps`) is a single flat rate applied to harvested
yield. It does not care whether the vault is 10% or 99% deployed, so the vault
has no lever to balance supply against demand: when nearly all capital is
working inside the strategy, idle liquidity is scarce and withdrawals start
queueing — yet depositing costs exactly what it did when the vault was mostly
idle.

Dynamic fees add that lever. The fee now scales with **utilization**: the share
of vault assets deployed to the strategy rather than sitting idle.

## The curve

A kinked linear curve, the same shape lending protocols use for borrow rates:

```
  fee_bps
     ▲
 max ┤                                        ╱
     │                                      ╱
     │                                    ╱
 opt ┤────────────────────────────────╱
     │                        ╱───────
     │            ╱───────────
base ┤────────────
     └────────────┬───────────────────┬──────▶ utilization_bps
     0          kink              10_000
```

| Parameter                 | Meaning                                       |
| ------------------------- | --------------------------------------------- |
| `enabled`                 | Off → the vault charges the flat `fee_bps`.   |
| `base_fee_bps`            | Fee at 0% utilization.                        |
| `optimal_fee_bps`         | Fee exactly at the kink.                      |
| `max_fee_bps`             | Fee at 100% utilization.                      |
| `optimal_utilization_bps` | The kink; strictly between 0% and 100%.       |

Below the kink the fee climbs gently; above it the curve steepens, so the
scarcer idle liquidity becomes, the more the protocol takes from incoming
yield.

### Worked example

Reference curve: `base = 25` (0.25%), `optimal = 100` (1%), `max = 500` (5%),
`kink = 8_000` (80%).

| Utilization | Calculation                    | Fee (bps) |
| ----------- | ------------------------------ | --------- |
| 20%         | `25 + 75 × 2000/8000`          | 43        |
| 50%         | `25 + 75 × 5000/8000`          | 71        |
| 80%         | at the kink                    | 100       |
| 95%         | `100 + 400 × 1500/2000`        | 400       |

Every interpolation uses **floor** division, matching the rounding policy in
[`ROUNDING_POLICY.md`](../ROUNDING_POLICY.md): the vault never rounds a fee up,
so any sub-basis-point remainder stays with depositors.

## Utilization

```
utilization_bps = (total_assets - idle_assets) × 10_000 / total_assets
```

`total_assets` is idle balance plus the strategy's mark-to-market, so
`total - idle` is exactly the deployed position. The ratio is clamped to
`0..=10_000`: a vault with no assets reads as 0%, and a strategy marked above
the recorded total reads as 100% rather than overflowing.

## Governance

Fee-curve changes go through the **same timelock as `fee_bps`**
(see [`timelock.rs`](../src/timelock.rs)). This is deliberate: the curve moves
the fee depositors actually pay, so letting it apply instantly would be a way
around the protection the fee timelock exists to provide.

| Function                   | Purpose                                            |
| -------------------------- | -------------------------------------------------- |
| `queue_fee_curve_change`   | Admin queues a validated curve; returns the `eta`. |
| `pending_fee_curve_change` | Reads the queued change, if any.                   |
| `execute_fee_curve_change` | Applies it once the `eta` is reached.              |
| `cancel_fee_curve_change`  | Drops a queued change before it lands.             |
| `fee_curve`                | Reads the active curve.                            |
| `utilization_bps`          | Reads current utilization.                         |
| `effective_fee_bps`        | Reads the fee that would be charged right now.     |

### Validation

`queue_fee_curve_change` rejects a curve with `VaultError::InvalidFeeBps` when:

- any leg is outside `0..=10_000` bps;
- the legs are not monotonically non-decreasing (`base <= optimal <= max`) —
  so a "dynamic" curve can never be shaped to charge *less* at high
  utilization than at low;
- the kink is not strictly between 0% and 100% utilization.

`execute_fee_curve_change` re-validates before applying, since a queued change
can outlive a code change.

`VaultError` is capped at 50 variants by the Soroban error-enum spec, so this
reuses the existing fee-range code rather than defining a new one — the same
reuse convention documented on `VaultError::NoPendingWithdrawal`.

## Events

| Symbol     | Topic         | Data                                                         |
| ---------- | ------------- | ------------------------------------------------------------ |
| `fcurveq`  | —             | `(enabled, base, optimal, max, kink, eta)` on queue           |
| `fcurve`   | —             | `(was_enabled, enabled, base, optimal, max, kink)` on execute |
| `fcurvecn` | admin         | `()` on cancel                                                |
| `dynfee`   | strategy      | `(utilization_bps, applied_fee_bps, static_fee_bps)`          |

`dynfee` fires on every yield report while the curve is active, so each fee the
vault actually charged — and the utilization it was derived from — is
reconstructable from the event stream alone.

## Opting in

**The curve is disabled by default.** Every existing deployment keeps charging
the flat `fee_bps`, on exactly the code path it used before: while
`enabled` is false, `effective_fee_bps` short-circuits and makes no strategy or
oracle call at all.

That short-circuit matters. Once the curve is enabled, resolving the fee reads
utilization, which reads through to the strategy and validates the oracle when
one is configured — so `report_benji_yield` inherits those failure modes.
A vault whose oracle has gone stale can no longer report yield until the feed
recovers or governance disables the curve. Enable the curve only on vaults
where the strategy and oracle reads are known-reliable.

## Tests

`src/fee_curve.rs` carries the unit suite: utilization at the four acceptance
levels (20%, 50%, 80%, 95%), endpoint and clamping behaviour, a full
`0..=10_000` monotonicity sweep, validation rejections, and the
disabled-curve passthrough.

The frontend mirror in `frontend/src/lib/feeCurve.ts` is tested against the
same reference curve and the same expected integers (43 / 71 / 100 / 400),
which doubles as a cross-language parity check on the interpolation.
