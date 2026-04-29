import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Analytics from "./Analytics";
import { VaultProvider } from "../context/VaultContext";
import * as vaultDataHooks from "../hooks/useVaultData";
import type { UseQueryResult } from "@tanstack/react-query";
import type { VaultSummary } from "../lib/vaultApi";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../hooks/useVaultData", () => ({
  useVaultSummary: vi.fn(),
  useVaultHistory: vi.fn(),
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

function renderAnalytics() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <VaultProvider>
          <Analytics />
        </VaultProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Analytics — empty state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(vaultDataHooks.useVaultHistory).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as UseQueryResult<{ date: string; value: number }[], Error>);
  });

  it("shows the empty state when TVL is zero and loading is done", () => {
    vi.mocked(vaultDataHooks.useVaultSummary).mockReturnValue({
      data: { ...mockSummary, tvl: 0 },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as UseQueryResult<VaultSummary, Error>);

    renderAnalytics();

    expect(screen.getByText("No data to display.")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Performance metrics will appear here once your assets start generating yield\./i,
      ),
    ).toBeInTheDocument();
  });

  it("renders the Deposit Now CTA in the empty state", () => {
    vi.mocked(vaultDataHooks.useVaultSummary).mockReturnValue({
      data: { ...mockSummary, tvl: 0 },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as UseQueryResult<VaultSummary, Error>);

    renderAnalytics();

    expect(screen.getByRole("button", { name: "Deposit Now" })).toBeInTheDocument();
  });

  it("does NOT show the empty state while loading", () => {
    vi.mocked(vaultDataHooks.useVaultSummary).mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    } as unknown as UseQueryResult<VaultSummary, Error>);

    renderAnalytics();

    expect(screen.queryByText("No data to display.")).not.toBeInTheDocument();
  });

  it("does NOT show the empty state when TVL is non-zero", () => {
    vi.mocked(vaultDataHooks.useVaultSummary).mockReturnValue({
      data: mockSummary,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as UseQueryResult<VaultSummary, Error>);

    renderAnalytics();

    expect(screen.queryByText("No data to display.")).not.toBeInTheDocument();
    // Metric cards should be visible
    expect(screen.getByText("Total Value Locked")).toBeInTheDocument();
  });

  it("shows the 'Advanced Analytics Coming Soon' placeholder when data is present", () => {
    vi.mocked(vaultDataHooks.useVaultSummary).mockReturnValue({
      data: mockSummary,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as UseQueryResult<VaultSummary, Error>);

    renderAnalytics();

    expect(
      screen.getByText("Advanced Analytics Coming Soon"),
    ).toBeInTheDocument();
  });
});
