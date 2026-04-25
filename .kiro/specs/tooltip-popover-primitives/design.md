# Design Document: Tooltip & Popover Primitives

## Overview

This document describes the technical design for the `Tooltip`, `Popover`, `HelpIcon`, and `useFloating` primitives for YieldVault-RWA. These components standardize contextual help across the application, replacing ad-hoc patterns (`title` attributes, bare icon wrappers) with fully accessible, keyboard-operable, glassmorphism-styled floating panels.

### Research Summary

**No existing floating UI library is installed.** The project uses React 19, Vite, TypeScript, Vitest + Testing Library, and `lucide-react` for icons. The existing ad-hoc tooltip in `WalletConnect.tsx` uses absolute CSS positioning with no viewport-overflow handling. The `Modal` component demonstrates the established patterns for portals (`createPortal`), focus trapping, Escape-key dismissal, and ARIA dialog semantics — these patterns will be reused and extended.

Key design tokens already defined in `index.css`:
- `--bg-surface`, `--border-glass`, `--shadow-glass`, `--text-primary`, `--text-sm`
- `--radius-sm` (8px), `--radius-md` (12px)
- `--accent-cyan` for focus rings (`*:focus-visible` already sets `outline: 2px solid var(--accent-cyan); outline-offset: 2px`)
- Both `data-theme="dark"` and `data-theme="light"` are supported via CSS custom properties on `:root` and `[data-theme='light']`

**Positioning approach:** Rather than pulling in `@floating-ui/react` (which would add ~15 kB gzip and a new dependency), the positioning engine will be implemented as a custom `useFloating` hook using `getBoundingClientRect` and `window.scroll`/`resize` events. This keeps the bundle lean, matches the project's zero-external-dependency philosophy for UI primitives, and is straightforward to test. The hook will handle the flip logic required by the requirements.

---

## Architecture

```
src/components/
  ui/
    Tooltip.tsx          ← Tooltip primitive
    Tooltip.css
    Popover.tsx          ← Popover primitive
    Popover.css
    HelpIcon.tsx         ← Convenience wrapper
    HelpIcon.css
    index.ts             ← re-exports (extend existing)

src/hooks/
  useFloating.ts         ← Positioning engine hook
  useFloating.test.ts    ← Unit tests for flip logic
```

Component dependency graph:

```
HelpIcon
  ├── Tooltip
  │     └── useFloating
  └── Popover
        └── useFloating
```

Both `Tooltip` and `Popover` render their floating panel via `createPortal(…, document.body)` to escape `overflow: hidden` ancestors.

---

## Components and Interfaces

### `useFloating` hook

```ts
type Placement =
  | 'top' | 'bottom' | 'left' | 'right'
  | 'top-start' | 'top-end'
  | 'bottom-start' | 'bottom-end';

interface UseFloatingOptions {
  placement?: Placement;   // default: 'top'
  offset?: number;         // default: 8
  isOpen: boolean;
}

interface UseFloatingReturn {
  triggerRef: React.RefObject<HTMLElement>;
  floatingRef: React.RefObject<HTMLElement>;
  floatingStyle: React.CSSProperties;  // { position: 'fixed', top, left }
  actualPlacement: Placement;          // after flip
}

function useFloating(options: UseFloatingOptions): UseFloatingReturn;
```

The hook:
1. Attaches `scroll` and `resize` listeners on `window` (debounced ≤ 100 ms) when `isOpen` is true.
2. Calls `triggerRef.current.getBoundingClientRect()` to get the trigger's viewport-relative rect.
3. Computes the preferred position, then checks if the floating panel would overflow the viewport. If it would, flips to the opposite side.
4. When the trigger scrolls out of the visible viewport (trigger rect is entirely outside `[0, window.innerHeight]` or `[0, window.innerWidth]`), sets a `hidden` flag that the consuming component uses to hide the panel.
5. Returns `position: fixed` coordinates so the panel is positioned relative to the viewport, not the document.

**Debounce implementation:** Uses `setTimeout`/`clearTimeout` inside a `useEffect` cleanup — no external debounce library needed.

