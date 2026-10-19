import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useState } from "react";
import { Drawer } from "./Drawer";

describe("Drawer", () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function renderDrawer(isOpen = true) {
    return render(
      <Drawer
        isOpen={isOpen}
        onClose={onClose}
        title="Drawer Title"
        description="Drawer description"
      >
        <button type="button">Inside button</button>
      </Drawer>,
    );
  }

  it("renders nothing when closed", () => {
    renderDrawer(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders dialog when open", () => {
    renderDrawer(true);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Drawer Title")).toBeInTheDocument();
    expect(screen.getByText("Drawer description")).toBeInTheDocument();
  });

  it("closes on Escape key press", async () => {
    renderDrawer(true);

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("closes on backdrop click", async () => {
    renderDrawer(true);

    const backdrop = screen.getByText("Drawer Title").closest(".drawer-backdrop");
    expect(backdrop).toBeInTheDocument();
    fireEvent.click(backdrop!);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("does not close when clicking inside the panel", () => {
    renderDrawer(true);

    fireEvent.click(screen.getByRole("button", { name: "Inside button" }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes when close button is clicked", () => {
    renderDrawer(true);

    fireEvent.click(screen.getByRole("button", { name: "Close drawer" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("has aria-modal=true on the dialog", () => {
    renderDrawer(true);
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });

  it("traps focus with Tab key", async () => {
    renderDrawer(true);

    const dialog = screen.getByRole("dialog");
    const focusableElements = dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const lastElement = focusableElements[focusableElements.length - 1];
    lastElement.focus();

    fireEvent.keyDown(document, { key: "Tab" });

    expect(document.activeElement).toBe(focusableElements[0]);
  });

  it("restores focus to the trigger after closing", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button data-testid="drawer-trigger" onClick={() => setOpen(true)}>
            open drawer
          </button>
          <Drawer isOpen={open} onClose={() => setOpen(false)} title="Drawer Title">
            <button type="button">Inside button</button>
          </Drawer>
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByTestId("drawer-trigger");
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole("dialog");

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("restores focus when the drawer unmounts", async () => {
    function Harness() {
      const [mounted, setMounted] = useState(false);
      return (
        <>
          <button data-testid="mount" onClick={() => setMounted(true)}>
            mount
          </button>
          <button data-testid="unmount" onClick={() => setMounted(false)}>
            unmount
          </button>
          {mounted && (
            <Drawer isOpen onClose={() => {}} title="Drawer Title">
              <button type="button">Inside button</button>
            </Drawer>
          )}
        </>
      );
    }

    render(<Harness />);
    const mount = screen.getByTestId("mount");
    mount.focus();
    fireEvent.click(mount);
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByTestId("unmount"));

    await waitFor(() => expect(mount).toHaveFocus());
  });
});
