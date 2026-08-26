# Formal Verification Notes: Critical Vault Accounting Logic

This document defines the formal mathematical specification, invariants, and verification properties for the critical accounting logic in `YieldVault-RWA`.

---

## 1. Core Mathematical Definitions

Let $T_A \in \mathbb{N}_{\ge 0}$ be the total vault assets (`total_assets`), $T_S \in \mathbb{N}_{\ge 0}$ be the total shares outstanding (`total_shares`), and $\mathbf{scale} = 10^{18}$.

### 1.1 Deposit Math
For a deposit of assets $A > 0$:
$$
S(A) = \begin{cases}
A & \text{if } T_S = 0 \lor T_A = 0 \\
\left\lfloor \frac{A \cdot T_S}{T_A} \right\rfloor & \text{if } T_S > 0 \land T_A > 0
\end{cases}
$$

### 1.2 Withdrawal Math
For a redemption of shares $S \in (0, T_S]$:
$$
A(S) = \left\lfloor \frac{S \cdot T_A}{T_S} \right\rfloor
$$

### 1.3 Share Price
$$
P(T_A, T_S) = \begin{cases}
0 & \text{if } T_S = 0 \\
\left\lfloor \frac{T_A \cdot \mathbf{scale}}{T_S} \right\rfloor & \text{if } T_S > 0
\end{cases}
$$

---

## 2. Invariant Specifications & Proof Statements

### Invariant 1: Share Price Monotonicity
> **Theorem**: For any positive yield accrual $\Delta A \ge 0$ where $T_S > 0$:
$$
P(T_A + \Delta A, T_S) \ge P(T_A, T_S)
$$
*Proof Outline*: Since $\Delta A \ge 0$ and $T_S > 0$, $(T_A + \Delta A) \cdot \mathbf{scale} \ge T_A \cdot \mathbf{scale}$. Floor division by constant $T_S > 0$ preserves non-strict order inequality. $\blacksquare$

### Invariant 2: Solvency & Balance Conservation
> **Theorem**: The sum of all individual user share balances equals total shares, and total redeemable value never exceeds accounting total assets:
$$
\sum_{u \in \text{Users}} \text{balance}(u) = T_S
$$
$$
\sum_{u \in \text{Users}} A(\text{balance}(u)) \le T_A
$$
*Proof Outline*: Truncation in $A(S_i) = \lfloor S_i \cdot T_A / T_S \rfloor$ guarantees $A(S_i) \le S_i \cdot T_A / T_S$. Summing over all $i$ yields $\sum A(S_i) \le \frac{T_A}{T_S} \sum S_i = T_A$. Rounding dust is bounded by $|\text{Users}| - 1$. $\blacksquare$

### Invariant 3: Round-Trip Non-Inflation Bound
> **Theorem**: Immediate redemption of newly minted shares $S(A)$ yields at most the deposited asset amount $A$:
$$
A(S(A)) \le A
$$
*Proof Outline*: $S(A) = \lfloor A \cdot T_S / T_A \rfloor \le A \cdot T_S / T_A$. Subbing into redemption math: $A(S(A)) = \lfloor S(A) \cdot (T_A + A) / (T_S + S(A)) \rfloor \le A$. No asset value can be extracted through deposit-withdraw roundtrips. $\blacksquare$

### Invariant 4: Fee Accrual Safety
> **Theorem**: Protocol fee deductions $F = \lfloor Y \cdot \text{FeeBps} / 10000 \rfloor$ preserve non-negative net yield $Y_{net} = Y - F \ge 0$ whenever $\text{FeeBps} \le 10000$.

---

## 3. Formal Verification Tool Integration

- **Property Tests**: Executable invariant assertions in `contracts/vault/src/formal_verification_tests.rs`, `contracts/vault/src/invariants.rs`, and `contracts/share-price-math/src/fuzz_invariants.rs`.
- **Contract-level enforcement**: `YieldVault::persist_accounting_state` rejects `VaultState` writes that violate I1–I5 (`docs/VAULT_INVARIANTS.md`). Failures surface as `VaultError::MathOverflow`.
- **SMT Solver Specification**: Key pre/post conditions specified for Z3 / Certora prover integrations.
