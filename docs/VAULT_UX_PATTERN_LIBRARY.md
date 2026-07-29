# Vault UX Pattern Library

> **Last Updated:** 2026-07-24

This document defines the approved frontend UX patterns for vault-specific interactions in YieldVault-RWA. It is the source of truth for deposit, withdrawal, allowance approval, transaction confirmation, loading, and recovery states.

Use this guide when changing existing vault flows or building new vault-facing components.

---

## Goals

- Keep deposit and withdrawal flows predictable across surfaces.
- Prevent unsafe signing by requiring explicit review of sensitive actions.
- Make asynchronous vault state understandable while optimistic updates and refetches are in flight.
- Preserve accessibility, keyboard flow, and recoverability during multi-step interactions.

---

## Scope

This library applies to:

- `frontend/src/components/VaultDashboard.tsx`
- `frontend/src/components/TransactionConfirmationModal.tsx`
- `frontend/src/hooks/useVaultMutations.ts`
- Any future component that starts, reviews, confirms, or reports vault transactions

This library does not replace:

- [`docs/FRONTEND_STATE_MANAGEMENT.md`](./FRONTEND_STATE_MANAGEMENT.md) for ownership of state
- [`docs/focus-management-pattern.md`](./focus-management-pattern.md) for focus and dialog rules
- [`docs/DEPOSIT_WITHDRAWAL_LIFECYCLE.md`](./DEPOSIT_WITHDRAWAL_LIFECYCLE.md) for protocol sequence details

---

## Core Principles

1. One primary transaction surface. Deposit and withdrawal actions should live in a single vault transaction shell instead of competing modals or duplicate forms on the same page.
2. Step-based progression. Vault actions must move through `amount -> review -> result`. Do not skip review for production actions.
3. Explicit user confirmation before signing. Sensitive actions must show a confirmation surface with action, amount, fees, network, and contract details.
4. Progressive disclosure. Show basic inputs first, then fees, approvals, slippage, and warnings when they become relevant.
5. Recover without context loss. Validation errors return the user to the amount step with their prior input preserved.
6. Optimistic but honest state. Immediate UI updates are allowed, but pending status must remain visible until server truth arrives.

---

## Canonical Flow

All vault interactions should follow this sequence:

1. User selects `Deposit` or `Withdraw`.
2. User enters an amount in the amount step.
3. Inline validation runs before review is unlocked.
4. Review step summarizes amount, protocol fee, network fee, and any action-specific controls.
5. If deposit approval is required, approval happens before final action confirmation.
6. User confirms through the secure confirmation modal before wallet signing proceeds.
7. UI enters a pending state and applies optimistic cache updates.
8. Result step shows success or failure with a clear recovery action.

Do not introduce alternate one-click flows for the same operation unless there is a separately approved security review.

---

## Surface Structure

### 1. Transaction Shell

Use a single card or panel that owns:

- current action tab
- current wizard step
- form state
- pending state
- success or failure result state

Approved pattern:

- Tabs switch between `deposit` and `withdraw`
- Step indicator remains visible across all steps
- Switching tabs should not create a second independent transaction flow

### 2. Amount Step

The amount step should contain:

- one primary numeric amount input
- available balance context
- quick actions such as `MAX` when supported
- immediate inline validation
- estimated protocol fee and net amount preview
- one primary CTA: `Review Transaction`

Rules:

- Disable the primary CTA when the wallet is disconnected, input is empty, validation fails, or the vault cannot accept the action. The CTA's disabled state must be computed against the full validation schema on every value change (live), not only from errors already surfaced by a blurred/touched field — the user should never be able to reach review with an invalid amount just because they haven't blurred the field yet.
- Inline field errors appear once a field has been blurred (or once the user has attempted to advance), and continue to revalidate live as the user keeps typing so they clear as soon as the value becomes valid.
- Validation messages should appear inline and also be summarized via toast only when the user tries to advance with invalid input.
- Advancing to review must re-run full validation (`validateAll`) and block the transition if invalid, independent of whether the CTA happened to be enabled — this is a defense-in-depth check, not just a UI affordance.
- If a deep link pre-fills the amount, the value may be hydrated from the URL, but the URL should not trap the user in a stale step.

