# Implementation Plan: Tooltip & Popover Primitives

## Overview

Implement the `useFloating` positioning hook, `Tooltip` and `Popover` primitives, and the `HelpIcon` convenience component. Then apply `HelpIcon` to three existing help hints in `VaultDashboard` and `Portfolio`. All components follow the existing glassmorphism design system and reuse the portal/focus-trap patterns established in `Modal.tsx`.

## Tasks

- [x] 1. Implement the `useFloating` positioning hook
  - Create `frontend/src/hooks/useFloating.ts`
  - Define the `Placement` union type and `UseFloatingOptions` / `UseFloatingReturn` interfaces
  - Implement `getBoundingClientRect`-based position calculation returning `position: fixed` coordinates
  - Add configurable `offset` (default 8 px) between trigger edge and floating panel edge
  - Implement flip logic: check viewport overflow on the preferred axis and switch to the opposite placement when needed; clamp to viewport edges with `Math.max(0, …)` / `Math.min(window.innerWidth - panelWidth, …)` for viewports narrower than 320 px
  - Attach debounced (≤ 100 ms via `setTimeout`/`clearTimeout`) `scroll` and `resize` listeners on `window` when `isOpen` is true; clean up on unmount or when `isOpen` becomes false
  - Set a `hidden` flag when the trigger rect is entirely outside the visible viewport
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [-]* 1.1 Write unit tests for `useFloating` — flip and offset
    - Test that flip is applied when preferred placement overflows the viewport boundary
    - Test that no flip occurs when preferred placement fits within the viewport
    - Test that the configured offset is correctly applied for all 8 placement values
    - Test that position is recalculated on scroll/resize events
    - _Requirements: 3.3, 3.6, 7.4_

  - [ ]* 1.2 Write property test for flip prevents viewport overflow (Property 6)
    - **Property 6: Flip prevents viewport overflow**
    - Generate random trigger positions (x, y within a 320–1920 px viewport) and all 8 placement values; assert the computed floating position does not overflow the viewport boundary after flip
    - Tag: `// Feature: tooltip-popover-primitives, Property 6: flip prevents overflow`
    - **Validates: Requirements 1.9, 2.11, 3.6**

  - [ ]* 1.3 Write property test for positioning offset always respected (Property 7)
    - **Property 7: Positioning offset is always respected**
    - Generate random trigger rects and placement values; assert the gap between trigger edge and panel edge equals the configured offset
    - Tag: `// Feature: tooltip-popover-primitives, Property 7: offset always respected`
    - **Validates: Requirements 3.3**

- [x] 2. Implement the `Tooltip` component
  - Create `frontend/src/components/ui/Tooltip.tsx` and `Tooltip.css`
  - Accept `content`, `children`, `placement` (default `"top"`), and `disabled` props per the design interfaces
  - Wrap `children` in a `<span>` forwarding `onMouseEnter`, `onMouseLeave`, `onFocus`, `onBlur` handlers
  - Show panel after 300 ms on hover; show immediately on focus; hide after 150 ms on blur/mouse-leave (use `setTimeout`/`clearTimeout`)
  - Add a `keydown` document listener (active only when visible) for Escape: hide panel and call `triggerRef.current.focus()`
  - Render floating panel via `createPortal(…, document.body)` with `role="tooltip"`, stable `id` from `useId()`, and `pointer-events: none`; never set `tabIndex` on the panel
  - Set `aria-describedby` on the trigger `<span>` to the panel `id` when visible; remove when hidden
  - Apply design-system styles: `background: var(--bg-surface)`, `border: 1px solid var(--border-glass)`, `border-radius: var(--radius-sm)`, `color: var(--text-primary)`, `font-size: var(--text-sm)`, `box-shadow: var(--shadow-glass)`
  - Consume `useFloating` for positioning; hide panel when `useFloating` reports trigger is out of viewport
  - Emit a `console.warn` in development when `children` is not a valid React element
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 1.14, 1.15_

  - [ ]* 2.1 Write unit tests for `Tooltip`
    - Panel shown on keyboard focus (immediate, 0 ms delay)
    - Panel shown on hover after 300 ms (use `vi.useFakeTimers()`)
    - Panel hidden on blur within 150 ms
    - Panel hidden on Escape key press; focus returns to trigger
    - `aria-describedby` on trigger references the panel `id` when visible
    - Panel absent from DOM when `disabled={true}`
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.14, 7.1_

  - [ ]* 2.2 Write property test for Tooltip visibility follows hover delay (Property 1)
    - **Property 1: Tooltip visibility follows hover delay**
    - Generate random content strings and placement values; use `vi.useFakeTimers()` to advance time by arbitrary amounts < 300 ms (panel must be hidden) and ≥ 300 ms (panel must be visible)
    - Tag: `// Feature: tooltip-popover-primitives, Property 1: tooltip hover delay`
    - **Validates: Requirements 1.2**

  - [ ]* 2.3 Write property test for Tooltip hides on Escape (Property 2)
    - **Property 2: Tooltip hides on Escape**
    - Generate random content and placement; open tooltip, press Escape, assert panel hidden and focus on trigger
    - Tag: `// Feature: tooltip-popover-primitives, Property 2: tooltip escape hides`
    - **Validates: Requirements 1.5**

  - [ ]* 2.4 Write property test for Tooltip aria-describedby round-trip (Property 3)
    - **Property 3: Tooltip aria-describedby round-trip**
    - Generate random content strings; when panel is visible, assert `aria-describedby` on trigger resolves to a DOM element present in the document
    - Tag: `// Feature: tooltip-popover-primitives, Property 3: aria-describedby resolves`
    - **Validates: Requirements 1.6, 1.7, 6.1, 7.5**

