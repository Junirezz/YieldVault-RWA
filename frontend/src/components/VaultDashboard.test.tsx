import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import VaultDashboard from "./VaultDashboard";
import { VaultProvider } from "../context/VaultContext";
import { ToastProvider } from "../context/ToastContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import * as vaultApi from "../lib/vaultApi";

vi.mock("../lib/vaultApi", async (importOriginal) => {
  const actual = await importOriginal<typeof vaultApi>();
  return {
    ...actual,
    submitDeposit: vi.fn(),
  };
});

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

function LocationSearchProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function renderDashboard(
  walletAddress: string | null,
  usdcBalance = 1250.5,
  initialEntry = "/",
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <VaultProvider>
            <VaultDashboard walletAddress={walletAddress} usdcBalance={usdcBalance} />
            <LocationSearchProbe />
          </VaultProvider>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
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
    expect(screen.getByText(/Strategy ID:/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy strategy ID/i })).toBeInTheDocument();
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
    let resolveSubmit!: () => void;
    const submitPromise = new Promise<void>((resolve) => {
      resolveSubmit = resolve;
    });
    vi.mocked(vaultApi.submitDeposit).mockReturnValue(submitPromise);
    
    renderDashboard("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

    expect(await screen.findByText(/Approve & Deposit/i)).toBeInTheDocument();

    const input = screen.getByPlaceholderText("0.00");
    fireEvent.change(input, { target: { value: "100" } });
    expect(input).toHaveValue(100);

    const button = screen.getByText("Approve & Deposit");
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText(/Processing Transaction/i)).toBeInTheDocument();
    });

    // Resolve the mocked API call
    resolveSubmit();

    // Loading state should be visible while mutation is pending.
    expect(screen.getByText(/Processing Transaction/i)).toBeInTheDocument();
  });

  it("fills the input with max allowable amount via MAX button", async () => {
    renderDashboard("GABC123");

    expect(await screen.findByText(/Approve & Deposit/i)).toBeInTheDocument();

    const maxButton = screen.getByRole("button", { name: "MAX" });
    fireEvent.click(maxButton);
    const input = screen.getByPlaceholderText("0.00");
    expect(input).toHaveValue(1250.5);

    fireEvent.click(screen.getByRole("tab", { name: "Withdraw" }));
    fireEvent.click(maxButton);
    expect(input).toHaveValue(1250.5);
  });

  it("shows inline error and blocks submit for amounts above balance", async () => {
    renderDashboard("GABC123");

    expect(await screen.findByText(/Approve & Deposit/i)).toBeInTheDocument();

    const input = screen.getByPlaceholderText("0.00");
    fireEvent.change(input, { target: { value: "2000" } });
    fireEvent.blur(input);

    expect(
      screen.getByText(/Deposit amount cannot exceed your available USDC balance./i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve & Deposit" })).toBeDisabled();
  });

  it("shows minimum deposit validation and clears error when corrected", async () => {
    renderDashboard("GABC123");

    expect(await screen.findByText(/Approve & Deposit/i)).toBeInTheDocument();

    const input = screen.getByPlaceholderText("0.00");
    fireEvent.change(input, { target: { value: "0.5" } });
    fireEvent.blur(input);

    expect(screen.getByText(/Minimum deposit is 1.00 USDC./i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve & Deposit" })).toBeDisabled();

    fireEvent.change(input, { target: { value: "10" } });

    await waitFor(() => {
      expect(screen.queryByText(/Minimum deposit is 1.00 USDC./i)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Approve & Deposit" })).toBeEnabled();
    });
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
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load vault data");
  });

  it("prefills the deposit amount from deep links and removes params", async () => {
    renderDashboard("GABC123", 1250.5, "/?action=deposit&amount=100&ref=partner");

    const input = await screen.findByPlaceholderText("0.00");
    await waitFor(() => {
      expect(input).toHaveValue(100);
    });
    expect(screen.getByTestId("location-search")).toHaveTextContent("?ref=partner");
  });

  it("ignores invalid deep-link amounts and removes deep-link params", async () => {
    renderDashboard("GABC123", 1250.5, "/?action=deposit&amount=oops");

    const input = await screen.findByPlaceholderText("0.00");
    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe("");
    });
    expect(screen.getByTestId("location-search")).toHaveTextContent("");
  });
});
