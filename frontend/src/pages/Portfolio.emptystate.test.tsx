import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Portfolio from "./Portfolio";
import { ToastProvider } from "../context/ToastContext";
import * as portfolioApi from "../lib/portfolioApi";
import * as referralHooks from "../hooks/useReferral";
import type { PortfolioHolding } from "../lib/portfolioApi";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../lib/portfolioApi", async (importOriginal) => {
  const actual = await importOriginal<typeof portfolioApi>();
  return { ...actual, getPortfolioHoldings: vi.fn() };
});

vi.mock("../hooks/useReferral", () => ({
  useReferralStats: vi.fn().mockReturnValue({ data: null }),
  useReferralLink: vi.fn().mockReturnValue({ referralLink: null, referralCode: null }),
}));

vi.mock("../components/YieldBreakdownChart", () => ({
  default: () => <div data-testid="yield-chart" />,
}));

vi.mock("../components/ShareModal", () => ({
  default: () => null,
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function renderPortfolio(walletAddress: string | null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <Portfolio walletAddress={walletAddress} />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const mockHolding: PortfolioHolding = {
  id: "pos-1",
  asset: "USDC",
  vaultName: "RWA Vault",
  symbol: "yvUSDC",
  issuer: "G...",
  shares: 100,
  apy: 8.45,
  valueUsd: 1000,
  unrealizedGainUsd: 50,
  status: "active",
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Portfolio — empty state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the empty state when wallet is connected and holdings are empty", async () => {
    vi.mocked(portfolioApi.getPortfolioHoldings).mockResolvedValue([]);

    renderPortfolio("GABC123");

    await waitFor(() => {
      expect(
        screen.getByText("Your portfolio is empty."),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText(
        /Once you deposit, you'll be able to track your assets and growth here\./i,
      ),
    ).toBeInTheDocument();
  });

  it("renders the Deposit Now CTA in the empty state", async () => {
    vi.mocked(portfolioApi.getPortfolioHoldings).mockResolvedValue([]);

    renderPortfolio("GABC123");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Deposit Now" })).toBeInTheDocument();
    });
  });

  it("does NOT show the empty state when holdings have value", async () => {
    vi.mocked(portfolioApi.getPortfolioHoldings).mockResolvedValue([mockHolding]);

    renderPortfolio("GABC123");

    await waitFor(() => {
      expect(screen.queryByText("Your portfolio is empty.")).not.toBeInTheDocument();
    });

    // Holdings table should be visible instead
    expect(screen.getByText("Position Details")).toBeInTheDocument();
  });

  it("does NOT show the empty state while loading is in progress", () => {
    // Never resolves — simulates in-flight request
    vi.mocked(portfolioApi.getPortfolioHoldings).mockReturnValue(
      new Promise(() => undefined),
    );

    renderPortfolio("GABC123");

    // Empty state must not appear during loading
    expect(screen.queryByText("Your portfolio is empty.")).not.toBeInTheDocument();
  });

  it("shows the wallet-not-connected message when no wallet is provided", () => {
    renderPortfolio(null);

    expect(
      screen.getByText(/Please connect your wallet to view your portfolio\./i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Your portfolio is empty.")).not.toBeInTheDocument();
  });
});
