import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import Portfolio from "./Portfolio";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "../context/ToastContext";
import { PreferencesProvider } from "../context/PreferencesContext";
import * as portfolioApi from "../lib/portfolioApi";
import type { PortfolioHolding } from "../lib/portfolioApi";

vi.mock("../lib/portfolioApi", async (importOriginal) => {
  const actual = await importOriginal<typeof portfolioApi>();
  return {
    ...actual,
    getPortfolioHoldings: vi.fn(async () => [
      {
        id: "hold-1",
        asset: "USDC Treasury Pool",
        vaultId: "vault-1",
        vaultName: "Stellar RWA Yield Fund",
        symbol: "yvUSDC",
        shares: 1250.5,
        apy: 8.45,
        valueUsd: 1250.5,
        unrealizedGainUsd: 42.15,
        issuer: "Franklin Templeton",
        status: "active" as const,
      },
      {
        id: "hold-2",
        asset: "Government Bond Basket",
        vaultId: "vault-2",
        vaultName: "Sovereign Income Sleeve",
        symbol: "yvBOND",
        shares: 840.12,
        apy: 7.2,
        valueUsd: 894.41,
        unrealizedGainUsd: 25.22,
        issuer: "WisdomTree",
        status: "active" as const,
      },
      {
        id: "hold-3",
        asset: "Short Duration Credit",
        vaultId: "vault-3",
        vaultName: "Liquidity Ladder",
        symbol: "yvCASH",
        shares: 500.33,
        apy: 6.85,
        valueUsd: 512.9,
        unrealizedGainUsd: 11.48,
        issuer: "Circle Reserve",
        status: "pending" as const,
      },
      {
        id: "hold-4",
        asset: "Tokenized T-Bills",
        vaultId: "vault-4",
        vaultName: "USD Treasury Express",
        symbol: "yvUSTB",
        shares: 1380,
        apy: 5.95,
        valueUsd: 1404.32,
        unrealizedGainUsd: 19.77,
        issuer: "OpenEden",
        status: "active" as const,
      },
      {
        id: "hold-5",
        asset: "Yield Bearing Cash",
        vaultId: "vault-5",
        vaultName: "Prime Reserve Strategy",
        symbol: "yvPRIME",
        shares: 320.42,
        apy: 7.9,
        valueUsd: 337.08,
        unrealizedGainUsd: 9.66,
        issuer: "Hashnote",
        status: "active" as const,
      },
      {
        id: "hold-6",
        asset: "EM Debt Blend",
        vaultId: "vault-6",
        vaultName: "Global Carry Vault",
        symbol: "yvEMD",
        shares: 214.1,
        apy: 9.1,
        valueUsd: 228.55,
        unrealizedGainUsd: 14.07,
        issuer: "Templeton",
        status: "pending" as const,
      },
    ]),
  };
});

vi.mock("../components/AccountStatementExport", () => ({
  default: () => null,
}));

vi.mock("../hooks/useReferral", () => ({
  useReferralStats: vi.fn().mockReturnValue({ data: null }),
  useReferralLink: vi.fn().mockReturnValue({ referralLink: null, referralCode: null }),
}));

