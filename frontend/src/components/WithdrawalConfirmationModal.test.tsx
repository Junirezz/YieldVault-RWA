import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import WithdrawalConfirmationModal from "./WithdrawalConfirmationModal";

const baseProps = {
  amount: 100,
  estimatedFee: 0.5,
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

function Harness({ isProcessing = false }: { isProcessing?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button data-testid="trigger" onClick={() => setOpen(true)}>
        open
      </button>
      <WithdrawalConfirmationModal
        {...baseProps}
        isOpen={open}
        isProcessing={isProcessing}
        onCancel={() => {
          baseProps.onCancel();
          setOpen(false);
        }}
      />
    </div>
  );
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

describe("WithdrawalConfirmationModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing while closed", () => {
    render(<WithdrawalConfirmationModal {...baseProps} isOpen={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the dialog with translated copy when open", () => {
    render(<WithdrawalConfirmationModal {...baseProps} isOpen />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { name: "Confirm Withdrawal" })).toBeInTheDocument();
    expect(screen.getByText("Estimated Network Fee")).toBeInTheDocument();
    expect(screen.getByText("Total Deducted")).toBeInTheDocument();
  });

  it("moves focus into the dialog on open", async () => {
    render(<WithdrawalConfirmationModal {...baseProps} isOpen />);
    const dialog = screen.getByRole("dialog");
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
  });

  it("calls onConfirm when the confirm button is clicked", () => {
    render(<WithdrawalConfirmationModal {...baseProps} isOpen />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm Withdrawal" }));
    expect(baseProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  it("closes via onCancel on Escape", async () => {
    render(<WithdrawalConfirmationModal {...baseProps} isOpen />);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(baseProps.onCancel).toHaveBeenCalledTimes(1));
  });

  it("closes on backdrop click when idle", () => {
    render(<WithdrawalConfirmationModal {...baseProps} isOpen />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(baseProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it("ignores backdrop clicks while processing", () => {
    render(<WithdrawalConfirmationModal {...baseProps} isOpen isProcessing />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(baseProps.onCancel).not.toHaveBeenCalled();
  });

  it("ignores Escape while processing", () => {
    render(<WithdrawalConfirmationModal {...baseProps} isOpen isProcessing />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(baseProps.onCancel).not.toHaveBeenCalled();
  });

  it("does not close when clicking inside the panel", () => {
    render(<WithdrawalConfirmationModal {...baseProps} isOpen />);
    fireEvent.click(screen.getByRole("heading", { name: "Confirm Withdrawal" }));
    expect(baseProps.onCancel).not.toHaveBeenCalled();
  });

  it("wraps Tab focus from the last element back to the first", () => {
    render(<WithdrawalConfirmationModal {...baseProps} isOpen />);
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
