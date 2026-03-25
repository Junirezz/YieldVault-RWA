# YieldVault — Strategy Allocation & RWA Risk Management Wiki

## 1. Overview

YieldVault is a Soroban smart contract vault on the Stellar network that accepts USDC deposits
from retail users and generates yield by allocating funds into tokenized Real-World Assets (RWAs)
such as sovereign debt instruments and US Treasuries. This document describes the mathematical
strategies and risk parameters governing the vault.

---

## 2. Core Mathematical Strategies

### 2.1 Share Price Model (ERC-4626 Style)

YieldVault uses a proportional share model. When a user deposits USDC they receive vault shares
(yvUSDC) representing their fractional ownership of total vault assets.

**Share Minting Formula (Deposit):**
```
shares_to_mint = deposit_amount × total_shares / total_assets
```
> If the vault is empty (`total_assets = 0` or `total_shares = 0`), shares are minted 1:1 with
> the deposit amount.

**Asset Redemption Formula (Withdrawal):**
```
assets_to_return = shares_burned × total_assets / total_shares
```

**Share Price (Exchange Rate):**
```
share_price = total_assets / total_shares
```

As yield accrues, `total_assets` increases while `total_shares` stays constant — each share
becomes redeemable for more USDC over time.

Source: [`contracts/vault/src/lib.rs`](../contracts/vault/src/lib.rs) — `calculate_shares`,
`calculate_assets`.

---

### 2.2 Yield Accrual Model

There are three yield accrual paths, all of which increase `total_assets` without minting new
shares, thereby raising the share price for all existing holders.

#### 2.2.1 Admin Direct Accrual (`accrue_yield`)

The admin transfers USDC directly into the vault:

```
new_total_assets = total_assets + yield_amount
new_share_price  = new_total_assets / total_shares
```

#### 2.2.2 BENJI Strategy Push (`report_benji_yield`)

The configured BENJI strategy contract calls back into the vault to report harvested yield.
The vault verifies the caller matches the on-chain `BenjiStrategy` address before accepting
the transfer:

```
require strategy == configured_benji_strategy
new_total_assets = total_assets + amount
```

#### 2.2.3 Korean Sovereign Debt Pull (`accrue_korean_debt_yield`)

The admin triggers a pull-based harvest from the configured Korean debt strategy contract.
The strategy's `harvest_yield()` is called and the returned amount is added to `total_assets`:

```
harvested = KoreanDebtStrategy.harvest_yield()
require harvested > 0
new_total_assets = total_assets + harvested
```

Yield is **socialized proportionally** across all shareholders — no new shares are minted,
so every existing holder's redemption value increases equally.

---

### 2.3 Korean Sovereign Debt Yield Curve Model

The `MockKoreanSovereignStrategy` contract implements a linear step-up yield curve used for
testing and simulation:

```
yield(epoch) = base_yield + step_yield × epoch
```

| Parameter    | Description                                      |
|--------------|--------------------------------------------------|
| `base_yield` | Fixed yield floor per harvest epoch (in stroops) |
| `step_yield` | Incremental yield added each successive epoch    |
| `epoch`      | Auto-incremented counter on each `harvest_yield` call |

This models a bond instrument where coupon payments increase over time. The admin can update
`base_yield` and `step_yield` at any time via `set_yield_curve`.

Source: [`contracts/mock-strategy/src/lib.rs`](../contracts/mock-strategy/src/lib.rs).

---

### 2.4 Worked Example

| Step | Action                        | total_assets | total_shares | Share Price |
|------|-------------------------------|-------------|-------------|-------------|
| 1    | User A deposits 100 USDC      | 100         | 100         | 1.00        |
| 2    | User B deposits 200 USDC      | 300         | 300         | 1.00        |
| 3    | Admin accrues 30 USDC yield   | 330         | 300         | 1.10        |
| 4    | User A withdraws 100 shares   | 220         | 200         | 1.10        |
| 5    | User B withdraws 100 shares   | 110         | 100         | 1.10        |

