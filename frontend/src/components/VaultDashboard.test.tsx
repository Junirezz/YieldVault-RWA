import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import VaultDashboard from "./VaultDashboard";
import { VaultProvider } from "../context/VaultContext";
import { ToastProvider } from "../context/ToastContext";

const mockSummary = {
  tvl: 12450800,
  apy: 8.45,
  participantCount: 1248,
  monthlyGrowthPct: 12.5,
  strategyStabilityPct: 99.9,
  assetLabel: "Sovereign Debt",
  exchangeRate: 1.084,
  networkFeeEstimate: "~0.00001 XLM",
  updatedAt: "2026-03-25T10:00:00.000Z",
  strategy: {
    id: "stellar-benji",
    name: "Franklin BENJI Connector",
    issuer: "Franklin Templeton",
    network: "Stellar",
    rpcUrl: "https://soroban-testnet.stellar.org",
    status: "active" as const,
    description:
      "Connector strategy that routes vault yield updates from BENJI-issued tokenized money market exposure on Stellar.",
  },
};

function renderDashboard(walletAddress: string | null, usdcBalance = 1250.5) {
  return render(
    <ToastProvider>
      <VaultProvider>
        <VaultDashboard walletAddress={walletAddress} usdcBalance={usdcBalance} />
      </VaultProvider>
    </ToastProvider>,
  );
}

describe("VaultDashboard", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockSummary), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the connect overlay when wallet is not connected", async () => {
    renderDashboard(null);

    expect(screen.getByText(/Wallet Not Connected/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Please connect your Freighter wallet/i),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/Franklin BENJI Connector/i),
    ).toBeInTheDocument();
  });

  it("renders the dashboard when wallet is connected", async () => {
    renderDashboard("GABC123");

    expect(screen.queryByText(/Wallet Not Connected/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Global RWA Yield Fund/i)).toBeInTheDocument();
    expect(screen.getByText(/Current APY/i)).toBeInTheDocument();

    expect(await screen.findByText(/Sovereign Debt/i)).toBeInTheDocument();
  });

  it("allows switching between deposit and withdraw tabs", async () => {
    renderDashboard("GABC123");

    expect(await screen.findByText(/Approve & Deposit/i)).toBeInTheDocument();

    const depositTab = screen.getByText("Deposit");
    const withdrawTab = screen.getByText("Withdraw");

    fireEvent.click(withdrawTab);
    expect(screen.getByText(/Amount to withdraw/i)).toBeInTheDocument();

    fireEvent.click(depositTab);
    expect(screen.getByText(/Amount to deposit/i)).toBeInTheDocument();
  });

  it("updates the amount input and processes a deposit", async () => {
    renderDashboard("GABC123");

    expect(await screen.findByText(/Approve & Deposit/i)).toBeInTheDocument();

    vi.useFakeTimers();

    const input = screen.getByPlaceholderText("0.00");
    fireEvent.change(input, { target: { value: "100" } });
    expect(input).toHaveValue(100);

    const button = screen.getByText("Approve & Deposit");
    fireEvent.click(button);

    expect(
      screen.getByText(/Processing Transaction.../i),
    ).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(
      screen.queryByText(/Processing Transaction.../i),
    ).not.toBeInTheDocument();
    expect(screen.getByText("1350.50")).toBeInTheDocument();
  });

  it("shows a normalized API error message when data loading fails", async () => {
    vi.useRealTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    renderDashboard("GABC123");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Data unavailable");
    }, { timeout: 3000 });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "We could not reach the server. Check your connection and try again.",
    );
  });
});
