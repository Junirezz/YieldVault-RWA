import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import SessionExpiryWarning from "./SessionExpiryWarning";
import { AuthProvider } from "../context/AuthContext";

vi.mock("../i18n", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const interpolate = (message: string) =>
        options
          ? message.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
              options[name] !== undefined ? String(options[name]) : match,
            )
          : message;
      if (key === "session.warning.title") return "Session Expiring Soon";
      if (key === "session.warning.message")
        return interpolate("Your wallet session will expire in {{minutes}} minutes. Reconnect to continue without interruption.");
      if (key === "session.warning.reconnect") return "Reconnect";
      if (key === "common.dismiss") return "Dismiss";
      return key;
    },
  }),
}));

vi.mock("../lib/walletSession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/walletSession")>();
  return {
    ...actual,
    isProviderAvailable: vi.fn().mockResolvedValue(false),
  };
});

function renderWithAuth() {
  return render(
    <AuthProvider>
      <SessionExpiryWarning />
    </AuthProvider>,
  );
}

describe("SessionExpiryWarning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    const sessionStart = Date.now() - (30 * 60 * 1000) + (4 * 60 * 1000);
    localStorage.setItem("wallet_session_start", sessionStart.toString());
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders warning banner when session is close to expiry", async () => {
    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByText("Session Expiring Soon")).toBeInTheDocument();
    });

    expect(screen.getByText(/will expire in \d+ minutes/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("does not render when no session start time exists", () => {
    localStorage.removeItem("wallet_session_start");
    renderWithAuth();
    expect(screen.queryByText("Session Expiring Soon")).not.toBeInTheDocument();
  });

  it("calls renewSession when reconnect button is clicked", async () => {
    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reconnect" })).toBeInTheDocument();
    });

    screen.getByRole("button", { name: "Reconnect" }).click();

    await waitFor(() => {
      expect(screen.queryByText("Session Expiring Soon")).not.toBeInTheDocument();
    });
  });

  it("calls dismissSessionWarning when dismiss button is clicked", async () => {
    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    });

    screen.getByRole("button", { name: "Dismiss" }).click();

    await waitFor(() => {
      expect(screen.queryByText("Session Expiring Soon")).not.toBeInTheDocument();
    });
  });
});
