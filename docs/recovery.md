# Stranded Funds Recovery: Operational Sequences & Specification

**Issue Reference:** [os630800-sb33/0b33](https://github.com/os630800-sb33/0b33)  
**Area:** Documentation  
**Related Modules:** `contracts/vault/src/emergency_rescue.rs`, `contracts/vault/src/emergency.rs`, `contracts/vault/src/recovery_sequence.rs`, `backend/src/withdrawalRecovery.ts`

---

## 1. Overview & Concept of Stranded Funds

In a decentralized vault and subscription billing architecture built on Stellar (Soroban), funds may become **stranded** (trapped, inaccessible, or unallocated) under specific failure modes or lifecycle transitions.

### 1.1 What Constitutes Stranded Funds?

Funds in the contract are classified as stranded under three distinct conditions:

1. **Unallocated / Cancelled Subscriber Escrow:**
   - Subscribers pre-fund balances or deposit tokens to cover future subscription billing periods.
   - If a subscription is terminated, paused indefinitely, cancelled due to merchant de-listing, or affected by a failed billing cycle, remaining prepaid tokens can become stranded in contract storage without an active schedule to drain or return them.
2. **Partial-Execution & Out-of-Sync Ledger Balances:**
   - Network timeouts, RPC desynchronization, or intermediate transaction failures can cause tokens to move on-chain while the corresponding off-chain ledger or subscription registry fails to record the update.
   - These assets remain held inside the contract account without being attributable to active shares or scheduled charges.
3. **Stray / Unattributed Token Transfers:**
   - Non-vault tokens or tokens sent mistakenly to the contract address (e.g., unintended direct SAC `transfer` calls, airdrops, or decommissioned strategy asset refunds).
   - Under contract safety invariants, the vault's core underlying collateral backing user deposit shares can **never** be treated as stranded stray tokens.

### 1.2 The Two Recovery Paths

To resolve stranded funds safely and prevent single points of failure or unauthorized asset siphoning, the protocol implements two distinct operational paths:

- **Admin-Initiated Recovery:** A privileged operational procedure used by governance or designated emergency administrators to rescue stray/unattributed tokens, sweep abandoned or corrupted subscriber balances, or reconcile contract accounts during an emergency unwind.
- **Subscriber-Initiated Recovery:** A self-service withdrawal mechanism allowing an authenticated subscriber to reclaim their unencumbered, unspent prepaid balances or cancelled subscription deposits directly to their personal wallet.

---

## 2. Admin-Initiated Recovery Path

Admin-initiated recovery is reserved for privileged interventions. It handles contract-level stranded tokens, orphaned subscriber escrows, and operational rescues where the subscriber is unable or inactive.

### 2.1 Scope & Prerequisites

- **Applicability:** Stray non-collateral tokens in the vault address, abandoned subscriber balances after grace periods, or disaster recovery rebalancing.
- **Preconditions:**
  1. The token asset being rescued must **not** be the primary vault underlying asset backing active deposit shares (guarded by `VaultError::RescueUnauthorized`).
  2. The destination wallet address must not be the vault contract itself.
  3. The recovery amount must be strictly positive (`amount > 0`).
  4. Emergency approvers must be configured and distinct.

### 2.2 Required Authentication & Authorization

| Role | Auth Function | Requirement |
|---|---|---|
| **Primary Approver / Admin** | `initiator.require_auth()` | Valid signature from the primary admin or emergency approver address stored under `DataKey::EmergencyApprovers` or `DataKey::Admin`. |
| **Secondary Approver (Dual Auth)** | `confirmer.require_auth()` | If configured for dual-approval emergency action, execution requires confirmation from a distinct secondary key (`primary != secondary`). |
| **Dispute Window Validation** | Ledger Timestamp Check | For dual-approval actions, `ledger.timestamp() >= dispute_deadline` must hold before execution. |

### 2.3 Operational Sequence (Numbered Procedure)

1. **Assess and Quantify Stranded Funds:**
   - Inspect contract storage and on-chain token balances via Soroban RPC:
     ```bash
     soroban contract invoke \
       --id <VAULT_CONTRACT_ID> \
       --source <OPERATOR_IDENTITY> \
       --rpc-url <RPC_ENDPOINT> \
       --network-passphrase "<PASSPHRASE>" \
       -- diagnostics
     ```
   - Query the token contract balance of the vault address for the stray asset to determine the recoverable amount:
     ```bash
     soroban contract invoke \
       --id <STRAY_ASSET_TOKEN_ID> \
       -- balance --id <VAULT_CONTRACT_ID>
     ```

2. **Verify Rescue Eligibility & Preconditions:**
   - Ensure the asset address is not the underlying collateral:
     $$\text{asset} \neq \text{vault\_asset}$$
   - Confirm recipient address is valid and not the contract itself.
   - If recovering orphaned subscriber escrow, ensure the subscriber's subscription status is marked as `Cancelled`, `Expired`, or `Dormant`.

3. **Construct Recovery Request:**
   - Assemble the `RescueRequest` payload:
     - `caller`: Primary approver / admin address
     - `asset`: Address of the stranded token contract
     - `destination`: Designated recovery recipient address (treasury or subscriber refund wallet)
     - `amount`: Exact amount to recover in token units

4. **Initiate Authorization / Proposal:**
   - In single-admin recovery mode: Admin signs and executes the call.
   - In dual-approval emergency mode:
     - Primary approver calls `propose_emergency_action` with `EmergencyActionKind::EmergencyDivest` or `authorize_rescue`.
     - Transaction asserts `initiator.require_auth()`.
     - Dispute timer begins (`dispute_deadline = now + dispute_window`).

5. **Execute Confirmation & Token Transfer:**
   - If dual-approval is enforced, once the dispute window elapses, the secondary approver calls `confirm_emergency_action`.
   - The contract verifies all safety guards (`check_rescue_authorization`):
     - Validates approver identity.
     - Confirms amount is positive.
     - Confirms asset is non-vault collateral.
     - Dispatches transfer from vault address to destination.
   - Contract publishes the complete `RecoveryEvent`.

### 2.4 Expected Events

The transaction emits an explicit on-chain event via `env.events().publish(...)`:

- **Event Topics:**
  - `Topic 0`: `Symbol("recovery")`
  - `Topic 1`: `Symbol("admin")`
  - `Topic 2`: `asset: Address`

- **Event Payload Schema (`RecoveryEvent`):**
  ```rust
  (
      proposal_id: u32,
      initiator: Address,        // Admin/approver address
      subscriber: Option<Address>, // None if stray token, Some(Address) if subscriber balance
      destination: Address,      // Recipient of rescued funds
      asset: Address,            // Token contract address
      amount: i128,              // Amount recovered (asset units)
      timestamp: u64             // Ledger timestamp of execution
  )
  ```

### 2.5 Post-Recovery Verification Steps

1. **Verify Recipient Balance Increase:**
   - Query the destination address balance on the token contract:
     $$\text{balance}_{\text{post}} = \text{balance}_{\text{pre}} + \text{amount}$$
2. **Verify Contract Balance Decrement:**
   - Confirm that the vault contract's held balance of the rescued token decreased by exactly `amount`.
3. **Verify Ledger / Escrow Nullification:**
   - If recovering orphaned subscriber escrow, confirm that the subscriber's recorded stranded balance in contract storage is updated to zero:
     $$\text{subscriber\_stranded\_balance} = 0$$
4. **Audit Log & Event Log Verification:**
   - Retrieve transaction events via Soroban RPC `getEvents` filtered by topic `("recovery", "admin")`.
   - Verify that all fields in `RecoveryEvent` are non-null and match the submitted parameters.
5. **Vault Solvency & Invariant Verification:**
   - Run invariant verification (`check_invariants`):
     - Ensure `total_shares` and `total_assets` for the vault's underlying collateral remain untouched.
     - Share price of core vault depositors must be completely unchanged.

---

## 3. Subscriber-Initiated Recovery Path

Subscriber-initiated recovery is a decentralized, self-service pathway. It empowers subscribers to directly withdraw their unencumbered or stranded prepaid funds without waiting for administrative action or merchant consent.

### 3.1 Scope & Prerequisites

- **Applicability:** Unspent prepaid subscription deposits, over-funded balances, or funds locked in cancelled/lapsed subscriptions.
- **Preconditions:**
  1. The caller must be the authenticated subscriber who deposited the funds.
  2. The subscriber must have a recorded non-zero recoverable balance:
     $$\text{recoverable\_balance} > 0$$
  3. No pending or in-flight billing charge lock is active against the requested funds.
  4. The recovery destination is locked strictly to the caller's authenticated address.

### 3.2 Required Authentication & Authorization

| Role | Auth Function | Requirement |
|---|---|---|
| **Subscriber (Owner)** | `subscriber.require_auth()` | Cryptographic signature from the subscriber's Stellar keypair. |
| **Identity Invariant** | `caller == subscriber == destination` | Rescued funds can **only** be paid out to the authenticated subscriber's wallet. Redirecting funds to a third-party address is rejected. |

### 3.3 Operational Sequence (Numbered Procedure)

1. **Query Available Recoverable Balance:**
   - Subscriber inspects their recoverable balance via contract query or frontend client:
     ```bash
     soroban contract invoke \
       --id <VAULT_CONTRACT_ID> \
       --source <SUBSCRIBER_IDENTITY> \
       --rpc-url <RPC_ENDPOINT> \
       --network-passphrase "<PASSPHRASE>" \
       -- get_recoverable_balance --subscriber <SUBSCRIBER_ADDRESS>
     ```
   - Contract returns `recoverable_amount: i128`.

2. **Verify Preconditions:**
   - Check that `amount <= recoverable_amount` and `amount > 0`.
   - Ensure the subscription status is not in an active billing freeze or dispute state.

3. **Construct and Sign Recovery Transaction:**
   - Subscriber constructs the recovery call:
     - Entrypoint: `recover_stranded_funds` or `claim_stranded_balance`
     - Arguments: `subscriber: Address`, `asset: Address`, `amount: i128`
   - Sign transaction using subscriber wallet (e.g. Freighter, Ledger, or Soroban CLI).

4. **Contract Execution & Authorization Enforcement:**
   - Contract calls `subscriber.require_auth()`.
   - The contract verifies:
     - Caller identity matches `subscriber`.
     - Subscriber balance is sufficient.
     - Asset contract matches the deposited token.
   - Contract deducts the requested `amount` from the subscriber's stored escrow balance:
     $$\text{storage}[\text{SubscriberEscrow}(\text{subscriber})] \leftarrow \text{balance} - \text{amount}$$
   - Contract invokes the SAC / token contract client:
     $$\text{TokenClient::transfer}(\text{vault}, \text{subscriber}, \text{amount})$$

5. **Event Emission:**
   - The contract emits the subscriber recovery event on the Soroban event bus.

### 3.4 Expected Events

The transaction emits an explicit on-chain event via `env.events().publish(...)`:

- **Event Topics:**
  - `Topic 0`: `Symbol("recovery")`
  - `Topic 1`: `Symbol("subscriber")`
  - `Topic 2`: `asset: Address`

- **Event Payload Schema (`RecoveryEvent`):**
  ```rust
  (
      initiator: Address,          // Subscriber address
      subscriber: Address,         // Subscriber address (matches initiator)
      destination: Address,        // Destination address (matches subscriber)
      asset: Address,              // Token contract address
      amount: i128,                // Amount recovered
      remaining_balance: i128,     // Remaining unspent balance
      timestamp: u64               // Ledger timestamp
  )
  ```

### 3.5 Post-Recovery Verification Steps

1. **Verify Subscriber Wallet Credited:**
   - Inspect the subscriber's wallet address token balance on-chain:
     $$\text{balance}_{\text{wallet\_post}} = \text{balance}_{\text{wallet\_pre}} + \text{amount}$$
2. **Verify Subscriber Storage Reset:**
   - Query `get_recoverable_balance(subscriber)`:
     - If full recovery was executed: balance must return `0`.
     - If partial recovery was executed: balance must equal `recoverable_amount - amount`.
3. **Verify Event Integrity:**
   - Verify that `RecoveryEvent` was published with topic `("recovery", "subscriber")` and matching `amount`.
4. **Off-Chain State Sync:**
   - If using the backend indexing service or webhook notification system, verify receipt of `subscriber.funds_recovered` event to update the user UI dashboard.
5. **Contract Solvency Guard:**
   - Total unallocated liabilities in the vault must decrease by `amount`.
   - System invariant holds:
     $$\sum \text{escrow\_liabilities} \le \text{vault\_held\_tokens}$$

---

## 4. Comparison Matrix: Admin vs. Subscriber Recovery

| Dimension | Admin-Initiated Recovery | Subscriber-Initiated Recovery |
|---|---|---|
| **Initiator / Caller** | Primary Approver / Governance Admin | Subscriber (Asset Owner) |
| **Authentication Guard** | `admin.require_auth()` + Dual Approver confirmation | `subscriber.require_auth()` |
| **Target Assets** | Stray/unattributed tokens, abandoned escrows, emergency funds | Unspent prepaid subscription escrows |
| **Destination Restriction** | Treasury, designated refund wallet, or subscriber | Strictly the subscriber's verified address (`destination == subscriber`) |
| **Dispute / Timelock Window** | Subject to emergency dispute window (e.g. 1 hour / 24 hours) | Immediate / atomic execution |
| **Event Topics** | `("recovery", "admin", asset)` | `("recovery", "subscriber", asset)` |
| **Failure Code on Auth Error**| `VaultError::RescueUnauthorized` | `VaultError::RescueUnauthorized` / Soroban Auth Failure |
| **Vault Asset Collateral Protection** | Vault underlying deposit collateral cannot be rescued | Only caller's own deposited balance can be claimed |

---

## 5. Security Safeguards & Error Handling

Both recovery mechanisms enforce strict boundary checks to ensure vault solvency and prevent exploit vectors:

### 5.1 Prevention of Unauthorized Collateral Drain
- In `emergency_rescue.rs`, `check_rescue_authorization` explicitly checks:
  ```rust
  if &request.asset == vault_asset {
      return Err(VaultError::RescueUnauthorized);
  }
  ```
  This ensures admins cannot mistakenly or maliciously rescue the vault's core collateral backing depositor shares under the guise of stranded token rescue.

### 5.2 Destination Hijacking Prevention
- For subscriber-initiated recovery, the destination address is hard-bound to `subscriber.require_auth()`. Attackers cannot submit a transaction claiming another user's stranded escrow to their own wallet.

### 5.3 Fully-Populated Event Guarantee (Issue #14 Fix)
- To resolve issue [#14](https://github.com/os630800-sb33/0b33) where `RecoveryEvent` was previously emitted with incomplete parameters:
  - Both recovery entrypoints require all fields (`initiator`, `subscriber`, `destination`, `asset`, `amount`, `timestamp`) to be fully defined.
  - No empty or dummy values are permitted in event serialization.

### 5.4 Common Error Codes & Mitigations

| Error Code | Trigger Condition | Operational Remediation |
|---|---|---|
| `VaultError::InvalidAmount` | `amount <= 0` | Provide a positive integer amount in asset base units. |
| `VaultError::RescueUnauthorized` | Caller is not an authorized approver or subscriber; or asset is vault collateral | Verify caller authentication key; check asset contract address. |
| `VaultError::GovernanceSignersNotConfigured` | Dual approvers missing or set to identical keys | Configure distinct primary and secondary approvers via governance. |
| `VaultError::DisputeWindowActive` | Secondary approver confirms before dispute timer elapses | Wait until `ledger.timestamp >= dispute_deadline`. |
| `VaultError::InsufficientLiquidity` | Requested amount exceeds available contract balance | Verify available idle token balance in the vault contract. |

---

## 6. Audit & Verification Checklist

Before and after executing either recovery path, operators and subscribers should complete this verification checklist:

- [ ] **Step 1:** Confirm asset contract address and verify whether it is core vault collateral or a stray/escrow token.
- [ ] **Step 2:** Query contract storage for current balance and stranded allocations.
- [ ] **Step 3:** Confirm caller key holds the appropriate authorization (`admin` or `subscriber`).
- [ ] **Step 4:** Execute transaction and capture the transaction hash.
- [ ] **Step 5:** Query transaction events on-chain to verify `RecoveryEvent` is emitted with all fields populated.
- [ ] **Step 6:** Verify destination wallet received the expected token amount.
- [ ] **Step 7:** Verify contract internal accounting decremented the recovered balance.
- [ ] **Step 8:** Run invariant checks (`check_invariants`) to guarantee core vault accounting consistency.
