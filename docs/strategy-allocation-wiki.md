# YieldVault — Strategy Allocation & RWA Risk Management Wiki

## 1. Overview

YieldVault is a Soroban smart contract vault on the Stellar network that accepts USDC deposits from retail users and generates yield by allocating funds into tokenized Real-World Assets (RWAs) such as sovereign debt instruments and US Treasuries. This document describes the mathematical strategies and risk parameters governing the vault.

---

## 2. Core Mathematical Strategies

### 2.1 Share Price Model (ERC-4626 Style)

YieldVault uses a proportional share model. When a user deposits USDC, they receive vault shares (yvUSDC) representing their fractional ownership of the total vault assets.

**Share Minting Formula (Deposit):**
```
shares_to_mint = deposit_amount × total_shares / total_assets
```
> If the vault is empty (`total_assets = 0` or `total_shares = 0`), shares are minted 1:1 with the deposit amount.

**Asset Redemption Formula (Withdrawal):**
```
assets_to_return = shares_burned × total_assets / total_shares
```

**Share Price (Exchange Rate):**
```
share_price = total_assets / total_shares
```
As yield accrues, `total_assets` increases while `total_shares` stays constant — meaning each share becomes redeemable for more USDC over time.

---

### 2.2 Yield Accrual Model

Yield is accrued by the admin (or strategy contract in future phases) calling `accrue_yield(amount)`. This transfers real USDC into the vault and bumps `total_assets`, immediately increasing the share price for all existing holders.
```
new_total_assets = total_assets + yield_amount
new_share_price  = new_total_assets / total_shares
```

This means yield is **socialized proportionally** — all shareholders benefit instantly and equally based on their share holdings.

---

### 2.3 Worked Example (From Test Snapshot)

| Step | Action | total_assets | total_shares | Share Price |
|---|---|---|---|---|
| 1 | User A deposits 100 USDC | 100 | 100 | 1.00 |
| 2 | User B deposits 200 USDC | 300 | 300 | 1.00 |
| 3 | Admin accrues 30 USDC yield | 330 | 300 | 1.10 |
| 4 | User A withdraws 100 shares | 220 | 200 | 1.10 |
| 5 | User B withdraws 100 shares | 110 | 100 | 1.10 |

**User A final balance:** 110 USDC (deposited 100, earned 10 from yield)
**User B final balance:** 910 USDC remaining (deposited 200, partial withdrawal of 110)

This matches the test snapshot final state:
- `TotalAssets: 110`
- `TotalShares: 100`
- User A share balance: `0`
- User B share balance: `100`

---

## 3. RWA Risk Management Parameters

### 3.1 Current Risk Parameters

| Parameter | Value | Description |
|---|---|---|
| Underlying Asset | USDC (Stellar) | Stablecoin deposit currency |
| Token Decimals | 7 | Standard Stellar token precision |
| Min Deposit | > 0 USDC | Any positive amount accepted |
| Min Withdrawal | > 0 shares | Any positive share amount accepted |
| Max Deposit | None (Phase 1) | No cap in current implementation |
| Admin Control | Single admin key | Controls yield accrual and strategy allocation |
| Protocol Version | Soroban v22 | Stellar Soroban smart contract runtime |
| Entry TTL (Persistent) | 6,312,000 ledgers | ~1 year at 5s/ledger |
| Entry TTL (Temporary) | 16 ledgers minimum | Short-lived auth entries |

---

### 3.2 Risk Categories

**Smart Contract Risk**
The vault is a single Soroban contract with no upgrade mechanism in Phase 1. All state is stored in instance storage. An audit is required before mainnet deployment (Phase 4).

**Counterparty Risk**
In Phase 1, yield is manually accrued by a trusted admin. In future phases, yield will be pulled from RWA issuers (e.g. Franklin Templeton BENJI, tokenized Korean bonds, US Treasuries) via strategy bridge contracts. Each RWA issuer introduces its own counterparty risk.

**Liquidity Risk**
Withdrawals are processed immediately against vault USDC balance. If vault funds are deployed into illiquid RWA strategies in future phases, a withdrawal queue or lock-up period may be required.

**Admin Key Risk**
The current implementation uses a single admin address for yield accrual and strategy control. Phase 2 will introduce multi-sig or DAO governance to mitigate this risk.

**Oracle / Price Risk**
Phase 1 has no oracle dependency — USDC is treated as 1:1 USD. Future phases integrating non-stablecoin RWAs will require price feeds and introduce oracle risk.

---

## 4. Contract State Reference

| State Key | Type | Description |
|---|---|---|
| `Admin` | Address | Controls yield accrual and initialization |
| `Token` | Address | Underlying USDC token contract address |
| `TotalShares` | i128 | Total vault shares currently minted |
| `TotalAssets` | i128 | Total USDC held/tracked by the vault |
| `ShareBalance(Address)` | i128 | Individual user share balance |

---

## 5. Contract Functions Reference

| Function | Access | Description |
|---|---|---|
| `initialize(admin, token)` | Admin | Sets up vault with USDC token and admin |
| `deposit(user, amount)` | User | Deposits USDC, mints proportional shares |
| `withdraw(user, shares)` | User | Burns shares, returns proportional USDC |
| `accrue_yield(amount)` | Admin only | Transfers yield into vault, raises share price |
| `calculate_shares(assets)` | Read-only | Returns shares for a given asset amount |
| `calculate_assets(shares)` | Read-only | Returns assets redeemable for given shares |
| `total_shares()` | Read-only | Returns total minted shares |
| `total_assets()` | Read-only | Returns total vault assets |
| `balance(user)` | Read-only | Returns a user's share balance |

---

## 6. Planned Strategy Integrations (Phase 3+)

| Strategy | Asset Type | Target APY | Risk Level |
|---|---|---|---|
| Franklin Templeton BENJI | US Treasury Fund | ~5% | Low |
| Tokenized Korean Sovereign Bonds | Sovereign Debt | ~4-6% | Low-Medium |
| Stellar-native RWA Bridges | TBD | TBD | Medium |

> Note: APY figures are indicative and subject to market conditions. Risk parameters will be updated as integrations are confirmed.

---

## 7. Changelog

| Version | Date | Change |
|---|---|---|
| 0.1.0 | 2026-03-24 | Initial wiki — Phase 1 strategy and risk documentation |
```

---

## Where to Place It

Save this file as `docs/strategy-allocation-wiki.md` in your project root.

---

## Commit Message
```
docs: add strategy allocation and RWA risk management wiki