### 3. Review Step

The review step is mandatory for deposit and withdrawal.

It should show:

- action type
- entered amount
- protocol fee
- network fee
- resulting net amount
- action-specific warnings
- action-specific controls such as slippage or approval

Rules:

- Keep the review content static enough for users to verify what they are about to sign.
- Warnings must appear above the final confirmation CTA.
- The user must be able to navigate back to the amount step unless a transaction is already in flight.

### 4. Result Step

The result step should show:

- clear success or failure iconography
- one-sentence outcome
- one recovery action

Approved actions:

- Success: `Done`
- Failure: `Try Again`

Rules:

- Failure copy should describe the actual problem when known.
- Returning from a failure should preserve enough context for the user to fix the issue quickly.

---

## Action-Specific Rules

### Deposit

- Deposits must respect minimum amount validation, vault cap state, wallet balance, and network fee availability.
- If token approval is required, show it in the review step as a distinct prerequisite before final confirmation.
- Approval state should be visually separate from final deposit execution.
- When the vault is at or near capacity, surface a warning before the user reaches signing.

Approved approval sequence:

1. User enters deposit amount.
2. Review step indicates approval is required.
3. User completes approval.
4. Final deposit CTA becomes enabled.
5. Secure confirmation modal appears before signing the deposit.

### Withdraw

- Withdrawals must show the estimated net amount and any slippage settings that can materially affect proceeds.
- High slippage must be surfaced as a warning, not buried in supporting text.
- If network fee or other constraints make completion unlikely, warn before opening the signing flow.

---

## Confirmation Modal Rules

The secure confirmation modal is required for all sensitive vault actions.

It must show:

- action name
- amount
- asset
- network
- estimated fee
- full contract address
- verified or unverified contract status
- warning callouts for unusual amount, unusual fee, or unknown contract

Rules:

- Never truncate the contract address in the confirmation view.
- Provide a copy action for the contract address.
- Backdrop click must not dismiss the modal.
- Escape may dismiss the modal only as an explicit cancel path.
- Confirmation copy must clearly state that the action cannot be reversed once signed.

This modal should be the final human-readable checkpoint before wallet signing.

---

## Allowance And Prerequisite Pattern

Allowance approval is a prerequisite state, not a silent side effect.

Rules:

- Show approval as a numbered or clearly sequenced sub-step inside review.
- Keep approval status visible: idle, pending, confirmed, failed.
- Final deposit confirmation must remain disabled until approval succeeds.
- Approval success should be acknowledged with lightweight feedback, such as a toast.
- Approval failure should not discard the entered amount or force the user out of review.

---

## Loading, Pending, And Optimistic States

Vault interactions are asynchronous and must distinguish between these states:

- `loading`: the screen is fetching initial or refreshed data
- `pending`: the user has submitted an action and completion is in progress
- `stale`: the last known data is visible, but refresh freshness is degraded
- `optimistic`: local cache reflects the expected result before server confirmation

### Loading skeletons (vault pages)

Use contextual skeletons from `frontend/src/components/Skeleton.tsx` instead of blank panels:

| Surface | Skeleton |
| --- | --- |
| Vault dashboard cards / stats | `DashboardCardSkeleton`, `VaultStatSkeleton`, `SharePriceSkeleton` |
| Charts | `ChartSkeleton` |
| Portfolio summary | `PortfolioCardSkeleton` |
| Transaction rows / tables | `TransactionRowSkeleton`, `TableSkeleton` |
| Analytics widgets | `AnalyticsWidgetSkeleton` |
| Lazy route fallback | `RouteLoadingFallback` |

Rules:

- Mark loading regions with `aria-busy="true"` and keep `aria-hidden` on decorative skeleton chrome.
- Prefer delayed loading (`useDelayedLoading`) for short fetches to avoid skeleton flash.
- Do not show empty-state CTAs while `isLoading` is true.

### Empty states (vault pages)

Use `frontend/src/components/ui/EmptyState` with an explicit `kind`:

- `no-data` — wallet connected, no deposits/positions yet (offer deposit intent)
- `no-results` / `search` — filters returned nothing (offer reset filters)
- `permission` — wallet disconnected or access required
- `error` — fetch failed after retries (offer retry)