---

### `Tooltip` component

```tsx
interface TooltipProps {
  content: string | React.ReactNode;
  children: React.ReactElement;       // the trigger element
  placement?: Placement;              // default: 'top'
  disabled?: boolean;                 // default: false
}

const Tooltip: React.FC<TooltipProps>;
```

**Behavior:**
- Wraps `children` in a `<span>` that forwards `onMouseEnter`, `onMouseLeave`, `onFocus`, `onBlur` handlers.
- On hover: shows panel after 300 ms delay (via `setTimeout`).
- On focus: shows panel immediately (0 ms delay).
- On blur/mouse-leave: hides panel after 150 ms delay.
- On `Escape` keydown (document listener, active only when visible): hides panel and calls `triggerRef.current.focus()`.
- Renders floating panel via `createPortal` with `role="tooltip"` and a stable `id` (generated with `useId()`).
- Sets `aria-describedby` on the trigger element to the panel `id` when visible.
- The floating panel itself has `pointer-events: none` and `tabIndex` is never set on it.

**Unique ID generation:** Uses React 19's `useId()` hook.

---

### `Popover` component

```tsx
interface PopoverProps {
  content: React.ReactNode;
  children: React.ReactElement;       // the trigger element
  title?: string;
  placement?: Placement;              // default: 'bottom'
  disabled?: boolean;                 // default: false
}

const Popover: React.FC<PopoverProps>;
```

**Behavior:**
- Wraps `children` in a `<span>` that forwards `onClick` and `onKeyDown` (Enter/Space) handlers.
- On trigger activation: opens panel, moves focus to first focusable element inside panel (or panel container if none).
- Focus trap: `Tab`/`Shift+Tab` cycle within the panel (same algorithm as `Modal.tsx`).
- On `Escape`: closes panel, returns focus to trigger.
- On outside click (`mousedown` listener on `document`): closes panel if click target is outside both panel and trigger.
- Renders floating panel via `createPortal` with `role="dialog"`, `aria-modal="false"`, and `aria-labelledby` referencing the title element `id` when `title` is provided.
- Renders a close button (`aria-label="Close"`) inside the panel.
- Stores `previousFocusRef` (same pattern as `Modal.tsx`) to restore focus on close.

**Why `aria-modal="false"`:** The Popover is a non-modal dialog — it does not block interaction with the rest of the page. Setting `aria-modal="true"` would incorrectly signal to screen readers that background content is inert.

---

### `HelpIcon` component

```tsx
interface HelpIconProps {
  content: string | React.ReactNode;
  variant?: 'tooltip' | 'popover';   // default: 'tooltip'
  label?: string;                     // default: 'More information'
  size?: 'sm' | 'md';                // default: 'sm' (14px icon)
  placement?: Placement;
  disabled?: boolean;
}

const HelpIcon: React.FC<HelpIconProps>;
```

**Behavior:**
- Renders a `<button type="button">` containing a `lucide-react` `Info` icon with `aria-hidden="true"`.
- The button has `aria-label={label}` and minimum 44×44 px touch target (via CSS `min-width: 44px; min-height: 44px`).
- When `variant="tooltip"`, wraps the button in `<Tooltip content={content} placement={placement}>`.
- When `variant="popover"`, wraps the button in `<Popover content={content} placement={placement}>`.
- `size="sm"` → icon `size={14}`, `size="md"` → icon `size={16}`.

---

## Data Models

### Floating Panel Position

The `useFloating` hook computes a `FloatingPosition` internally:

```ts
interface FloatingPosition {
  top: number;    // px, viewport-relative (for position: fixed)
  left: number;   // px, viewport-relative
}
```

The hook derives `top` and `left` from the trigger's `DOMRect` plus the `offset` and the chosen `Placement`. The flip algorithm checks whether `top + floatingHeight > window.innerHeight` (or similar for each axis) and switches to the opposite placement if needed.

### Component State

**Tooltip internal state:**
```ts
{
  isVisible: boolean;
  showTimerId: number | null;
  hideTimerId: number | null;
}
```

