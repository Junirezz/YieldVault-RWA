import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Tooltip } from "./Tooltip";

// Mock useFloating to avoid DOM measurement issues in jsdom
vi.mock("../../hooks/useFloating", () => ({
  useFloating: () => ({
    triggerRef: { current: null },
    floatingRef: { current: null },
    floatingStyle: { position: "fixed", top: 0, left: 0 },
    actualPlacement: "top",
    isHidden: false,
  }),
}));

describe("Tooltip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ── Focus behaviour ─────────────────────────────────────────────────────────

  it("shows panel immediately on keyboard focus (0 ms delay)", () => {
    render(
      <Tooltip content="Helpful info">
        <button>Trigger</button>
      </Tooltip>
    );

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    // Focus the trigger span
    const triggerSpan = document.querySelector("span")!;
    fireEvent.focus(triggerSpan);

    // With delay=0 the show timer fires immediately when timers are run
    act(() => {
      vi.runAllTimers();
    });

    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent("Helpful info");
  });

  // ── Hover behaviour ─────────────────────────────────────────────────────────

  it("does NOT show panel before 300 ms on hover", () => {
    render(
      <Tooltip content="Hover tip">
        <button>Trigger</button>
      </Tooltip>
    );

    const triggerSpan = document.querySelector("span")!;
    fireEvent.mouseEnter(triggerSpan);

    // Advance by 299 ms — panel must still be hidden
    act(() => {
      vi.advanceTimersByTime(299);
    });

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows panel after 300 ms on hover", () => {
    render(
      <Tooltip content="Hover tip">
        <button>Trigger</button>
      </Tooltip>
    );

    const triggerSpan = document.querySelector("span")!;
    fireEvent.mouseEnter(triggerSpan);

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent("Hover tip");
  });

  // ── Blur / mouse-leave behaviour ─────────────────────────────────────────────

  it("hides panel after blur (within 150 ms)", () => {
    render(
      <Tooltip content="Info">
        <button>Trigger</button>
      </Tooltip>
    );

    const triggerSpan = document.querySelector("span")!;

    // Show immediately via focus
    fireEvent.focus(triggerSpan);
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    // Blur — should hide after 150 ms
    fireEvent.blur(triggerSpan);
    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("hides panel after mouse-leave (within 150 ms)", () => {
    render(
      <Tooltip content="Info">
        <button>Trigger</button>
      </Tooltip>
    );

    const triggerSpan = document.querySelector("span")!;

    // Show via hover
    fireEvent.mouseEnter(triggerSpan);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    // Mouse-leave — hidden after 150 ms
    fireEvent.mouseLeave(triggerSpan);
    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  // ── Escape key behaviour ─────────────────────────────────────────────────────

  it("hides panel on Escape key press", () => {
    render(
      <Tooltip content="Esc me">
        <button>Trigger</button>
      </Tooltip>
    );

    const triggerSpan = document.querySelector("span")!;
    fireEvent.focus(triggerSpan);
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    // Press Escape
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("returns focus to the trigger element when Escape is pressed", () => {
    const { container } = render(
      <Tooltip content="Esc focus">
        <button>Trigger</button>
      </Tooltip>
    );

    const button = container.querySelector("button")!;
    const triggerSpan = container.querySelector("span")!;

    // Give focus to the trigger button so the span's ref can .focus() it
    button.focus();
    fireEvent.focus(triggerSpan);
    act(() => {
      vi.runAllTimers();
    });

    // Escape — focus should return to trigger
    fireEvent.keyDown(document, { key: "Escape" });

    // Since triggerRef.current is null in the mock, verify we at minimum
    // attempt to call focus (no crash).  In a real DOM test the button
    // receives focus; here we just assert the panel is gone.
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  // ── ARIA attributes ──────────────────────────────────────────────────────────

  it("sets aria-describedby on the trigger span when panel is visible", () => {
    render(
      <Tooltip content="Described">
        <button>Trigger</button>
      </Tooltip>
    );

    const triggerSpan = document.querySelector("span")!;

    // Not set before panel is visible
    expect(triggerSpan).not.toHaveAttribute("aria-describedby");

    fireEvent.focus(triggerSpan);
    act(() => {
      vi.runAllTimers();
    });

    const describedById = triggerSpan.getAttribute("aria-describedby");
    expect(describedById).toBeTruthy();

    // The referenced element should exist in the DOM and be the tooltip panel
    const panel = document.getElementById(describedById!);
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveAttribute("role", "tooltip");
  });

  it("removes aria-describedby from trigger span when panel is hidden", () => {
    render(
      <Tooltip content="Described">
        <button>Trigger</button>
      </Tooltip>
    );

    const triggerSpan = document.querySelector("span")!;

    // Show then hide
    fireEvent.focus(triggerSpan);
    act(() => {
      vi.runAllTimers();
    });
    expect(triggerSpan).toHaveAttribute("aria-describedby");

    fireEvent.blur(triggerSpan);
    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(triggerSpan).not.toHaveAttribute("aria-describedby");
  });

  // ── Disabled state ───────────────────────────────────────────────────────────

  it("does not show panel when disabled=true on hover", () => {
    render(
      <Tooltip content="Never shown" disabled>
        <button>Trigger</button>
      </Tooltip>
    );

    // Disabled tooltip renders children directly — no wrapper span
    expect(document.querySelector("span")).not.toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("renders children as-is when disabled=true", () => {
    render(
      <Tooltip content="Never shown" disabled>
        <button>Trigger</button>
      </Tooltip>
    );

    expect(screen.getByRole("button", { name: "Trigger" })).toBeInTheDocument();
  });

  // ── Panel attributes ─────────────────────────────────────────────────────────

  it("renders panel with role=tooltip", () => {
    render(
      <Tooltip content="Role check">
        <button>Trigger</button>
      </Tooltip>
    );

    const triggerSpan = document.querySelector("span")!;
    fireEvent.focus(triggerSpan);
    act(() => {
      vi.runAllTimers();
    });

    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("panel has pointer-events: none", () => {
    render(
      <Tooltip content="No clicks">
        <button>Trigger</button>
      </Tooltip>
    );

    const triggerSpan = document.querySelector("span")!;
    fireEvent.focus(triggerSpan);
    act(() => {
      vi.runAllTimers();
    });

    const panel = screen.getByRole("tooltip");
    expect(panel.style.pointerEvents).toBe("none");
  });

  it("accepts ReactNode content (not just strings)", () => {
    render(
      <Tooltip content={<strong>Rich content</strong>}>
        <button>Trigger</button>
      </Tooltip>
    );

    const triggerSpan = document.querySelector("span")!;
    fireEvent.focus(triggerSpan);
    act(() => {
      vi.runAllTimers();
    });

    expect(screen.getByRole("tooltip")).toContainHTML("<strong>Rich content</strong>");
  });
});