Rules:

- Pending transactions must disable duplicate submission.
- Show a spinner or processing label on the final CTA during submission.
- Optimistically updated balances, holdings, TVL, and transaction lists must mark new entries as pending until refetch completes.
- If optimistic updates fail at the network or server layer, revert cached values and show a failure result.
- Stale data indicators should appear near the affected panel, not only in a global banner.

---

## Error Handling Pattern

Error handling should be layered:

1. Field-level validation errors stay attached to the relevant input.
2. Action-level failures appear in the result step and in toast feedback.
3. Data-fetch failures for vault metrics appear in the panel through an inline status banner.

Rules:

- Map backend validation failures back to field errors whenever possible.
- Do not collapse all failures into a generic toast if the UI can point to the exact fix.
- When the failure blocks completion after review, route the user to the result step unless they need to correct a specific field immediately.
- Retry paths should be obvious and should not require re-entering unchanged values.

---

## URL And Event Integration

Vault flows may be opened from deep links or external UI triggers, but the interaction rules stay the same.

Approved patterns:

- URL state may set the initial tab, step, or prefilled amount.
- Global events may move focus into the transaction input for `deposit` or `withdraw`.

Rules:

- URL-driven state must remain shareable and recoverable.
- External triggers may focus the amount input, but must not bypass review or confirmation.
- Cleanup URL params that would otherwise reopen one-time actions on refresh.

---

## Accessibility Rules

Vault interaction components must follow the shared focus management guidance and add these vault-specific rules:

- Keep one logical primary heading per page.
- Preserve keyboard order across tabs, amount entry, review controls, and final actions.
- All confirmation overlays must trap focus and restore focus on close.
- Warning states cannot rely on color alone; pair color with iconography or text.
- Action buttons must use explicit labels such as `Review Transaction`, `Approve USDC`, and `Confirm deposit`.

---

## Content And Copy Rules

- Use `deposit` and `withdraw` as the canonical action labels.
- Use `USDC` for the asset label unless a multi-asset vault is explicitly introduced.
- Prefer concrete copy over generic reassurance.
- Fee copy must distinguish protocol fee from network fee.
- Success copy should state what happened.
- Failure copy should state what blocked completion and what the user can do next.

Avoid:

- ambiguous labels like `Continue`
- hidden prerequisites
- multiple primary CTAs in the same step
- modal stacks for the same vault action

---

## Do And Don't

### Do

- Keep deposit and withdrawal in one transaction shell.
- Require review before signing.
- Surface approval as an explicit prerequisite.
- Mark optimistic transaction rows as pending.
- Show stale data inline where it matters.

### Don't

- Submit directly from the amount field.
- Hide fees until after signing starts.
- Auto-dismiss critical warnings before the user acts.
- Open a second confirmation modal for the same action path.
- Clear user input on recoverable errors.

---

## Implementation Checklist

- [ ] Uses the shared `amount -> review -> result` vault flow
- [ ] Blocks progress on validation failures
- [ ] Shows protocol fee and network fee before signing
- [ ] Requires approval before final deposit submission when needed
- [ ] Uses the secure confirmation modal for sensitive actions
- [ ] Prevents duplicate submissions while pending
- [ ] Applies optimistic updates with visible pending status
- [ ] Reverts optimistic state on failure
- [ ] Preserves focus and keyboard flow for all overlays
- [ ] Preserves user input across recoverable failures

---

## Current Reference Implementation

The current approved implementation lives in:

- `frontend/src/components/VaultDashboard.tsx`
- `frontend/src/components/TransactionConfirmationModal.tsx`
- `frontend/src/hooks/useVaultMutations.ts`
- `frontend/src/lib/optimisticVaultCache.ts` (snapshot / apply / rollback helpers)

Optimistic deposit and withdrawal patches credit or debit wallet USDC in opposite directions, mark holdings and pending transaction rows as `pending`, and restore the pre-mutation snapshot when the network or contract call fails. Settled mutations always invalidate related React Query keys so the UI converges on server truth.

If a future implementation intentionally diverges from this library, update this document in the same change set and explain the reason in the pull request.