- [x] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement the `Popover` component
  - Create `frontend/src/components/ui/Popover.tsx` and `Popover.css`
  - Accept `content`, `children`, `title`, `placement` (default `"bottom"`), and `disabled` props per the design interfaces
  - Wrap `children` in a `<span>` forwarding `onClick` and `onKeyDown` (Enter/Space) handlers
  - On trigger activation: open panel, move focus to first focusable element inside panel (or panel container if none); store `previousFocusRef` (same pattern as `Modal.tsx`)
  - Implement focus trap using the same `querySelectorAll` selector as `Modal.tsx`; Tab/Shift+Tab cycle within the panel
  - On Escape: close panel, return focus to `previousFocusRef.current`
  - On outside click (`mousedown` listener on `document`): close panel if click target is outside both panel and trigger
  - Render floating panel via `createPortal(…, document.body)` with `role="dialog"`, `aria-modal="false"`, and `aria-labelledby` referencing the title element `id` (from `useId()`) when `title` prop is provided
  - Render a close button inside the panel with `aria-label="Close"`; on activation close panel and return focus to trigger
  - Apply design-system styles: `background: var(--bg-surface)`, `border: 1px solid var(--border-glass)`, `border-radius: var(--radius-md)`, `color: var(--text-primary)`, `font-size: var(--text-sm)`, `box-shadow: var(--shadow-glass)`, `max-width: 320px`
  - Consume `useFloating` for positioning; recalculate on scroll/resize without closing the panel
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 2.14, 2.15, 2.16_

  - [ ]* 4.1 Write unit tests for `Popover`
    - Panel opens on trigger click
    - Panel opens on Enter/Space keydown on trigger
    - Panel closes on Escape; focus returns to trigger
    - Panel closes on outside click
    - Close button closes panel; focus returns to trigger
    - Focus moves into panel on open
    - Tab cycles within panel (focus trap)
    - `aria-labelledby` references title element when `title` prop is provided
    - Panel absent when `disabled={true}`
    - _Requirements: 2.2, 2.3, 2.4, 2.6, 2.7, 2.8, 2.9, 2.16, 7.2_

  - [ ]* 4.2 Write property test for Popover opens and closes symmetrically (Property 4)
    - **Property 4: Popover opens and closes symmetrically**
    - Generate random content and placement; open via click, close via Escape or outside click, assert panel hidden and focus on trigger
    - Tag: `// Feature: tooltip-popover-primitives, Property 4: popover open/close symmetry`
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.9**

  - [ ]* 4.3 Write property test for Popover focus trap containment (Property 5)
    - **Property 5: Popover focus trap containment**
    - Generate random numbers of focusable elements (1–10) inside the panel; Tab through all of them and assert focus wraps correctly (last → first on Tab, first → last on Shift+Tab)
    - Tag: `// Feature: tooltip-popover-primitives, Property 5: focus trap containment`
    - **Validates: Requirements 2.7, 6.4**

