import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import TransactionStatusModal from "./TransactionStatusModal";

describe("TransactionStatusModal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    // Mock navigator.clipboard
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders correctly in submitting state when txHash is null", () => {
    render(
      <TransactionStatusModal
        isOpen={true}
        onClose={vi.fn()}
        txHash={null}
        actionType="deposit"
        amount={150.75}
      />,
    );

    expect(screen.getByText("Sign Transaction")).toBeInTheDocument();
    expect(screen.getByText(/Please approve the transaction in your Freighter/i)).toBeInTheDocument();
    expect(screen.getByText("Transaction Type")).toBeInTheDocument();
    expect(screen.getByText("deposit")).toBeInTheDocument();
    expect(screen.getByText("150.75 USDC")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("renders confirming state and displays hash when non-null txHash is provided", () => {
    render(
      <TransactionStatusModal
        isOpen={true}
        onClose={vi.fn()}
        txHash="mock_hash_1234567890abcdef"
        actionType="withdraw"
        amount={300.0}
      />,
    );

    expect(screen.getByText("Confirming on Ledger")).toBeInTheDocument();
    expect(screen.getByText(/mock_has...cdef/i)).toBeInTheDocument();
  });

  it("copies transaction hash when Copy button is clicked", async () => {
    render(
      <TransactionStatusModal
        isOpen={true}
        onClose={vi.fn()}
        txHash="mock_hash_1234567890abcdef"
        actionType="withdraw"
        amount={300.0}
      />,
    );

    const copyBtn = screen.getByTitle("Copy transaction hash");
    fireEvent.click(copyBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("mock_hash_1234567890abcdef");
  });

  it("simulates mock polling and transitions to success state", async () => {
    const onSuccess = vi.fn();
    // Force mock mode and patch Math.random to always succeed (value < 0.9)
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    render(
      <TransactionStatusModal
        isOpen={true}
        onClose={vi.fn()}
        txHash="mock_hash"
        actionType="deposit"
        amount={100}
        onSuccess={onSuccess}
        mockMode={true}
      />,
    );

    // Initial state confirming
    expect(screen.getByText("Confirming on Ledger")).toBeInTheDocument();

    // Advance 3 poll intervals (3 x 2s = 6s)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(screen.getByText("Transaction Successful")).toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("simulates mock polling and transitions to failure state on simulated random failure", async () => {
    const onFailure = vi.fn();
    // Force mock mode and patch Math.random to fail (value >= 0.9)
    vi.spyOn(Math, "random").mockReturnValue(0.95);

    render(
      <TransactionStatusModal
        isOpen={true}
        onClose={vi.fn()}
        txHash="mock_hash"
        actionType="deposit"
        amount={100}
        onFailure={onFailure}
        mockMode={true}
      />,
    );

    // Advance 3 poll intervals
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(screen.getByText("Transaction Failed")).toBeInTheDocument();
    expect(screen.getByText("Mock transaction failed ledger verification.")).toBeInTheDocument();
    expect(onFailure).toHaveBeenCalledWith("Mock transaction failed ledger verification.");
  });

  it("polls real Horizon API and succeeds when response is successful", async () => {
    const onSuccess = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(new Response(null, { status: 404 })) // 1st poll: pending
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ successful: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ), // 2nd poll: success
    );

    render(
      <TransactionStatusModal
        isOpen={true}
        onClose={vi.fn()}
        txHash="stellar_real_hash_123"
        actionType="deposit"
        amount={50}
        onSuccess={onSuccess}
        mockMode={false} // force real mode
      />,
    );

    // 1st poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText("Confirming on Ledger")).toBeInTheDocument();

    // 2nd poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText("Transaction Successful")).toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("polls real Horizon API and fails when polling times out", async () => {
    const onFailure = vi.fn();
    // Always return 404 (pending)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    );

    render(
      <TransactionStatusModal
        isOpen={true}
        onClose={vi.fn()}
        txHash="stellar_real_hash_123"
        actionType="deposit"
        amount={50}
        onFailure={onFailure}
        mockMode={false} // force real mode
      />,
    );

    // Advance 15 poll intervals (30 seconds)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });

    expect(screen.getByText("Transaction Failed")).toBeInTheDocument();
    expect(screen.getByText(/Transaction polling timed out/i)).toBeInTheDocument();
    expect(onFailure).toHaveBeenCalledWith("Transaction polling timed out.");
  });

  it("calls onClose when Close button is clicked in success or failure states", () => {
    const onClose = vi.fn();
    render(
      <TransactionStatusModal
        isOpen={true}
        onClose={onClose}
        txHash="mock_hash"
        actionType="deposit"
        amount={100}
        error="Transaction rejected by user"
      />,
    );

    // Immediately shows failure due to external error
    expect(screen.getByText("Transaction Failed")).toBeInTheDocument();

    const closeBtn = screen.getByRole("button", { name: "Close" });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("has correct ARIA role and attributes for accessibility", () => {
    render(
      <TransactionStatusModal
        isOpen={true}
        onClose={vi.fn()}
        txHash={null}
        actionType="deposit"
        amount={100}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "tx-modal-title");
    expect(dialog).toHaveAttribute("aria-describedby", "tx-modal-desc");
  });
});