**Popover internal state:**
```ts
{
  isOpen: boolean;
  previousFocus: HTMLElement | null;  // stored in a ref, not state
}
```

### CSS Custom Properties Used

| Token | Usage |
|---|---|
| `--bg-surface` | Floating panel background |
| `--border-glass` | Floating panel border |
| `--radius-sm` | Tooltip border-radius |
| `--radius-md` | Popover border-radius |
| `--text-primary` | Floating panel text color |
| `--text-sm` | Floating panel font size |
| `--shadow-glass` | Floating panel box-shadow |
| `--accent-cyan` | Focus ring color (inherited from global `*:focus-visible`) |

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Tooltip visibility follows hover delay

*For any* trigger element and any `content` value, after a pointer-enter event the Tooltip panel SHALL NOT be visible before 300 ms have elapsed, and SHALL be visible after 300 ms have elapsed (when not disabled).

**Validates: Requirements 1.2**

---

### Property 2: Tooltip hides on Escape

*For any* visible Tooltip, pressing the Escape key SHALL hide the floating panel and return focus to the trigger element.

**Validates: Requirements 1.5**

---

### Property 3: Tooltip aria-describedby round-trip

*For any* Tooltip instance where the floating panel is visible, the `aria-describedby` attribute on the trigger SHALL reference an `id` that resolves to an element present in the DOM.

**Validates: Requirements 1.6, 1.7, 6.1, 7.5**

---

### Property 4: Popover opens and closes symmetrically

*For any* Popover instance, activating the trigger SHALL open the panel, and subsequently pressing Escape or clicking outside SHALL close the panel and return focus to the trigger — regardless of the content or placement.

**Validates: Requirements 2.2, 2.3, 2.4, 2.9**

---

### Property 5: Popover focus trap containment

*For any* open Popover with N focusable elements inside the panel (N ≥ 1), pressing Tab from the last focusable element SHALL move focus to the first focusable element, and pressing Shift+Tab from the first SHALL move focus to the last.

**Validates: Requirements 2.7, 6.4**

---

### Property 6: Flip prevents viewport overflow

*For any* valid Placement value and any trigger position within a viewport of at least 320 px wide, the `useFloating` hook SHALL produce a `FloatingPosition` such that the floating panel does not overflow the viewport boundary (after flip is applied).

**Validates: Requirements 1.9, 2.11, 3.6**

---

### Property 7: Positioning offset is always respected

*For any* trigger element and any valid Placement, the distance between the trigger's bounding rectangle edge and the nearest edge of the floating panel SHALL equal the configured `offset` (default 8 px).

**Validates: Requirements 3.3**

---

### Property 8: HelpIcon aria-label reflects label prop

*For any* `label` string passed to `HelpIcon`, the rendered trigger button SHALL have `aria-label` equal to that string.

**Validates: Requirements 4.1, 4.6**

---

## Error Handling

| Scenario | Handling |
|---|---|
| `children` is not a valid React element | Tooltip/Popover render children as-is; no crash. A console warning is emitted in development. |
| `triggerRef.current` is null during position calculation | `useFloating` skips the calculation and returns the previous style. |
| `floatingRef.current` is null during focus management | Popover falls back to focusing the panel container element. |
| `getBoundingClientRect` returns a zero-size rect (hidden element) | Floating panel is not shown; `isVisible` / `isOpen` remains false. |
| Viewport narrower than 320 px | Flip logic still runs; panel is clamped to viewport edges using `Math.max(0, …)` / `Math.min(window.innerWidth - panelWidth, …)`. |
| `disabled` prop is true | All event handlers are no-ops; no panel is rendered. |

---

## Testing Strategy

### Unit Tests (Vitest + Testing Library)

All tests live alongside their components in `src/components/ui/` and `src/hooks/`.

**`Tooltip.test.tsx`**
- Panel shown on keyboard focus (immediate).
- Panel shown on hover after 300 ms (use `vi.useFakeTimers()`).
- Panel hidden on blur within 150 ms.
- Panel hidden on Escape key press; focus returns to trigger.
- `aria-describedby` on trigger references the panel `id` when visible.
- Panel absent from DOM when `disabled={true}`.

