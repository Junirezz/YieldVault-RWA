import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToastItem } from "../context/ToastContext";
import ToastCenter from "./ToastCenter";

const { mockUseToast } = vi.hoisted(() => ({ mockUseToast: vi.fn() }));

vi.mock("../context/ToastContext", () => ({
  useToast: () => mockUseToast(),
}));

const sampleToast: ToastItem = {
  id: "toast-1",
  variant: "success",
  title: "Deposit confirmed",
  description: "Your shares are on the way",
  duration: 5000,
  timestamp: 0,
};

function setToasts(toasts: ToastItem[] = []) {
  const dismissToast = vi.fn();
  mockUseToast.mockReturnValue({ toasts, dismissToast });
  return { dismissToast };
}

describe("ToastCenter", () => {
  beforeEach(() => {
    mockUseToast.mockReset();
    setToasts();
  });

  it("opens the notification panel and moves focus into it", async () => {
    render(<ToastCenter />);
    const toggle = screen.getByRole("button", { name: /notifications/i });
    fireEvent.click(toggle);
    const panel = await screen.findByRole("dialog");
    await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));
  });

  it("closes on Escape and restores focus to the toggle", async () => {
    render(<ToastCenter />);
    const toggle = screen.getByRole("button", { name: /notifications/i });
    toggle.focus();
    fireEvent.click(toggle);
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(toggle).toHaveFocus());
  });

  it("does not lock page scroll, since it is a non-modal popover", async () => {
    render(<ToastCenter />);
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    await screen.findByRole("dialog");
    expect(document.body.style.overflow).toBe("");
  });

  it("renders queued toasts and dismisses them by id", () => {
    const { dismissToast } = setToasts([sampleToast]);
    render(<ToastCenter />);
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(screen.getByText("Deposit confirmed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Deposit confirmed" }));
    expect(dismissToast).toHaveBeenCalledWith("toast-1");
  });

  it("renders only the newest toast for a transaction hash without hiding unrelated toasts", () => {
    const transactionHash = "a".repeat(64);
    const { dismissToast } = setToasts([
      {
        ...sampleToast,
        id: "toast-1",
        title: "Transaction submitted",
        status: "submitted",
        transactionHash,
      },
      {
        ...sampleToast,
        id: "toast-2",
        title: "Unrelated notice",
        variant: "info",
      },
      {
        ...sampleToast,
        id: "toast-3",
        title: "Transaction confirmed",
        status: "success",
        transactionHash,
      },
    ]);

    render(<ToastCenter />);
    expect(screen.getByRole("button", { name: "Notifications (2)" })).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(screen.getByText("Transaction confirmed")).toBeInTheDocument();
    expect(screen.queryByText("Transaction submitted")).not.toBeInTheDocument();
    expect(screen.getByText("Unrelated notice")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss Transaction confirmed" }));
    expect(dismissToast).toHaveBeenCalledWith("toast-3");
  });
});
