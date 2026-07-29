# YieldVault-RWA — Frontend State Management

> **Last Updated:** 2026-07-24

A shared reference for the frontend state management architecture used across the YieldVault-RWA codebase. The purpose of this document is to clarify state ownership, data fetching boundaries, and UI synchronization patterns to ensure a consistent and maintainable developer experience. 

The frontend heavily relies on **React Context** for global client state and **React Query** (`@tanstack/react-query`) for server state and asynchronous data fetching. There are no external global state stores like Redux or Zustand in this architecture.

---

## Table of Contents

- [State Ownership](#state-ownership)
- [Data Fetching Strategy](#data-fetching-strategy)
- [UI Synchronization Patterns](#ui-synchronization-patterns)
- [Key Contexts](#key-contexts)
- [Key Hooks](#key-hooks)
- [Component Architecture](#component-architecture)
- [State Boundaries & Best Practices](#state-boundaries--best-practices)

---

## State Ownership

State in the YieldVault-RWA frontend is strictly divided into three domains:

1. **Server State (React Query):** External data that requires asynchronous fetching, caching, and background updates. Owned entirely by React Query hooks (e.g., Share Price, USDC Balance, Vault History, Transaction History).
2. **Global Client State (React Context):** UI state and preferences that multiple disparate components need access to. Managed via Context providers (e.g., Wallet Connection/Auth, Theme, Toast Notifications, computed Vault Metrics).
3. **Local Component State (React State):** Ephemeral UI state specific to a single component or view. Handled by `useState` and custom form hooks (e.g., Transaction Wizard steps, input amounts, active tabs).

---

## Data Fetching Strategy

Data fetching is exclusively handled by **React Query**, utilizing custom hooks to encapsulate the query keys, fetch functions, and caching policies.

### Query Client Configuration
The global `QueryClient` is configured with sensible defaults to prevent aggressive refetching and improve the user experience:
- **`refetchOnWindowFocus`**: Disabled for specific queries like `useSharePrice` to avoid unnecessary RPC calls on tab switching.
- **`retry`**: Limited to 1 for most queries to fail fast and display graceful error states to the user.

### Caching and Stale Times
To optimize RPC calls and Horizon API usage, queries have specific `staleTime` configurations based on data volatility:
- **USDC Balance:** `10 seconds` — Balance is critical for transactions but we avoid spamming the RPC (`useUsdcBalance`).
- **Transaction History:** `15 seconds` — Updates frequently as users transact (`useTransactionHistory`).
- **Vault Summary:** `30 seconds` — Vault metrics (TVL, Deposit Cap) update relatively slowly (`useVaultSummary`).
- **Vault History:** `60 seconds` — Historical charting data changes infrequently (`useVaultHistory`).

### Background Polling
Critical real-time metrics use a custom `useQueryWithPolling` wrapper. For example, `useSharePrice` implements a 30-second polling interval (`POLLING_INTERVALS.normal`) that pauses when the window is hidden or the network is offline.

---

## UI Synchronization Patterns

### URL State Synchronization
Complex view state, such as data tables and filters, is synchronized with the URL search parameters. 
- **`useDataTableState`**: Syncs pagination (page, pageSize) and single-column sorting state to the URL.
- **`useTransactionFilters`**: Syncs multi-filter criteria (date ranges, statuses, types) to the URL.
- **`useTransactionSort`**: Syncs the transaction table's multi-column ordering to the URL (`?sort=status:asc,amount:desc`), mirroring the primary key into `useDataTableState`'s legacy `sortBy`/`direction` params so older links keep working. See [Transaction History — Advanced Filter and Sort](../frontend/docs/TRANSACTION_HISTORY_FILTER_SORT.md).
- **Deep Linking**: Components like `VaultDashboard` listen for URL parameters (e.g., `?action=deposit&amount=100`) to automatically pre-fill local state (active tab, input amount) on mount, then clean up the URL to prevent state trapping.

### Client-Side Data Derivation
Instead of relying on backend endpoints for every data permutation, raw data is fetched via React Query and heavily processed client-side:
- **Vault Metrics**: `VaultContext` consumes raw `useVaultSummary` and `useVaultHistory` data, computes the active APY and Vault Utilization, and provides these derived metrics to all dashboard components.
- **Table Filtering**: `TransactionHistory` fetches a raw list of transactions (max 200) and uses `useClientDataTable` to handle sorting, filtering, and pagination entirely in memory.

### Optimistic Mutations And Rollback
Deposit and withdrawal mutations update React Query caches immediately so the UI feels responsive, then reconcile with the server.

Shared helpers live in `frontend/src/lib/optimisticVaultCache.ts` and are consumed by `useDepositMutation` / `useWithdrawMutation`:

1. **Cancel** in-flight reads for balance, holdings, vault summary, and transactions.
2. **Snapshot** each key, including whether the key existed (so rollback can `removeQueries` when there was no prior cache).
3. **Apply** optimistic patches:
   - Deposit: wallet USDC ↓, holdings/TVL ↑, prepend pending tx row
   - Withdrawal: wallet USDC ↑, holdings/TVL ↓, prepend pending tx row
4. **On error**: restore the snapshot exactly (cache consistency first).
5. **On settled** (success or failure): invalidate the same keys so server truth replaces optimistic rows.

`VaultDashboard` still owns user-facing feedback (result step + toast). Cache rollback must not depend on toast timing.

See also [`docs/VAULT_UX_PATTERN_LIBRARY.md`](./VAULT_UX_PATTERN_LIBRARY.md) for pending / optimistic UX rules.

---

## Key Contexts

All global providers are located in `frontend/src/context/`.

**`VaultContext`**
The central data hub for the vault. It wraps the `useVaultSummary` and `useVaultHistory` queries, calculates derived metrics like `apy`, `utilization`, `isCapWarning`, and `isCapReached`, and handles global API error normalization. Components use `useVault()` to consume these metrics without worrying about loading states individually.

**`AuthContext`**
Manages the user's wallet session state (`idle`, `warning`, `expired`). It tracks session duration (30 minutes) and handles warning triggers and forced expirations, ensuring the UI accurately reflects wallet security state.

**`ToastContext`**
A global notification system exposing methods like `toast.success()`, `toast.error()`, and `toast.warning()` for transaction feedback and system alerts.

---

## Key Hooks

Custom hooks in `frontend/src/hooks/` encapsulate all complex logic.

**Data Hooks (React Query):**
- **`useSharePrice`**: Fetches the current vault share price with 30s background polling.
- **`useUsdcBalance`**: Fetches the connected wallet's USDC balance. Enabled only when a wallet is connected.
- **`useTransactionHistory`**: Fetches the user's past deposits and withdrawals.
- **`useVaultSummary` & `useVaultHistory`**: Fetch global vault stats and historical data.

**Mutation Hooks (React Query):**
- **`useVaultMutations`**: Exposes `useDepositMutation` and `useWithdrawMutation` for executing Soroban contract calls. Applies optimistic cache updates via `optimisticVaultCache`, rolls back on failure, and invalidates related query caches on settle.

**Utility Hooks:**
- **`useClientDataTable`**: Handles client-side pagination, sorting, and text-based filtering of arrays.
- **`useInfiniteScroll`**: Manages IntersectionObserver logic for loading more items in infinite-scroll views.
- **`useFeeEstimate` / `useSlippage`**: Calculates estimated transaction fees and slippage parameters for deposits and withdrawals.

---

## Component Architecture

### `VaultDashboard` (`frontend/src/components/VaultDashboard.tsx`)
- **State Consumed:** `VaultContext` (global stats), `useUsdcBalance` (wallet balance), `useTokenAllowance` (contract approvals).
- **Local State:** Manages the transaction wizard. Tracks `activeTab` ("deposit" | "withdraw"), `currentStep` ("amount" | "review" | "result"), and form validation via a custom `useForm` hook. It also maintains `transactionResult` for displaying success/failure states post-mutation.
- **Event Listeners:** Listens for global `TRIGGER_DEPOSIT` / `TRIGGER_WITHDRAW` events to auto-focus inputs, allowing disjointed UI elements (like the EmptyState) to orchestrate dashboard actions.
- **Mutations:** Executes `useDepositMutation` and `useWithdrawMutation`, triggering localized confetti effects and toast notifications on success. It leverages the global `QueryClient` to auto-invalidate balances upon completion.

### `TransactionHistory` (`frontend/src/pages/TransactionHistory.tsx`)
- **State Consumed:** `useTransactionHistory` (raw transaction list).
- **Local State:** Manages `viewMode` ("paginated" | "infinite") and infinite scroll batch counts via `useState` and `useRef`. Persists user preferences for `viewMode` and `pageSize` to `localStorage`.
- **URL Synchronization:** Binds heavily to URL parameters using `useDataTableState` (pagination), `useTransactionFilters` (filters) and `useTransactionSort` (multi-column ordering) to ensure the view is shareable and persists across refreshes.
- **Rendering:** Derives the visible rows with the pure `filterTransactions → sortTransactions → paginateRows` pipeline from `lib/transactionQuery`, keeping the matching and ordering rules unit-testable outside React. Renders either a standard paginated `DataTable` or an infinite scroll container based on `viewMode`.

---

## State Boundaries & Best Practices

To maintain a clean and scalable frontend architecture, adhere to the following guidelines:

1. **Prefer React Query over Context for Data:** Do not fetch API data inside a React Context unless it requires heavy, cross-component computation (like `VaultContext`). Rely on React Query hooks directly within components.
2. **Keep Local State Local:** Avoid hoisting `useState` higher than necessary. If only a single child component needs the state, keep it encapsulated within that child.
3. **Use the URL as the Source of Truth:** For shareable states like search queries, filters, or active tabs, use the URL parameters instead of internal `useState`.
4. **Don't Duplicate Server State:** Avoid copying React Query data into local `useState`. Derive values directly from the query data during render.
5. **Colocate Form State:** Use the custom `useForm` hook for transaction inputs and validation. Avoid storing form inputs in global contexts.
6. **Optimistic Updates Must Roll Back:** When mutating vault state, patch React Query caches through `optimisticVaultCache` helpers. Always snapshot before patching and restore on failure; never leave pending optimistic rows after an error.

---

*This document is the authoritative reference for frontend state management. Please ensure new features align with these established patterns to maintain codebase consistency.*
