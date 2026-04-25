# Requirements Document

## Introduction

The YieldVault RWA dashboard currently shows the yvUSDC exchange rate as a static inline string (`1 yvUSDC = {exchangeRate} USDC`) derived from the cached vault summary. This feature replaces that static display with a dedicated **Share Price Display** widget that reads the authoritative share price directly from the `get_share_price` contract function, refreshes it automatically every 30 seconds, and communicates its live-update status to the user through a subtle loading indicator.

The share price is defined by the vault contract as `(total_assets × 10¹⁸) / total_shares`, scaled to 18 decimal places. The widget must decode this fixed-point value into a human-readable USDC price, keep it current without requiring a full page reload, and degrade gracefully when the Soroban RPC is unavailable.

---

## Glossary

- **Share_Price**: The current redemption value of one yvUSDC share expressed in USDC, computed on-chain as `(total_assets × 10¹⁸) / total_shares` and returned by the `get_share_price` contract function as an `i128` scaled by `10¹⁸`.
- **Share_Price_Display**: The UI widget on the dashboard that shows the current Share_Price and its live-update status.
- **Share_Price_Fetcher**: The frontend service layer responsible for invoking the `get_share_price` Soroban contract function via the Stellar RPC and returning a decoded `number`.
- **Polling_Cycle**: A single scheduled invocation of the Share_Price_Fetcher triggered by the 30-second interval timer.
- **Loading_Indicator**: A subtle visual element (spinner or animated icon) shown inside the Share_Price_Display while a Polling_Cycle is in progress.
- **Stale_Price**: A Share_Price value that was fetched during a previous Polling_Cycle and has not yet been replaced by a newer value.
- **Error_State**: The condition in which the most recent Polling_Cycle failed and no valid Share_Price is available to display.
- **Last_Updated_Timestamp**: The wall-clock time at which the most recently successful Share_Price fetch completed.
- **VaultContext**: The existing React context (`frontend/src/context/VaultContext.tsx`) that provides vault state to dashboard components.
- **useSharePrice**: The new React hook that encapsulates Share_Price_Fetcher calls, polling logic, and error handling.
- **Soroban_RPC**: The Stellar Soroban RPC endpoint configured via `VITE_SOROBAN_RPC_URL` in `frontend/src/config/network.ts`.
- **Fixed_Point_Divisor**: The constant `1_000_000_000_000_000_000` (10¹⁸) used to convert the raw `i128` contract return value to a human-readable decimal.

---

## Requirements

### Requirement 1: Share Price Fetching

**User Story:** As a frontend developer, I want a dedicated service function that reads the share price directly from the vault contract, so that the displayed value is always authoritative and not derived from a cached summary field.

#### Acceptance Criteria

1. THE Share_Price_Fetcher SHALL invoke the `get_share_price` function on the vault contract identified by `networkConfig.contractId` using the Soroban_RPC endpoint at `networkConfig.rpcUrl`.
2. WHEN the `get_share_price` contract call succeeds, THE Share_Price_Fetcher SHALL decode the returned `i128` value by dividing it by the Fixed_Point_Divisor and return the result as a JavaScript `number`.
3. WHEN the `get_share_price` contract call returns a value of `1_000_000_000_000_000_000` (the initial 1:1 price), THE Share_Price_Fetcher SHALL return `1.0`.
4. IF the Soroban_RPC call fails with a network error or non-success response, THEN THE Share_Price_Fetcher SHALL throw a typed `SharePriceFetchError` that includes the original error cause.
5. IF `networkConfig.contractId` is an empty string, THEN THE Share_Price_Fetcher SHALL throw a `SharePriceFetchError` with message `"Vault contract ID is not configured"` without making any RPC call.
6. THE Share_Price_Fetcher SHALL be implemented as an exported async function `getSharePrice(): Promise<number>` in `frontend/src/lib/vaultApi.ts`.

---

### Requirement 2: Live Polling Hook

**User Story:** As a frontend developer, I want a React hook that polls the share price every 30 seconds and exposes loading and error state, so that components can display a live price without managing timers themselves.

#### Acceptance Criteria

1. THE `useSharePrice` hook SHALL poll the Share_Price_Fetcher at an interval of exactly 30 000 ms using the existing `useQueryWithPolling` infrastructure (`frontend/src/hooks/useQueryWithPolling.ts`).
2. WHEN the browser tab becomes hidden, THE `useSharePrice` hook SHALL pause polling and resume it when the tab becomes visible again, using the `pauseOnHidden` behaviour already implemented in `usePolling`.
3. WHEN the browser goes offline, THE `useSharePrice` hook SHALL pause polling and resume it when connectivity is restored, using the `pauseOnOffline` behaviour already implemented in `usePolling`.
4. THE `useSharePrice` hook SHALL expose the following values: `sharePrice: number | null`, `isLoading: boolean`, `isRefetching: boolean`, `error: Error | null`, `lastUpdated: Date | null`, and `forceRefresh: () => void`.
5. WHEN the hook mounts, THE `useSharePrice` hook SHALL perform an initial fetch immediately before the first 30-second interval elapses.
6. WHILE a Polling_Cycle is in progress, THE `useSharePrice` hook SHALL set `isRefetching` to `true` and SHALL NOT clear the previously fetched `sharePrice` value.
7. WHEN a Polling_Cycle completes successfully, THE `useSharePrice` hook SHALL update `sharePrice` with the new value, set `error` to `null`, and record the current time as `lastUpdated`.
8. WHEN a Polling_Cycle fails, THE `useSharePrice` hook SHALL set `error` to the caught error, retain the last known `sharePrice` (Stale_Price), and SHALL NOT reset `sharePrice` to `null`.