- [x] 5. Implement the `HelpIcon` convenience component
  - Create `frontend/src/components/ui/HelpIcon.tsx` and `HelpIcon.css`
  - Accept `content`, `variant` (default `"tooltip"`), `label` (default `"More information"`), `size` (default `"sm"`), `placement`, and `disabled` props
  - Render a `<button type="button">` with `aria-label={label}` containing a `lucide-react` `Info` icon with `aria-hidden="true"`
  - Apply `min-width: 44px; min-height: 44px` to the button for WCAG 2.5.8 touch target compliance
  - Map `size="sm"` → `<Info size={14} />`, `size="md"` → `<Info size={16} />`
  - When `variant="tooltip"`, wrap the button in `<Tooltip content={content} placement={placement} disabled={disabled}>`
  - When `variant="popover"`, wrap the button in `<Popover content={content} placement={placement} disabled={disabled}>`
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [ ]* 5.1 Write unit tests for `HelpIcon`
    - Trigger button has correct `aria-label` from `label` prop
    - Default `aria-label` is `"More information"`
    - `variant="tooltip"` renders a Tooltip
    - `variant="popover"` renders a Popover
    - Icon SVG has `aria-hidden="true"`
    - _Requirements: 4.1, 4.6, 7.3_

  - [ ]* 5.2 Write property test for HelpIcon aria-label reflects label prop (Property 8)
    - **Property 8: HelpIcon aria-label reflects label prop**
    - Generate random non-empty label strings; assert `aria-label` on the trigger button equals the generated string
    - Tag: `// Feature: tooltip-popover-primitives, Property 8: aria-label reflects label prop`
    - **Validates: Requirements 4.1, 4.6**

- [x] 6. Export new components from the UI index
  - Update `frontend/src/components/ui/index.ts` to add `export * from "./Tooltip"`, `export * from "./Popover"`, and `export * from "./HelpIcon"`
  - _Requirements: 4.1_

- [x] 7. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Apply HelpIcon to `VaultDashboard`
  - In `frontend/src/components/VaultDashboard.tsx`, replace the existing `<div title="Annualized yield...">` APY info wrapper with a `HelpIcon` component using `variant="tooltip"` and `content="Annualized yield based on the historical performance of the vault's underlying assets."`; position it inline with the "Current APY" label with a `gap: 6px` between label and icon
  - Add a `HelpIcon` component with `variant="popover"` next to the "Estimated protocol fee" label span, with content explaining that the fee is 35 basis points (0.35%) of the transaction amount and is deducted before settlement; position it inline with `gap: 6px`
  - Import `HelpIcon` from `../components/ui`
  - _Requirements: 5.1, 5.2, 5.4, 5.5_

- [x] 9. Apply HelpIcon to `Portfolio`
  - In `frontend/src/pages/Portfolio.tsx`, update the `PortfolioSummaryCard` for "Weighted Avg APY" to include a `HelpIcon` component with `variant="tooltip"` and content explaining that the value is the portfolio-value-weighted average of all active position APYs; position it inline with the label text with `gap: 6px`
  - Import `HelpIcon` from `../components/ui`
  - _Requirements: 5.3, 5.4, 5.5_

- [x] 10. Final checkpoint — Ensure all tests pass
  - Run `npm run test:run` in the `frontend` directory and confirm all tests pass; ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Property-based tests use **fast-check** (install as a dev dependency: `npm install --save-dev fast-check` in `frontend/`)
- Each property test runs a minimum of 100 iterations
- Test files live alongside their components: `Tooltip.test.tsx`, `Popover.test.tsx`, `HelpIcon.test.tsx` in `src/components/ui/`, and `useFloating.test.ts` in `src/hooks/`
- Run tests with `npm run test:run` (single-pass) or `npm test` (watch mode) from the `frontend/` directory
- The `Modal.tsx` focus-trap and `previousFocusRef` patterns are the reference implementation for Popover
- All floating panels use `position: fixed` coordinates from `useFloating` to escape `overflow: hidden` ancestors
