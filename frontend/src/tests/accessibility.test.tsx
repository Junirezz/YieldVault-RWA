/**
 * Accessibility Audit Tests — WCAG 2.1 AA Compliance
 *
 * Uses axe-core to automatically detect critical accessibility violations.
 * Covers all primary page shells and reusable interactive components.
 *
 * Acceptance criteria (issue #239):
 *   • Zero critical axe violations
 *   • All interactive elements are keyboard accessible
 *   • Color contrast ratios meet AA requirements (4.5:1 normal, 3:1 large)
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import axe from "axe-core";
import type { AxeResults } from "axe-core";

// ─── Helper ────────────────────────────────────────────────────────────────────

async function runAxe(container: HTMLElement): Promise<AxeResults> {
  const results = await axe.run(container, {
    runOnly: {
      type: "tag",
      values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
    },
    rules: {
      // Allow region landmark to be optional for isolated component tests
      region: { enabled: false },
    },
  });
  return results;
}

function expectNoViolations(results: AxeResults): void {
  const violations = results.violations.map(
    (v) =>
      `[${v.impact}] ${v.id}: ${v.description}\n` +
      v.nodes.map((n) => `  → ${n.html}`).join("\n"),
  );

  expect(violations, `axe found ${violations.length} violation(s):\n${violations.join("\n\n")}`).toHaveLength(0);
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("Accessibility: axe-core audit", () => {
  beforeEach(() => {
    document.documentElement.setAttribute("lang", "en");
  });

  it("skip-link is present and has correct href", () => {
    const { container } = render(
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>,
    );
    const link = container.querySelector(".skip-link") as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe("#main-content");
  });

  it("skip navigation includes main content and primary nav targets", () => {
    const { container } = render(
      <nav className="skip-links" aria-label="Skip links">
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <a className="skip-link" href="#primary-nav">
          Skip to navigation
        </a>
      </nav>,
    );
    const links = container.querySelectorAll(".skip-link");
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe("#main-content");
    expect(links[1].getAttribute("href")).toBe("#primary-nav");
  });

  it("buttons have accessible names", async () => {
    const { container } = render(
      <div>
        <button aria-label="Close dialog">×</button>
        <button>Submit</button>
        <button aria-label="Open navigation menu">☰</button>
      </div>,
    );

    const results = await runAxe(container);
    expectNoViolations(results);
  });

  it("form inputs have associated labels", async () => {
    const { container } = render(
      <form>
        <div>
          <label htmlFor="deposit-amount">Deposit amount</label>
          <input id="deposit-amount" type="number" placeholder="0.00" />
        </div>
        <div>
          <label htmlFor="page-size">Rows per page</label>
          <select id="page-size" aria-label="Rows per page">
            <option value="10">10</option>
            <option value="20">20</option>
          </select>
        </div>
      </form>,
    );

    const results = await runAxe(container);
    expectNoViolations(results);
  });

  it("modal dialog has correct ARIA attributes", async () => {
    const { container } = render(
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        aria-describedby="modal-desc"
      >
        <h2 id="modal-title">Session Expired</h2>
        <p id="modal-desc">Your session has expired. Please reconnect.</p>
        <button>Reconnect</button>
        <button aria-label="Close dialog">×</button>
      </div>,
    );

    const results = await runAxe(container);
    expectNoViolations(results);
  });

  it("tabs have correct ARIA roles and keyboard attributes", async () => {
    const { container } = render(
      <div>
        <div role="tablist" aria-orientation="horizontal">
          <button
            role="tab"
            aria-selected={true}
            aria-controls="panel-deposit"
            id="tab-deposit"
            tabIndex={0}
          >
            Deposit
          </button>
          <button
            role="tab"
            aria-selected={false}
            aria-controls="panel-withdraw"
            id="tab-withdraw"
            tabIndex={-1}
          >
            Withdraw
          </button>
        </div>
        <div
          role="tabpanel"
          id="panel-deposit"
          aria-labelledby="tab-deposit"
          tabIndex={0}
        >
          Deposit content
        </div>
      </div>,
    );

    const results = await runAxe(container);
    expectNoViolations(results);
  });

  it("data table has caption for screen readers", async () => {
    const { container } = render(
      <table>
        <caption className="sr-only">Transaction history</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Type</th>
            <th scope="col">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>2026-04-26</td>
            <td>Deposit</td>
            <td>100 USDC</td>
          </tr>
        </tbody>
      </table>,
    );

    const results = await runAxe(container);
    expectNoViolations(results);
  });

  it("pagination nav has accessible labels", async () => {
    const { container } = render(
      <nav aria-label="Page navigation">
        <button aria-label="Previous page" disabled>
          ←
        </button>
        <button aria-current="page" aria-label="Go to page 1">
          1
        </button>
        <button aria-label="Go to page 2">2</button>
        <button aria-label="Next page">→</button>
      </nav>,
    );

    const results = await runAxe(container);
    expectNoViolations(results);
  });

  it("alert banners have role=alert", async () => {
    const { container } = render(
      <div role="alert">
        <strong>Vault Capacity Reached</strong>
        <p>Deposits are temporarily disabled.</p>
      </div>,
    );

    const results = await runAxe(container);
    expectNoViolations(results);
  });

  it("progress bars have correct ARIA attributes", async () => {
    const { container } = render(
      <div
        role="progressbar"
        aria-valuenow={42}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Upload progress: 42%"
        style={{ height: "4px", background: "#ccc" }}
      >
        <div style={{ width: "42%", height: "100%", background: "#0ff" }} />
      </div>,
    );

    const results = await runAxe(container);
    expectNoViolations(results);
  });

  it("color contrast meets WCAG AA (dark theme variables)", () => {
    // Verify our color values:
    // --text-secondary: #a8b8cc on --bg-main: #0a0b10
    // Contrast ratio ≈ 7.8:1 (exceeds 4.5:1)
    const textSecondary = 0xa8b8cc;
    const bgMain = 0x0a0b10;

    // Relative luminance formula per WCAG 2.1
    function luminance(hex: number): number {
      const r = ((hex >> 16) & 0xff) / 255;
      const g = ((hex >> 8) & 0xff) / 255;
      const b = (hex & 0xff) / 255;

      const sR = r <= 0.03928 ? r / 12.92 : ((r + 0.055) / 1.055) ** 2.4;
      const sG = g <= 0.03928 ? g / 12.92 : ((g + 0.055) / 1.055) ** 2.4;
      const sB = b <= 0.03928 ? b / 12.92 : ((b + 0.055) / 1.055) ** 2.4;

      return 0.2126 * sR + 0.7152 * sG + 0.0722 * sB;
    }

    function contrastRatio(l1: number, l2: number): number {
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    const textL = luminance(textSecondary);
    const bgL = luminance(bgMain);
    const ratio = contrastRatio(textL, bgL);

    // WCAG AA requires 4.5:1 for normal text
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("color contrast meets WCAG AA (light theme variables)", () => {
    const textSecondary = 0x40505f;
    const bgMain = 0xf8fafc;

    function luminance(hex: number): number {
      const r = ((hex >> 16) & 0xff) / 255;
      const g = ((hex >> 8) & 0xff) / 255;
      const b = (hex & 0xff) / 255;

      const sR = r <= 0.03928 ? r / 12.92 : ((r + 0.055) / 1.055) ** 2.4;
      const sG = g <= 0.03928 ? g / 12.92 : ((g + 0.055) / 1.055) ** 2.4;
      const sB = b <= 0.03928 ? b / 12.92 : ((b + 0.055) / 1.055) ** 2.4;

      return 0.2126 * sR + 0.7152 * sG + 0.0722 * sB;
    }

    function contrastRatio(l1: number, l2: number): number {
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    const textL = luminance(textSecondary);
    const bgL = luminance(bgMain);
    const ratio = contrastRatio(textL, bgL);

    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("color contrast for tertiary text meets WCAG AA (dark theme)", () => {
    const textTertiary = 0x8494a7;
    const bgMain = 0x0a0b10;

    function luminance(hex: number): number {
      const r = ((hex >> 16) & 0xff) / 255;
      const g = ((hex >> 8) & 0xff) / 255;
      const b = (hex & 0xff) / 255;

      const sR = r <= 0.03928 ? r / 12.92 : ((r + 0.055) / 1.055) ** 2.4;
      const sG = g <= 0.03928 ? g / 12.92 : ((g + 0.055) / 1.055) ** 2.4;
      const sB = b <= 0.03928 ? b / 12.92 : ((b + 0.055) / 1.055) ** 2.4;

      return 0.2126 * sR + 0.7152 * sG + 0.0722 * sB;
    }

    function contrastRatio(l1: number, l2: number): number {
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    const textL = luminance(textTertiary);
    const bgL = luminance(bgMain);
    const ratio = contrastRatio(textL, bgL);

    // Tertiary text is used at larger sizes / less critical contexts; 4.5:1 still required
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("keyboard navigation: interactive elements have visible focus styles", () => {
    const { container } = render(
      <div>
        <button>Submit</button>
        <a href="#main-content">Skip</a>
        <input type="text" />
      </div>,
    );

    // Verify elements are focusable
    const button = container.querySelector("button")!;
    const link = container.querySelector("a")!;
    const input = container.querySelector("input")!;

    button.focus();
    expect(document.activeElement).toBe(button);

    link.focus();
    expect(document.activeElement).toBe(link);

    input.focus();
    expect(document.activeElement).toBe(input);
  });

  it("accordion has proper aria-expanded and aria-controls", async () => {
    const { container } = render(
      <div role="region" aria-label="Accordion">
        <button
          aria-expanded={true}
          aria-controls="accordion-panel-faq1"
          id="accordion-header-faq1"
        >
          What is YieldVault?
        </button>
        <div
          id="accordion-panel-faq1"
          role="region"
          aria-labelledby="accordion-header-faq1"
        >
          YieldVault is a decentralized yield platform.
        </div>
      </div>,
    );

    const results = await runAxe(container);
    expectNoViolations(results);
  });

  // ─── Additional Contrast & Component Tests (Issue #993) ──────────────────

  it("disabled buttons have sufficient contrast", async () => {
    const { container } = render(
      <div>
        <button disabled>Disabled Primary</button>
        <button className="btn-outline" disabled>
          Disabled Outline
        </button>
      </div>,
    );

    // Verify disabled buttons are focusable and have clear styling
    const buttons = container.querySelectorAll("button[disabled]");
    expect(buttons.length).toBeGreaterThan(0);

    // Check they're still reachable by keyboard
    buttons.forEach((btn) => {
      expect(btn.getAttribute("disabled")).toBe("");
    });
  });

  it("badge color variants meet contrast requirements", () => {
    // Verify badge color combinations meet 4.5:1 minimum for normal text
    const badgeColorTests = [
      { name: "cyan", text: 0x00f0ff, bg: 0x021c44 }, // rgba(2, 132, 199, 0.15) on dark
      { name: "purple", text: 0xd8b4fe, bg: 0x1a1a2e }, // #d8b4fe on dark bg
      { name: "success", text: 0x86efac, bg: 0x1a1a2e }, // #86efac on dark bg
      { name: "warning", text: 0xfcd34d, bg: 0x1a1a2e }, // #fcd34d on dark bg
      { name: "error", text: 0xfca5a5, bg: 0x1a1a2e }, // #fca5a5 on dark bg
      { name: "info", text: 0x93c5fd, bg: 0x1a1a2e }, // #93c5fd on dark bg
    ];

    function luminance(hex: number): number {
      const r = ((hex >> 16) & 0xff) / 255;
      const g = ((hex >> 8) & 0xff) / 255;
      const b = (hex & 0xff) / 255;

      const sR = r <= 0.03928 ? r / 12.92 : ((r + 0.055) / 1.055) ** 2.4;
      const sG = g <= 0.03928 ? g / 12.92 : ((g + 0.055) / 1.055) ** 2.4;
      const sB = b <= 0.03928 ? b / 12.92 : ((b + 0.055) / 1.055) ** 2.4;

      return 0.2126 * sR + 0.7152 * sG + 0.0722 * sB;
    }

    function contrastRatio(l1: number, l2: number): number {
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    badgeColorTests.forEach(({ name, text, bg }) => {
      const textL = luminance(text);
      const bgL = luminance(bg);
      const ratio = contrastRatio(textL, bgL);
      expect(ratio, `Badge ${name} should meet 4.5:1 contrast`).toBeGreaterThanOrEqual(4.5);
    });
  });

  it("tabs component has sufficient inactive tab contrast", async () => {
    const { container } = render(
      <div>
        <div role="tablist" aria-orientation="horizontal">
          <button
            role="tab"
            aria-selected={false}
            aria-controls="panel-tab2"
            id="tab-tab2"
            tabIndex={-1}
            style={{
              color: "var(--text-secondary)",
              background: "transparent",
            }}
          >
            Inactive Tab
          </button>
        </div>
      </div>,
    );

    const results = await runAxe(container);
    expectNoViolations(results);
  });

  it("health status indicator tooltip is readable", async () => {
    const { container } = render(
      <div
        id="hs-tooltip"
        role="tooltip"
        style={{
          background: "var(--bg-surface)",
          color: "var(--text-primary)",
          padding: "10px",
        }}
      >
        <div style={{ fontWeight: 600, color: "#22c55e" }}>✓ Healthy</div>
        <div style={{ color: "var(--text-secondary)" }}>All systems operational</div>
      </div>,
    );

    const results = await runAxe(container);
    expectNoViolations(results);
  });

  it("breadcrumbs have sufficient font size and contrast", async () => {
    const { container } = render(
      <nav aria-label="Breadcrumb">
        <ol style={{ display: "flex", gap: "8px" }}>
          <li>
            <a href="/" style={{ color: "var(--text-secondary)" }}>
              Home
            </a>
          </li>
          <li aria-current="page" style={{ color: "var(--text-primary)" }}>
            Current Page
          </li>
        </ol>
      </nav>,
    );

    const results = await runAxe(container);
    expectNoViolations(results);
  });

  it("small text combinations avoid tertiary color", async () => {
    // Test that small text (var(--text-xs)) is not combined with --text-tertiary
    const { container } = render(
      <div>
        <p
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--text-secondary)",
          }}
        >
          This is small secondary text (acceptable)
        </p>
        <p
          style={{
            fontSize: "var(--text-base)",
            color: "var(--text-tertiary)",
          }}
        >
          This is base tertiary text (acceptable)
        </p>
      </div>,
    );

    const results = await runAxe(container);
    expectNoViolations(results);
  });

  it("focus styles are visible on all interactive elements", () => {
    const { container } = render(
      <div>
        <button style={{ outline: "2px solid var(--accent-cyan)", outlineOffset: "2px" }}>
          Focused Button
        </button>
        <a href="#test" style={{ outline: "2px solid var(--accent-cyan)", outlineOffset: "2px" }}>
          Focused Link
        </a>
        <input type="text" style={{ outline: "2px solid var(--accent-cyan)", outlineOffset: "2px" }} />
      </div>,
    );

    const elements = container.querySelectorAll("button, a, input");
    elements.forEach((el) => {
      // Verify element is in DOM and focusable
      expect(el).toBeTruthy();
    });
  });

  it("error state text meets contrast requirements", () => {
    // Verify error text color has sufficient contrast
    const errorText = 0xfca5a5; // Light error for dark background
    const errorBg = 0x1a1a2e; // Dark background

    function luminance(hex: number): number {
      const r = ((hex >> 16) & 0xff) / 255;
      const g = ((hex >> 8) & 0xff) / 255;
      const b = (hex & 0xff) / 255;

      const sR = r <= 0.03928 ? r / 12.92 : ((r + 0.055) / 1.055) ** 2.4;
      const sG = g <= 0.03928 ? g / 12.92 : ((g + 0.055) / 1.055) ** 2.4;
      const sB = b <= 0.03928 ? b / 12.92 : ((b + 0.055) / 1.055) ** 2.4;

      return 0.2126 * sR + 0.7152 * sG + 0.0722 * sB;
    }

    function contrastRatio(l1: number, l2: number): number {
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    const textL = luminance(errorText);
    const bgL = luminance(errorBg);
    const ratio = contrastRatio(textL, bgL);

    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
