# Frontend Form Validation

> **Last Updated:** 2026-07-24

This document describes the shared frontend form validation system (`frontend/src/forms/`) and how it is used by the deposit/withdraw wizard in `VaultDashboard.tsx`. It complements [`docs/VAULT_UX_PATTERN_LIBRARY.md`](./VAULT_UX_PATTERN_LIBRARY.md), which defines the wizard's UX rules; this document focuses on the validation *implementation*.

---

## Goals

- Give users feedback on amount input as early and as accurately as possible, without being noisy while they are still typing their first character.
- Guarantee that a transaction amount which passes frontend validation will not be rejected by the API for a *format* reason (decimal precision, scientific notation, etc.).
- Keep the review/confirm step from ever being reachable with an invalid amount, even if the user never blurs the input field.

---

## Why not Zod on the frontend?

The API layer (`packages/api-schemas`, consumed by `backend/`) validates requests with [Zod](https://zod.dev). The frontend forms in this repo intentionally do **not** depend on Zod (or any other schema library). `frontend/src/forms/validate.ts` is a small, dependency-free validator built from plain objects (`ValidationSchema<T>`), so that:

- Fields can be validated synchronously on every keystroke without pulling a schema-parsing runtime into the client bundle.
- Form-specific error copy (e.g. "Minimum deposit is 1.00 USDC.") can reference live values (balances, fee estimates) that don't exist as static schema constraints.

Where a frontend rule mirrors a server-side constraint, the two are kept in sync explicitly (see below) rather than by sharing a schema object.

---

## Amount format: shared with the API

`frontend/src/forms/schemas/amountValidation.ts` defines:

```ts
export const AMOUNT_PATTERN = /^\d+(\.\d{1,7})?$/;
```

This is copied from `AmountSchema` in `packages/api-schemas/src/primitives.ts`, which the backend uses to validate deposit/withdrawal amounts. It requires:

- digits only (no `+`/`-` sign, no leading `.`)
- at most 7 fractional digits (Stellar's stroop precision)
- no scientific notation (`1e5` is rejected)

`parseAmountInput(rawValue: string)` wraps this pattern with the friendlier, incremental checks the UI needs:

1. empty input → `"Amount is required."`
2. not a finite number (`"abc"`, `"NaN"`, `"Infinity"`) → `"Enter a valid number."`
3. zero or negative → `"Amount must be greater than 0."`
4. finite and positive, but not in canonical decimal form (scientific notation, too many decimal places) → a "too many decimal places" format error
5. otherwise → `{ ok: true, amount: <number> }`

Both `depositFormSchema.ts` and `withdrawFormSchema.ts` call `parseAmountInput` first, then layer their own business rules (minimum deposit, balance, vault capacity, XLM fee coverage) on top of the parsed numeric amount. `AMOUNT_PATTERN` and `parseAmountInput` are re-exported from `frontend/src/forms/index.ts` for reuse by other amount inputs.

---

## `useForm` validation lifecycle

`frontend/src/forms/useForm.ts` exposes:

| Field / method | Purpose |
| --- | --- |
| `values`, `setValues` | Current field values. `setValues` accepts a value or updater function and revalidates immediately (see below). |
| `touched` | Which fields the user has blurred at least once. |
| `errors` | Errors gated by `touched` (or, once a submit/`validateAll` has been attempted, shown for every field). |
| `hasAttemptedSubmit` | True once `handleSubmit` or `validateAll` has run at least once. |
| `handleChange` / `handleBlur` | Wire directly to an `<input>`. |
| `validateAll(overrideValues?)` | Validates the whole schema, marks every field touched, sets `hasAttemptedSubmit`, and returns `true`/`false`. |
| `resetErrors` | Clears `errors`, `touched`, and `hasAttemptedSubmit` (e.g. when switching tabs). |

### Revalidation rules

- **Before any blur/submit**: a field shows no error while the user is still typing it for the first time, even if invalid. This avoids flashing an error before the user has finished entering a value.
- **After a field has been blurred**: it revalidates on every subsequent keystroke, so the error clears (or updates) as soon as the value becomes valid, instead of waiting for another blur.
- **After `validateAll` or a submit attempt**: *every* field revalidates live on every keystroke, since the user has already tried to proceed once.
- `setValues` (e.g. a programmatic "MAX" fill) revalidates using the same rules as `handleChange`, so it will not show an error unless the field is already touched or a submit has been attempted.

`validateAll` takes an optional `overrideValues` argument. This exists because calling `setValues(...)` followed immediately by `validateAll()` in the same event handler would otherwise read a stale `values` snapshot (React state updates are asynchronous); passing the just-computed values directly avoids that race. See the "MAX" button handler in `VaultDashboard.tsx` for an example.

---

## How `VaultDashboard.tsx` uses this

- **Balances are tab-specific.** `depositBalance` is the connected wallet's USDC balance; `withdrawBalance` is the sum of `valueUsd` across the user's vault holdings (`usePortfolioHoldings`). The deposit and withdraw schemas are built from the balance that applies to the active tab, and the withdraw schema also receives `xlmBalance`/`feeXlm` so a withdrawal can be blocked if the user can't afford the network fee.
- **Two layers of validation state:**
  - `errors` (from `useForm`) is touched-gated and drives the inline field error (`showInlineError`) shown under the input.
  - `liveValidationErrors` is computed unconditionally on every render (`validate(schema, values)`) and drives whether the primary CTA (`Review Transaction`) is disabled. This means the button is disabled the instant an amount becomes invalid, even before the user blurs the field — the user simply won't see red inline text until they blur or try to advance.
- **`goToReview` calls `validateAll()`.** If the values aren't valid, the wizard never advances to the review step (all fields become touched and their errors become visible), regardless of what `isSubmitDisabled` happened to compute — this is a defense-in-depth check, not just a UI affordance.
- **The `MAX` button** fills the tab-specific balance (`depositBalance` or `withdrawBalance`) and immediately calls `validateAll(nextValues)` with the value it just set, so the CTA state and any inline errors are correct immediately rather than one render behind.
- **Switching tabs** calls `resetErrors()`, clearing `hasAttemptedSubmit`, `touched`, and `errors` so the new tab starts from the "not yet touched" state described above.

---

## Adding a new amount-driven form

1. Reuse `parseAmountInput` for the base numeric/format checks instead of re-deriving `Number(value)` logic.
2. Build a `ValidationSchema<...>` (see `depositFormSchema.ts` / `withdrawFormSchema.ts` for the pattern) rather than validating ad hoc in a component.
3. Use `useForm` for field state; prefer `validateAll()` over manually reading `errors` when gating navigation (e.g. wizard steps) so validity checks stay in sync with what's rendered.
4. If the new rule also exists on the API (`packages/api-schemas`), note the relationship in a comment on both sides, the way `AMOUNT_PATTERN` documents its origin.
