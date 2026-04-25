# Implementation Plan: Share Price Display

## Overview

Replace the static `1 yvUSDC = {exchangeRate} USDC` line in `VaultDashboard.tsx` with a live-updating `SharePriceDisplay` widget. The implementation adds a typed fetch function and error class to `vaultApi.ts`, a new query key, a polling hook, and a self-contained display component, then wires the component into the dashboard.

## Tasks

- [x] 1. Add `fast-check` dev dependency
  - Add `"fast-check": "^3.22.0"` to `devDependencies` in `frontend/package.json`
  - _Requirements: 6.1, 6.4_

- [x] 2. Extend `queryClient.ts` with the share price query key
  - Add `sharePrice: () => [...queryKeys.vault.all, "sharePrice"] as const` to the `queryKeys.vault` object in `frontend/src/lib/queryClient.ts`
  - _Requirements: 2.1_

- [x] 3. Implement share price fetching in `vaultApi.ts`
  - [x] 3.1 Add `SharePriceFetchError` class and `decodeSharePrice` helper
    - Export `class SharePriceFetchError extends Error` with `name = "SharePriceFetchError"` and an `options?: ErrorOptions` constructor parameter
    - Export `const FIXED_POINT_DIVISOR = 1_000_000_000_000_000_000n`
    - Export `function decodeSharePrice(raw: bigint): number` using BigInt integer division for the integer part and remainder division for the fractional part
    - _Requirements: 1.2, 1.3, 1.4_

  - [ ]* 3.2 Write unit tests for `decodeSharePrice` in `frontend/src/lib/vaultApi.test.ts`
    - Test `decodeSharePrice(1_000_000_000_000_000_000n)` returns `1.0`
    - Test `decodeSharePrice(1_084_200_000_000_000_000n)` returns approximately `1.0842`
    - Test `decodeSharePrice(0n)` returns `0`
    - _Requirements: 6.1_

  - [ ]* 3.3 Write property test for `decodeSharePrice` round-trip
    - **Property 1: Decode round-trip**
    - **Validates: Requirements 1.2, 6.4**
    - Use `fast-check` with `{ numRuns: 100 }` to generate `raw` values in `[0n, BigInt(Number.MAX_SAFE_INTEGER) * FIXED_POINT_DIVISOR]`
    - Assert `BigInt(Math.round(decodeSharePrice(raw) * 1e18)) === raw`
    - Tag comment: `// Feature: share-price-display, Property 1: Decode round-trip`
    - _Requirements: 6.4_

  - [x] 3.4 Implement `getSharePrice(): Promise<number>` in `frontend/src/lib/vaultApi.ts`
    - Import `Contract`, `SorobanRpc`, `TransactionBuilder`, `Networks`, `BASE_FEE` from `@stellar/stellar-sdk`
    - Import `networkConfig` from `../config/network` and `log` from `./logger`
    - Throw `SharePriceFetchError("Vault contract ID is not configured")` immediately if `networkConfig.contractId` is empty — no RPC call made
    - Construct `SorobanRpc.Server` with `networkConfig.rpcUrl`
    - Build a minimal transaction calling `get_share_price` on the vault contract using a placeholder source account (with `.catch()` fallback for the `getAccount` call)
    - Call `server.simulateTransaction(tx)` and wrap any thrown error in `SharePriceFetchError` with the original as `cause`
    - Check `SorobanRpc.Api.isSimulationError(simResult)` and throw `SharePriceFetchError` if true
    - Extract `simResult.result?.retval`; throw `SharePriceFetchError("Contract returned no value")` if absent
    - Decode the `i128` via `returnValue.i128()` → `(raw.hi << 64n) | raw.lo` and pass to `decodeSharePrice`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ]* 3.5 Write unit tests for `getSharePrice` in `frontend/src/lib/vaultApi.test.ts`
    - Test throws `SharePriceFetchError` when `contractId` is empty (no RPC call made)
    - Test throws `SharePriceFetchError` when `simulateTransaction` rejects; verify `cause` is the original error
    - Test throws `SharePriceFetchError` when simulation returns an error response
    - Test throws `SharePriceFetchError("Contract returned no value")` when `retval` is absent
    - Test returns decoded number when simulation succeeds with a known raw value
    - _Requirements: 6.1_

  - [ ]* 3.6 Write property test for RPC errors always producing `SharePriceFetchError`
    - **Property 2: RPC errors always produce `SharePriceFetchError`**
    - **Validates: Requirements 1.4**
    - Use `fast-check` to generate arbitrary `Error` instances as the rejection cause
    - Mock `simulateTransaction` to reject with each generated error
    - Assert the thrown error is `instanceof SharePriceFetchError` and `error.cause` is the original
    - Tag comment: `// Feature: share-price-display, Property 2: RPC errors always produce SharePriceFetchError`
    - _Requirements: 1.4_

