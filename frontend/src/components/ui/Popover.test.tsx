import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Popover } from "./Popover";

// Mock useFloating to avoid DOM measurement issues in jsdom
vi.mock("../../hooks/useFloating", () => ({
  useFloating: () => ({
    triggerRef: { current: null },
    floatingRef: { current: null },
    floatingStyle: { position: "fixed", top: 0, left: 0 },
    actualPlacement: "bottom",
    isHidden: false,
  }),
}));

describe("Popover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up any portals
    document.body.innerHTML = "";
  });

  it("panel opens on trigger click", async () => {
    render(
      <Popover content="Popover content">
        <button>Trigger</button>
      </Popover>
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    expect(screen.getByText("Popover content")).toBeInTheDocument();
  });

  it("panel opens on Enter keydown on trigger", async () => {
    render(
      <Popover content="Popover content">
        <button>Trigger</button>
      </Popover>
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("button", { name: "Trigger" }), {
      key: "Enter",
    });

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  it("panel opens on Space keydown on trigger", async () => {
    render(
      <Popover content="Popover content">
        <button>Trigger</button>
      </Popover>
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "Trigger" }), {
      key: " ",
    });

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  it("panel closes on Escape key press", async () => {
    render(
      <Popover content="Popover content">
        <button>Trigger</button>
      </Popover>
    );

    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("focus returns to trigger after Escape", async () => {
    render(
      <Popover content="Popover content">
        <button>Trigger</button>
      </Popover>
    );

    const trigger = screen.getByRole("button", { name: "Trigger" });
    trigger.focus();

    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    expect(document.activeElement).toBe(trigger);
  });

  it("panel closes on outside click", async () => {
    render(
      <div>
        <Popover content="Popover content">
          <button>Trigger</button>
        </Popover>
        <button>Outside</button>
      </div>
    );

    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    fireEvent.mouseDown(screen.getByRole("button", { name: "Outside" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("close button closes panel", async () => {
    render(
      <Popover content="Popover content">
        <button>Trigger</button>
      </Popover>
    );

    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("focus returns to trigger after close button click", async () => {
    render(
      <Popover content="Popover content">
        <button>Trigger</button>
      </Popover>
    );

    const trigger = screen.getByRole("button", { name: "Trigger" });
    trigger.focus();

    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    expect(document.activeElement).toBe(trigger);
  });

  it("aria-labelledby references title element when title prop is provided", async () => {
    render(
      <Popover content="Popover content" title="My Title">
        <button>Trigger</button>
      </Popover>
    );

    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    const dialog = screen.getByRole("dialog");
    const labelledById = dialog.getAttribute("aria-labelledby");
    expect(labelledById).toBeTruthy();

    const titleElement = document.getElementById(labelledById!);
    expect(titleElement).toBeInTheDocument();
    expect(titleElement).toHaveTextContent("My Title");
  });

  it("panel has role=dialog and aria-modal=false", async () => {
    render(
      <Popover content="Popover content">
        <button>Trigger</button>
      </Popover>
    );

    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));

    await waitFor(() => {
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAttribute("aria-modal", "false");
    });
  });

  it("panel is absent when disabled=true", () => {
    render(
      <Popover content="Popover content" disabled>
        <button>Trigger</button>
      </Popover>
    );

    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("panel does not close when clicking inside it", async () => {
    render(
      <Popover content={<button>Inside button</button>}>
        <button>Trigger</button>
      </Popover>
    );

    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    fireEvent.mouseDown(screen.getByRole("button", { name: "Inside button" }));

    // Panel should still be open
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Tab key cycles focus within panel (focus trap)", async () => {
    render(
      <Popover
        content={
          <>
            <button>First</button>
            <button>Second</button>
            <button>Third</button>
          </>
        }
      >
        <button>Trigger</button>
      </Popover>
    );

    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    const dialog = screen.getByRole("dialog");

    // Focus the last focusable element (Close button is first, then First, Second, Third)
    const focusableElements = dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const lastElement = focusableElements[focusableElements.length - 1];
    lastElement.focus();

    // Tab from last should wrap to first
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: false });

    expect(document.activeElement).toBe(focusableElements[0]);
  });

  it("Shift+Tab from first focusable element wraps to last", async () => {
    render(
      <Popover
        content={
          <>
            <button>First</button>
            <button>Second</button>
          </>
        }
      >
        <button>Trigger</button>
      </Popover>
    );

    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    const dialog = screen.getByRole("dialog");
    const focusableElements = dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    firstElement.focus();

    // Shift+Tab from first should wrap to last
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });

    expect(document.activeElement).toBe(
      focusableElements[focusableElements.length - 1]
    );
  });

  it("renders title when title prop is provided", async () => {
    render(
      <Popover content="Content text" title="Panel Title">
        <button>Trigger</button>
      </Popover>
    );

    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));

    await waitFor(() => {
      expect(screen.getByText("Panel Title")).toBeInTheDocument();
    });
  });

  it("renders content inside the panel", async () => {
    render(
      <Popover content={<p>Rich content here</p>}>
        <button>Trigger</button>
      </Popover>
    );

    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));

    await waitFor(() => {
      expect(screen.getByText("Rich content here")).toBeInTheDocument();
    });
  });
});