- User A: deposited 100 USDC, withdrew 110 USDC (+10 yield)
- User B: deposited 200 USDC, partial withdrawal of 110 USDC, 100 shares remain

---

## 3. DAO Governance & Strategy Allocation

Strategy addresses are not hardcoded — they are set through an on-chain governance proposal
lifecycle.

### 3.1 Proposal Lifecycle

```
create_strategy_proposal(proposer, strategy)  →  proposal_id
vote_on_proposal(voter, proposal_id, support, weight)
execute_strategy_proposal(proposal_id)        →  sets BenjiStrategy
```

### 3.2 Execution Rules

| Rule | Detail |
|------|--------|
| Quorum | `yes_votes >= dao_threshold` |
| Majority | `yes_votes > no_votes` |
| One vote per address | Duplicate votes are rejected |
| Immutable once executed | `executed = true` blocks re-execution |

`dao_threshold` is set by the admin via `set_dao_threshold` and must be `> 0`.

The Korean debt strategy bypasses governance — it is set directly by the admin via
`configure_korean_strategy`. This is a Phase 1 simplification; governance coverage for all
strategies is planned for Phase 3.

---

## 4. RWA Risk Parameters

### 4.1 Current Risk Parameters

| Parameter           | Value                  | Description                                      |
|---------------------|------------------------|--------------------------------------------------|
| Underlying Asset    | USDC (Stellar)         | Stablecoin deposit currency                      |
| Token Decimals      | 7                      | Standard Stellar stroop precision                |
| Min Deposit         | > 0                    | Any positive stroop amount accepted              |
| Min Withdrawal      | > 0 shares             | Any positive share amount accepted               |
| Max Deposit         | None (Phase 1)         | No cap in current implementation                 |
| Max Page Size       | 50                     | Shipment pagination hard cap                     |
| Admin Control       | Single admin key       | Controls yield accrual and strategy allocation   |
| DAO Threshold       | Configurable (default 1) | Minimum yes-votes to execute a proposal        |
| Protocol Version    | Soroban v22            | Stellar Soroban smart contract runtime           |
| Entry TTL (Persistent) | 6,312,000 ledgers   | ~1 year at 5 s/ledger                            |
| Entry TTL (Temporary)  | 16 ledgers minimum  | Short-lived auth entries                         |

### 4.2 Risk Categories

**Smart Contract Risk**
Single Soroban contract with no upgrade mechanism in Phase 1. All state is stored in instance
storage. An audit is required before mainnet deployment (Phase 4).

**Counterparty Risk**
Phase 1 yield is manually accrued by a trusted admin. Phase 3+ yield is pulled from RWA issuers
(Franklin Templeton BENJI, tokenized Korean sovereign bonds) via strategy bridge contracts. Each
issuer introduces its own counterparty risk.

**Liquidity Risk**
Withdrawals are processed immediately against the vault's USDC balance. If funds are deployed
into illiquid RWA strategies in future phases, a withdrawal queue or lock-up period may be
required.

**Admin Key Risk**
A single admin address controls yield accrual, strategy configuration, and DAO threshold. Phase 2
introduces multi-sig or DAO governance to mitigate this.

**Oracle / Price Risk**
Phase 1 has no oracle dependency — USDC is treated as 1:1 USD. Future phases integrating
non-stablecoin RWAs will require price feeds and introduce oracle risk.

**Governance Attack Risk**
The DAO threshold defaults to `1`, meaning a single vote can pass a proposal in Phase 1. This is
intentional for testnet iteration. Threshold must be raised before mainnet deployment.

---

## 5. Strategy Integrations

### 5.1 Active / Planned Strategies

| Strategy                        | Asset Type              | Yield Model          | Risk Level  | Status     |
|---------------------------------|-------------------------|----------------------|-------------|------------|
| Franklin Templeton BENJI        | US Treasury Money Market | Push (callback)     | Low         | Phase 2    |
| Korean Sovereign Debt (Mock)    | Sovereign Debt Bond     | Pull (step-up curve) | Low-Medium  | Phase 2    |
| Stellar-native RWA Bridges      | TBD                     | TBD                  | Medium      | Phase 3+   |