- [x] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement `useSharePrice` hook
  - [x] 5.1 Create `frontend/src/hooks/useSharePrice.ts`
    - Import `useQuery` from `@tanstack/react-query`, `useQueryWithPolling` and `POLLING_INTERVALS` from `./useQueryWithPolling`, `getSharePrice` from `../lib/vaultApi`, `queryKeys` from `../lib/queryClient`, `log` from `../lib/logger`, and `useEffect` from `react`
    - Export `interface UseSharePriceResult` with fields: `sharePrice: number | null`, `isLoading: boolean`, `isRefetching: boolean`, `error: Error | null`, `lastUpdated: Date | null`, `forceRefresh: () => void`
    - Implement `export function useSharePrice(): UseSharePriceResult` using `useQuery` with `queryKey: queryKeys.vault.sharePrice()`, `queryFn: getSharePrice`, `staleTime: POLLING_INTERVALS.normal`, `retry: 1`, `refetchOnWindowFocus: false`
    - Wrap the query with `useQueryWithPolling` using `interval: POLLING_INTERVALS.normal`, `pauseOnHidden: true`, `pauseOnOffline: true`
    - Add a `useEffect` watching `query.error` that calls `log("warn", "Share price fetch failed", { errorCode: query.error.name, message: query.error.message, timestamp: new Date().toISOString() })` when `query.error` is non-null
    - Return `{ sharePrice: query.data ?? null, isLoading: query.isLoading, isRefetching: query.isFetching && !query.isLoading, error: query.error, lastUpdated, forceRefresh: polling.forceRefresh }`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 4.4_

  - [ ]* 5.2 Write unit tests for `useSharePrice` in `frontend/src/hooks/useSharePrice.test.ts`
    - Test initial state: `sharePrice === null`, `isLoading === true`, `error === null`
    - Test after successful fetch: `sharePrice` is set, `isLoading === false`, `error === null`, `lastUpdated` is a `Date`
    - Test during refetch: `isRefetching === true`, `sharePrice` retains previous value
    - Test after failed fetch with stale price: `error` is set, `sharePrice` retains previous value
    - Test after failed fetch without stale price: `error` is set, `sharePrice === null`
    - Test `log("warn", ...)` is called when a fetch fails
    - _Requirements: 6.2_

  - [ ]* 5.3 Write property test: share price is never cleared once set
    - **Property 3: Share price is never cleared once set**
    - **Validates: Requirements 2.6, 2.8**
    - Use `fast-check` to generate random positive numbers as share prices
    - Set as current price via a successful mock, then trigger a fetch failure
    - Assert `sharePrice` is unchanged after the failure
    - Tag comment: `// Feature: share-price-display, Property 3: Share price is never cleared once set`
    - _Requirements: 2.6, 2.8_

  - [ ]* 5.4 Write property test: successful fetch updates price and clears error
    - **Property 4: Successful fetch updates price and clears error**
    - **Validates: Requirements 2.7**
    - Use `fast-check` to generate random positive numbers as new share prices
    - Mock `getSharePrice` to return each generated value
    - Assert `sharePrice` equals the new value, `error === null`, and `lastUpdated` is a recent `Date`
    - Tag comment: `// Feature: share-price-display, Property 4: Successful fetch updates price and clears error`
    - _Requirements: 2.7_

  - [ ]* 5.5 Write property test: fetch failures are always logged at warn level
    - **Property 7: Fetch failures are always logged at warn level**
    - **Validates: Requirements 4.4**
    - Use `fast-check` to generate arbitrary error messages
    - Mock `getSharePrice` to throw errors with those messages
    - Assert `log` was called with `"warn"` and a payload containing the error message and a timestamp string
    - Tag comment: `// Feature: share-price-display, Property 7: Fetch failures are always logged at warn level`
    - _Requirements: 4.4_