---

### Requirement 3: Share Price Display Widget

**User Story:** As a user, I want to see the current yvUSDC share price on the dashboard with a clear indication that it is live, so that I can make informed deposit and withdrawal decisions.

#### Acceptance Criteria

1. THE Share_Price_Display SHALL render the Share_Price formatted to exactly 4 decimal places followed by the string `" USDC"` (e.g. `"1.0842 USDC"`).
2. WHEN `isLoading` is `true` on initial mount and no Share_Price has been fetched yet, THE Share_Price_Display SHALL render a `Skeleton` placeholder of width `120px` and height `1.25rem` in place of the price value.
3. WHILE `isRefetching` is `true` and a Stale_Price is available, THE Share_Price_Display SHALL show the Stale_Price value alongside the Loading_Indicator, and SHALL NOT replace the price text with a skeleton.
4. THE Loading_Indicator SHALL be a `Loader2` icon from `lucide-react` with a CSS `spin` animation, sized `14px`, and rendered inline with the price label.
5. WHEN `isRefetching` is `false`, THE Loading_Indicator SHALL not be rendered.
6. THE Share_Price_Display SHALL include an `aria-live="polite"` region so that screen readers announce price updates without interrupting the user.
7. THE Share_Price_Display SHALL replace the existing static exchange-rate line (`1 yvUSDC = {exchangeRate} USDC`) in `VaultDashboard.tsx` and SHALL be visually consistent with the surrounding glassmorphism design system.
8. THE Share_Price_Display SHALL render the label `"1 yvUSDC ="` to the left of the formatted price value, preserving the existing semantic meaning of the display.

---

### Requirement 4: Error Handling and Graceful Degradation

**User Story:** As a user, I want the dashboard to remain usable and informative when the share price cannot be refreshed, so that a temporary RPC outage does not break my workflow.

#### Acceptance Criteria

1. WHEN the Error_State is active and no Stale_Price is available (first fetch failed), THE Share_Price_Display SHALL render the text `"Unavailable"` in place of the price value, styled with `color: var(--text-secondary)`.
2. WHEN the Error_State is active and a Stale_Price is available, THE Share_Price_Display SHALL continue to display the Stale_Price and SHALL render a warning icon (`AlertTriangle` from `lucide-react`, size `14px`, `color: var(--text-warning)`) inline with the price to indicate the value may be outdated.
3. WHEN the Error_State is active, THE Share_Price_Display SHALL render a tooltip (using the existing `HelpIcon` or `Tooltip` primitive) on the warning icon with the text `"Share price could not be refreshed. Showing last known value."`.
4. IF a Polling_Cycle fails, THEN THE `useSharePrice` hook SHALL log the error using the existing `logger` utility (`frontend/src/lib/logger.ts`) at `warn` level, including the error message and the timestamp of the failure.
5. WHEN connectivity is restored after an offline period, THE `useSharePrice` hook SHALL automatically trigger a fetch within one Polling_Cycle interval (30 000 ms) of coming back online.
6. THE Share_Price_Display SHALL never throw an unhandled exception to its parent; all error conditions SHALL be handled internally and reflected in the UI state described above.

---

### Requirement 5: Accessibility

**User Story:** As a user who relies on assistive technology, I want the share price display to be correctly announced and navigable, so that I have equal access to live price information.

#### Acceptance Criteria

1. THE Share_Price_Display container SHALL carry `aria-live="polite"` and `aria-atomic="true"` so that the complete updated price string is announced as a single unit when it changes.
2. THE Loading_Indicator icon SHALL carry `aria-hidden="true"` so that screen readers do not announce the spinner.
3. WHEN the Error_State warning icon is rendered, THE warning icon SHALL carry `aria-label="Share price data may be stale"` so that screen readers convey the degraded state.
4. THE Share_Price_Display label text `"1 yvUSDC ="` and the price value SHALL be wrapped in a single element with `role="status"` to group them semantically for assistive technologies.
5. THE Share_Price_Display SHALL meet WCAG 1.4.3 minimum contrast ratio of 4.5:1 for the price text against its background in both `data-theme="dark"` and `data-theme="light"` modes.

---

### Requirement 6: Testing

**User Story:** As a developer, I want automated tests for the share price feature, so that regressions in fetching, polling, and error display are caught before deployment.

#### Acceptance Criteria

1. THE `getSharePrice` function SHALL have unit tests verifying: correct decoding of the Fixed_Point_Divisor-scaled value, the 1:1 initial price case, the `SharePriceFetchError` thrown on RPC failure, and the error thrown when `contractId` is empty.
2. THE `useSharePrice` hook SHALL have unit tests verifying: initial loading state, successful price population after fetch, retention of Stale_Price on polling failure, and `isRefetching` toggling during a Polling_Cycle.
3. THE Share_Price_Display component SHALL have unit tests verifying: skeleton shown during initial load, formatted price shown after successful fetch, `Loader2` spinner present during refetch, `AlertTriangle` icon shown in Error_State with Stale_Price, and `"Unavailable"` text shown when no price is available.
4. FOR ALL valid `i128` share price values representable as a JavaScript `number`, the decoding function SHALL satisfy the round-trip property: `encode(decode(raw)) === raw` where `encode(x) = Math.round(x * Fixed_Point_Divisor)` and `decode(raw) = raw / Fixed_Point_Divisor`.
5. THE test suite SHALL verify that the `aria-live` and `aria-atomic` attributes are present on the Share_Price_Display container element.
