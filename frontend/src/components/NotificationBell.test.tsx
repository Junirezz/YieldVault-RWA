import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import NotificationBell from "./NotificationBell";
import {
  WithdrawalNotificationProvider,
} from "../context/WithdrawalNotificationContext";
import { dispatchWithdrawalReady } from "../lib/withdrawalNotificationEvents";

// Mock useTransactionHistory to avoid network calls during tests
vi.mock("../hooks/useTransactionData", () => ({
  useTransactionHistory: () => ({ data: [] }),
}));

describe("NotificationBell", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("shows unread count for completed withdrawals on the bell", () => {
    render(
      <MemoryRouter>
        <WithdrawalNotificationProvider walletAddress="G_TEST_USER">
          <NotificationBell />
        </WithdrawalNotificationProvider>
      </MemoryRouter>,
    );

    // Initial state: 0 unread, badge not rendered
    expect(screen.queryByTestId("notification-badge")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();

    // Generate withdrawal-ready event for a completed withdrawal
    dispatchWithdrawalReady({
      id: "tx-completed-1",
      withdrawalId: "wd-c1",
      transactionHash: "0xhashc1",
      amount: "150.00",
      asset: "USDC",
    });

    // Bell now shows unread count (1)
    const badge = screen.getByTestId("notification-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /1 unread/i })).toBeInTheDocument();
  });

  it("deduplicates repeated alerts for the same withdrawal", () => {
    render(
      <MemoryRouter>
        <WithdrawalNotificationProvider walletAddress="G_TEST_USER">
          <NotificationBell />
        </WithdrawalNotificationProvider>
      </MemoryRouter>,
    );

    // Dispatch first event
    dispatchWithdrawalReady({
      id: "tx-dedupe-1",
      withdrawalId: "wd-dedupe",
      transactionHash: "0xdedupehash",
      amount: "50.00",
      asset: "USDC",
    });

    expect(screen.getByTestId("notification-badge")).toHaveTextContent("1");

    // Dispatch repeat event for same withdrawalId
    dispatchWithdrawalReady({
      id: "tx-dedupe-1-repeat",
      withdrawalId: "wd-dedupe",
      transactionHash: "0xdedupehash",
      amount: "50.00",
      asset: "USDC",
    });

    // Count stays 1 due to deduplication
    expect(screen.getByTestId("notification-badge")).toHaveTextContent("1");
  });

  it("opening the panel marks items read and links to the transaction", async () => {
    render(
      <MemoryRouter>
        <WithdrawalNotificationProvider walletAddress="G_TEST_USER">
          <NotificationBell />
        </WithdrawalNotificationProvider>
      </MemoryRouter>,
    );

    dispatchWithdrawalReady({
      id: "tx-open-test",
      withdrawalId: "wd-open-test",
      transactionHash: "0xtransactionreceipt99",
      amount: "75.00",
      asset: "USDC",
    });

    expect(screen.getByTestId("notification-badge")).toHaveTextContent("1");

    // Click the bell button to open the panel
    const bellBtn = screen.getByRole("button", { name: /1 unread/i });
    fireEvent.click(bellBtn);

    // Opening the panel marks items read -> badge is cleared
    await waitFor(() => {
      expect(screen.queryByTestId("notification-badge")).not.toBeInTheDocument();
    });

    // Notification dialog panel is open
    const panel = screen.getByRole("dialog", { name: /Withdrawal Alerts/i });
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveTextContent("Withdrawal Completed");
    expect(panel).toHaveTextContent("75.00 USDC");

    // Links to the transaction
    const txLink = screen.getByRole("link", { name: /View transaction/i });
    expect(txLink).toBeInTheDocument();
    expect(txLink).toHaveAttribute("href", "/receipt/0xtransactionreceipt99");
  });

  it("closes the panel on Escape and restores focus", async () => {
    render(
      <MemoryRouter>
        <WithdrawalNotificationProvider walletAddress="G_TEST_USER">
          <NotificationBell />
        </WithdrawalNotificationProvider>
      </MemoryRouter>,
    );

    const bellBtn = screen.getByRole("button", { name: /Notifications/i });
    bellBtn.focus();
    fireEvent.click(bellBtn);

    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(bellBtn).toHaveFocus();
  });

  it("clears all notifications when Clear all is clicked", async () => {
    render(
      <MemoryRouter>
        <WithdrawalNotificationProvider walletAddress="G_TEST_USER">
          <NotificationBell />
        </WithdrawalNotificationProvider>
      </MemoryRouter>,
    );

    dispatchWithdrawalReady({
      id: "tx-clear-1",
      withdrawalId: "wd-clear-1",
      transactionHash: "0xhashclear1",
      amount: "10.00",
    });

    // Open panel
    fireEvent.click(screen.getByRole("button", { name: /1 unread/i }));

    const clearBtn = screen.getByRole("button", { name: "Clear all" });
    fireEvent.click(clearBtn);

    expect(screen.getByText("No withdrawal alerts yet.")).toBeInTheDocument();
  });
});
