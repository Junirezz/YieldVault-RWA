import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SessionExpiryWarning from "./SessionExpiryWarning";

// Mock the useTranslation hook
vi.mock("../i18n", () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) => {
      if (key === "session.warning.title") return "Session Expiring Soon";
      if (key === "session.warning.message") return `Your wallet session will expire in ${options?.minutes || 5} minutes. Reconnect to continue without interruption.`;
      if (key === "session.warning.reconnect") return "Reconnect";
      if (key === "common.dismiss") return "Dismiss";
      return key;
    },
  }),
}));

describe("SessionExpiryWarning", () => {
  const mockOnReconnect = vi.fn();
  const mockOnDismiss = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Set up a session that will expire in 4 minutes (less than 5 minute warning threshold)
    const sessionStart = Date.now() - (30 * 60 * 1000) + (4 * 60 * 1000); // 26 minutes ago
    localStorage.setItem("wallet_session_start", sessionStart.toString());
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders warning banner when session is close to expiry", async () => {
    render(
      <SessionExpiryWarning onReconnect={mockOnReconnect} onDismiss={mockOnDismiss} />
    );

    await waitFor(() => {
      expect(screen.getByText("Session Expiring Soon")).toBeInTheDocument();
    });

    expect(screen.getByText(/will expire in \d+ minutes/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("does not render when session is not close to expiry", () => {
    // Set up a fresh session (started 5 minutes ago)
    const sessionStart = Date.now() - (5 * 60 * 1000);
    localStorage.setItem("wallet_session_start", sessionStart.toString());

    render(
      <SessionExpiryWarning onReconnect={mockOnReconnect} onDismiss={mockOnDismiss} />
    );

    expect(screen.queryByText("Session Expiring Soon")).not.toBeInTheDocument();
  });

  it("does not render when no session start time exists", () => {
    localStorage.removeItem("wallet_session_start");

    render(
      <SessionExpiryWarning onReconnect={mockOnReconnect} onDismiss={mockOnDismiss} />
    );

    expect(screen.queryByText("Session Expiring Soon")).not.toBeInTheDocument();
  });

  it("calls onReconnect and updates session start time when reconnect button is clicked", async () => {
    render(
      <SessionExpiryWarning onReconnect={mockOnReconnect} onDismiss={mockOnDismiss} />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reconnect" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));

    expect(mockOnReconnect).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("wallet_session_start")).not.toBeNull();
  });

  it("calls onDismiss when dismiss button is clicked", async () => {
    render(
      <SessionExpiryWarning onReconnect={mockOnReconnect} onDismiss={mockOnDismiss} />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(mockOnDismiss).toHaveBeenCalledTimes(1);
  });

  it("hides banner after session expires", async () => {
    // Set up session that expires in 2 seconds for testing
    const sessionStart = Date.now() - (30 * 60 * 1000) + (2 * 1000);
    localStorage.setItem("wallet_session_start", sessionStart.toString());

    render(
      <SessionExpiryWarning onReconnect={mockOnReconnect} onDismiss={mockOnDismiss} />
    );

    // Should initially show
    await waitFor(() => {
      expect(screen.getByText("Session Expiring Soon")).toBeInTheDocument();
    });

    // Wait for session to expire (should happen in ~2 seconds)
    await waitFor(
      () => {
        expect(screen.queryByText("Session Expiring Soon")).not.toBeInTheDocument();
      },
      { timeout: 3000 }
    );
  });
});