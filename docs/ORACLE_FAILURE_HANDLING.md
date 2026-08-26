# Oracle Failure Handling (Issue #1231)

Procedures for heartbeat failures, deviation spikes, network partitions, and
timeouts. Implementation lives in:

- Validator: `contracts/vault/src/oracle.rs`
- Mock feed: `contracts/mock-strategy/src/mock_oracle.rs`
- Tests: `contracts/vault/src/oracle_failure_tests.rs`

The vault is **fail-closed**. Invalid oracle data never falls back to a cached
or stale price. `total_assets()` (and anything that calls it, including
`invest`) aborts.

## Failure modes

| Mode | Mock API | Validator error | Operator meaning |
| --- | --- | --- | --- |
| Heartbeat / stale | `StaleHeartbeat` or ledger time > heartbeat | `HeartbeatExceeded` | Feed stopped updating |
| Deviation spike | `DeviationSpike` (3× last price) | `PriceDeviationExceeded` | Flash crash / manipulation |
| Zero / negative | `ZeroPrice` / `NegativePrice` | `PriceZero` | Corrupt payload |
| Bad decimals | `InvalidDecimals` | `InvalidDecimals` | Precision attack |
| Future timestamp | `FutureTimestamp` | `TimestampInFuture` | Clock / injection |
| Network partition | `NetworkPartition` | host panic `oracle network partition` | Oracle contract unreachable |
| RPC / call timeout | `Timeout` | host panic `oracle timeout` | Call does not return |

Heartbeat default is **3600s**. Deviation circuit breaker default is **5000 bps
(50%)** vs the last *validated* price (`LastValidatedPrice`).

## Handling procedure

1. **Confirm** — `try_total_assets` / RPC error. Pause reason should be
   `PauseReason::OracleFailure` if the vault is halted.
2. **Halt price-sensitive flow** — do not invest, divest-for-rebalance, or
   quote TVL from the failed feed. Deposits that do not consult the oracle
   still mint against accounting state; prefer pausing if the feed is required
   for user-facing NAV.
3. **Classify**
   - Heartbeat / timeout: wait for a fresh push, or rotate the oracle via the
     timelocked `queue_price_oracle_change` → `execute_price_oracle_change`.
   - Deviation spike: do **not** widen `MAX_PRICE_DEVIATION_BPS` in an
     incident. Investigate the upstream feed; resume only after a new price
     is within 50% of the last validated value or after a deliberate admin
     oracle rotation (which clears the last-price cache on a new address
     only after the next successful read).
   - Partition: restore the RPC / contract; the mock `NetworkPartition` flag
     is the test stand-in.
4. **Resume** — `set_oracle_enabled(true)` only if it was turned off. Call
   `total_assets` once in a dry-run / testnet check. Unpause if paused.
5. **Disable (last resort)** — `set_oracle_enabled(false)` skips the feed.
   Phase 1 defaults to disabled. Production should keep it enabled once the
   feed is live.

## Tests

```bash
cargo test -p vault oracle
cargo test -p mock-strategy
```

Coverage target for oracle modules is **≥ 90%** of validator branches
(heartbeat, deviation, bounds, slippage, conversion) plus every mock failure
mode wired through the vault.
