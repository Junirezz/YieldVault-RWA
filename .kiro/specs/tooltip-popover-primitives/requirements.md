# Requirements Document

## Introduction

YieldVault-RWA currently displays contextual help text using ad-hoc patterns: native `title` attributes (not keyboard-accessible), plain inline text, and bare icon wrappers with no ARIA semantics. This feature introduces reusable `Tooltip` and `Popover` primitives that standardize how help text and disclosures are surfaced across the application.

A **Tooltip** is a short, non-interactive label that appears on hover or keyboard focus. A **Popover** is a richer, interactive disclosure panel that can contain formatted text, links, or structured content. Both primitives must be fully accessible (WCAG 2.1 AA), keyboard-operable, and visually consistent with the existing glassmorphism design system.

The primitives will be applied to at least three existing help hints:
1. The APY info icon in `VaultDashboard` (currently `<div title="...">`)
2. The "Estimated protocol fee" label in the deposit/withdraw form
3. The "Weighted Avg APY" column header in the Portfolio holdings table

---

## Glossary

- **Tooltip**: A short, non-interactive floating label that appears when a trigger element receives hover or keyboard focus, and disappears when focus or hover is lost. Implemented with `role="tooltip"` and `aria-describedby`.
- **Popover**: An interactive floating panel triggered by a button click. Remains open until explicitly dismissed. May contain rich content (formatted text, links, lists). Implemented with `role="dialog"` or `role="region"` and managed focus.
- **Trigger**: The interactive element (button or focusable element) that opens a Tooltip or Popover.
- **Floating_Panel**: The positioned overlay element containing Tooltip or Popover content.
- **Placement**: The preferred side and alignment of the Floating_Panel relative to its Trigger (e.g., `top`, `bottom`, `left`, `right`, with optional `start`/`end` alignment).
- **Flip**: Automatic repositioning of the Floating_Panel to an alternative Placement when the preferred Placement would cause the panel to overflow the viewport.
- **Inline_Definition**: A Tooltip applied to a term or label to provide a short contextual definition without navigating away.
- **Rich_Content_Popover**: A Popover containing structured content such as formatted paragraphs, bullet lists, or hyperlinks.
- **Help_Hint**: Any UI element that uses a Tooltip or Popover to surface contextual guidance to the user.
- **Focus_Trap**: A keyboard navigation constraint that keeps focus within a Popover while it is open.
- **Escape_Dismissal**: Closing a Tooltip or Popover when the user presses the Escape key.
- **ARIA**: Accessible Rich Internet Applications — a set of attributes that define ways to make web content more accessible.

---

## Requirements

### Requirement 1: Tooltip Primitive

**User Story:** As a user, I want short contextual labels to appear when I hover over or focus on help icons, so that I can understand financial terms without leaving the current page.

#### Acceptance Criteria

1. THE `Tooltip` component SHALL accept a `content` prop of type `string` or `React.ReactNode` and a `children` prop representing the Trigger element.
2. WHEN the Trigger receives pointer hover, THE `Tooltip` SHALL display the Floating_Panel containing the `content` after a delay of no more than 300 ms.
3. WHEN the Trigger receives keyboard focus, THE `Tooltip` SHALL display the Floating_Panel containing the `content` immediately (0 ms delay).
4. WHEN the Trigger loses pointer hover or keyboard focus, THE `Tooltip` SHALL hide the Floating_Panel within 150 ms.
5. WHEN the user presses the Escape key while the Tooltip is visible, THE `Tooltip` SHALL hide the Floating_Panel and return focus to the Trigger.
6. THE `Tooltip` SHALL render the Floating_Panel with `role="tooltip"` and a unique `id` attribute.
7. THE `Tooltip` SHALL set `aria-describedby` on the Trigger element to reference the Floating_Panel `id` when the Tooltip is visible.
8. THE `Tooltip` SHALL accept a `placement` prop with values `top`, `bottom`, `left`, `right`, `top-start`, `top-end`, `bottom-start`, `bottom-end` and SHALL default to `top`.
9. WHEN the preferred Placement would cause the Floating_Panel to overflow the viewport, THE `Tooltip` SHALL apply Flip to reposition the Floating_Panel to an alternative Placement that fits within the viewport.
10. WHEN the viewport is resized, THE `Tooltip` SHALL recalculate the Floating_Panel position within 100 ms and update the position without closing the Tooltip.
11. THE `Tooltip` SHALL render the Floating_Panel via a React portal attached to `document.body` to prevent clipping by ancestor `overflow: hidden` containers.
12. THE `Tooltip` SHALL apply visual styles consistent with the existing design system: `background: var(--bg-surface)`, `border: 1px solid var(--border-glass)`, `border-radius: var(--radius-sm)`, `color: var(--text-primary)`, `font-size: var(--text-sm)`, and `box-shadow: var(--shadow-glass)`.
13. THE `Tooltip` SHALL support both `data-theme="dark"` and `data-theme="light"` themes by inheriting CSS custom properties from the document root.
14. WHERE the `disabled` prop is set to `true`, THE `Tooltip` SHALL not display the Floating_Panel on hover or focus.
15. THE `Tooltip` SHALL not receive focus itself; only the Trigger element SHALL be focusable.

