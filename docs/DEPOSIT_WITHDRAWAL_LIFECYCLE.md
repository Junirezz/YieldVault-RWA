# Vault Deposit & Withdrawal Lifecycle Sequence Diagrams

This document covers the complete request-to-confirmation lifecycle for deposit and withdrawal operations in YieldVault, from the user's wallet interaction through the Soroban smart contract to on-chain confirmation.

---

## Deposit Lifecycle

A deposit moves USDC from the user's wallet into the vault and mints proportional `yvUSDC` shares back to the user.

```mermaid
sequenceDiagram
    actor User
    participant Freighter as Freighter Wallet
    participant Frontend as React Frontend
    participant Backend as Backend API
    participant RPC as Stellar Soroban RPC
    participant USDC as USDC Token (SAC)
    participant Vault as YieldVault Contract

    User->>Frontend: Enter deposit amount
    Frontend->>Frontend: Validate: amount > 0, meets min_deposit
    Frontend->>RPC: simulate_transaction(deposit)
    RPC-->>Frontend: Simulated shares_to_mint, fee estimate

    Frontend->>User: Show preview (shares, share price, fee)
    User->>Freighter: Confirm & sign transaction

    Freighter-->>Frontend: Signed XDR transaction

    Frontend->>RPC: submit_transaction(signed XDR)
    RPC->>Vault: deposit(user, amount)

    Note over Vault: CHECKS
    Vault->>Vault: amount > 0
    Vault->>Vault: not paused
    Vault->>Vault: amount >= min_deposit
    Vault->>Vault: user_deposit + amount <= per_user_cap

    Note over Vault: EFFECTS
    Vault->>Vault: shares = amount * total_shares / total_assets
    Vault->>Vault: total_assets += amount
    Vault->>Vault: total_shares += shares
    Vault->>Vault: share_balance[user] += shares
    Vault->>Vault: user_deposit[user] += amount

    Note over Vault: INTERACTIONS
    Vault->>USDC: transfer(user → vault, amount)
    USDC-->>Vault: OK

    Vault->>RPC: emit event("deposit", amount, shares)
    Vault-->>RPC: Return shares_minted

    RPC-->>Frontend: Transaction result (success, ledger, hash)
    Frontend->>Backend: POST /api/v1/vault/deposit (index event)
    Backend->>RPC: getEvents(contractId, ledger)
    RPC-->>Backend: deposit event confirmed
    Backend-->>Frontend: Deposit indexed

    Frontend-->>User: Show confirmation (shares minted, tx hash)
```

### Deposit State Transitions

```
IDLE
  │
  ▼ User submits amount
VALIDATING (frontend checks: amount > 0, meets min_deposit, within cap)
  │
  ▼ Simulation passes
AWAITING_SIGNATURE (Freighter prompt shown)
  │
  ▼ User signs
SUBMITTING (XDR sent to Soroban RPC)
  │
  ├─ Contract rejects ──► FAILED
  │   (paused / below min / exceeds cap / zero amount)
  │
  ▼ Contract accepts
CONFIRMING (waiting for ledger close ~5 s)
  │
  ▼ Ledger closes
CONFIRMED
  └─ deposit event emitted on-chain
  └─ yvUSDC shares credited to user
```

### Deposit Error Paths

| Error | VaultError Code | Cause | User Action |
|---|---|---|---|
| `InvalidAmount` | 3 | Amount ≤ 0 | Enter a positive amount |
| `ContractPaused` | 4 | Vault is paused | Wait for admin to unpause |
| `MinDepositNotMet` | 6 | Amount < `min_deposit` | Increase deposit amount |
| `ExceedsUserCap` | 5 | Would exceed per-user cap | Reduce amount |

---

## Withdrawal Lifecycle

Withdrawals have two paths depending on whether the requested amount exceeds the `large_withdrawal_threshold`.

### Path A — Standard Withdrawal (below threshold)

