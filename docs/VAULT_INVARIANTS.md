# Vault Accounting Invariants (Issue #1166)

This document is the operator-facing specification for the contract-level
total-supply and share-price checks enforced by
`contracts/vault/src/invariants.rs`.

The vault persists `VaultState` only after these checks succeed. A future
change to deposit, withdraw, yield, or share math must keep them true.

## Canonical state

Let \(T_S\) = `VaultState.total_shares` and \(T_A\) = `VaultState.total_assets`.
Share price is scaled by \(10^{18}\):

\[
P(T_A, T_S) =
\begin{cases}
0 & \text{if } T_S = 0 \\
\left\lfloor T_A \cdot 10^{18} / T_S \right\rfloor & \text{if } T_S > 0
\end{cases}
\]

## Invariants

| ID | Statement | Failure |
| --- | --- | --- |
| I1 | \(T_S \ge 0\) | `VaultError::MathOverflow` |
| I2 | \(T_A \ge 0\) | `VaultError::MathOverflow` |
| I3 | If \(T_S > 0\) then \(T_A > 0\) (no unbacked shares) | `VaultError::MathOverflow` |
| I4 | If \(T_S = 0\) then \(P = 0\) | `VaultError::MathOverflow` |
| I5 | If \(T_S > 0\) then \(P = \lfloor T_A \cdot 10^{18} / T_S \rfloor\) and \(P > 0\) | `VaultError::MathOverflow` |

`MathOverflow` is reused because the Soroban error enum is capped at 50 cases.
Integrators should treat it as "accounting assumption broken" when it fires
from a deposit/withdraw/yield path that is not a genuine arithmetic overflow.

## Allowed edge case

\(T_A > 0\) with \(T_S = 0\) is allowed (donated / pre-deposit yield). The next
deposit mints 1:1. Unbacked shares (\(T_S > 0\), \(T_A = 0\)) are never allowed.

## Where they are checked

`YieldVault::persist_accounting_state` runs the checks before writing
`DataKey::State` on:

- `deposit` / `gasless_deposit` / `batch_deposit`
- `withdraw` / queued-liquidity withdraw
- `accrue_yield` / `report_benji_yield`

## Tests

- Unit: `contracts/vault/src/invariants.rs` (violation snapshots)
- Regression: `contracts/vault/src/invariant_tests.rs`
- Formal: `docs/FORMAL_VERIFICATION_ACCOUNTING.md`

Run:

```bash
cargo test -p vault invariant
```