---

### Requirement 2: Popover Primitive

**User Story:** As a user, I want to open a richer help panel for complex financial concepts, so that I can read detailed explanations including formatted text and links without navigating away.

#### Acceptance Criteria

1. THE `Popover` component SHALL accept a `content` prop of type `React.ReactNode`, a `children` prop representing the Trigger element, and an optional `title` prop of type `string`.
2. WHEN the Trigger is activated by pointer click or keyboard Enter/Space, THE `Popover` SHALL display the Floating_Panel containing the `content`.
3. WHEN the Popover is open and the user presses the Escape key, THE `Popover` SHALL close the Floating_Panel and return focus to the Trigger.
4. WHEN the Popover is open and the user clicks outside the Floating_Panel and outside the Trigger, THE `Popover` SHALL close the Floating_Panel.
5. THE `Popover` SHALL render the Floating_Panel with `role="dialog"`, `aria-modal="false"`, and `aria-labelledby` referencing the `title` element when a `title` prop is provided.
6. WHEN the Popover opens, THE `Popover` SHALL move keyboard focus to the first focusable element inside the Floating_Panel, or to the Floating_Panel container if no focusable element exists.
7. WHEN the Popover is open, THE `Popover` SHALL constrain Tab and Shift+Tab navigation to elements within the Floating_Panel (Focus_Trap).
8. THE `Popover` SHALL render a close button inside the Floating_Panel with `aria-label="Close"`.
9. WHEN the close button is activated, THE `Popover` SHALL close the Floating_Panel and return focus to the Trigger.
10. THE `Popover` SHALL accept a `placement` prop with the same values as the Tooltip `placement` prop and SHALL default to `bottom`.
11. WHEN the preferred Placement would cause the Floating_Panel to overflow the viewport, THE `Popover` SHALL apply Flip to reposition the Floating_Panel to an alternative Placement that fits within the viewport.
12. WHEN the viewport is resized while the Popover is open, THE `Popover` SHALL recalculate the Floating_Panel position within 100 ms without closing the Popover.
13. THE `Popover` SHALL render the Floating_Panel via a React portal attached to `document.body`.
14. THE `Popover` SHALL apply visual styles consistent with the existing design system: `background: var(--bg-surface)`, `border: 1px solid var(--border-glass)`, `border-radius: var(--radius-md)`, `color: var(--text-primary)`, `font-size: var(--text-sm)`, `box-shadow: var(--shadow-glass)`, and a maximum width of `320px`.
15. THE `Popover` SHALL support both `data-theme="dark"` and `data-theme="light"` themes by inheriting CSS custom properties from the document root.
16. WHERE the `disabled` prop is set to `true`, THE `Popover` SHALL not open the Floating_Panel when the Trigger is activated.

---

### Requirement 3: Positioning Engine

**User Story:** As a developer, I want the Floating_Panel to stay anchored to its Trigger and remain within the viewport under all layout conditions, so that help content is always readable regardless of scroll position or viewport size.

#### Acceptance Criteria

1. THE Positioning_Engine SHALL calculate the Floating_Panel position relative to the Trigger element's bounding rectangle using `getBoundingClientRect`.
2. WHEN the Trigger element is scrolled out of the visible viewport, THE Positioning_Engine SHALL hide the Floating_Panel.
3. THE Positioning_Engine SHALL add a configurable `offset` (default: `8px`) between the Trigger bounding rectangle and the Floating_Panel edge.
4. THE Positioning_Engine SHALL recalculate position on `scroll` and `resize` window events using a debounce interval of no more than 100 ms.
5. THE Positioning_Engine SHALL be implemented as a reusable React hook (`useFloating`) that both the `Tooltip` and `Popover` components consume.
6. FOR ALL valid Placement values, the Positioning_Engine SHALL produce a Floating_Panel position that does not overlap the Trigger element when the viewport is at least 320px wide.

---

### Requirement 4: HelpIcon Convenience Component

**User Story:** As a developer, I want a pre-composed `HelpIcon` component that combines a standard info icon with a Tooltip or Popover, so that I can add Help_Hints to labels with a single import and minimal boilerplate.

#### Acceptance Criteria