```mermaid
sequenceDiagram
    actor User
    participant Freighter as Freighter Wallet
    participant Frontend as React Frontend
    participant Backend as Backend API
    participant RPC as Stellar Soroban RPC
    participant USDC as USDC Token (SAC)
    participant Vault as YieldVault Contract

    User->>Frontend: Enter shares to withdraw
    Frontend->>RPC: simulate_transaction(withdraw)
    RPC-->>Frontend: Simulated assets_to_return, fee estimate

    Frontend->>User: Show preview (USDC to receive, share price)
    User->>Freighter: Confirm & sign transaction

    Freighter-->>Frontend: Signed XDR transaction
    Frontend->>RPC: submit_transaction(signed XDR)
    RPC->>Vault: withdraw(user, shares)

    Note over Vault: CHECKS
    Vault->>Vault: shares > 0
    Vault->>Vault: share_balance[user] >= shares
    Vault->>Vault: not paused
    Vault->>Vault: assets_to_return = shares * total_assets / total_shares
    Vault->>Vault: assets_to_return <= large_withdrawal_threshold ✓

    Note over Vault: EFFECTS
    Vault->>Vault: total_assets -= assets_to_return
    Vault->>Vault: total_shares -= shares
    Vault->>Vault: share_balance[user] -= shares
    Vault->>Vault: user_deposit[user] -= assets_to_return (floor 0)

    Note over Vault: INTERACTIONS
    Vault->>USDC: transfer(vault → user, assets_to_return)
    USDC-->>Vault: OK

    Vault->>RPC: emit event("withdraw", user, assets_to_return, shares)
    Vault-->>RPC: Return assets_to_return

    RPC-->>Frontend: Transaction result (success, ledger, hash)
    Frontend->>Backend: Index withdraw event
    Backend-->>Frontend: Withdrawal indexed
    Frontend-->>User: Show confirmation (USDC received, tx hash)
```

### Path B — Large Withdrawal with 24-Hour Timelock

```mermaid
sequenceDiagram
    actor User
    participant Freighter as Freighter Wallet
    participant Frontend as React Frontend
    participant Backend as Backend API
    participant RPC as Stellar Soroban RPC
    participant USDC as USDC Token (SAC)
    participant Vault as YieldVault Contract

    %% ── Phase 1: Initiate ──────────────────────────────────────────
    Note over User,Vault: Phase 1 — Initiate Large Withdrawal

    User->>Frontend: Enter shares to withdraw (large amount)
    Frontend->>RPC: simulate_transaction(withdraw)
    RPC-->>Frontend: Detects timelock path (assets > threshold)

    Frontend->>User: Warn: 24-hour timelock applies
    User->>Freighter: Confirm & sign transaction

    Freighter-->>Frontend: Signed XDR
    Frontend->>RPC: submit_transaction(signed XDR)
    RPC->>Vault: withdraw(user, shares)

    Note over Vault: CHECKS
    Vault->>Vault: shares > 0
    Vault->>Vault: share_balance[user] >= shares
    Vault->>Vault: not paused
    Vault->>Vault: assets_to_return > large_withdrawal_threshold → TIMELOCK

    Note over Vault: EFFECTS (lock only — no transfer yet)
    Vault->>Vault: pending_withdrawal[user] = {shares, unlock_ts: now + 86400}
    Vault->>Vault: share_balance[user] -= shares (locked)

    Vault->>RPC: emit event("pndwdraw", user, shares, unlock_ts)
    Vault-->>RPC: Return 0 (no assets transferred yet)

    RPC-->>Frontend: Transaction result (success, ledger)
    Frontend->>Backend: Index pndwdraw event
    Backend-->>Frontend: Pending withdrawal indexed
    Frontend-->>User: Show: "Withdrawal pending — available in 24 hours"

    %% ── Phase 2: Execute after timelock ────────────────────────────
    Note over User,Vault: Phase 2 — Execute After 24-Hour Timelock

    User->>Frontend: Return after unlock_ts has passed
    Frontend->>RPC: simulate_transaction(execute_withdrawal)
    RPC-->>Frontend: Simulated assets_to_return

    Frontend->>User: Show: "Ready to claim X USDC"
    User->>Freighter: Confirm & sign execute_withdrawal

    Freighter-->>Frontend: Signed XDR
    Frontend->>RPC: submit_transaction(signed XDR)
    RPC->>Vault: execute_withdrawal(user)

    Note over Vault: CHECKS
    Vault->>Vault: pending_withdrawal[user] exists
    Vault->>Vault: now >= unlock_ts ✓

    Note over Vault: EFFECTS
    Vault->>Vault: Remove pending_withdrawal[user]
    Vault->>Vault: total_assets -= assets_to_return
    Vault->>Vault: total_shares -= shares
    Vault->>Vault: user_deposit[user] -= assets_to_return (floor 0)

    Note over Vault: INTERACTIONS
    Vault->>USDC: transfer(vault → user, assets_to_return)
    USDC-->>Vault: OK

    Vault->>RPC: emit event("withdraw", user, assets_to_return, shares)
    Vault-->>RPC: Return assets_to_return

    RPC-->>Frontend: Transaction result (success, ledger, hash)
    Frontend->>Backend: Index withdraw event
    Backend-->>Frontend: Withdrawal confirmed
    Frontend-->>User: Show confirmation (USDC received, tx hash)
```

