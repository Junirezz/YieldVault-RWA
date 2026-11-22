import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ToastProvider, useToast } from "./ToastContext";

const VALID_HASH = "a".repeat(64);

function ToastHarness() {
  const toast = useToast();

  return (
    <div>
      <button
        type="button"
        onClick={() =>
          toast.success({
            title: "Saved",
            description: "Changes were stored successfully.",
            duration: 1500,
          })
        }
      >
        Show success
      </button>
      <button
        type="button"
        onClick={() =>
          toast.error({
            title: "Failed",
            description: "Something went wrong.",
            duration: 1500,
          })
        }
      >
        Show error
      </button>
    </div>
  );
}

function TxHashHarness() {
  const toast = useToast();

  return (
    <button
      type="button"
      onClick={() =>
        toast.success({
          title: "Deposit Successful",
          description: "100.00 USDC has been deposited into the vault.",
          duration: 5000,
          txHash: VALID_HASH,
        })
      }
    >
      Show deposit success
    </button>
  );
}

describe("ToastProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows and auto-dismisses toasts", () => {
    const { container } = render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText(/Show success/i));

    // Sonner defers rendering new toasts by a tick; flush it under fake timers.
    act(() => {
      vi.advanceTimersByTime(20);
    });

    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(container.querySelector("[data-sonner-toaster]")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    // Sonner keeps the toast mounted for a 200ms exit animation before unmounting.
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("supports manual dismissal", () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText(/Show error/i));

    // Sonner defers rendering new toasts by a tick; flush it under fake timers.
    act(() => {
      vi.advanceTimersByTime(20);
    });

    expect(screen.getByText("Failed")).toBeInTheDocument();

    const dismiss = screen.getByRole("button", { name: /close|dismiss/i });
    fireEvent.click(dismiss);

    // Dismissal is applied on the next animation frame, then sonner keeps the
    // toast mounted for a 200ms exit animation before unmounting it.
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
  });

  it("renders a copyable explorer link when the toast carries a transaction hash", () => {
    render(
      <ToastProvider>
        <TxHashHarness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText(/Show deposit success/i));

    // Sonner defers rendering new toasts by a tick; flush it under fake timers.
    act(() => {
      vi.advanceTimersByTime(20);
    });

    // The original description is still shown alongside the hash row.
    expect(
      screen.getByText("100.00 USDC has been deposited into the vault."),
    ).toBeInTheDocument();

    const link = screen.getByRole("link", {
      name: `View transaction ${VALID_HASH} on the Stellar explorer`,
    });
    expect(link).toHaveAttribute(
      "href",
      `https://stellar.expert/explorer/testnet/tx/${VALID_HASH}`,
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");

    expect(
      screen.getByRole("button", { name: "Copy transaction hash" }),
    ).toBeInTheDocument();

    // Truncated on screen; the full hash is carried by the title and label.
    expect(screen.getByTitle(VALID_HASH)).toHaveTextContent("aaaaaaaa...aaaa");
  });
});
