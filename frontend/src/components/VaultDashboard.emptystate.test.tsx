import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import VaultDashboard from "./VaultDashboard";
import { VaultProvider } from "../context/VaultContext";
import { ToastProvider } from "../context/ToastContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import * as portfolioHooks from "../hooks/usePortfolioData";
import * as vaultDataHooks from "../hooks/useVaultData";
import * as tokenAllowanceHooks from "../hooks/useTokenAllowance";
import type { UseQueryResult } from "@tanstack/react-query";
import type { PortfolioHolding } from "../lib/portfolioApi";
import type { VaultSummary } from "../lib/vaultApi";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../hooks/usePortfolioData", () => ({
  usePortfolioHoldings: vi.fn(),
}));

vi.mock("../hooks/useVaultData", () => ({
  useVaultSummary: vi.fn(),
  useVaultHistory: vi.fn(),
}));

vi.mock("../hooks/useTokenAllowance", () => ({
  useTokenAllowance: vi.fn(),
}));

// ── Shared mock data ───────────────────────────────────────────────────────

const mockSummary: VaultSummary = {
  tvl: 12450800,
  depositCap: 15000000,
  apy: 8.45,
  participantCount: 1248,
  monthlyGrowthPct: 12.5,
  strategyStabilityPct: 99.9,
  assetLabel: "Sovereign Debt",
  exchangeRate: 1.084,
  networkFeeEstimate: "~0.00001 XLM",
  updatedAt: "2026-03-25T10:00:00.000Z",
  contractPaused: false,
  strategy: {
    id: "stellar-benji",
    name: "Franklin BENJI Connector",
    issuer: "Franklin Templeton",
    network: "Stellar",
    rpcUrl: "https://soroban-testnet.stellar.org",
    status: "active",
    description: "Connector strategy.",
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function renderDashboard(
  walletAddress: string | null,
  usdcBalance = 0,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <VaultProvider>
            <VaultDashboard
              walletAddress={walletAddress}
              usdcBalance={usdcBalance}
            />
          </VaultProvider>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("VaultDashboard — empty state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    vi.mocked(portfolioHooks.usePortfolioHoldings).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as UseQueryResult<PortfolioHolding[], Error>);

    vi.mocked(vaultDataHooks.useVaultSummary).mockReturnValue({
      data: mockSummary,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as UseQueryResult<VaultSummary, Error>);

    vi.mocked(vaultDataHooks.useVaultHistory).mockReturnValue({
      data: [
        { date: "2026-03-20", value: 1.0 },
        { date: "2026-03-25", value: 1.084 },
      ],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as UseQueryResult<{ date: string; value: number }[], Error>);

    vi.mocked(tokenAllowanceHooks.useTokenAllowance).mockReturnValue({
      allowance: 0,
      approvalStatus: "idle",
      needsApproval: vi.fn().mockReturnValue(false),
      approve: vi.fn().mockResolvedValue(undefined),
      resetApproval: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the empty state when wallet is connected and balance is zero", async () => {
    renderDashboard("GABC123", 0);

    await waitFor(() => {
      expect(screen.getByText("No deposits yet.")).toBeInTheDocument();
    });

    expect(
      screen.getByText(
        /Start earning yield by depositing USDC into our high-efficiency vaults\./i,
      ),
    ).toBeInTheDocument();
  });

  it("renders the Deposit Now CTA in the empty state", async () => {
    renderDashboard("GABC123", 0);

    await waitFor(
      () => {
        expect(screen.getByRole("button", { name: "Deposit Now" })).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
  });

  it("Deposit Now CTA dispatches TRIGGER_DEPOSIT event", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    renderDashboard("GABC123", 0);

    const cta = await screen.findByRole("button", { name: "Deposit Now" });
    fireEvent.click(cta);

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "TRIGGER_DEPOSIT" }),
    );
  });

  it("does NOT show the empty state when balance is non-zero", async () => {
    renderDashboard("GABC123", 1250.5);

    // Give async effects time to settle
    await waitFor(() => {
      expect(screen.queryByText("No deposits yet.")).not.toBeInTheDocument();
    });
  });

  it("does NOT show the empty state while loading is in progress", () => {
    vi.mocked(vaultDataHooks.useVaultSummary).mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    } as unknown as UseQueryResult<VaultSummary, Error>);

    renderDashboard("GABC123", 0);

    expect(screen.queryByText("No deposits yet.")).not.toBeInTheDocument();
  });

  it("does NOT show the empty state when wallet is not connected", () => {
    renderDashboard(null, 0);

    expect(screen.queryByText("No deposits yet.")).not.toBeInTheDocument();
    // Wallet overlay should be shown instead
    expect(screen.getByText(/Wallet Not Connected/i)).toBeInTheDocument();
  });
});
