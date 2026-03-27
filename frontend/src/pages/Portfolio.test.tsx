import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import Portfolio from "./Portfolio";
import { ToastProvider } from "../context/ToastContext";

const mockHoldings = [
  {
    id: "hold-1",
    asset: "USDC Treasury Pool",
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
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
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
    </MemoryRouter>,
  );
}

describe("Portfolio", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockHoldings), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the wallet prompt when disconnected", () => {
    renderPortfolio("/portfolio", null);

    expect(
      screen.getByText(/Please connect your wallet to view your portfolio/i),
    ).toBeInTheDocument();
  });

  it("renders holdings in the reusable table", async () => {
    renderPortfolio();

    expect(await screen.findByText(/Tokenized T-Bills/i)).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sort by Asset/i })).toBeInTheDocument();
    expect(screen.getAllByText(/Position ID:/i).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Copy position ID/i }).length).toBeGreaterThan(0);
  });

  it("persists filter state in the URL", async () => {
    renderPortfolio();

    const searchInput = await screen.findByPlaceholderText(
      /Search asset, vault, issuer/i,
    );
    fireEvent.change(searchInput, { target: { value: "OpenEden" } });

    await waitFor(() => {
      expect(screen.getByText(/Tokenized T-Bills/i)).toBeInTheDocument();
      expect(screen.queryByText(/USDC Treasury Pool/i)).not.toBeInTheDocument();
      expect(screen.getByTestId("location-display")).toHaveTextContent(
        "search=OpenEden",
      );
    });
  });

  it("supports keyboard sorting and pagination state from the URL", async () => {
    renderPortfolio("/portfolio?page=2&pageSize=4&sortBy=asset&direction=asc");

    expect(await screen.findByText(/Yield Bearing Cash/i)).toBeInTheDocument();
    expect(screen.getByText(/USDC Treasury Pool/i)).toBeInTheDocument();

    const assetSort = screen.getByRole("button", { name: /Sort by Asset/i });
    fireEvent.keyDown(assetSort, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByTestId("location-display")).toHaveTextContent(
        "sortBy=asset",
      );
      expect(screen.getByTestId("location-display")).toHaveTextContent(
        "direction=desc",
      );
      expect(screen.getByTestId("location-display")).toHaveTextContent("page=1");
    });

    const row = screen.getByText(/Yield Bearing Cash/i).closest("tr");
    expect(row).toHaveAttribute("tabindex", "0");
  });
});