- [x] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement `SharePriceDisplay` component
  - [x] 7.1 Create `frontend/src/components/SharePriceDisplay.tsx`
    - Import `React` from `react`, `Loader2` and `AlertTriangle` from `./icons` (or `lucide-react` if not re-exported), `Skeleton` from `./Skeleton`, `Tooltip` from `./ui/Tooltip`, and `useSharePrice` from `../hooks/useSharePrice`
    - Export `const SharePriceDisplay: React.FC` with no props
    - Derive render state from `{ isLoading, isRefetching, sharePrice, error }` returned by `useSharePrice()`
    - Render a container `<div role="status" aria-live="polite" aria-atomic="true">` with `marginTop: "8px"`, `color: "var(--text-secondary)"`, `fontSize: "0.82rem"`
    - Render `<span>1 yvUSDC =&nbsp;</span>` as the label
    - When `isLoading && sharePrice === null`: render `<Skeleton width="120px" height="1.25rem" />`
    - When `!isLoading && sharePrice === null && error`: render `<span style={{ color: "var(--text-secondary)" }}>Unavailable</span>`
    - When `sharePrice !== null`: render `<span>{sharePrice.toFixed(4)} USDC</span>` plus conditionally the `Loader2` spinner (`aria-hidden="true"`, `size={14}`, `className="spin"`, `style={{ marginLeft: "4px", animation: "spin 0.9s linear infinite" }}`) when `isRefetching`, and the `AlertTriangle` icon wrapped in `<Tooltip>` when `error && !isRefetching`
    - `AlertTriangle` must have `aria-label="Share price data may be stale"`, `size={14}`, `style={{ marginLeft: "4px", color: "var(--text-warning)" }}`
    - Tooltip content: `"Share price could not be refreshed. Showing last known value."` with `placement="top"`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3, 4.6, 5.1, 5.2, 5.3, 5.4_

  - [ ]* 7.2 Write unit tests for `SharePriceDisplay` in `frontend/src/components/SharePriceDisplay.test.tsx`
    - Mock `useSharePrice` to control hook output in each test
    - Test skeleton rendered when `isLoading=true` and `sharePrice=null`
    - Test formatted price shown after successful fetch (e.g., `"1.0842 USDC"`)
    - Test `Loader2` spinner present when `isRefetching=true`; absent when `isRefetching=false`
    - Test `AlertTriangle` icon shown when `error` is set and `sharePrice` is not null
    - Test `"Unavailable"` text shown when `error` is set and `sharePrice === null`
    - Test `aria-live="polite"` and `aria-atomic="true"` present on container
    - Test `role="status"` present on container
    - Test `aria-hidden="true"` on `Loader2` icon
    - Test `aria-label="Share price data may be stale"` on `AlertTriangle` icon
    - Test tooltip text `"Share price could not be refreshed. Showing last known value."` present in error state
    - _Requirements: 6.3, 5.1, 5.2, 5.3, 5.4_

  - [ ]* 7.3 Write property test: price is always formatted to 4 decimal places
    - **Property 5: Price is always formatted to 4 decimal places**
    - **Validates: Requirements 3.1**
    - Use `fast-check` to generate random positive finite numbers as `sharePrice`
    - Render `SharePriceDisplay` with mocked `useSharePrice` returning each value
    - Assert rendered text matches `/^\d+\.\d{4} USDC$/`
    - Tag comment: `// Feature: share-price-display, Property 5: Price is always formatted to 4 decimal places`
    - _Requirements: 3.1_

  - [ ]* 7.4 Write property test: stale price is always shown with warning icon on error
    - **Property 6: Stale price is always shown with warning icon on error**
    - **Validates: Requirements 4.2**
    - Use `fast-check` to generate random positive numbers as stale prices
    - Render `SharePriceDisplay` with mocked `useSharePrice` returning `{ sharePrice: generatedPrice, error: new Error("rpc failed"), isRefetching: false, isLoading: false }`
    - Assert both the formatted price text and the `AlertTriangle` icon (via `aria-label`) are present
    - Tag comment: `// Feature: share-price-display, Property 6: Stale price is always shown with warning icon on error`
    - _Requirements: 4.2_

- [x] 8. Wire `SharePriceDisplay` into `VaultDashboard`
  - [x] 8.1 Replace the static exchange-rate div in `frontend/src/components/VaultDashboard.tsx`
    - Import `SharePriceDisplay` from `./SharePriceDisplay`
    - Remove the `<div style={{ marginTop: "8px", color: "var(--text-secondary)", fontSize: "0.82rem" }}>1 yvUSDC = {summary.exchangeRate.toFixed(3)} USDC</div>` block
    - Insert `<SharePriceDisplay />` in its place
    - _Requirements: 3.7_

  - [ ]* 8.2 Update `VaultDashboard.test.tsx` to verify the new component renders
    - Add a test asserting that the static text `"1 yvUSDC = 1.084 USDC"` (old format with 3 decimal places) is no longer present
    - Add a test asserting that the `SharePriceDisplay` container with `role="status"` is rendered inside the dashboard
    - Mock `useSharePrice` (or `getSharePrice`) as needed so the test does not make real RPC calls
    - _Requirements: 6.3_

- [x] 9. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use `fast-check` with `{ numRuns: 100 }` minimum and are tagged with `// Feature: share-price-display, Property N: <text>`
- `fast-check` must be installed (task 1) before any property tests are written
- The `SharePriceDisplay` component is fully self-contained — no props required
- `getSharePrice` uses `simulateTransaction` (a read-only view call); no funded account is needed
