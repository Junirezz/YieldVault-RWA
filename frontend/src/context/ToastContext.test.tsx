import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { toast as sonnerToast } from "sonner";
import { ToastProvider, useToast } from "./ToastContext";

const TX_HASH = "a".repeat(64);
const VALID_HASH = TX_HASH;

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

/** Simulates repeated poll/event responses for one transaction hash. */
function TransactionToastHarness() {
  const { toasts, ...toast } = useToast();

  return (
    <div>
      <button
        type="button"
        onClick={() =>
          toast.success({
            title: "Transaction submitted",
            description: "Waiting for confirmation",
            transactionHash: TX_HASH,
            status: "submitted",
            duration: 5000,
          })
        }
      >
        Poll submitted
      </button>
      <button
        type="button"
        onClick={() =>
          toast.success({
            title: "Transaction confirmed",
            description: "Included in the ledger",
            transactionHash: TX_HASH,
            status: "success",
            duration: 5000,
          })
        }
      >
        Poll confirmed
      </button>
      <button
        type="button"
        onClick={() => toast.info({ title: "Unrelated notice", duration: 5000 })}
      >
        Unrelated
      </button>
      <output data-testid="toast-list">
        {toasts.map((item) => `${item.id}:${item.title}:${item.status ?? ""}`).join("|")}
      </output>
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

  it("deduplicates repeated poll responses for the same transaction hash", () => {
    const sonnerSpy = vi.spyOn(sonnerToast, "success");
    render(
      <ToastProvider>
        <TransactionToastHarness />
      </ToastProvider>,
    );

    const poll = screen.getByText(/Poll submitted/i);
    fireEvent.click(poll);
    fireEvent.click(poll);
    fireEvent.click(poll);

    const list = screen.getByTestId("toast-list");
    expect(list.textContent?.split("|")).toHaveLength(1);
    expect(list.textContent).toContain("Transaction submitted");
    // The same sonner id is reused, so the notification is never stacked.
    expect(sonnerSpy).toHaveBeenCalledTimes(1);
  });

  it("updates the existing toast when the transaction status changes", () => {
    const sonnerSpy = vi.spyOn(sonnerToast, "success");
    render(
      <ToastProvider>
        <TransactionToastHarness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText(/Poll submitted/i));
    fireEvent.click(screen.getByText(/Poll confirmed/i));

    const list = screen.getByTestId("toast-list");
    expect(list.textContent?.split("|")).toHaveLength(1);
    expect(list.textContent).toContain("Transaction confirmed:success");
    expect(list.textContent).not.toContain("Transaction submitted");
    // The status transition reuses the original toast id.
    expect(sonnerSpy).toHaveBeenCalledTimes(2);
    expect(sonnerSpy.mock.calls[1][1]?.id).toBe(sonnerSpy.mock.calls[0][1]?.id);
  });

  it("does not suppress unrelated toasts", () => {
    render(
      <ToastProvider>
        <TransactionToastHarness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText(/Poll submitted/i));
    fireEvent.click(screen.getByText(/Poll submitted/i));
    fireEvent.click(screen.getByText(/Unrelated/i));

    const list = screen.getByTestId("toast-list");
    expect(list.textContent?.split("|")).toHaveLength(2);
    expect(list.textContent).toContain("Transaction submitted");
    expect(list.textContent).toContain("Unrelated notice");
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