1. THE `HelpIcon` component SHALL render a `lucide-react` `Info` icon as the Trigger with `aria-hidden="true"` on the icon SVG and an accessible label provided via `aria-label` on the Trigger button.
2. THE `HelpIcon` component SHALL accept a `content` prop of type `string` or `React.ReactNode`.
3. WHERE the `variant` prop is set to `"tooltip"` (default), THE `HelpIcon` SHALL use the `Tooltip` component to display the `content`.
4. WHERE the `variant` prop is set to `"popover"`, THE `HelpIcon` SHALL use the `Popover` component to display the `content`.
5. THE `HelpIcon` Trigger button SHALL have a minimum touch target size of 44×44 px in compliance with WCAG 2.5.8.
6. THE `HelpIcon` component SHALL accept a `label` prop of type `string` that sets the `aria-label` on the Trigger button; the `label` prop SHALL default to `"More information"`.
7. THE `HelpIcon` component SHALL accept a `size` prop with values `"sm"` (14px) and `"md"` (16px) and SHALL default to `"sm"`.

---

### Requirement 5: Application of Help Hints

**User Story:** As a user, I want contextual help available on key financial metrics and form fields throughout the application, so that I can make informed decisions without needing external documentation.

#### Acceptance Criteria

1. THE `VaultDashboard` component SHALL replace the existing `<div title="...">` APY info wrapper with a `HelpIcon` component using the `"tooltip"` variant and the content `"Annualized yield based on the historical performance of the vault's underlying assets."`.
2. THE `VaultDashboard` component SHALL add a `HelpIcon` component with the `"popover"` variant next to the "Estimated protocol fee" label, with content explaining that the fee is `35 basis points (0.35%)` of the transaction amount and is deducted before settlement.
3. THE `Portfolio` component SHALL add a `HelpIcon` component with the `"tooltip"` variant to the "Weighted Avg APY" summary card label, with content explaining that the value is the portfolio-value-weighted average of all active position APYs.
4. WHEN a `HelpIcon` Trigger in `VaultDashboard` or `Portfolio` receives keyboard focus via Tab navigation, THE `HelpIcon` SHALL display the associated Tooltip or open the associated Popover in accordance with the respective primitive's keyboard behavior requirements.
5. THE `HelpIcon` components applied in `VaultDashboard` and `Portfolio` SHALL be visually positioned inline with their associated label text, with a gap of `6px` between the label and the icon.

---

### Requirement 6: Accessibility Compliance

**User Story:** As a user who relies on assistive technology, I want all Help_Hints to be fully operable by keyboard and correctly announced by screen readers, so that I have equal access to contextual information.

#### Acceptance Criteria

1. THE `Tooltip` and `Popover` components SHALL pass automated accessibility checks for `role`, `aria-describedby`, `aria-labelledby`, and `aria-modal` attributes as defined in ARIA 1.2 authoring practices.
2. WHEN a screen reader user navigates to a Trigger element, THE Trigger SHALL announce its accessible name followed by the associated Tooltip content via `aria-describedby`.
3. THE `Tooltip` Floating_Panel SHALL not be reachable via Tab navigation; only the Trigger SHALL be in the tab order.
4. THE `Popover` Floating_Panel SHALL be reachable via Tab navigation when open, and Tab SHALL cycle through focusable elements within the Floating_Panel (Focus_Trap).
5. WHEN the Popover closes, THE `Popover` SHALL return focus to the Trigger element that opened it.
6. THE `Tooltip` and `Popover` Trigger elements SHALL display a visible focus indicator consistent with the existing `*:focus-visible` style (`outline: 2px solid var(--accent-cyan); outline-offset: 2px`).
7. THE `Tooltip` and `Popover` Floating_Panel text SHALL meet WCAG 1.4.3 minimum contrast ratio of 4.5:1 against the Floating_Panel background in both `data-theme="dark"` and `data-theme="light"` modes.

---

### Requirement 7: Testing

**User Story:** As a developer, I want automated tests for the Tooltip and Popover primitives, so that regressions in accessibility and positioning behavior are caught before deployment.

#### Acceptance Criteria

1. THE `Tooltip` component SHALL have unit tests verifying that the Floating_Panel is shown on focus, shown on hover, hidden on blur, and hidden on Escape key press.
2. THE `Popover` component SHALL have unit tests verifying that the Floating_Panel opens on click, closes on Escape, closes on outside click, and returns focus to the Trigger on close.
3. THE `HelpIcon` component SHALL have unit tests verifying that the correct ARIA attributes are present on the Trigger button and that the `label` prop sets `aria-label` correctly.
4. THE `useFloating` hook SHALL have unit tests verifying that Flip is applied when the preferred Placement overflows the viewport boundary.
5. FOR ALL `Tooltip` and `Popover` instances, the test suite SHALL verify that `aria-describedby` or `aria-labelledby` references resolve to an element present in the DOM when the Floating_Panel is visible.