vi.mock("../hooks/useVaultHealth", () => ({
  useVaultHealth: vi.fn().mockReturnValue({
    data: [
      {
        vaultId: "vault-1",
        name: "Stellar RWA Yield Fund",
        status: "healthy",
        latencyMs: 48,
        uptimePct: 99.98,
        lastCheckedAt: "2026-07-24T08:45:00.000Z",
        message: "All systems operational",
      },
      {
        vaultId: "vault-4",
        name: "USD Treasury Express",
        status: "healthy",
        latencyMs: 55,
        uptimePct: 99.99,
        lastCheckedAt: "2026-07-24T08:45:00.000Z",
        message: "All systems operational",
      },
    ],
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("../components/YieldBreakdownChart", () => ({
  default: () => <div data-testid="yield-chart" />,
}));

vi.mock("../components/AccountStatementExport", () => ({
  default: () => null,
}));

vi.mock("../components/ShareModal", () => ({
  default: () => null,
}));

const mockHoldings: PortfolioHolding[] = [
  {
    id: "hold-1",
    asset: "USDC Treasury Pool",
    vaultId: "vault-1",
    vaultName: "Stellar RWA Yield Fund",
    symbol: "yvUSDC",
    shares: 1250.5,
    apy: 8.45,
    valueUsd: 1250.5,
    unrealizedGainUsd: 42.15,
    issuer: "Franklin Templeton",
    status: "active",
  },
  {
    id: "hold-2",
    asset: "Government Bond Basket",
    vaultId: "vault-2",
    vaultName: "Sovereign Income Sleeve",
    symbol: "yvBOND",
    shares: 840.12,
    apy: 7.2,
    valueUsd: 894.41,
    unrealizedGainUsd: 25.22,
    issuer: "WisdomTree",
    status: "active",
  },
  {
    id: "hold-3",
    asset: "Short Duration Credit",
    vaultId: "vault-3",
    vaultName: "Liquidity Ladder",
    symbol: "yvCASH",
    shares: 500.33,
    apy: 6.85,
    valueUsd: 512.9,
    unrealizedGainUsd: 11.48,
    issuer: "Circle Reserve",
    status: "pending",
  },
  {
    id: "hold-4",
    asset: "Tokenized T-Bills",
    vaultId: "vault-4",
    vaultName: "USD Treasury Express",
    symbol: "yvUSTB",
    shares: 1380,
    apy: 5.95,
    valueUsd: 1404.32,
    unrealizedGainUsd: 19.77,
    issuer: "OpenEden",
    status: "active",
  },
  {
    id: "hold-5",
    asset: "Yield Bearing Cash",
    vaultId: "vault-5",
    vaultName: "Prime Reserve Strategy",
    symbol: "yvPRIME",
    shares: 320.42,
    apy: 7.9,
    valueUsd: 337.08,
    unrealizedGainUsd: 9.66,
    issuer: "Hashnote",
    status: "active",
  },
  {
    id: "hold-6",
    asset: "EM Debt Blend",
    vaultId: "vault-6",
    vaultName: "Global Carry Vault",
    symbol: "yvEMD",
    shares: 214.1,
    apy: 9.1,
    valueUsd: 228.55,
    unrealizedGainUsd: 14.07,
    issuer: "Templeton",
    status: "pending",
  },
];

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location-display">{location.pathname}{location.search}</div>;
}

function renderPortfolio(
  initialEntry = "/portfolio",
  walletAddress: string | null = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <PreferencesProvider>
          <ToastProvider>
            <Routes>
              <Route
                path="/portfolio"
                element={
                  <>
                    <Portfolio walletAddress={walletAddress} />
                    <LocationDisplay />
                  </>
                }
              />
            </Routes>
          </ToastProvider>
        </PreferencesProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function waitForHoldingsToLoad() {
  await waitFor(
    () => {
      expect(portfolioApi.getPortfolioHoldings).toHaveBeenCalled();
      expect(screen.getByText(/Tokenized T-Bills/i)).toBeInTheDocument();
    },
    { timeout: 10000 },
  );
}

describe("Portfolio", () => {
  beforeEach(() => {
    vi.mocked(portfolioApi.getPortfolioHoldings).mockReset();
    vi.mocked(portfolioApi.getPortfolioHoldings).mockResolvedValue(mockHoldings);
  });

  it("shows the onboarding panel when disconnected", () => {
    renderPortfolio("/portfolio", null);

    expect(
      screen.getByRole("region", { name: /Getting started guide/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Connect Your Wallet")).toBeInTheDocument();
  });

  it("renders holdings in the reusable table", async () => {
    renderPortfolio("/portfolio?pageSize=10");

    await waitForHoldingsToLoad();

    const table = screen.getByRole("table");
    expect(within(table).getByText(/Tokenized T-Bills/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sort by Asset/i })).toBeInTheDocument();
    expect(within(table).getAllByText(/Position ID:/i).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Copy position ID/i }).length).toBeGreaterThan(0);
  });

  it("persists filter state in the URL", async () => {
    renderPortfolio();

    await waitForHoldingsToLoad();
    const searchInput = screen.getByPlaceholderText(/Search asset, vault, issuer/i);
    fireEvent.change(searchInput, { target: { value: "OpenEden" } });

    await waitFor(() => {
      const table = screen.getByRole("table");
      expect(within(table).getByText(/Tokenized T-Bills/i)).toBeInTheDocument();
      expect(within(table).queryByText(/USDC Treasury Pool/i)).not.toBeInTheDocument();
      expect(screen.getByTestId("location-display")).toHaveTextContent(
        "search=OpenEden",
      );
    });
  });

  it("supports keyboard sorting and pagination state from the URL", async () => {
    renderPortfolio("/portfolio?page=1&pageSize=10&sortBy=asset&sortDirection=asc");

    await waitForHoldingsToLoad();
    await waitFor(() => {
      const table = screen.getByRole("table");
      expect(within(table).getByText(/Tokenized T-Bills/i)).toBeInTheDocument();
      expect(within(table).getByText(/Government Bond Basket/i)).toBeInTheDocument();
    });

    const assetSort = screen.getByRole("button", { name: /Sort by Asset/i });
    fireEvent.keyDown(assetSort, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByTestId("location-display").textContent).toMatch(/sortBy=asset/);
    });
  });

  it("shows vault health overview section", async () => {
    renderPortfolio();

    await waitForHoldingsToLoad();
    expect(screen.getByRole("heading", { name: "Vault Health" })).toBeInTheDocument();
  });
});

describe("Portfolio — empty state", () => {
  afterEach(() => {
    vi.mocked(portfolioApi.getPortfolioHoldings).mockReset();
    vi.mocked(portfolioApi.getPortfolioHoldings).mockResolvedValue(mockHoldings);
  });
  it("shows the empty state when wallet is connected and holdings are empty", async () => {
    vi.mocked(portfolioApi.getPortfolioHoldings).mockResolvedValue([]);

    renderPortfolio("/portfolio", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

    await waitFor(() => {
      expect(screen.getByRole("region", { name: /getting started guide/i })).toBeInTheDocument();
    });

    expect(screen.getByText(/make your first deposit/i)).toBeInTheDocument();
  });

  it("renders the Deposit Now CTA in the empty state", async () => {
    vi.mocked(portfolioApi.getPortfolioHoldings).mockResolvedValue([]);

    renderPortfolio("/portfolio", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /deposit now/i })).toBeInTheDocument();
    });
  });

  it("does NOT show the empty state when holdings have value", async () => {
    vi.mocked(portfolioApi.getPortfolioHoldings).mockResolvedValue([
      {
        id: "pos-1",
        asset: "USDC",
        vaultId: "vault-1",
        vaultName: "RWA Vault",
        symbol: "yvUSDC",
        issuer: "G...",
        shares: 100,
        apy: 8.45,
        valueUsd: 1000,
        unrealizedGainUsd: 50,
        status: "active",
      },
    ]);

    renderPortfolio("/portfolio", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

    await waitFor(() => {
      expect(screen.queryByRole("region", { name: /getting started guide/i })).not.toBeInTheDocument();
    });

    expect(screen.getByText("Position Details")).toBeInTheDocument();
  });
});