### 5.2 BENJI Connector

- Strategy type: **push-based** — the strategy contract calls `report_benji_yield(strategy, amount)`.
- Authorization: vault verifies `strategy == BenjiStrategy` on-chain before accepting funds.
- Strategy address is set via DAO governance (`execute_strategy_proposal`).
- Frontend metadata: [`frontend/src/lib/strategy.ts`](../frontend/src/lib/strategy.ts).

### 5.3 Korean Sovereign Debt Strategy

- Strategy type: **pull-based** — vault admin calls `accrue_korean_debt_yield()`, which invokes
  `KoreanDebtStrategy.harvest_yield()` on the configured contract.
- Yield model: linear step-up curve — `yield(epoch) = base_yield + step_yield × epoch`.
- Strategy address is set directly by admin via `configure_korean_strategy`.

---

## 6. Contract State Reference

| State Key                    | Type      | Description                                      |
|------------------------------|-----------|--------------------------------------------------|
| `Admin`                      | Address   | Controls yield accrual and initialization        |
| `TokenAsset`                 | Address   | Underlying USDC token contract address           |
| `TotalShares`                | i128      | Total vault shares currently minted              |
| `TotalAssets`                | i128      | Total USDC held/tracked by the vault             |
| `ShareBalance(Address)`      | i128      | Individual user share balance                    |
| `BenjiStrategy`              | Address   | Active BENJI strategy (set via governance)       |
| `KoreanDebtStrategy`         | Address   | Korean debt strategy (set by admin)              |
| `DaoThreshold`               | i128      | Minimum yes-votes required to execute a proposal |
| `ProposalNonce`              | u32       | Auto-incrementing proposal ID counter            |
| `Proposal(u32)`              | StrategyProposal | Proposal state by ID                      |
| `Vote(u32, Address)`         | bool      | Deduplication guard per voter per proposal       |

---

## 7. Contract Functions Reference

| Function                          | Access     | Description                                              |
|-----------------------------------|------------|----------------------------------------------------------|
| `initialize(admin, token)`        | Admin      | Sets up vault with USDC token and admin                  |
| `deposit(user, amount)`           | User       | Deposits USDC, mints proportional shares                 |
| `withdraw(user, shares)`          | User       | Burns shares, returns proportional USDC                  |
| `accrue_yield(amount)`            | Admin only | Transfers yield into vault, raises share price           |
| `report_benji_yield(strategy, amount)` | BENJI strategy | Push-based yield from BENJI connector         |
| `accrue_korean_debt_yield()`      | Admin only | Pull-based yield harvest from Korean debt strategy       |
| `configure_korean_strategy(addr)` | Admin only | Sets the Korean debt strategy contract address           |
| `create_strategy_proposal(proposer, strategy)` | Any | Opens a governance proposal for a new strategy  |
| `vote_on_proposal(voter, id, support, weight)` | Any | Casts a weighted vote on a proposal            |
| `execute_strategy_proposal(id)`   | Any        | Executes a passed proposal, sets `BenjiStrategy`         |
| `set_dao_threshold(threshold)`    | Admin only | Updates the minimum yes-vote quorum                      |
| `calculate_shares(assets)`        | Read-only  | Returns shares for a given asset amount                  |
| `calculate_assets(shares)`        | Read-only  | Returns assets redeemable for given shares               |
| `total_shares()`                  | Read-only  | Returns total minted shares                              |
| `total_assets()`                  | Read-only  | Returns total vault assets                               |
| `balance(user)`                   | Read-only  | Returns a user's share balance                           |

---

## 8. Changelog

| Version | Date       | Change                                                                 |
|---------|------------|------------------------------------------------------------------------|
| 0.2.0   | 2026-03-25 | Full rewrite: added DAO governance model, Korean debt yield curve, BENJI push model, complete state/function reference, updated risk parameters |
| 0.1.0   | 2026-03-24 | Initial wiki — Phase 1 strategy and risk documentation                 |