**`Popover.test.tsx`**
- Panel opens on trigger click.
- Panel opens on Enter/Space keydown on trigger.
- Panel closes on Escape; focus returns to trigger.
- Panel closes on outside click.
- Close button closes panel; focus returns to trigger.
- Focus moves into panel on open.
- Tab cycles within panel (focus trap).
- `aria-labelledby` references title element when `title` prop is provided.
- Panel absent when `disabled={true}`.

**`HelpIcon.test.tsx`**
- Trigger button has correct `aria-label` from `label` prop.
- Default `aria-label` is `"More information"`.
- `variant="tooltip"` renders a Tooltip.
- `variant="popover"` renders a Popover.
- Icon SVG has `aria-hidden="true"`.

**`useFloating.test.ts`**
- Flip is applied when preferred placement overflows the viewport boundary.
- No flip when preferred placement fits within the viewport.
- Offset is correctly applied for all 8 placement values.
- Position is recalculated on scroll/resize events.

### Property-Based Tests

This feature involves pure positioning logic (`useFloating`) and component state machines (open/close, focus trap) that are well-suited to property-based testing. The project uses Vitest; the property-based testing library will be **fast-check** (the standard choice for TypeScript/JavaScript PBT).

Each property test runs a minimum of **100 iterations**.

Tag format: `Feature: tooltip-popover-primitives, Property {N}: {property_text}`

**Property 1 — Tooltip visibility follows hover delay**
Generate random content strings and placement values. Use `vi.useFakeTimers()` to advance time by arbitrary amounts < 300 ms (panel must be hidden) and ≥ 300 ms (panel must be visible).
`// Feature: tooltip-popover-primitives, Property 1: tooltip hover delay`

**Property 2 — Tooltip hides on Escape**
Generate random content and placement. Open tooltip, press Escape, assert panel hidden and focus on trigger.
`// Feature: tooltip-popover-primitives, Property 2: tooltip escape hides`

**Property 3 — Tooltip aria-describedby round-trip**
Generate random content strings. When panel is visible, assert `aria-describedby` on trigger resolves to a DOM element.
`// Feature: tooltip-popover-primitives, Property 3: aria-describedby resolves`

**Property 4 — Popover opens and closes symmetrically**
Generate random content and placement. Open via click, close via Escape or outside click, assert panel hidden and focus on trigger.
`// Feature: tooltip-popover-primitives, Property 4: popover open/close symmetry`

**Property 5 — Popover focus trap containment**
Generate random numbers of focusable elements (1–10) inside the panel. Tab through all of them and assert focus wraps correctly.
`// Feature: tooltip-popover-primitives, Property 5: focus trap containment`

**Property 6 — Flip prevents viewport overflow**
Generate random trigger positions (x, y within a 320–1920 px viewport) and all 8 placement values. Assert the computed floating position does not overflow the viewport.
`// Feature: tooltip-popover-primitives, Property 6: flip prevents overflow`

**Property 7 — Positioning offset is always respected**
Generate random trigger rects and placement values. Assert the gap between trigger edge and panel edge equals the configured offset.
`// Feature: tooltip-popover-primitives, Property 7: offset always respected`

**Property 8 — HelpIcon aria-label reflects label prop**
Generate random non-empty label strings. Assert `aria-label` on the trigger button equals the generated string.
`// Feature: tooltip-popover-primitives, Property 8: aria-label reflects label prop`

### Integration / Smoke Tests

- `VaultDashboard` renders with `HelpIcon` for APY and protocol fee without errors.
- `Portfolio` renders with `HelpIcon` for Weighted Avg APY without errors.
- Both dark and light themes render the floating panel without contrast failures (verified manually; automated contrast checks are out of scope for unit tests).

### Accessibility Notes

Full WCAG 2.1 AA validation requires manual testing with assistive technologies (NVDA, VoiceOver) and expert review. Automated tests cover ARIA attribute correctness but cannot substitute for manual screen reader testing.
