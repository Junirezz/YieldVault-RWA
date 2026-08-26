# YieldVault-RWA — Domain Glossary

> **Last Updated:** 2026-07-29

A shared reference for technical and product terminology used across the YieldVault-RWA codebase, specifications, and documentation. Terms are grouped by domain — with deep coverage of **RWA vault concepts**, **strategy allocation mechanics**, and **protocol economics** alongside supporting systems (rate limiting, logging, accessibility, CI/CD). Individual specs may define additional context-specific terms in their own `## Glossary` sections.

**Identifier convention:** Terms that map directly to a code symbol or config key include a parenthesised identifier, e.g. `(Share_Price)`. General domain terms do not.

---

## Table of Contents

- [Vault Architecture & ERC-4626 Model](#vault-architecture--erc-4626-model)
- [Shares & Share Conversions (Rounding Policy)](#shares--share-conversions-rounding-policy)
- [Deposits, Withdrawals & User Flows](#deposits-withdrawals--user-flows)
- [APY, Yield & Fee Economics](#apy-yield--fee-economics)
- [Strategies — Lifecycle, Registration & Allocation](#strategies--lifecycle-registration--allocation)
- [Strategy Connectors — BENJI & Korean Debt](#strategy-connectors--benji--korean-debt)
- [Governance — Strategy Proposals & Voting](#governance--strategy-proposals--voting)
- [Emergency Controls, Pause & Timelocks](#emergency-controls-pause--timelocks)
- [Real-World Assets (RWA) — Terminology & Provenance](#real-world-assets-rwa--terminology--provenance)
- [Oracle Price Validation & Heartbeats](#oracle-price-validation--heartbeats)
- [Protocol Risk Limits & Accounting Invariants](#protocol-risk-limits--accounting-invariants)
- [Access Controls — Whitelist, RBAC & Admin](#access-controls--whitelist-rbac--admin)
- [Protocol Fees, Treasury & Basis Points](#protocol-fees-treasury--basis-points)
- [RWA Shipment Tracking & Asset Provenance](#rwa-shipment-tracking--asset-provenance)
- [Smart Contracts & On-Chian Mechanics](#smart-contracts--on-chain-mechanics)
- [Math & Fixed-Point Arithmetic](#math--fixed-point-arithmetic)
- [Frontend & UI](#frontend--ui)
- [API & Backend](#api--backend)
- [Rate Limiting](#rate-limiting)
- [CI/CD & Infrastructure](#cicd--infrastructure)
- [Logging & Observability](#logging--observability)
- [Accessibility](#accessibility)

---

## Vault Architecture & ERC-4626 Model

**Vault**
The core smart contract that accepts user deposits, issues fractional shares (`yvUSDC`), and allocates capital to yield-generating strategy contracts. Implements an ERC-4626-style tokenized vault pattern on Stellar Soroban. Also called the "Vault contract" or "Vault Router."

**ERC-4626**
The Ethereum standard for tokenized vaults (EIP-4626) that defines a common interface for `deposit`, `withdraw`, `convertToShares`, `convertToAssets`, `totalAssets`, `totalSupply`, etc. YieldVault follows the ERC-4626 rounding and security conventions (always round down to favor the vault).

**Vault State** (`VaultState`)
The on-chain struct containing the core invariants: `total_shares`, `total_assets`, `is_paused`, and `pause_reason`. Reads from the `State` storage key.

**Idle Funds**
USDC held directly in the Vault contract that has not been deployed (invested) into any strategy. Idle funds earn no yield but are immediately available for withdrawals.

**Invested Funds**
USDC that has been moved from the Vault into a strategy contract via `invest()`. Invested funds generate yield but may not be instantly redeemable (depends on strategy liquidity).

**Underlying Token** (`TokenAsset`)
The asset accepted as deposit and used for redemption — currently USDC on Stellar (a SAC-tokenized stablecoin). Configured at initialization and immutable.

**yvUSDC**
The colloquial name for a YieldVault share — a tokenized unit of vault ownership. Shares are not (yet) a standalone SAC token; balances are tracked in the Vault contract's `ShareBalance(Address)` storage map.

**Bootstrap**
The condition when the Vault has zero Total Assets and zero Total Shares (usually the first deposit ever). In bootstrap mode, shares are minted 1:1 with the deposit amount to establish the initial share price of 1.0.

**Per-User Cap** (`PerUserCap`)
The maximum cumulative USDC a single wallet address may deposit into the Vault. Enforced at deposit time; prevents any single user from holding disproportionate share supply.

**User Deposit** (`UserDeposit`)
The cumulative USDC amount a given address has deposited into the Vault. Used to enforce the Per-User Cap and for on-chain analytics. Differs from current share value (which appreciates with yield).

**Minimum Deposit** (`MinDeposit`)
The smallest positive USDC amount accepted by `deposit()`. Prevents dust attacks and zero-share rounding failures. Configurable by admin via `set_min_deposit()`.

**Vault Solvency**
The invariant that `total_assets ≥ sum_over_all_users(convertToAssets(balance(user)))`. Protected by the round-down rounding policy — every share conversion favors the vault, so solvency can only improve over time.

**Withdrawal Queue**
The ordered list (conceptual) of pending large withdrawals that have been placed under timelock. Currently one per user; stored as `PendingWithdrawal(Address)` entries with unlock timestamps.

---

## Shares & Share Conversions (Rounding Policy)

**Share**
A tokenized unit of ownership in the Vault. Shares are issued to depositors proportional to their contribution relative to `total_assets / total_shares` at deposit time.

**Share Price** (`Share_Price`)
The redemption value of one share expressed in USDC (underlying token). Computed as `total_assets / total_shares`. For display, the on-chain contract returns an `i128` scaled by `10¹⁸` (see `Share_Price_Scale`). Share Price only changes when yield accrues — not when users deposit or withdraw.

**Share Price Scale** (`SHARE_PRICE_SCALE`)
The constant `1_000_000_000_000_000_000` (10¹⁸) used to scale the integer share price returned by the contract. Divide by this value to get a human-readable decimal.

**Fixed Point Divisor** (`Fixed_Point_Divisor`)
Synonym for `Share_Price_Scale` in documentation contexts; see rounding policy in [contracts/vault/ROUNDING_POLICY.md](../contracts/vault/ROUNDING_POLICY.md).

**Assets-to-Shares Conversion**
Formula used when minting new shares on deposit: `shares = (assets × total_shares) / total_assets`. Always rounds DOWN (integer truncation).

**Shares-to-Assets Conversion**
Formula used when burning shares on withdrawal: `assets = (shares × total_assets) / total_shares`. Always rounds DOWN (integer truncation).

**Deterministic Round-Down Policy**
The protocol's explicit rounding policy for ALL share-asset conversions: both minting and burning use integer division with truncation (floor). Ensures the vault never over-mints or over-pays, protecting solvency. Aligned with ERC-4626's "favor the vault" recommendation.

**Rounding Loss**
The difference between the exact (fractional) conversion result and the integer result after rounding down. Maximum value per operation: < 1 unit of the output (i.e. < 1 share on mint, < 1 stroop of USDC on burn).

**Dust Amount**
A share or asset quantity so small it rounds to zero on conversion. Deposits that would mint zero shares are rejected with `VaultError::InvalidAmount`; withdrawals that return zero assets succeed silently (a no-op).

**Round-Trip Invariant**
The mathematical guarantee that `withdraw(deposit(x)) ≤ x` for all non-negative `x`. Because both directions round down, a deposit-then-immediate-withdrawal can never extract value from the vault (it can only lose rounding dust). Verified by 10,000+ property-based fuzz tests in `fuzz_math.rs`.

**Math Module** (`math.rs`)
The centralized module in `contracts/vault/src/math.rs` that exposes `assets_to_shares()` and `shares_to_assets()`. Every conversion path (view functions, deposit, withdrawal, fee calculations) flows through here to ensure uniform rounding.

**Bootstrap Ratio**
When `total_assets == 0 || total_shares == 0` (empty vault), `assets_to_shares` returns the raw asset amount (1:1). This avoids division-by-zero and establishes the first depositor's share price as exactly 1.0.

**calculate_shares**
Public read-only function returning the exact number of shares that would be minted for a given asset amount at current vault state. Used by frontends for preview before submitting a deposit transaction.

**calculate_assets**
Public read-only function returning the exact USDC amount that would be redeemed for burning a given share count at current vault state. Used for withdrawal previews.

---

## Deposits, Withdrawals & User Flows

**Deposit**
The user action of transferring USDC into the Vault and receiving newly minted yvUSDC shares at the current share price. On-chain function: `deposit(user, amount)`.

**Withdrawal / Redemption**
The user action of burning yvUSDC shares in exchange for their proportional USDC value at the current share price. On-chain function: `withdraw(user, shares)`. Small withdrawals execute immediately; large withdrawals enter a 24-hour timelock.

**Immediate Withdrawal**
A `withdraw()` call where the asset-equivalent of the shares being burned is **below** the `Large_Withdrawal_Threshold`. Assets are returned to the user in the same transaction.

**Large Withdrawal**
A `withdraw()` call where the asset-equivalent **meets or exceeds** the `Large_Withdrawal_Threshold`. Shares are burned immediately, but the USDC is not released until the timelock expires. A `PendingWithdrawal` record is created with an unlock timestamp 24 hours in the future.

**Execute Withdrawal** (`execute_withdrawal`)
The second on-chain call required to complete a large withdrawal. Can be called by anyone (not just the user) after the timelock expires; transfers USDC to the original withdrawer. This two-step design supports auto-completion by keepers.

**Unlock Timestamp**
The Unix timestamp stored on a `PendingWithdrawal` after which `execute_withdrawal` will succeed. Computed as `ledger.timestamp + 24h`.

**Timelock Not Expired** (`VaultError::TimelockNotExpired`)
Error returned when `execute_withdrawal` is called before the unlock timestamp.

**No Pending Withdrawal** (`VaultError::NoPendingWithdrawal`)
Error returned when `execute_withdrawal` is called for a user with no queued large withdrawal (either already claimed, never created, or below-threshold immediate withdrawal used).

**Insufficient Shares** (`VaultError::InsufficientShares`)
Error returned when `withdraw()` is called with more shares than the user's `ShareBalance`.

**Min Deposit Not Met** (`VaultError::MinDepositNotMet`)
Error returned when `deposit()` is called with an amount below `MinDeposit` (or that would round to zero shares).

**Exceeds User Cap** (`VaultError::ExceedsUserCap`)
Error returned when `deposit()` would cause the user's cumulative `UserDeposit` to exceed `PerUserCap`.

**Contract Paused** (`VaultError::ContractPaused`)
Error returned for any user action (deposit, withdraw, execute_withdrawal) when the vault is paused.

**Deposit Event**
On-chain event emitted on successful deposit: `("deposit", amount, shares_minted)`. Indexed by the backend to update user portfolios and transaction history.

**Withdraw Event**
On-chain event emitted on successful immediate withdrawal: `("withdraw", user, assets, shares)`. Large withdrawals emit a separate pending event.

**Pending Withdrawal Event**
On-chain event emitted when a large withdrawal is queued under timelock: `("pndwdraw", user, shares, unlock_ts)`. Indicates the user must call `execute_withdrawal` after the timestamp.

**Simulated Transaction**
A dry-run invocation via Soroban RPC `simulateTransaction` used by the frontend to preview share amounts, fee estimates, and expected events BEFORE asking the user to sign with their wallet.

**Signed XDR**
A Stellar transaction envelope (XDR format) that has been signed by the user's wallet (Freighter). Submitted to the network via `submitTransaction`.

---

## APY, Yield & Fee Economics

**APY (Annual Percentage Yield)**
The annualized rate of return on deposited assets, accounting for compounding of reinvested yield. Computed from the rate of change in Share Price: if share price grows from 1.00 to 1.05 in a year, APY ≈ 5%.

**APR (Annual Percentage Rate)**
The simple (non-compounded) annualized interest rate. APR ignores the effect of reinvesting yield; when yield is reinvested, APY ≥ APR.

**Net APY**
The APY actually received by depositors after deducting protocol fees, strategy fees, and operational costs from gross yield. The headline number shown on the dashboard.

**Gross Yield**
Total yield generated by all strategies (before any fees are deducted). Entered into the vault through yield-accrual paths and increases `total_assets`.

**Yield Source**
The underlying mechanism or asset class generating returns for a strategy. Examples for YieldVault-RWA:
- Tokenized T-Bill coupons (BENJI)
- Sovereign debt interest payments (Korean bonds)
- Future: lending rates, secured financing

**Yield Accrual**
Any operation that increases `total_assets` without minting new shares. Because `total_shares` is constant, the share price rises proportionally, socializing gains across all existing holders. YieldVault supports three accrual paths:
1. **Admin Direct** — `accrue_yield(amount)`
2. **BENJI Push** — `report_benji_yield(strategy, amount)` (callback from strategy)
3. **Korean Debt Pull** — `accrue_korean_debt_yield()` (admin-triggered harvest)

**Socialized Yield**
Yield that is distributed pro-rata to every shareholder simply by holding shares. No pro-rata distribution transactions needed — share price increases automatically. This is the standard ERC-4626 model.

**Management Fee**
A recurring annualized fee charged as a percentage of Total Assets (e.g. 2% per year). Typically accrued continuously or in epochs; deducted before computing Net APY.

**Performance Fee**
A fee charged on the positive yield only (never on principal), e.g. 20% of gains above a high-water mark. Applied at harvest time before yield is socialized.

**Protocol Fee**
The generic name for fees the protocol charges on yield accruals. Currently implemented as basis points taken from each `accrue_yield` call via the fee-math module. See also: `Fee_Bps`.

**High-Water Mark**
(Concept / future) The highest historical share price for a given position. Performance fees are typically charged only on gains above the high-water mark to prevent double-paying after drawdowns.

**Coupon**
The periodic interest payment made by a bond issuer to bondholders. For tokenized sovereign debt strategies, coupon payments are harvested and become `Gross_Yield`.

**Epochs**
Discrete time intervals used by strategies (e.g. the Korean debt mock) to model stepped coupon payments. Each `harvest_yield()` increments an epoch counter and returns a linearly-increasing yield amount.

**Harvest**
The act of calling a strategy's yield collection function and routing the proceeds back to the vault. Harvests may be admin-triggered (pull model) or initiated by the strategy itself via a trusted callback (push model).

**Net Amount**
The USDC deposited into `total_assets` after fees have been deducted from the gross harvested yield: `net = gross - protocol_fee`.

---

## Strategies — Lifecycle, Registration & Allocation

**Strategy**
A separate smart contract (or off-chain allocation module) that accepts USDC from the Vault, deploys it into a specific Yield Source, and implements the `StrategyTrait` interface (`total_value`, `deposit`, `withdraw`). The Vault routes capital to strategies and tracks their registration lifecycle.

**StrategyTrait**
The Rust trait defined in `contracts/vault/src/strategy.rs` that all strategy connectors must implement. Standardizes:
- `total_value(env)` — current USDC-equivalent value of assets in strategy
- `deposit(env, amount)` — transfer USDC from vault into strategy
- `withdraw(env, amount)` — recall USDC from strategy back to vault

**Active Strategy**
The single strategy address currently stored under the `Strategy` storage key. The Vault calls `invest()` and `divest()` against this address, and includes its `total_value()` in the `total_assets()` computation.

**Strategy Whitelist**
The set of strategy contract addresses pre-approved by admin for use. A strategy must be on the whitelist AND have `Active` registration state before the vault will allocate to it. Implemented by the `SecureWhitelist` module on top of `StrategyRegistration`.

**Strategy Registration Lifecycle**
The explicit state machine for strategy onboarding: `None → Pending → Active → Retired`. Stored as a `u32` in `StrategyWhitelist(address)` storage. State transitions are strictly guarded.

| State | Storage Value | Meaning |
|-------|---------------|---------|
| **Unregistered** | Not present | Strategy is unknown; cannot be used |
| **Pending** | `STATE_PENDING` = 1 | Admin has registered the strategy; undergoing due diligence / audit. Eligible for whitelist checks but NOT yet eligible for capital allocation. |
| **Active** | `STATE_ACTIVE` = 2 | Fully approved; may receive capital allocations from the vault. |
| **Retired** | `STATE_RETIRED` = 3 | Permanently decommissioned. Cannot be re-activated (must re-register as new). All capital must be divested before retiring. |

**STATE_PENDING / STATE_ACTIVE / STATE_RETIRED**
The `u32` constants used in strategy registration storage. Defined in `strategy_registration.rs`.

**Allowed State Transition**
The registration FSM only permits these transitions (enforced by `is_allowed_transition()`):
- None → Pending (register new strategy)
- Pending → Active (approve strategy after audit)
- Pending → Retired (reject during due diligence)
- Active → Retired (decommission after divestment)

Retired → Active is explicitly forbidden; a retired strategy can never be re-enabled.

**Strategy Registration Error**
Error enum from `strategy_registration.rs`: `Unauthorized`, `AlreadyRegistered`, `NotRegistered`, `InvalidTransition`, `ActiveStrategyInUse`, `StrategyNotActive`.

**ActiveStrategyInUse**
Error returned when trying to retire a strategy that is still set as the current `ActiveStrategy`. The admin must change the active strategy to a different one (or None) first, then divest all funds, then retire.

**Strategy Heartbeat** (`StrategyLastHeartbeat`)
A timestamp written by a strategy to signal it is operational and up-to-date. The vault checks heartbeat freshness before allowing `invest()`/rebalance operations, to prevent allocating capital to a stuck or abandoned strategy.

**Strategy Heartbeat Default** (`DEFAULT_STRATEGY_HEARTBEAT_SECONDS`)
Default maximum age: 3600 seconds (1 hour). Configurable per-strategy. If `now - last_heartbeat > max_age`, allocation is blocked with `VaultError::StrategyHeartbeatExpired`.

**Invest**
The vault function `invest(amount)` that moves `amount` USDC from the vault's idle balance into the currently Active Strategy. Requires: strategy whitelisted & active, heartbeat fresh, sufficient idle funds.

**Divest**
The vault function `divest(amount)` that recalls `amount` USDC from the Active Strategy back into the vault's idle balance. Used for rebalancing, servicing withdrawals, and before strategy retirement.

**Strategy Total Value** (`total_value()`)
The strategy's self-reported current USDC-equivalent valuation. Summed with idle USDC to compute the vault's `Total Assets`. When oracle validation is enabled, this value is cross-checked against the price oracle before being trusted.

**Strategy Allocation Weight**
(Concept / multi-strategy future) The target percentage of `Total Assets` that should be deployed to a given strategy. In the single-active-strategy Phase 2 model, this is effectively 0% or 100%; Phase 3 will support weighted multi-strategy allocations.

**Allocation Drift**
(Concept) The difference between a strategy's target Allocation Weight and its actual percentage of Total Assets, caused by asymmetric yield across strategies. Drift triggers rebalancing.

**Rebalancing**
The process of adjusting allocations (calling `invest` on underweight strategies, `divest` on overweight ones) to bring actual weights back to targets. Triggered manually by admin or by automated drift thresholds.

**Strategy Manager**
The privileged role (currently Admin, future: DAO sub-role or dedicated multisig) responsible for strategy registration, activation, retirement, and day-to-day rebalancing.

---

## Strategy Connectors — BENJI & Korean Debt

**BENJI Strategy**
The Franklin Templeton BENJI fund connector — a push-based strategy where the strategy contract itself calls back into the vault's `report_benji_yield(strategy, amount)` function when yield is harvested. Address is set via DAO governance proposal (`execute_strategy_proposal`).

**BENJI Push Model**
The callback-based yield accrual pattern: the strategy contract (not the vault admin) initiates the yield report. The vault authenticates the caller by checking it matches the stored `BenjiStrategy` address, then trusts the transferred amount.

**BenjiStrategy Storage**
The on-chain address storage key for the BENJI connector. Set only by governance (not by admin directly) — this is the rationale for the Strategy Proposal DAO flow.

**report_benji_yield**
External function on the vault callable only by the configured BENJI strategy. Transfers USDC from the strategy, deducts the protocol fee, and credits the remainder to `total_assets`.

**Korean Sovereign Debt Strategy**
A pull-based strategy modeling a Korean government bond portfolio. The vault admin calls `accrue_korean_debt_yield()` which in turn invokes `KoreanDebtStrategy.harvest_yield()` and deposits the proceeds.

**KoreanDebtStrategy Storage**
The on-chain address storage key for the Korean debt connector. Set directly by admin (bypasses DAO) as a Phase 1 simplification.

**Pull-Based Harvest**
The pattern used by the Korean debt strategy: the vault (admin) actively pulls yield by invoking `harvest_yield()` on the strategy contract. Contrasts with the BENJI push-based callback pattern.

**Step-Up Yield Curve**
The mock yield model in `contracts/mock-strategy/src/lib.rs`: `yield(epoch) = base_yield + step_yield × epoch`. Each harvest increments an epoch counter, so coupon payments grow over time — simulates a stepped-coupon bond instrument.

**Base Yield** (`base_yield`)
The fixed yield floor per epoch in the step-up curve — the minimum coupon even on the first harvest.

**Step Yield** (`step_yield`)
The incremental yield added each successive epoch — the coupon step-up amount.

**Epoch**
The auto-incremented counter in the mock Korean debt strategy, incremented on every `harvest_yield()` call.

**Strategy Connector Pattern**
The architectural pattern in which each RWA integration gets its own adapter contract (the "connector") that bridges off-chain/RWA operations into on-chain Soroban calls that the vault can understand via `StrategyTrait`.

---

## Governance — Strategy Proposals & Voting

**Governance**
The mechanism for decentralized strategy selection: any user can create a strategy proposal, holders vote with weight, and proposals meeting quorum + majority can be executed to set the BENJI strategy address.

**DAO Threshold** (`DaoThreshold`)
The minimum total weighted YES votes required for a Strategy Proposal to be executable. Set and modifiable by admin via `set_dao_threshold()`. Defaults to 1 in testnet; must be raised for mainnet.

**Strategy Proposal**
An on-chain governance proposal to set a new active BENJI strategy address. Lifecycle: `create_strategy_proposal → vote_on_proposal → execute_strategy_proposal`.

**ProposalNonce** (`ProposalNonce`)
A `u32` auto-incrementing counter for proposal IDs. The first proposal is ID 0.

**create_strategy_proposal**
Governance entry point. Creates a new proposal referencing a strategy address and the proposer. Returns the proposal ID.

**vote_on_proposal**
Casts a weighted vote (YES or NO via `support` boolean plus `weight` value) on a proposal. One vote per address per proposal — subsequent attempts by the same address are rejected.

**Vote Record** (`Vote(u32, Address)`)
The storage boolean deduplication guard: if the key exists, this address already voted. Stores `true` on first vote.

**execute_strategy_proposal**
After voting is complete, anyone may call this function. Checks:
- YES votes ≥ `DaoThreshold` (quorum)
- YES votes > NO votes (majority)
- Proposal not yet executed

If all pass, sets `BenjiStrategy` to the proposal's strategy address and marks the proposal executed.

**Quorum**
The threshold condition: `yes_votes >= dao_threshold`. Ensures proposals have enough participation before execution.

**Majority**
The threshold condition: `yes_votes > no_votes`. Ensures the proposal is preferred over the status quo by participating voters.

**Immutable Once Executed**
The guard that `execute_strategy_proposal` will revert if the proposal's `executed` flag is already `true`. Prevents replay of a passing proposal.

**Governance Signer** (multisig path)
An authorized address in the M-of-N signer set for operations that bypass the open vote (e.g., emergency admin parameters). Stored in `GovernanceConfig`. Migration mode accepts both old and new signer sets during handoff.

---

## Emergency Controls, Pause & Timelocks

**Pause**
The action of halting all user-facing vault operations (deposit, withdrawal, execute_withdrawal). Preserves read-only queries (`balance`, `total_assets`, etc.). Can be initiated directly by admin OR via the dual-approval Emergency Action flow.

**Unpause**
Resuming normal vault operations after a pause. Only the admin (or an unpause Emergency Action) may unpause.

**is_paused**
Read-only boolean from `VaultState`. Checked at the top of every user action.

**PauseReason** (`PauseReason`)
The explicit `u32` enum recorded when the vault is paused. Values: `None=0`, `SecurityIncident=1`, `OracleFailure=2`, `LiquidityCrisis=3`, `Governance=4`, `Maintenance=5`, `Other=6`. Stored in `VaultState.pause_reason` and surfaced to UIs.

**SecurityIncident (pause reason)**
A suspected exploit, unauthorized access, or bug. Highest urgency — triggers incident response playbook.

**OracleFailure (pause reason)**
Oracle feed is stale, invalid, or manipulated. All price-dependent operations are unsafe.

**LiquidityCrisis (pause reason)**
Insufficient idle USDC to cover expected withdrawals, or indicators of a bank-run (many large withdrawals in flight).

**Governance (pause reason)**
A planned pause directed by DAO vote or governance action.

**Maintenance (pause reason)**
Planned upgrade window, contract migration, or scheduled maintenance.

**Emergency Action** (`EmergencyActionKind`)
A dual-approval mechanism for high-impact operations, used when Admin is unavailable or the action itself relates to Admin:
- `Pause` — halt operations
- `Unpause` — resume operations
- `EmergencyDivest` — forced full recall from active strategy
- `ForceUpgrade` — WASM upgrade bypassing the normal admin-only gate

**Emergency Approver**
One of two distinct addresses (Primary + Secondary) authorized to initiate and confirm Emergency Actions. Both must be distinct and different from Admin.

**Primary Emergency Approver**
Creates the `EmergencyProposal`; cannot confirm their own proposal.

**Secondary Emergency Approver**
Confirms and executes the `EmergencyProposal` after the Dispute Window expires (unless admin cancels first).

**Emergency Proposal**
Stored record of a proposed Emergency Action, containing: `EmergencyActionKind`, parameters, initiator (Primary), confirmation status, and dispute deadline.

**Dispute Window**
Configurable delay (default 3600 seconds / 1 hour) between creation and confirmability of an Emergency Proposal. During this window, the Admin can cancel the proposal if they believe it to be unauthorized or erroneous.

**Emergency Divest** (`EmergencyDivest`)
Forces the vault to call `divest(max)` to recall ALL capital from the Active Strategy back into idle USDC. Used when the strategy is suspected to be compromised or to maximize liquidity during a LiquidityCrisis pause.

**Emergency Unwind Simulation** (`simulate_emergency_unwind`)
Read-only function estimating how much USDC would be recovered by EmergencyDivest, including projected losses, fees, and a feasibility flag. Used to evaluate whether divestment is safe before committing.

**EmergencyUnwindResult**
Struct returned: `total_assets_recovered`, `estimated_losses`, `net_amount_available`, `operational_cost`, `feasibility` (enum: Feasible / LossThresholdExceeded / Illiquid).

**ForceUpgrade** (`ForceUpgrade`)
Emergency action variant that allows executing `upgrade(new_wasm_hash)` via the dual-approval path when the normal Admin upgrade path is unavailable (e.g. Admin key loss). Still requires the vault to be paused as a safety prerequisite.

**Large Withdrawal Timelock**
The 24-hour delay on withdrawals at or above `LargeWithdrawalThreshold`. Designed to give the protocol time to liquidate strategy positions and detect / block fraudulent withdrawal attempts.

**Large Withdrawal Threshold** (`LargeWithdrawalThreshold`)
The USDC amount (in stroops) at or above which a withdrawal triggers the 24h timelock. Configurable by admin. Set very high (effectively off) in testnet; tuned for mainnet based on typical strategy liquidation times.

**Admin Parameter Change Interval**
Minimum time between consecutive admin parameter changes, guard against rapid-fire parameter manipulation attacks.

**Timelock (general)**
Any time-based delay on a sensitive operation to allow monitoring, intervention, or orderly processing. YieldVault uses timelocks for: large withdrawals, governance signer migrations, and (concept) future protocol parameter changes.

---

## Real-World Assets (RWA) — Terminology & Provenance

**RWA (Real-World Asset)**
A financial asset that originates and exists off the blockchain (treasury bills, sovereign bonds, corporate credit, real estate, trade receivables) whose economic value and ownership are represented on-chain through tokenization.

**Tokenization**
The process of creating an on-chain digital representation (a token) of a real-world asset. The token derives its value from the off-chain underlying, typically held by a Custodian under a legal and operational framework.

**Underlying Asset**
The off-chain financial instrument that backs an on-chain RWA token (e.g. a specific US Treasury Bill CUSIP, a Korean government bond ISIN).

**Custodian**
A regulated financial institution or trust company that legally holds the underlying off-chain assets, audited periodically. The custodian's attestations support the token's NAV and redemption rights.

**NAV (Net Asset Value)**
The per-unit fair value of a fund or strategy portfolio. For a tokenized T-Bill fund, NAV = (market value of all bonds + accrued interest - fees) / outstanding shares. BENJI's NAV is reported as the strategy's `total_value`.

**Treasury Bill (T-Bill)**
Short-term (≤ 1 year) US government debt security, typically issued at a discount to face value. Ultra-low risk and used as a near-cash cash-equivalent yield source.

**Sovereign Debt**
Bonds issued by a national government (e.g. Republic of Korea Treasury Bonds). Credit risk varies by issuer rating; generally low risk for investment-grade sovereigns.

**Coupon Payment**
The periodic interest payment a bond issuer makes to the bondholder. For an RWA vault, harvested coupons become Gross Yield routed into the share price.

**Maturity Date**
The date on which a bond's principal (face value) is repaid to the holder. Money-market strategies (T-Bills, BENJI) hold short-maturity paper and roll at maturity.

**Money Market Fund (MMF)**
A mutual fund investing in very short-term (≤13 month) government paper and repurchase agreements. BENJI is structured as a government MMF tokenized on-chain.

**Yield Curve**
The relationship between yield and maturity for bonds of similar credit quality. An upward-sloping yield curve (normal) means longer maturities yield more; in the Korean mock, the step-up yield curve models a rising coupon schedule within a single instrument.

**Spread**
The yield difference between a strategy's RWA holdings and a risk-free baseline (e.g. USDC lending rate vs. T-Bills). Positive spread is the value-add of the RWA allocation.

**Credit Risk**
Risk that the bond issuer (sovereign, corporate) will fail to make scheduled coupon or principal payments. Mitigated by issuer selection, diversification, and CUSIP-level reporting.

**Duration**
A measure of a bond portfolio's sensitivity to interest rate changes (higher duration = larger price swings when rates move). Short-duration strategies (T-Bills) have low interest-rate risk.

**Mark-to-Market**
Periodically revaluing a portfolio based on current market prices, rather than holding cost. Oracles validate that strategy-reported `total_value()` matches independently sourced marks.

**Legal & Operational Framework**
The contract structure (SPA, custody agreement, indenture, etc.) connecting on-chain tokens to off-chain assets. Different from the smart-contract security audit.

**Redemption Right**
Legal mechanism for token holders to redeem their on-chain RWA tokens for the underlying asset or its cash equivalent. Typically requires KYC/AML checks at the RWA layer.

**Proof of Reserve (PoR)**
On-chain attestation or cryptographic oracle proof verifying that off-chain collateral held by custodians equals or exceeds the total value of tokenized RWA issued.

**Off-Chain Settlement**
The operational process of completing asset transfers, bank wires, or delivery-versus-payment (DvP) in traditional financial rails before updating on-chain balances.

**CUSIP / ISIN**
Unique alphanumeric identifiers assigned to financial securities (Committee on Uniform Security Identification Procedures / International Securities Identification Number) used to identify and trace off-chain RWA underlying holdings.

**Delivery-versus-Payment (DvP)**
A settlement mechanism that links the transfer of financial assets to payment execution, ensuring securities delivery occurs if and only if payment is fulfilled.

**Off-Chain Collateral Ratio**
The ratio of verified off-chain collateral held in custody to total on-chain shares or tokens issued against those assets, ensuring full backing.

**Bankruptcy-Remote SPV**
A Special Purpose Vehicle legally structured to isolate RWA assets from the operational liabilities of the issuer or custodian, protecting investor capital in bankruptcy scenarios.

**Subscription & Redemption Window**
The specified timeframe and operational delay required for fiat processing, bank settlement, and custodial transfer when subscribing to or redeeming RWA positions.

**Yield Distribution Epoch**
The discrete time period over which harvested RWA yield (e.g., T-Bill interest or sovereign bond coupons) is aggregated and socialized to vault share price.

**Fractional RWA Ownership**
The mechanism enabling retail or institutional users to hold fractional shares of institutional-grade RWA assets with high minimum investment thresholds via tokenized ERC-4626 vault shares.

---

## Oracle Price Validation & Heartbeats

**Oracle**
An external data feed providing verified, signed market prices (or valuations) for RWA strategy portfolios. Oracles are trusted third-party services (e.g. Chainlink, RedStone, or proprietary NAV feeds from fund administrators).

**Price Oracle** (`PriceOracle`)
Storage slot holding the oracle contract address. Set by admin; validation is optional (opt-in via `OracleEnabled`).

**Oracle Enabled** (`OracleEnabled`)
Boolean flag toggling oracle validation for all price-dependent operations (invest, divest, total_assets). Off by default for Phase 1 testnet.

**Oracle Heartbeat** (`OracleHeartbeat`)
Maximum acceptable age (seconds) of the last oracle price update. If `now - price.timestamp > heartbeat`, validation fails with `HeartbeatExceeded`. Prevents relying on stale data.

**Oracle Default Heartbeat**
3600 seconds (1 hour). Configurable via `set_oracle_heartbeat()`.

**PriceData**
Tuple `(price, timestamp, decimals)` returned by an oracle read. Price is scaled by `10^decimals`.

**Validation Rules** (OracleValidator)
The set of checks applied in `contracts/vault/src/oracle.rs` before a price is accepted:
1. **Heartbeat** — not stale
2. **Not Zero** — price > 0
3. **Not Negative** — price sign non-negative
4. **Valid Decimals** — ≤ 30 (prevent precision attacks)
5. **No Overflow** — final computation fits `i128`
6. **Price Deviation** — change vs. last validated price ≤ `MAX_DEVIATION_BPS` (default 50%)
7. **No Future Timestamp** — protects against delayed-data-injection attacks

**Price Deviation Threshold / Circuit Breaker**
Default 5000 bps (50%) maximum single-update change. Anything larger triggers `PriceDeviationExceeded` and halts operations — the "circuit breaker" against flash crashes and oracle manipulation.

**MAX_DEVIATION_BPS**
Default 5000 basis points = 50%.

**OracleError**
The error enum from oracle validation: `HeartbeatExceeded`, `PriceZero`, `PriceNegative`, `TimestampInFuture`, `InvalidDecimals`, `PriceOverflow`, `PriceDeviationExceeded`.

**No-Fallback Policy**
Deliberate design choice: the vault NEVER falls back to a cached/stale price if validation fails. Transaction reverts immediately. This prioritizes safety over availability for price-sensitive operations.

**Last Validated Price** (`LastValidatedPrice`)
Cached `(price, timestamp, decimals)` from the last oracle read that passed validation. Used as the reference for the deviation circuit breaker. Cleared when a new oracle address is executed via `execute_price_oracle_change()`.

**StrategyHeartbeat vs OracleHeartbeat**
| Dimension | StrategyHeartbeat | OracleHeartbeat |
|-----------|-------------------|-----------------|
| What it checks | Strategy contract is live | Price feed is live |
| Who writes it | Strategy (periodic `record_heartbeat`) | Oracle service |
| Default | 1 hour | 1 hour |
| Failures block | invest / divest | total_assets / invest / divest |

---

## Protocol Risk Limits & Accounting Invariants

See [PROTOCOL_RISK_LIMITS.md](./PROTOCOL_RISK_LIMITS.md) and [VAULT_INVARIANTS.md](./VAULT_INVARIANTS.md) for the full operator specs.

**Protocol Risk Limits**
Protocol-wide hard caps on vault exposure (Issue #1173), independent of per-strategy caps.

**Max Vault TVL** (`MaxVaultTvl`)
Hard cap on accounting total assets for new deposits. `0` = unlimited (default).

**Max Strategy Concentration** (`MaxStrategyConcentrationBps`)
Maximum share of TVL that may sit in a single strategy, in basis points. Default `10000` (100%).

**Stress Mode** (`StressMode`)
When enabled, concentration and deployed caps use `min(normal, stress)` so limits can only tighten. Disable after volatility subsides to restore the normal caps.

**Accounting Invariants**
Contract-level checks that `total_shares` / `total_assets` / share-price stay mathematically valid on every state persist.

---

## Access Controls — Whitelist, RBAC & Admin

**Admin**
The privileged address with broad control over protocol parameters. Set during `initialize()`; transferable via two-step process (`propose_admin` → `accept_admin`). Controls: strategy whitelist, fee bps, treasury, thresholds, pausing, oracle config, manual yield accrual.

**Two-Step Admin Transfer**
The propose/accept pattern. Prevents accidental irreversible loss of admin control from typos. `PendingAdmin` is the intermediate state.

**Pending Admin** (`PendingAdmin`)
Address that has been proposed as new Admin. Must call `accept_admin()` within a reasonable window to take effect. Old admin remains active until acceptance.

**SecureWhitelist**
`contracts/vault/src/whitelist.rs` struct wrapping strategy registration operations with admin auth checks. Provides:
- `add_strategy(env, caller, strategy)` → register to Pending
- `remove_strategy(env, caller, strategy)` → fully remove registration record
- `is_strategy_whitelisted(env, strategy)` → true if Pending or Active

**WhitelistError**
Error enum for SecureWhitelist: `Unauthorized`, `InvalidStrategy`, `OperationFailed`.

**is_strategy_whitelisted**
Predicate used before setting the active strategy. Requires `Pending OR Active` registration state (per `strategy_registration::is_eligible_for_allocation`).

**Retired Strategy Reactivation**
Explicitly disallowed. A strategy that has transitioned to STATE_RETIRED can never be whitelisted again. To re-onboard the same code, deploy a new strategy address and register it fresh. This prevents accidentally approving a previously decommissioned strategy with known issues.

**RBAC (Backend)**
Role-Based Access Control in the backend API tier. Four admin key roles: `viewer` (read-only), `operator` (ops writes), `admin` (privileged config + key lifecycle), `super-admin` (impersonation + idempotency flush + mint super-admin keys). NOT to be confused with on-chain Admin role.

---

## Protocol Fees, Treasury & Basis Points

**Protocol Fee**
Fee deducted from harvested yield (or any admin `accrue_yield` call) before being credited to `total_assets`. Expressed as `FeeBps` — basis points of the gross amount.

**Basis Point (BPS, bps)**
One one-hundredth of one percent (0.01%). 100 bps = 1%. 10000 bps = 100%. Standard unit for fine-grained fee configuration.

**FeeBps** (`FeeBps`)
Storage slot holding the protocol fee rate. Valid range `0..=10_000`. Configurable by admin via `queue_fee_bps_change()` / `execute_fee_bps_change()` (timelocked, see Issue #969). Zero means no fee is charged.

**BPS_DENOMINATOR**
Constant `10_000` used in fee calculation: `fee = amount × fee_bps / 10_000`. All integer floor-division.

**Protocol Fee Calculation**
Deterministic formula in `contracts/vault/src/fee_math.rs`:
```
fee_amount = (gross_amount × fee_bps) / 10_000   [floor division]
net_amount = gross_amount - fee_amount
```
Always rounds in favor of depositors (the fee is rounded down, so `fee + net == gross` exactly with no phantom units).

**Fee Change Event** (`feechg`)
Event emitted when admin changes the fee: `(old_bps, new_bps)`. Allows integrators to track historical fee schedules.

**Treasury** (`Treasury`)
Storage slot for the designated protocol treasury address. Currently not automatically transferred — the vault itself accumulates fees in `TreasuryBalance`. Future: automated sweeps to this address.

**Treasury Balance** (`TreasuryBalance`)
Running accumulated protocol fee balance stored in the vault. Used to track how much of `total_assets` is protocol-owned vs. user-owned. Currently not automatically withdrawable; manual withdrawal path or future upgrade.

**Treasury Accumulator Bound** (`MAX_TREASURY_ACCUMULATOR`)
`i128::MAX / 2`. Prevents overflow during accumulation. When this bound would be exceeded, `would_exceed_accumulator_bound` returns true and the protocol should trigger a rollover (manual claim or sweep).

**Treasury Rollover**
(Concept) Procedure when the accumulator approaches its bound: excess is either swept to the external `Treasury` address or marked for distribution via share repurchase / fee redistribution.

**Fee Event in Deposit / Withdrawal**
Not applicable. Protocol fees are only taken on YIELD accrual paths — depositors never pay a fee at deposit or withdrawal time. This simplifies user math (the rounding policy handles the only "loss" on conversions).

---

## RWA Shipment Tracking & Asset Provenance

**Shipment**
An off-chain physical or custodial movement of RWA backing assets (e.g. US Treasury notes moved to a new custodian, settlement of a bond purchase). The vault tracks shipment records for on-chain provenance auditing.

**ShipmentID** (`u64`)
Unique identifier for each tracked shipment. Assigned off-chain at shipment creation time.

**ShipmentStatus**
Enum in the vault contract: `Pending`, `InTransit`, `Delivered`, `Cancelled`. Transitions via admin calls.

| Status | Meaning |
|--------|---------|
| `Pending` | Shipment record created; assets not yet dispatched |
| `InTransit` | Assets physically/custodially in motion; delivery pending |
| `Delivered` | Assets confirmed received by target custodian; reflected in NAV |
| `Cancelled` | Shipment aborted; no asset movement occurred |

**add_shipment**
Admin function to register a new shipment with initial status (typically `Pending`).

**update_shipment_status**
Admin function to transition a shipment's status. Status changes are validated (e.g. you cannot mark something Delivered before it was InTransit).

**ShipmentByStatus**
Storage index grouping shipment IDs by their current status. Supports efficient "show me all in-transit shipments" queries.

**ShipmentPage**
Paginated response struct for status-based queries: `{ shipment_ids: Vec<u64>, next_cursor: Option<u64> }`. Used for admin UIs and block explorers.

**Max Page Size** (`MAX_PAGE_SIZE`)
Constant `50`. Paginated queries will not return more than this many IDs in one call. Prevents gas-limit exhaustion on large result sets.

**Asset Provenance**
The end-to-end trail of custody and transfer of the real-world assets backing the on-chain tokens. Shipment tracking is one component; others include custodian statements, NA V attestations, and audit reports. Shipment status provides on-chain anchoring of off-chain events.

---

## Smart Contracts & On-Chain Mechanics

**Soroban**
Stellar's smart contract platform. Rust code is compiled to WASM, deployed to the network, and invoked via Stellar transactions. YieldVault uses Soroban SDK v22.

**WASM**
WebAssembly binary format produced by `cargo build --target wasm32-unknown-unknown`. Optimized with `stellar contract optimize` before deployment to reduce footprint and gas costs.

**Contract ID**
The 32-byte Stellar contract address (C… format) assigned at deploy time. Stored in `deployments/contracts.<network>.json` for testnet/futurenet/mainnet.

**SAC (Stellar Asset Contract)**
The standard built-in token contract for Stellar assets. USDC (the underlying token) is accessed via SAC's standard `transfer`, `approve`, `balance` interface.

**Stroop**
The smallest unit of a Stellar asset (7 decimal places). 1 USDC = 10,000,000 stroops. All on-chain amounts are stroop integers; UIs convert to decimal USDC for display.

**Stellar CLI** (`stellar`)
Command-line tool for building, deploying, and invoking Soroban contracts. Replaces the legacy `soroban` CLI.

**Ledger**
A Stellar block. Closed roughly every 5 seconds. Timestamps, sequence numbers, and TTL calculations are all ledger-based.

**Entry TTL**
Stellar Soroban storage entries have a time-to-live measured in ledgers. Instance storage (contract state) defaults to ~1 year (6,312,000 ledgers). Temporary auth entries are minimum 16 ledgers. Bump operations extend TTLs.

**Initialize** (`initialize`)
One-time constructor-like call. Sets admin, underlying token, and storage version. Reverts if called again (`AlreadyInitialized`).

**Upgrade** (`upgrade`)
Admin-only WASM code upgrade. Critical safety requirement: vault must be PAUSED before upgrade to prevent state inconsistencies during storage migration.

**Storage Version** (`StorageVersion`)
Monotonically increasing version number for contract storage layout. Incremented when an upgrade changes the data layout so migration code can detect and transform old-format entries.

**DataKey Enum**
Rust enum tagging every persistent storage slot. Variants include `TokenAsset`, `TotalShares`, `TotalAssets`, `Admin`, `State`, `Strategy`, `StrategyWhitelist(A)`, `ShareBalance(A)`, `Proposal(u32)`, `ShipmentByStatus(S)`, `FeeBps`, `PendingWithdrawal(A)`, `TreasuryBalance`, etc. Centralized enumeration prevents storage key collisions.

**VaultError**
Canonical error enum for the vault. Each variant has a numeric discriminant used in revert messages:
| Code | Variant | Trigger |
|------|---------|---------|
| 1 | AlreadyInitialized | `initialize()` called twice |
| 2 | InsufficientShares | withdraw exceeds balance |
| 3 | InvalidAmount | ≤0 or rounds to 0 shares |
| 4 | ContractPaused | operation during paused state |
| 5 | ExceedsUserCap | deposit > PerUserCap |
| 6 | MinDepositNotMet | deposit < MinDeposit |
| 7 | TimelockNotExpired | execute_withdrawal too early |
| 8 | NoPendingWithdrawal | no queued large withdrawal |
| ... | StrategyHeartbeatExpired | heartbeat stale at invest/divest |

**Contract Events**
Structured on-chain log entries emitted during state transitions. Backend event-polling service reads these to index transactions, deposits, withdrawals, fee changes, and audit-relevant operations.

**Checked Arithmetic**
All math in the vault uses `.checked_mul()`, `.checked_div()`, etc. and panics on overflow rather than silently wrapping. Fuzz tests exhaust boundary cases.

**Fuzz Tests (Property-Based)**
10,000+ randomized tests in `fuzz_math.rs` verifying the rounding invariants, round-trip no-value-extraction guarantee, monotonicity, and overflow protection.

---

## Math & Fixed-Point Arithmetic

**i128**
128-bit signed integer type used for all monetary values in the vault. Wide enough to hold the entire USDC supply × 10^18 with substantial headroom.

**Checked Operations**
`checked_add / checked_sub / checked_mul / checked_div` — arithmetic methods that return `Option` (or panic via `.expect`) if the result overflows the type.

**Fixed-Point Scaling**
Using integer arithmetic at a scale (typically 10^18) to represent decimals without floating-point error. Share price on-chain is an i128 scaled by `SHARE_PRICE_SCALE`.

**Rounding Direction (Floor / Truncation)**
Integer division in Rust (and i128) truncates towards zero, equivalent to "round down" for positive values. All vault operations operate on positive monetary amounts, so truncation = floor = favors the vault.

**Monotonicity**
Mathematical guarantee:
- If `a ≥ b`, then `assets_to_shares(a) ≥ assets_to_shares(b)`
- If `s ≥ t`, then `shares_to_assets(s) ≥ shares_to_assets(t)`
Verified by unit and fuzz tests. Prevents gaming the system with tiny inputs.

**Proportional Model** (ERC-4626 core)
The vault uses no accounting tricks beyond `shares = assets × total_shares / total_assets`. A user's economic share is always exactly `balance(user) / total_shares` — fully transparent and computable from public storage.

**Fuzz Invariants** (fuzz_math.rs)
Properties tested for tens of thousands of random input tuples:
1. Solvency: `sum(convertToAssets(balance(u))) ≤ total_assets`
2. Round-trip: `withdraw(deposit(x)) ≤ x`
3. Monotonicity: larger input → larger output
4. No over-minting / over-withdrawal
5. Identity in bootstrap: `deposit(x) = x`

---

## Frontend & UI

**VaultContext**
React context providing vault state (share price, balances, user position) to the entire dashboard via `VaultProvider`.

**useSharePrice**
Custom hook encapsulating the 30-second polling loop for share price. Exposes `sharePrice`, `isLoading`, `isRefetching`, `error`, `lastUpdated`, `forceRefresh`.

**Share Price Display** (`Share_Price_Display`)
Dashboard widget showing the current share price with live status dots and last-updated timestamp. Applies Tooltip/InlineDefinition with the Share Price glossary definition.

**Polling Cycle**
One scheduled fetch execution in the 30-second interval. 2-3 cycles per minute.

**Last Updated Timestamp**
The wall-clock (client browser) time the most recent successful fetch completed. Used for "X seconds ago" display.

**Loading Indicator**
Spinner / skeleton animation shown during an in-flight fetch.

**Error State**
UI mode when the last fetch failed and no valid data is available. Shows an inline error banner and allows manual retry.

**Tooltip**
Non-interactive floating `role="tooltip"` with a short term definition, tied to its trigger via `aria-describedby`.

**Popover**
Interactive `role="dialog"` floating panel for richer help content (paragraphs, links). Opened by button click, dismissible via Escape or outside click.

**Trigger**
The interactive element (button, term with `tabindex`) that opens a Tooltip or Popover.

**Floating Panel**
The absolutely positioned overlay element. Uses `@floating-ui` for Placement + Flip logic.

**Help Hint**
Generic term for any Tooltip or Popover used for contextual help.

**Inline Definition**
A Tooltip applied inline to a financial term (e.g. the word "APY" on the dashboard has a definition tooltip).

**Focus Trap**
Keyboard constraint keeping Tab/Shift+Tab within an open Popover for accessibility compliance.

**Escape Dismissal**
Standard behavior of closing the current floating panel on Escape key press.

**Placement / Flip**
Floating-UI concepts: `top/bottom/left/right` with `start/end` alignment, plus automatic repositioning on viewport overflow (Flip).

**RiskSummaryCard** (`RiskSummaryCard`)
A presentational card component summarizing account-level risk signals with one actionable CTA per warning. Renders items with configurable `tone` (`critical` | `warning` | `info` | `success`). Supports an "all clear" healthy state with an optional CTA.

**Risk Action Tone** (`RiskAction.tone`)
The severity classification of a risk item: `critical` (red), `warning` (amber), `info` (subtle cyan), or `success` (green). Drives visual styling and button variant.

**Healthy State CTA**
Optional call-to-action button rendered in the all-clear state when no risk warnings exist, e.g. "Compare strategies" to guide users toward the next beneficial action.

**Risk Item Row**
Individual warning display within the risk summary card: shows a title, description, and action button with color-coded borders based on the item's tone.

**Progressive Disclosure (Form UX)**
A UX pattern that reveals form sections and information only when relevant to the user's current input state. In YieldVault: fee breakdown appears only after a valid amount is entered; approval warnings appear early for deposits; slippage settings are inside a collapsible "Advanced Settings" panel.

**Conditional Fee Breakdown**
Dynamic display of protocol fee estimates that appears (fades in) only when the user enters a valid deposit/withdrawal amount, reducing initial visual clutter.

**Early Approval Warning**
An orange warning panel shown on the amount input step as soon as a valid deposit amount is entered, informing users they will need to approve USDC spending before the deposit can execute.

**Vault Capacity Indicator**
A visual progress bar that appears when the vault is >=70% full, showing utilization percentage with color coding: cyan (safe), orange (70–89%, warning), red (90–100%, caution).

**Collapsible Advanced Settings**
A `<details>` HTML element pattern wrapping slippage tolerance controls on the withdrawal form, labeled "Advanced Settings" with an "Optional" badge.

**Field Validation Visual Feedback**
Green checkmark (`✓`) displayed on validated amount fields (`input-valid` CSS class), providing positive reinforcement for correct input.

**CSS Animation Utility Classes**
Reusable animation classes: `.animate-in`, `.fade-in`, `.slide-in`. CSS-based for GPU acceleration, used for smooth transitions of conditional form elements.

**First-Time Portfolio Panel** (`FirstTimePortfolioPanel`)
A guided onboarding panel displayed for users with no deposit history. Presents a three-step checklist: (1) Connect Wallet, (2) Review Vault Details, (3) Make First Deposit.

**Onboarding Step State**
Each step in the first-time depositor checklist has three visual states: `done` (completed, checkmark icon), `active` (current actionable step, primary button style), and `future` (not yet available, visually dimmed). Uses `aria-current="step"` for the active step.

**Step Connector** (`ftp-step-connector`)
Vertical line connecting step indicators in the checklist, visually showing progression through the onboarding flow.

**Vault Strategy Catalog** (`VAULT_STRATEGIES`)
A local fixture array of `VaultStrategy` objects containing `id`, `name`, `issuer`, `apyPercent`, `liquidityDays`, `riskTier`, and `accent`. Serves as the data source for the comparison screen.

**Comparison Metric** (`ComparisonMetric`)
Definition of a comparison dimension with `id`, `label`, `description`, `betterIs` ("higher" | "lower"), a numeric `valueOf` projection, and a locale-aware `format` function.

**Best-In-Class Marking** (`findBestStrategyIds`)
Algorithm that identifies which strategies hold the optimal value for a given metric. Ties all win; if every value ties the result is empty. Marked with `★` glyph and `sr-only` text for WCAG 1.4.1 compliance.

**Risk Tier** (`RiskTier`)
Ordinal risk classification: `very-low`, `low`, `moderate`, `elevated`. Each tier has a numeric rank for sorting and comparison.

**Comparison Selection Rules**
Business rules: minimum 2 strategies required for a meaningful comparison, maximum 3 columns for laptop viewport. `toggleStrategySelection` returns the identical array reference when the cap rejects an addition.

**URL-Driven Comparison State**
Selection, sort metric, and sort direction are stored in URL query parameters (`?strategies=`, `?sortBy=`, `?direction=`) so comparisons are bookmarkable, shareable, and survive back/forward navigation.

**APY Spread** (`getApySpread`)
The difference between the highest and lowest APY across selected strategies, in percentage points. Helps users quickly see yield variance.

**Chart Series Sampling** (`sampleChartSeries`)
A utility function that reduces a large time-series dataset to a fixed number of evenly spaced data points for rendering. Preserves the first and last data points. Uses `MAX_RENDER_POINTS = 120` as the target point count. Prevents rendering performance degradation on long time ranges.

---

## API & Backend

**Wallet Address**
Stellar public key (G… format). Primary identifier for backend rate limiting and user lookups.

**Horizon API**
Stellar's REST API for account balances, transaction history, and network state. Complementary to Soroban RPC.

**Soroban RPC**
Remote procedure call endpoint for invoking contracts, simulating transactions, and reading contract events. Configured via `STELLAR_RPC_URL` / `VITE_SOROBAN_RPC_URL`.

**Withdrawal Saga** (`WithdrawalSagaRecord`)
A journalled, multi-step state machine for a withdrawal operation. Each saga records every step's status (`pending`, `in_progress`, `completed`, `failed`, `skipped`, `compensated`, `compensation_failed`) in a write-ahead journal before any side-effect executes. Implemented in `withdrawalRecovery.ts`.

**Withdrawal Plan** (`registerWithdrawalPlan`)
A registered ordered list of `WithdrawalStepDefinition` entries that a saga executes. Plans have names (e.g. `vault.withdrawal`) and are registered before a saga can run or be resumed.

**Write-Ahead Journal**
The pattern of recording each withdrawal saga step as `pending` before its first side effect and writing every transition as it happens. A crash always leaves evidence of how far the withdrawal got.

**Resume-Forward Recovery**
Recovery mechanism that re-walks the plan and skips steps already marked `completed` or `skipped`. The on-chain step is pinned to `maxAttempts: 1` so a submission is never repeated.

**Compensation (Saga Compensation)**
The process of undoing completed steps in reverse order when a failure occurs before any irreversible progress has been made. The saga ends as `compensated`.

**Manual-Intervention Queue** (`needs_manual_intervention`)
The saga terminal state when irreversible on-chain progress exists but remaining steps cannot be completed automatically. Sagas in this state are exposed via admin endpoints and logged with `alert: "withdrawal-partial-failure"`.

**Background Sweeper**
A periodic background process that resumes sagas in `awaiting_retry` or `in_progress` states with capped exponential backoff. Overlapping passes over the same saga are guarded against.

**Withdrawal Failure Classification** (`WithdrawalFailureClass`)
The classification of step errors as either `retryable` (transient infrastructure failures) or `terminal` (validation errors, insufficient balance, etc.). Used to decide whether to retry or escalate.

**WithdrawalPartialFailureError**
Error class raised when a withdrawal left irreversible on-chain effects behind that neither finish nor undo automatically. Mapped to HTTP 202 (Accepted) with a recovery handle.

**HTTP 202 Recovery Handle**
The response body when a withdrawal has a partial failure: includes `sagaId`, `status`, `automatedRetryScheduled`, `nextAttemptAt`, `failedStep`, and per-step journal status.

**Admin Withdrawal Recovery Endpoints**
Admin-only endpoints at `/admin/withdrawals/recovery`: `GET` (list), `GET /metrics` (aggregate counters), `GET /:sagaId` (detail), `POST /:sagaId/resume` (run one recovery pass), `POST /:sagaId/resolve` (close out a reconciled saga), `POST /sweep` (run sweeper immediately). Written to the admin audit log.

**Withdrawal Saga Prometheus Metrics**
Six metrics for monitoring: `withdrawal_saga_total` (counter, labels: plan, outcome), `withdrawal_saga_step_failure_total` (counter, labels: step, classification), `withdrawal_saga_compensation_total` (counter, labels: step, result), `withdrawal_saga_retry_total` (counter, labels: plan), `withdrawal_saga_awaiting_recovery` (gauge), `withdrawal_saga_manual_intervention_required` (gauge).

**WithdrawalJournalSink**
Optional hook that receives every journal transition, allowing deployments to mirror the in-memory ring buffer journal to durable storage (Postgres/Redis) without modifying the `withdrawalRecovery.ts` module.

**API Version Negotiation** (`apiVersionMiddleware`)
Express middleware that inspects `Accept-Version`, `X-API-Version`, and `Accept` headers to determine the requested API version. Returns 406 Not Acceptable for unsupported versions. Sets `X-API-Version` and `X-API-Version-Supported` response headers.

**Deprecation Header Injection**
Automatic addition of `Deprecation: true`, `Sunset: <future date>`, and `Link: <successor-path>; rel="successor-version"` headers for requests hitting legacy/unversioned routes.

**Query Budget** (`QUERY_BUDGETS`)
Performance threshold (in milliseconds) assigned per Prisma model+action pair (e.g. `User.findUnique: 50ms`). When a query exceeds its budget, a slow query alert is triggered.

**Slow Query Alert** (`triggerSlowQueryAlert`)
Alerting function that fires when a database query exceeds its performance budget. Supports Slack and PagerDuty delivery with a configurable cooldown (`SLOW_QUERY_ALERT_COOLDOWN_MS`).

---

## Rate Limiting

**Rate Limiter**
Backend middleware tracking request counts and enforcing per-key limits. Supports Redis-backed (multi-instance) and in-memory (single-instance) stores with fail-open behavior when Redis is unavailable.

**Redis Store**
Persistence layer sharing rate-limit counters across backend instances. Keys: `rl:<endpoint>:<wallet_or_ip>` with TTL equal to the window.

**Rate Limit Window**
Fixed time interval (milliseconds) over which a counter applies before reset.

**Rate Limit**
Maximum requests per window per key.

**Tiered Rate Limiters**
Preconfigured limit levels for different route classes:
- `authLimiter` — tightest (login/nonce endpoints)
- `writesLimiter` — strict (POST/PUT/PATCH/DELETE)
- `readsLimiter` — relaxed (GET)
- `adminLimiter` — admin routes by API key

**Retry-After**
HTTP response header returned on 429 with Unix timestamp (ms) when the limit resets.

**Fallback Key**
Rate-limit key used when no wallet address / API key is present — either client IP or `"unknown"`.

---

## CI/CD & Infrastructure

**CI Pipeline**
GitHub Actions workflows triggered on push/PR. Key files in `.github/workflows/`: `rust-wasm.yml` (contracts), `frontend.yml` (UI), `backend-governance.yml` (API), plus security, slither, and deploy pipelines.

**WASM Build Job**
`rust-wasm.yml` step compiling the contracts to optimized `.wasm` artifacts.

**Testnet Deploy Job**
CI step deploying the optimized WASM to Stellar testnet and running smoke tests. Outputs the deployed `Contract_ID`.

**Smoke Test**
Minimal end-to-end deploy validation: `deposit(100) → balance(user) == 100 shares`.

**Deployment Artifact**
JSON file uploaded to Actions artifacts recording deployed Contract ID and Git SHA for traceability.

---

## Logging & Observability

**Logger**
Structured JSON logger. Every log entry includes `timestamp`, `level`, `correlation_id`, `message`, and `module`.

**Log Entry**
Single JSON output line.

**Correlation ID** (`correlation_id`)
UUID v4 injected at the edge by the correlation middleware and propagated through all logs and downstream RPC calls for end-to-end tracing in production.

**Log Level**
One of: `debug`, `info`, `warn`, `error`. Configurable via `LOG_LEVEL` env var.

---

## Accessibility

**ARIA**
Accessible Rich Internet Applications attributes — HTML annotations for assistive technologies.

**Focus Trap**
Keyboard constraint inside open dialogs / popovers. Prevents focus from "leaking" behind the modal.

**Escape Dismissal**
Consistent Esc-to-close behavior on floating panels.

**Placement / Flip**
Floating UI positioning strategy with overflow fallback.

---

*This glossary is the authoritative cross-cutting reference. Per-spec glossaries in `.kiro/specs/*/requirements.md` define additional terms scoped to their feature context. Maintain this file alongside protocol changes — when a new storage key, enum, parameter, or domain concept is introduced, add it here with the same name used in code.*