### Withdrawal State Transitions

```
IDLE
  │
  ▼ User submits shares
VALIDATING (frontend checks: shares > 0, user has balance)
  │
  ▼ Simulation passes
AWAITING_SIGNATURE (Freighter prompt shown)
  │
  ▼ User signs
SUBMITTING (XDR sent to Soroban RPC)
  │
  ├─ Contract rejects ──► FAILED
  │   (paused / insufficient shares / zero amount)
  │
  ├─ assets <= threshold ──► CONFIRMING ──► CONFIRMED
  │                           (~5 s ledger close)   └─ withdraw event emitted
  │                                                  └─ USDC transferred to user
  │
  └─ assets > threshold ──► TIMELOCK_PENDING
                              └─ pndwdraw event emitted
                              └─ shares locked in contract
                              │
                              ▼ 24 hours pass
                            TIMELOCK_READY
                              │
                              ▼ User calls execute_withdrawal
                            CONFIRMING ──► CONFIRMED
                                           └─ withdraw event emitted
                                           └─ USDC transferred to user
```

### Withdrawal Error Paths

| Error | VaultError Code | Cause | User Action |
|---|---|---|---|
| `InvalidAmount` | 3 | Shares ≤ 0 | Enter a positive share amount |
| `InsufficientShares` | 2 | User balance < requested shares | Reduce share amount |
| `ContractPaused` | 4 | Vault is paused | Wait for admin to unpause |
| `TimelockNotExpired` | 7 | `execute_withdrawal` called too early | Wait until `unlock_ts` |
| `NoPendingWithdrawal` | 8 | No pending withdrawal exists | Initiate withdrawal first |

#### Backend Partial Failures

The errors above are rejected before anything durable happens. A separate class of
failure occurs *after* the on-chain submission succeeds — the transaction row or
the vault re-pricing fails — leaving the chain ahead of the ledger. The backend
journals withdrawals as a saga so these are retried, compensated, or escalated
instead of silently drifting, and answers the client with `202 Accepted` plus a
recovery handle rather than a misleading `500`.

See [Withdrawal Partial-Failure Recovery](../backend/docs/WITHDRAWAL_PARTIAL_FAILURE_RECOVERY.md)
for the state machine, admin endpoints, metrics, and the operator runbook.

---

## Share Price Mechanics

Both deposit and withdrawal use the same share price formula, ensuring fair value exchange at all times.

```
Share Price  =  total_assets / total_shares

Deposit:
  shares_minted  =  amount × total_shares / total_assets
                    (= amount if first deposit, when total_shares = 0)

Withdrawal:
  assets_returned  =  shares × total_assets / total_shares
```

Yield accrual increases `total_assets` without changing `total_shares`, which raises the share price and benefits all depositors proportionally.

---

## Event Reference

| Event | Emitted When | Key Data |
|---|---|---|
| `deposit` | Deposit succeeds | `amount`, `shares_minted` |
| `pndwdraw` | Large withdrawal initiated (timelocked) | `shares`, `unlock_timestamp` |
| `withdraw` | Withdrawal completes (standard or after timelock) | `assets_returned`, `shares_burned` |

See [WEBHOOK_INTEGRATION.md](./WEBHOOK_INTEGRATION.md) for full event schema and consumer examples.

---

## Related Documents

- [Contracts Architecture](./CONTRACTS_ARCHITECTURE.md) — Full contract interface and storage layout
- [Withdrawal Partial-Failure Recovery](../backend/docs/WITHDRAWAL_PARTIAL_FAILURE_RECOVERY.md) — Saga journal, recovery states, and operator runbook
- [Webhook Integration Guide](./WEBHOOK_INTEGRATION.md) — Consuming on-chain events
- [Local Development Quickstart](./LOCAL_DEVELOPMENT_QUICKSTART.md) — Running the stack locally
