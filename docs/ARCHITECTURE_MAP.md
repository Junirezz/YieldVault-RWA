# End-to-End Architecture Map: RWA Vault Lifecycle

A comprehensive map of the YieldVault RWA system — all components, data flows, state machines, and infrastructure — spanning user wallet to smart contract, backend, and external services.

---

## Table of Contents

1. [System Component Map](#1-system-component-map)
2. [Deposit Lifecycle (End to End)](#2-deposit-lifecycle-end-to-end)
3. [Withdrawal Lifecycle (End to End)](#3-withdrawal-lifecycle-end-to-end)
4. [Yield Accrual & Distribution Flow](#4-yield-accrual--distribution-flow)
5. [Strategy Management Flow](#5-strategy-management-flow)
6. [Governance & DAO Flow](#6-governance--dao-flow)
7. [Event & Notification Flow](#7-event--notification-flow)
8. [Admin Operations & Maintenance Flow](#8-admin-operations--maintenance-flow)
9. [Infrastructure & Service Dependencies](#9-infrastructure--service-dependencies)
10. [Security Boundaries & Trust Model](#10-security-boundaries--trust-model)
11. [State Machine Reference](#11-state-machine-reference)

---

## 1. System Component Map

```
                                 ┌──────────────────────────────────────────────────────────────────────────┐
                                 │                             EXTERNAL                                     │
                                 │  ┌─────────────────────────────────────────────────────────────────┐      │
                                 │  │  Stellar Network (Soroban)                                     │      │
                                 │  │  ┌──────────────────────┐    ┌────────────────────────────┐     │      │
                                 │  │  │  USDC Token (SAC)    │    │  Soroban RPC Endpoint      │     │      │
                                 │  │  │  - transfer()        │    │  - simulate_transaction()  │     │      │
                                 │  │  │  - balance()         │    │  - submit_transaction()    │     │      │
                                 │  │  └──────────┬───────────┘    │  - getEvents()             │     │      │
                                 │  │             │               └────────────┬───────────────┘     │      │
                                 │  │             ▼                            │                     │      │
                                 │  │  ┌──────────────────────────────────────┐│                     │      │
                                 │  │  │  YieldVault Contract (Rust/WASM)    ││                     │      │
                                 │  │  │  - deposit / withdraw               ││                     │      │
                                 │  │  │  - accrue_yield / invest / divest   ││                     │      │
                                 │  │  │  - governance / shipment tracking   ││                     │      │
                                 │  │  │  - pause / upgrade / admin           ││                     │      │
                                 │  │  └──────────┬───────────────────────────┘│                     │      │
                                 │  │             │                            │                     │      │
                                 │  │             ▼                            │                     │      │
                                 │  │  ┌──────────────────┐  ┌────────────────┐│                     │      │
                                 │  │  │  BenjiStrategy   │  │KoreanDebtStrat ││                     │      │
                                 │  │  │  (BENJI fund)    │  │(debt instr.)   ││                     │      │
                                 │  │  └──────────────────┘  └────────────────┘│                     │      │
                                 │  └─────────────────────────────────────────────────────────────────┘      │
                                 │                                                                          │
                                 │  ┌─────────────────────────────────────────────────────────────────┐      │
                                 │  │  Infrastructure Services                                       │      │
                                 │  │  ┌────────────┐  ┌────────────┐  ┌────────────────────────┐    │      │
                                 │  │  │ PostgreSQL │  │   Redis    │  │  Stellar Horizon API   │    │      │
                                 │  │  │  (main DB) │  │  (cache)   │  │  (account data)        │    │      │
                                 │  │  └────────────┘  └────────────┘  └────────────────────────┘    │      │
                                 │  └─────────────────────────────────────────────────────────────────┘      │
                                 └──────────────────────────────────────────────────────────────────────────┘
                                            ▲                    ▲                    ▲
                                            │                    │                    │
              ┌─────────────────────────────┼────────────────────┼────────────────────┼─────────────────────────┐
              │                             │                    │                    │                         │
              │  ┌────────────────────────────────────────────────────────────────────────────────────────┐    │
              │  │  Backend API (Node.js + Express + TypeScript)                                         │    │
              │  │                                                                                       │    │
              │  │  ┌─────────────────────┐  ┌─────────────────────┐  ┌────────────────────────────┐     │    │
              │  │  │  HTTP Layer         │  │  Middleware Stack    │  │  Background Services       │     │    │
              │  │  │  - /api/v1/vault/*  │  │  - CORS             │  │  - Event Polling Service   │     │    │
              │  │  │  - /api/v1/auth/*   │  │  - Rate Limiting    │  │  - APY Snapshot Scheduler  │     │    │
              │  │  │  - /admin/*         │  │  - Authentication   │  │  - DB Backup Scheduler     │     │    │
              │  │  │  - /health          │  │  - Geofencing       │  │  - Webhook Delivery        │     │    │
              │  │  │  - /ready           │  │  - Payload Limits   │  │  - Withdrawal Recovery     │     │    │
              │  │  └─────────────────────┘  │  - Adaptive Throttle│  │  - Idempotency Pruning     │     │    │
              │  │                           │  - Maintenance Mode │  └────────────────────────────┘     │    │
              │  │                           │  - Allowlist        │                                    │    │
              │  │                           └─────────────────────┘                                    │    │
              │  │                                                                                       │    │
              │  │  ┌─────────────────────┐  ┌─────────────────────┐  ┌────────────────────────────┐     │    │
              │  │  │  Service Layer      │  │  Integration Layer  │  │  Monitoring & Observability│    │    │
              │  │  │  - SorobanClient    │  │  - Prisma ORM       │  │  - OpenTelemetry Tracing  │     │    │
              │  │  │  - EmailService     │  │  - Redis Cache      │  │  - Latency SLO Monitoring │     │    │
              │  │  │  - WalletNonce      │  │  - Database Pool    │  │  - Prometheus Metrics     │     │    │
              │  │  │  - AdminAudit       │  │                     │  │  - Alerting (Slack/PD)    │     │    │
              │  │  │  - CircuitBreaker   │  │                     │  └────────────────────────────┘     │    │
              │  │  │  - RetryBudget      │  │                     │                                    │    │
              │  │  └─────────────────────┘  └─────────────────────┘                                    │    │
              │  └────────────────────────────────────────────────────────────────────────────────────────┘    │
              │                                                                                                │
              │  ┌────────────────────────────────────────────────────────────────────────────────────────┐    │
              │  │  Frontend (React + Vite + TypeScript)                                                  │    │
              │  │                                                                                        │    │
              │  │  ┌────────────────────┐  ┌────────────────────┐  ┌──────────────────────────────┐     │    │
              │  │  │  Pages & UI       │  │  State & Data      │  │  Stellar Integration         │     │    │
              │  │  │  - Vault Dashboard│  │  - React Context   │  │  - Freighter Wallet Connector│     │    │
              │  │  │  - Deposit/Withdraw│  │  - API Client     │  │  - SorobanClient (read)      │     │    │
              │  │  │  - Transaction    │  │  - Feature Flags   │  │  - Transaction Builder       │     │    │
              │  │  │    Status         │  │  - Balance Data    │  │  - Signature Handling        │     │    │
              │  │  │  - Admin Panel    │  │                     │  └──────────────────────────────┘     │    │
              │  │  └────────────────────┘  └────────────────────┘                                       │    │
              │  └────────────────────────────────────────────────────────────────────────────────────────┘    │
              │                                                                                                │
              │  ┌────────────────────────────────────────────────────────────────────────────────────────┐    │
              │  │  Smart Contracts (Rust + Soroban SDK v22.0.0)                                        │    │
              │  │                                                                                       │    │
              │  │  contracts/vault/src/                         contracts/mock-strategy/src/           │    │
              │  │  ├── lib.rs          — Main vault contract    ├── lib.rs           — Mock KoreanStrat│    │
              │  │  ├── strategy.rs     — StrategyTrait          └── mock_oracle.rs   — Mock Oracle     │    │
              │  │  ├── benji_strategy.rs — BENJI connector                                             │    │
              │  │  ├── oracle.rs       — Price validation                                               │    │
              │  │  ├── permissions.rs  — Auth functions                                                │    │
              │  │  ├── external_calls.rs — CEI helpers                                                  │    │
              │  │  ├── upgrade.rs      — Proxy/WASM upgrade                                            │    │
              │  │  ├── test.rs         — 50+ tests                                                     │    │
              │  │  ├── fuzz_math.rs     — Property-based fuzz tests                                   │    │
              │  │  ├── event_tests.rs  — Event emission tests                                          │    │
              │  │  ├── oracle_tests.rs — Oracle validation tests                                       │    │
              │  │  ├── proxy_tests.rs  — Upgrade test                                                  │    │
              │  │  └── security_tests.rs — Security test stubs                                         │    │
              │  └────────────────────────────────────────────────────────────────────────────────────────┘    │
              └────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Deposit Lifecycle (End to End)

### 2.1 Flow Diagram

```
USER WALLET                FRONTEND                   BACKEND API              SOROBAN RPC           VAULT CONTRACT         USDC (SAC)
     │                        │                          │                        │                       │                    │
     │  Enter amount          │                          │                        │                       │                    │
     │───────────────────────>│                          │                        │                       │                    │
     │                        │  simulate(deposit)       │                        │                       │                    │
     │                        │─────────────────────────────────────────────────>│                       │                    │
     │                        │                          │                        │  deposit(user,amount) │                    │
     │                        │                          │                        │──────────────────────>│                    │
     │                        │                          │                        │                       │                    │
     │                        │                          │                        │    │ CHECK            │                    │
     │                        │                          │                        │    │ amount > 0       │                    │
     │                        │                          │                        │    │ not paused       │                    │
     │                        │                          │                        │    │ >= min_deposit   │                    │
     │                        │                          │                        │    │ within user cap  │                    │
     │                        │                          │                        │    │                  │                    │
     │                        │                          │                        │    │ EFFECTS          │                    │
     │                        │                          │                        │    │ shares = amount  │                    │
     │                        │                          │                        │    │ * total_shares / │                    │
     │                        │                          │                        │    │ total_assets     │                    │
     │                        │                          │                        │    │                  │                    │
     │                        │                          │                        │    │ INTERACT         │                    │
     │                        │                          │                        │    │                  │  transfer(user,   │
     │                        │                          │                        │    │─────────────────────────────────>│
     │                        │                          │                        │    │                  │                    │
     │                        │                          │                        │    │<─────────────────────────────────│ OK
     │                        │                          │                        │    │                  │                    │
     │                        │                          │                        │<───│ return shares     │                    │
     │                        │                          │                        │                       │                    │
     │                        │<─────────────────────────────────────────────────│ simulation result    │                    │
     │                        │                          │                        │                       │                    │
     │  Show preview          │                          │                        │                       │                    │
     │<───────────────────────│                          │                        │                       │                    │
     │                        │                          │                        │                       │                    │
     │  Sign with Freighter   │                          │                        │                       │                    │
     │───────────────────────>│                          │                        │                       │                    │
     │                        │  submit(signed XDR)      │                        │                       │                    │
     │                        │─────────────────────────────────────────────────>│                       │                    │
     │                        │                          │                        │  submit_transaction   │                    │
     │                        │                          │                        │──────────────────────>│                    │
     │                        │                          │                        │                       │  deposit() executes│
     │                        │                          │                        │                       │  (CEI pattern)     │
     │                        │                          │                        │                       │────────────────────>│
     │                        │                          │                        │                       │                    │
     │                        │                          │  POST /api/v1/vault/   │                       │                    │
     │                        │                          │  deposit (index)       │                       │                    │
     │                        │──────────────────────────>│                       │                       │                    │
     │                        │                          │                        │                       │                    │
     │                        │                          │  getEvents()           │                       │                    │
     │                        │                          │─────────────────────────────────────────────────>│                    │
     │                        │                          │                        │<─────────────────────────────────│ deposit event
     │                        │                          │                        │                       │                    │
     │                        │                          │  Store in PostgreSQL   │                       │                    │
     │                        │                          │  Update cache          │                       │                    │
     │                        │                          │  Send notification     │                       │                    │
     │                        │                          │  (email/webhook)       │                       │                    │
     │                        │                          │                        │                       │                    │
     │  Show confirmation     │<──────────────────────────│ Deposit indexed        │                       │                    │
     │<───────────────────────│                          │                        │                       │                    │
```

### 2.2 Components Involved

| Step | Component | Action | Data |
|---|---|---|---|
| 1 | Frontend | Validate amount > 0, >= min_deposit, within cap | Amount (USDC) |
| 2 | Frontend → RPC | `simulate_transaction(deposit)` | User address, amount |
| 3 | RPC → Vault (sim) | Dry-run deposit() | — |
| 4 | Vault | Calculate shares, check all invariants | Shares to mint |
| 5 | RPC → Frontend | Return shares estimate + fee | Shares, fee |
| 6 | Frontend → Wallet | Show preview, request signature | Shares, share price |
| 7 | Wallet → Frontend | Return signed XDR | Signed transaction |
| 8 | Frontend → RPC | `submit_transaction(signed XDR)` | Signed XDR |
| 9 | RPC → Vault | Execute deposit() on-chain | — |
| 10 | Vault | CEI: checks → update state → transfer USDC | State mutation |
| 11 | Vault → RPC | Emit `deposit` event | amount, shares_minted |
| 12 | RPC → Frontend | Return tx hash, ledger seq | Tx result |
| 13 | Frontend → Backend | POST `/api/v1/vault/deposit` (index event) | Tx hash, ledger |
| 14 | Backend → RPC | `getEvents()` — confirm on-chain | Contract ID, ledger |
| 15 | Backend | Store in PostgreSQL | Deposit record |
| 16 | Backend | Update Redis cache | Vault summary |
| 17 | Backend | Trigger webhook/email | Deposit notification |
| 18 | Backend → Frontend | Return indexed confirmation | Deposit ID |

### 2.3 State Machine

```
IDLE ──> VALIDATING ──> AWAITING_SIGNATURE ──> SUBMITTING ──> CONFIRMING ──> CONFIRMED
                        (frontend checks)      (Freighter)    (XDR sent)     (ledger close)
                                                               │
                                                               └──> FAILED (contract rejection)
```

### 2.4 Error Paths

| Error | Code | Emitted By | Recovery |
|---|---|---|---|
| `InvalidAmount` | 3 | Vault | User enters positive amount |
| `ContractPaused` | 4 | Vault | Wait for admin unpause |
| `MinDepositNotMet` | 6 | Vault | Increase deposit |
| `ExceedsUserCap` | 5 | Vault | Reduce amount |
| Simulation failure | — | RPC | Check network/RPC status |
| Transaction failure | — | RPC | Check ledger, retry |

---

## 3. Withdrawal Lifecycle (End to End)

### 3.1 Path A — Standard Withdrawal (below threshold)

```
USER WALLET        FRONTEND              BACKEND              SOROBAN RPC        VAULT CONTRACT      USDC (SAC)
     │                 │                    │                     │                    │                  │
     │ Enter shares    │                    │                     │                    │                  │
     │────────────────>│                    │                     │                    │                  │
     │                 │ simulate(withdraw) │                     │                    │                  │
     │                 │──────────────────────────────────────────>│                    │                  │
     │                 │                    │                     │ withdraw(user,shrs)│                  │
     │                 │                    │                     │───────────────────>│                  │
     │                 │                    │                     │                    │                  │
     │                 │                    │                     │   CHECK            │                  │
     │                 │                    │                     │   shares > 0       │                  │
     │                 │                    │                     │   balance >= shares│                  │
     │                 │                    │                     │   not paused       │                  │
     │                 │                    │                     │   assets <= thresh │                  │
     │                 │                    │                     │                    │                  │
     │                 │                    │                     │   EFFECTS          │                  │
     │                 │                    │                     │   update state     │                  │
     │                 │                    │                     │                    │                  │
     │                 │                    │                     │   INTERACT         │                  │
     │                 │                    │                     │                    │ transfer(vault,  │
     │                 │                    │                     │                    │ user, assets)    │
     │                 │                    │                     │────────────────────────────────────>│
     │                 │                    │                     │                    │                  │
     │                 │                    │                     │<────────────────────────────────────│ OK
     │                 │                    │                     │                    │                  │
     │                 │                    │                     │<── return assets   │                  │
     │                 │<──────────────────────────────────────────│ simulation result │                  │
     │ Show preview    │                    │                     │                    │                  │
     │<────────────────│                    │                     │                    │                  │
     │                 │                    │                     │                    │                  │
     │ Sign & submit   │                    │                     │                    │                  │
     │────────────────>│                    │                     │                    │                  │
     │                 │ submit(signed XDR) │                     │                    │                  │
     │                 │──────────────────────────────────────────>│                    │                  │
     │                 │                    │                     │ submit_transaction │                  │
     │                 │                    │                     │───────────────────>│                  │
     │                 │                    │                     │                    │ withdraw() exec  │
     │                 │                    │                     │                    │──────────────────>│
     │                 │                    │  POST /api/v1/vault/│                    │                  │
     │                 │                    │  withdraw (index)   │                    │                  │
     │                 │────────────────────>│                    │                    │                  │
     │                 │                    │  getEvents()        │                    │                  │
     │                 │                    │──────────────────────────────────────────>│                  │
     │                 │                    │                     │<──────────────────── withdraw event   │
     │                 │                    │  Store + notify     │                    │                  │
     │ Confirm         │<───────────────────│ Withdrawal indexed  │                    │                  │
     │<────────────────│                    │                     │                    │                  │
```

### 3.2 Path B — Large Withdrawal with 24-Hour Timelock

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  PHASE 1 — Initiate Large Withdrawal                                                                        │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
USER WALLET        FRONTEND              BACKEND              SOROBAN RPC        VAULT CONTRACT      USDC (SAC)
     │                 │                    │                     │                    │                  │
     │ Enter large     │                    │                     │                    │                  │
     │ shares          │                    │                     │                    │                  │
     │────────────────>│                    │                     │                    │                  │
     │                 │ simulate(withdraw) │                     │                    │                  │
     │                 │──────────────────────────────────────────>│                    │                  │
     │                 │                    │                     │ withdraw(user,shrs)│                  │
     │                 │                    │                     │───────────────────>│                  │
     │                 │                    │                     │                    │                  │
     │                 │                    │                     │   CHECK            │                  │
     │                 │                    │                     │   assets > thresh  │                  │
     │                 │                    │                     │                    │                  │
     │                 │                    │                     │   EFFECTS          │                  │
     │                 │                    │                     │   Lock shares      │                  │
     │                 │                    │                     │   Set unlock_ts =  │                  │
     │                 │                    │                     │   now + 86400      │                  │
     │                 │                    │                     │                    │                  │
     │                 │                    │                     │   EMIT event       │                  │
     │                 │                    │                     │   ("pndwdraw")     │                  │
     │                 │                    │                     │<── return 0        │                  │
     │                 │                    │                     │   (no transfer)    │                  │
     │                 │                    │                     │                    │                  │
     │ 24h notice      │                    │                     │                    │                  │
     │<────────────────│                    │                     │                    │                  │
     │                 │                    │  POST /index pndwdraw                    │                  │
     │                 │────────────────────>│                     │                    │                  │
     │                 │                    │                     │                    │                  │
     │   ... 24 hours passes ...           │                     │                    │                  │
     │                 │                    │                     │                    │                  │
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  PHASE 2 — Execute Withdrawal After Timelock                                                                 │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
     │                 │                    │                     │                    │                  │
     │ Return to claim│                    │                     │                    │                  │
     │────────────────>│                    │                     │                    │                  │
     │                 │ simulate(exec_wd)  │                     │                    │                  │
     │                 │──────────────────────────────────────────>│                    │                  │
     │                 │                    │                     │ execute_withdrawal │                  │
     │                 │                    │                     │───────────────────>│                  │
     │                 │                    │                     │                    │                  │
     │                 │                    │                     │   CHECK            │                  │
     │                 │                    │                     │   pending exists   │                  │
     │                 │                    │                     │   now >= unlock_ts │                  │
     │                 │                    │                     │                    │                  │
     │                 │                    │                     │   EFFECTS          │                  │
     │                 │                    │                     │   Clear pending    │                  │
     │                 │                    │                     │   Update state     │                  │
     │                 │                    │                     │                    │                  │
     │                 │                    │                     │   INTERACT         │                  │
     │                 │                    │                     │                    │ transfer(vault,  │
     │                 │                    │                     │                    │ user, assets)    │
     │                 │                    │                     │────────────────────────────────────>│
     │                 │                    │                     │                    │                  │
     │                 │                    │                     │<────────────────────────────────────│ OK
     │                 │                    │                     │                    │                  │
     │                 │                    │                     │  emit ("withdraw") │                  │
     │                 │                    │                     │                    │                  │
     │ Show USDC recv  │                    │                     │                    │                  │
     │<────────────────│                    │                     │                    │                  │
     │                 │                    │  POST /index withdraw                    │                  │
     │                 │────────────────────>│                     │                    │                  │
     │                 │                    │                     │                    │                  │
```

### 3.3 Withdrawal State Machine

```
IDLE
  │
  ▼ User submits shares
VALIDATING
  │
  ▼
AWAITING_SIGNATURE
  │
  ▼ User signs
SUBMITTING
  │
  ├── assets <= threshold ──► CONFIRMING ──► CONFIRMED
  │                            (~5 s ledger)   └─ withdraw event
  │                                             └─ USDC transferred
  │
  └── assets > threshold ──► TIMELOCK_PENDING
                               └─ pndwdraw event
                               └─ shares locked
                               │
                               ▼ 24 hours
                             TIMELOCK_READY
                               │
                               ▼ User calls execute_withdrawal
                             CONFIRMING ──► CONFIRMED
                                            └─ withdraw event
                                            └─ USDC transferred
```

### 3.4 Withdrawal Saga (Backend Partial-Failure Recovery)

The backend journals withdrawals through a saga to handle failures after on-chain submission succeeds but database/notification updates fail:

```
START
  │
  ├── INITIATED ──► PENDING_CONFIRMATION ──► CONFIRMED
  │                      │                        │
  │                      ▼                        ▼
  │                 RETRY_SYNC              NOTIFICATIONS_SENT
  │                      │                        │
  │                      ▼                        ▼
  │                 ESCALATED                COMPLETED
  │
  └── FAILED (pre-submission)
         └─ Rejected by validation/contract
```

---

## 4. Yield Accrual & Distribution Flow

### 4.1 Flow Diagram

```
                  ┌─────────────────────────────────────────────────────────┐
                  │   YIELD ACCRUAL PATHS                                   │
                  │                                                         │
                  │  Path A: BENJI Strategy (push)                          │
                  │  ┌──────────────────┐    ┌────────────────────────┐    │
                  │  │  BENJI Fund      │───>│  report_benji_yield()  │    │
                  │  │  generates yield │    │  (strategy callback)   │    │
                  │  └──────────────────┘    └───────────┬────────────┘    │
                  │                                      │                  │
                  │  Path B: Korean Debt (pull)          │                  │
                  │  ┌──────────────────┐    ┌────────────────────────┐    │
                  │  │  Admin/Backend   │───>│  accrue_korean_debt_  │    │
                  │  │  triggers        │    │  yield()              │    │
                  │  └──────────────────┘    └───────────┬────────────┘    │
                  │                                      │                  │
                  │  Path C: Manual Yield (admin)        │                  │
                  │  ┌──────────────────┐    ┌────────────────────────┐    │
                  │  │  Admin           │───>│  accrue_yield(amount)  │    │
                  │  └──────────────────┘    └───────────┬────────────┘    │
                  │                                      │                  │
                  └──────────────────────────────────────┼──────────────────┘
                                                         │
                                                         ▼
                              ┌────────────────────────────────────────────┐
                              │  YieldVault Contract                      │
                              │                                            │
                              │  1. Deduct protocol fee (fee_bps)         │
                              │     fee = yield * fee_bps / 10000          │
                              │     treasury_balance += fee                │
                              │                                            │
                              │  2. Add net yield to total_assets          │
                              │     total_assets += (yield - fee)          │
                              │     (total_shares unchanged)               │
                              │                                            │
                              │  3. Share price increases automatically    │
                              │     share_price = total_assets / total_shs │
                              │                                            │
                              │  4. Event emitted                          │
                              └────────────────────────────────────────────┘
                                                         │
                                                         ▼
                              ┌────────────────────────────────────────────┐
                              │  Backend Event Polling                     │
                              │                                            │
                              │  1. Poll getEvents() for yield events      │
                              │  2. Update APY cache                       │
                              │  3. Update vault metrics in DB             │
                              │  4. Trigger APY snapshot if scheduler      │
                              │  5. Notify users via email/webhook         │
                              └────────────────────────────────────────────┘
```

### 4.2 Share Price Impact

```
Before yield:  share_price = total_assets / total_shares
After yield:   total_assets += net_yield
               total_shares unchanged
               share_price increases for ALL depositors proportionally
```

### 4.3 APY Snapshot Flow

```
APY_SNAPSHOT_SCHEDULER (backend background job)
  │
  ├── On interval (APY_SNAPSHOT_INTERVAL_MS)
  │     │
  │     ├── Read total_assets from vault contract
  │     ├── Read historical total_assets from DB
  │     ├── Calculate period APY
  │     ├── Store APY snapshot in PostgreSQL
  │     └── Update Prometheus gauge
  │
  └── On new deposit/withdraw event
        │
        ├── Recalculate share price
        ├── Update rolling APY window
        └── Update Redis cache
```

---

## 5. Strategy Management Flow

### 5.1 Strategy Lifecycle

```
                    ┌──────────────────────────────────────────────────┐
                    │  STRATEGY LIFECYCLE                               │
                    │                                                   │
                    │  1. Whitelist Strategy                            │
                    │     Admin calls whitelist_strategy(address, true) │
                    │                                                   │
                    │  2. Set Active Strategy                           │
                    │     Admin calls set_strategy(address)             │
                    │     (must be whitelisted)                         │
                    │                                                   │
                    │  3. Investment (idle → strategy)                  │
                    │     Admin calls invest(amount)                    │
                    │     Vault approves + deposits to strategy         │
                    │                                                   │
                    │  4. Yield Generation (on strategy side)           │
                    │     BENJI: Strategy calls report_benji_yield()    │
                    │     Korean: Admin calls accrue_korean_debt_yield()│
                    │                                                   │
                    │  5. Divestment (strategy → idle)                  │
                    │     Admin calls divest(amount)                    │
                    │     Strategy returns tokens to vault              │
                    │                                                   │
                    │  6. Strategy Change                               │
                    │     Admin divests from old strategy               │
                    │     Sets new strategy                             │
                    │     Invests into new strategy                     │
                    └──────────────────────────────────────────────────┘
```

### 5.2 Strategy Connector Interface

```
StrategyTrait (contracts/vault/src/strategy.rs)
  ├── deposit(amount)        — Move funds into strategy
  ├── withdraw(amount)       — Recall funds from strategy
  ├── total_value()          — Get current strategy NAV
  └── asset()                — Get underlying token address

Implementations:
  ├── BenjiStrategy          — BENJI fund token (test-only)
  └── MockKoreanSovereignStrategy — Korean debt with stepped yield curve
```

---

## 6. Governance & DAO Flow

### 6.1 Proposal Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  GOVERNANCE FLOW                                                            │
│                                                                             │
│  1. CREATE PROPOSAL                                                         │
│     Any user calls create_strategy_proposal(proposer, strategy_address)     │
│     └─ New Proposal created with ID, proposer, target strategy              │
│                                                                             │
│  2. VOTING PERIOD                                                           │
│     Users call vote_on_proposal(voter, proposal_id, support, weight)        │
│     └─ Vote recorded (support/oppose, with weight)                          │
│                                                                             │
│  3. EXECUTION                                                               │
│     Anyone calls execute_strategy_proposal(proposal_id)                     │
│     └─ If votes >= dao_threshold, strategy is set                           │
│                                                                             │
│  4. ADMIN OVERRIDE                                                          │
│     Admin can directly call set_strategy() (no vote needed)                 │
│     └─ Direct strategy assignment bypasses DAO                              │
│                                                                             │
│  STORAGE:                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  DaoThreshold   — Weighted voting quorum threshold                  │   │
│  │  ProposalNonce  — Auto-incrementing proposal ID counter             │   │
│  │  Proposal(id)   — StrategyProposal { proposer, strategy, executed } │   │
│  │  Vote(id, addr) — VoteRecord { support: bool, weight: i128 }       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Event & Notification Flow

### 7.1 On-Chain Events

| Event | Triggered By | Data | Consumed By |
|---|---|---|---|
| `deposit` | `deposit()` succeeds | amount, shares_minted | Backend poller, webhooks, analytics |
| `withdraw` | `withdraw()` or `execute_withdrawal()` | assets_returned, shares_burned | Backend poller, webhooks |
| `pndwdraw` | Large withdrawal initiated | shares, unlock_timestamp | Backend poller, timelock tracker |
| `feechg` | `set_fee_bps()` | old_bps, new_bps | Backend config updater |
| `mindepchg` | `set_min_deposit()` | old_min, new_min | Backend config updater |

### 7.2 Event Consumption Pipeline

```
SOROBAN LEDGER
     │
     ▼
BACKEND EVENT POLLING SERVICE (EVENT_POLL_INTERVAL_MS = 10s)
     │
     ├── getEvents(contractId, cursor) → [Event]
     │
     ├── For each event:
     │     │
     │     ├── Parse event type and data
     │     ├── Store in PostgreSQL (events table)
     │     ├── Update user balances/cache
     │     │
     │     ├── If deposit/withdraw event:
     │     │     ├── Trigger webhook delivery (if webhook configured)
     │     │     ├── Send email notification (if email enabled)
     │     │     └── Update APY snapshot
     │     │
     │     ├── If pndwdraw event:
     │     │     ├── Schedule timelock expiry check
     │     │     └── Notify user of pending withdrawal
     │     │
     │     ├── If feechg/mindepchg event:
     │     │     ├── Update backend config cache
     │     │     └── Log admin audit trail
     │     │
     │     └── Update cursor for next poll
     │
     └── On failure:
           └── Retry with exponential backoff (SOROBAN_MAX_RETRIES)
```

### 7.3 Off-Chain Notification Flows

```
EVENT DETECTED ──> Backend processes event
                      │
                      ├── Email Notification
                      │     └── EmailService.send(event_type, user_data)
                      │           └── Resend/SendGrid API
                      │
                      ├── Webhook Delivery
                      │     └── WebhookDelivery.deliver(event, subscriber_url)
                      │           ├── Sign payload with HMAC
                      │           ├── POST to subscriber URL
                      │           └── Retry on failure (WEBHOOK_MAX_ATTEMPTS=3)
                      │
                      └── Cache Update
                            └── RedisCache.set(key, data, ttl)
                                  └── Update vault summary, metrics, APY
```

---

## 8. Admin Operations & Maintenance Flow

### 8.1 Admin Function Map

```
ADMIN (authorized by admin address on contract)
  │
  ├── Contract Management
  │     ├── propose_admin(new_admin)       — Two-step transfer
  │     ├── accept_admin()                 — Accept pending admin
  │     ├── upgrade(new_wasm_hash)         — WASM upgrade
  │     ├── pause() / unpause()            — Emergency pause/resume
  │
  ├── Strategy Management
  │     ├── whitelist_strategy(addr, bool) — Whitelist control
  │     ├── set_strategy(addr)             — Set active strategy
  │     ├── invest(amount)                 — Move funds to strategy
  │     ├── divest(amount)                 — Recall funds from strategy
  │     ├── accrue_korean_debt_yield()     — Harvest Korean debt yield
  │     ├── accrue_yield(amount)           — Manual yield accrual
  │
  ├── Protocol Configuration
  │     ├── set_fee_bps(new_bps)           — Fee rate (0–10000)
  │     ├── set_treasury(address)          — Treasury address
  │     ├── set_min_deposit(amount)        — Minimum deposit
  │     ├── set_large_withdrawal_threshold — Timelock threshold
  │     ├── set_per_user_cap(amount)       — Deposit cap per user
  │     ├── set_dao_threshold(threshold)   — Voting threshold
  │
  ├── RWA Shipment Tracking
  │     ├── add_shipment(id, status)       — Add new shipment
  │     └── update_shipment_status(id, st) — Update status
  │
  ├── Oracle Configuration (future)
  │     ├── set_price_oracle(address)
  │     ├── set_oracle_enabled(bool)
  │     └── set_oracle_heartbeat(seconds)
  │
  └── Backend Admin API (separate from contract)
        ├── POST /admin/api-keys/register  — API key management
        ├── POST /admin/cache/flush        — Cache invalidation
        ├── GET  /admin/audit-log          — Audit trail query
        ├── POST /admin/maintenance/on     — Maintenance mode
        └── GET  /admin/health/details     — Deep health check
```

### 8.2 Maintenance Mode Flow

```
BACKEND MAINTENANCE MODE
  │
  ├── MAINTENANCE_MODE_ENABLED=true
  │     └── All API routes return 503 with Retry-After header
  │
  ├── MAINTENANCE_WINDOW_POLL_MS interval
  │     └── Check if maintenance window active
  │
  └── Admin can toggle via /admin/maintenance/on|off
```

### 8.3 Database Backup Flow

```
DB_BACKUP_SCHEDULER (runs at BACKUP_SCHEDULE_HOUR_UTC daily)
  │
  ├── 1. Dump PostgreSQL database
  ├── 2. Compress dump
  ├── 3. Upload to S3 (BACKUP_S3_BUCKET / BACKUP_S3_PREFIX)
  ├── 4. Prune old backups (older than BACKUP_RETENTION_DAYS)
  ├── 5. Send alert on failure (Slack / Email)
  └── 6. Log completion
```

---

## 9. Infrastructure & Service Dependencies

### 9.1 Service Dependency Graph

```
                         ┌──────────────────────┐
                         │   Smart Contracts    │
                         │   (Rust + Soroban)   │
                         │   Independent build  │
                         └──────────────────────┘

                         ┌──────────────────────┐
                         │   Stellar Soroban    │
                         │   RPC Endpoint       │◄──── External Service
                         └──────────────────────┘
                              ▲            ▲
                              │            │
                    ┌─────────┴──┐    ┌────┴──────────┐
                    │  Backend   │    │   Frontend    │
                    │  API       │    │   (React)     │
                    │  (Node.js) │    └────▲──────────┘
                    └──────┬─────┘         │
                           │               │
                    ┌──────┴─────┐         │
                    │  Backend   │─────────┘
                    │  (reads)   │
                    └──────┬─────┘
                           │
              ┌────────────┴────────────┐
              │                         │
     ┌────────┴──────┐        ┌────────┴──────┐
     │  PostgreSQL   │        │    Redis      │
     │  (main DB)    │        │   (cache)     │
     └───────────────┘        └───────────────┘
```

### 9.2 Startup Order

```
LEVEL 0 (No Dependencies)
  ├── PostgreSQL (port 5432)
  └── Redis (port 6379)

LEVEL 1 (Depends on Level 0)
  └── Backend API (port 3000)
        └── depends on PostgreSQL, Redis, Stellar RPC

LEVEL 2 (Depends on Level 1)
  ├── Frontend (port 5173)
  │     └── depends on Backend API, Stellar RPC
  └── Smart Contracts (independent)
        └── depends on Rust toolchain
```

### 9.3 Port Allocation

| Service | Port | Protocol |
|---|---|---|
| PostgreSQL | 5432 | TCP |
| Redis | 6379 | TCP |
| Backend API | 3000 | HTTP |
| Frontend (dev) | 5173 | HTTP |
| Prisma Studio | 5555 | HTTP |
| Stellar RPC | 443 | HTTPS |

---

## 10. Security Boundaries & Trust Model

### 10.1 Trust Boundaries

```
┌─────────────────────────────────────────────────────────────────────┐
│  TRUST BOUNDARY 1: User ↔ Frontend (untrusted)                      │
│  ────────────────────────────────────────────────────────────────── │
│  - User's browser runs frontend code                                │
│  - No secrets in VITE_* vars (embedded in bundle)                   │
│  - All sensitive operations require Freighter signature             │
└─────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  TRUST BOUNDARY 2: Frontend ↔ Backend API (authenticated)           │
│  ────────────────────────────────────────────────────────────────── │
│  - JWT-based authentication                                         │
│  - Rate limiting per endpoint type                                  │
│  - CORS-restricted origins                                          │
│  - Payload size limits per route                                    │
│  - Geofencing (optional)                                            │
│  - Adaptive throttle for abuse detection                            │
└─────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  TRUST BOUNDARY 3: Backend ↔ Database/Cache (internal network)      │
│  ────────────────────────────────────────────────────────────────── │
│  - PostgreSQL with SSL in production                                │
│  - Redis with TLS in production (rediss://)                         │
│  - Connection pooling with timeouts                                 │
│  - Query timeout enforcement                                        │
└─────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  TRUST BOUNDARY 4: Backend ↔ Stellar Network (external)             │
│  ────────────────────────────────────────────────────────────────── │
│  - RPC calls via SorobanClient with retry/backoff                   │
│  - Circuit breaker for RPC failures                                 │
│  - Retry budget to limit retry amplification                        │
│  - Idempotency keys to prevent duplicate submissions                │
└─────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  TRUST BOUNDARY 5: Contract ↔ External Strategies (trusted)         │
│  ────────────────────────────────────────────────────────────────── │
│  - Only whitelisted strategies can callback                          │
│  - CEI pattern prevents reentrancy                                   │
│  - Soroban atomic execution model                                   │
│  - Two-step admin transfer                                         │
└─────────────────────────────────────────────────────────────────────┘
```

### 10.2 Authorization Matrix

| Role | Can Access | Cannot Access |
|---|---|---|
| **User** | Deposit, withdraw (own funds), vote, query | Admin functions, other users' funds |
| **Admin** | All contract admin functions, backend admin API | User funds directly (CEI pattern enforced) |
| **Strategy** | `report_benji_yield()` callback only | Other contract functions |
| **Public** | Query functions, `execute_strategy_proposal()` | State-modifying operations |
| **Backend** | Read events, submit transactions via user signatures | Move funds without authorization |

### 10.3 Critical Security Mechanisms

| Mechanism | Where | Purpose |
|---|---|---|
| CEI Pattern | Vault contract | Prevent reentrancy |
| Soroban Atomic Model | Network level | Prevent state inconsistency |
| Two-step admin transfer | Vault contract | Prevent accidental admin loss |
| Pause mechanism | Vault contract | Emergency stop |
| Rate limiting | Backend middleware | Prevent API abuse |
| JWT authentication | Backend middleware | API access control |
| Payload limits | Backend middleware | Prevent oversized requests |
| Adaptive throttle | Backend middleware | Detect anomalous behavior |
| Geofencing | Backend middleware | Regional access control |
| Circuit breaker | Backend service | RPC failure isolation |
| Retry budget | Backend service | Prevent retry storms |
| Idempotency keys | Backend middleware | Duplicate request prevention |
| Signature verification | Contract level | Authenticate user actions |
| Webhook HMAC signing | Backend service | Authenticate webhook payloads |
| OpenTelemetry tracing | Backend service | Audit trail and debugging |
| Admin audit log | Backend service | Track admin actions |

---

## 11. State Machine Reference

### 11.1 Vault Contract State

```
UNINITIALIZED
     │
     ▼ initialize(admin, token)
ACTIVE
     │
     ├── pause()
     │     └── PAUSED
     │           └── unpause()
     │                 └── ACTIVE
     │
     ├── propose_admin(new_admin)
     │     └── ADMIN_PENDING
     │           └── accept_admin()
     │                 └── ACTIVE (new admin)
     │
     └── upgrade(new_wasm_hash)
           └── UPGRADING (proxy swap)
                 └── ACTIVE (new implementation)
```

### 11.2 Withdrawal State Machine

```
IDLE ──> VALIDATING ──> AWAITING_SIGNATURE ──> SUBMITTING
                                                   │
                                        ┌──────────┴──────────┐
                                        │                     │
                                   assets <= threshold    assets > threshold
                                        │                     │
                                   CONFIRMING           TIMELOCK_PENDING
                                        │                     │
                                   CONFIRMED           TIMELOCK_READY
                                                            │
                                                      CONFIRMING
                                                            │
                                                      CONFIRMED
```

### 11.3 Governance Proposal State Machine

```
DRAFT (proposal created)
  │
  └── VOTING_OPEN (users vote)
        │
        ├── votes >= threshold ──> EXECUTABLE
        │                              │
        │                              └── execute_strategy_proposal()
        │                                    └── EXECUTED / strategy set
        │
        └── votes < threshold ──> REJECTED (no execution possible)
```

### 11.4 RWA Shipment State Machine

```
IN_TRANSIT
  │
  ├── update_shipment_status → INSPECTION
  │                              │
  │                              ├── → QUALITY_CHECK
  │                              │        │
  │                              │        └── → DELIVERED
  │                              │
  │                              └── → CUSTOMS
  │                                       │
  │                                       └── → DELIVERED
  │
  ├── update_shipment_status → DELIVERED
  │
  └── update_shipment_status → CANCELLED
```

---

## Related Documents

| Document | Content |
|---|---|
| `docs/CONTRACTS_ARCHITECTURE.md` | Full contract interface, storage layout, 12 sections |
| `docs/DEPOSIT_WITHDRAWAL_LIFECYCLE.md` | Sequence diagrams for deposit/withdraw mermaid flows |
| `docs/ENV_VARIABLE_MATRIX.md` | Complete env var reference by service |
| `docs/SERVICE_DEPENDENCY_MATRIX.md` | Infrastructure dependencies, startup order |
| `docs/THREAT_MODEL.md` | Security threat model and trust boundaries |
| `docs/DEPLOYMENT.md` | Deployment procedures |
| `docs/SECURITY_CHECKLIST.md` | Security review checklist |
| `docs/VAULT_LIFECYCLE_AUDIT_LOG.md` | Audit event catalog |
| `backend/docs/WITHDRAWAL_PARTIAL_FAILURE_RECOVERY.md` | Withdrawal saga state machine |
| `docs/recovery.md` | Stranded funds operational recovery procedures (admin vs. subscriber) |
| `docs/runbooks/CONTRACT_UPGRADE_PLAYBOOK.md` | Contract upgrade runbook |
| `ARCHITECTURE_SUMMARY.md` | Architecture deliverables summary |

---

**Document Version:** 1.0  
**Created:** July 28, 2026  
**Covers:** YieldVault RWA v22.0.0 (Soroban SDK)  
**Related Issue:** [#1053](https://github.com/Junirezz/YieldVault-RWA/issues/1053)
