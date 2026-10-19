import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import ConfirmationModal from "./ConfirmationModal";

const baseProps = {
  onClose: vi.fn(),
  onConfirm: vi.fn(),
  actionType: "deposit" as const,
  amount: 100,
  expectedOutput: 99.5,
  estimatedFee: 0.5,
};

function Harness({ isProcessing = false }: { isProcessing?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button data-testid="trigger" onClick={() => setOpen(true)}>
        open
      </button>
      <ConfirmationModal
        {...baseProps}
        isOpen={open}
        isProcessing={isProcessing}
        onClose={() => {
          baseProps.onClose();
          setOpen(false);
        }}
      />
    </div>
  );
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

describe("ConfirmationModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing while closed", () => {
    render(<ConfirmationModal {...baseProps} isOpen={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the dialog with translated copy when open", () => {
    render(<ConfirmationModal {...baseProps} isOpen />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { name: "Confirm Deposit" })).toBeInTheDocument();
    expect(screen.getByText("Estimated Fee")).toBeInTheDocument();
    expect(screen.getByText("Total Cost")).toBeInTheDocument();
  });

  it("shows the large-amount alert for amounts over the threshold", () => {
    render(<ConfirmationModal {...baseProps} isOpen amount={5000} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Large transaction amount detected");
  });

  it("moves focus into the dialog on open", async () => {
    render(<ConfirmationModal {...baseProps} isOpen />);
    const dialog = screen.getByRole("dialog");
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
  });

  it("calls onConfirm when the confirm button is clicked", () => {
    render(<ConfirmationModal {...baseProps} isOpen />);
    fireEvent.click(screen.getByLabelText("Confirm deposit"));
    expect(baseProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", async () => {
    render(<ConfirmationModal {...baseProps} isOpen />);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(baseProps.onClose).toHaveBeenCalledTimes(1));
  });

  it("closes on backdrop click", () => {
    render(<ConfirmationModal {...baseProps} isOpen />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(baseProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores backdrop clicks while processing", () => {
    render(<ConfirmationModal {...baseProps} isOpen isProcessing />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(baseProps.onClose).not.toHaveBeenCalled();
  });

  it("ignores Escape while processing", () => {
    render(<ConfirmationModal {...baseProps} isOpen isProcessing />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(baseProps.onClose).not.toHaveBeenCalled();
  });

  it("does not close when clicking inside the panel", () => {
    render(<ConfirmationModal {...baseProps} isOpen />);
    fireEvent.click(screen.getByRole("heading", { name: "Confirm Deposit" }));
    expect(baseProps.onClose).not.toHaveBeenCalled();
  });

  it("wraps Tab focus from the last element back to the first", () => {
    render(<ConfirmationModal {...baseProps} isOpen />);
    const dialog = screen.getByRole("dialog");
    const focusables = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    const last = focusables[focusables.length - 1];
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(focusables[0]);
  });

  it("restores focus to the trigger after closing", async () => {
    render(<Harness />);
    const trigger = screen.getByTestId("trigger");
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
