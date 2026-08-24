import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import VaultDashboard from "./VaultDashboard";
import { VaultProvider } from "../context/VaultContext";
import { PreferencesProvider } from "../context/PreferencesContext";
import { ToastProvider } from "../context/ToastContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import * as vaultApi from "../lib/vaultApi";
import type { VaultSummary } from "../lib/vaultApi";
import * as portfolioHooks from "../hooks/usePortfolioData";
import * as vaultDataHooks from "../hooks/useVaultData";
import * as tokenAllowanceHooks from "../hooks/useTokenAllowance";
import type { UseQueryResult } from "@tanstack/react-query";
import type { PortfolioHolding } from "../lib/portfolioApi";
import confetti from "canvas-confetti";
import { ApiError } from "../lib/api/error";
import { ValidationError } from "../lib/api/validation";

const { mockDepositMutateAsync, mockWithdrawMutateAsync } = vi.hoisted(() => ({
  mockDepositMutateAsync: vi.fn().mockResolvedValue({}),
  mockWithdrawMutateAsync: vi.fn().mockResolvedValue({}),
}));

vi.mock("canvas-confetti", () => ({
  default: vi.fn(),
}));

vi.mock("../lib/vaultApi", async (importOriginal) => {
  const actual = await importOriginal<typeof vaultApi>();
  return {
    ...actual,
    submitDeposit: vi.fn(),
    estimateNetworkFee: vi.fn().mockResolvedValue("0.05"),
  };
});

vi.mock("../hooks/usePortfolioData", () => ({
  usePortfolioHoldings: vi.fn(),
}));

vi.mock("../hooks/useVaultData", () => ({
  useVaultSummary: vi.fn(),
  useVaultHistory: vi.fn(),
}));

vi.mock("../hooks/useVaultMutations", () => ({
  useDepositMutation: vi.fn(() => ({
    mutateAsync: mockDepositMutateAsync,
    isPending: false,
  })),
  useWithdrawMutation: vi.fn(() => ({
    mutateAsync: mockWithdrawMutateAsync,
    isPending: false,
  })),
}));

vi.mock("../hooks/useTokenAllowance", () => ({
  useTokenAllowance: vi.fn(),
}));

vi.mock("../hooks/useFeeEstimate", () => ({
  useFeeEstimate: () => ({
    feeXlm: 0.05,
    feeUsd: 0.01,
    isEstimating: false,
    isHighFee: false,
    lastUpdated: new Date(),
  }),
}));

vi.mock("../hooks/useTransactionConfirmation", () => ({
  useTransactionConfirmation: () => ({
    requestConfirmation: vi.fn().mockResolvedValue(true),
    modal: null,
    isOpen: false,
  }),
}));

const mockSummary = {
  tvl: 12450800,
  depositCap: 15000000,
  apy: 8.45,
  participantCount: 1248,
  monthlyGrowthPct: 12.5,
  strategyStabilityPct: 99.9,
  assetLabel: "Sovereign Debt",
  exchangeRate: 1.084,
  networkFeeEstimate: "~0.00001 XLM",
  updatedAt: new Date().toISOString(),
  contractPaused: false,
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
  xlmBalance = 10.0,
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="*"
          element={
            <QueryClientProvider client={queryClient}>
              <PreferencesProvider>
                <ToastProvider>
                  <VaultProvider>
                    <VaultDashboard
                      walletAddress={walletAddress}
                      usdcBalance={usdcBalance}
                      xlmBalance={xlmBalance}
                    />
                    <LocationSearchProbe />
                  </VaultProvider>
                </ToastProvider>
              </PreferencesProvider>
            </QueryClientProvider>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("VaultDashboard", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mockDepositMutateAsync.mockReset();
    mockWithdrawMutateAsync.mockReset();
    mockDepositMutateAsync.mockResolvedValue({});
    mockWithdrawMutateAsync.mockResolvedValue({});
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
    vi.mocked(portfolioHooks.usePortfolioHoldings).mockReturnValue({
      data: [{ id: "1", shares: 100, valueUsd: 100, asset: "USDC", vaultName: "RWA Vault", symbol: "yvUSDC", apy: 5, unrealizedGainUsd: 0, issuer: "G...", status: "active" }],
      isLoading: false,
    } as unknown as UseQueryResult<PortfolioHolding[], Error>);

    vi.mocked(vaultDataHooks.useVaultSummary).mockReturnValue({
      data: { ...mockSummary, contractPaused: false },
      isLoading: false,
      error: null,
    } as unknown as UseQueryResult<VaultSummary, Error>);

    vi.mocked(vaultDataHooks.useVaultHistory).mockReturnValue({
      data: [{ date: "2026-03-20", value: 1.0 }, { date: "2026-03-25", value: 1.084 }],
      isLoading: false,
      error: null,
    } as unknown as UseQueryResult<{ date: string; value: number }[], Error>);

    vi.mocked(tokenAllowanceHooks.useTokenAllowance).mockReturnValue({
      allowance: 1_000_000,
      approvalStatus: "confirmed",
      needsApproval: vi.fn().mockReturnValue(false),
      approve: vi.fn().mockResolvedValue(undefined),
      resetApproval: vi.fn(),
    });
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as MediaQueryList));
    localStorage.clear();
  });

  afterEach(() => {
    vi.mocked(console.error).mockRestore?.();
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
    expect(screen.getAllByText(/^Live$|^Fresh/i).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/Fresh just now|Live|Fresh/i)).length).toBeGreaterThan(0);

    expect(await screen.findByText(/Sovereign Debt/i)).toBeInTheDocument();
    expect(screen.getByText(/Strategy ID:/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy strategy ID/i })).toBeInTheDocument();
  });

  it("allows switching between deposit and withdraw tabs", async () => {
    renderDashboard("GABC123", 1250.5, "/?tab=withdraw");
    expect(await screen.findByText(/Amount to withdraw/i)).toBeInTheDocument();

    expect(await screen.findByText(/Review Transaction/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    await waitFor(() => {
      expect(screen.getByTestId("location-search")).toHaveTextContent("tab=withdraw");
      expect(screen.getByText(/Amount to withdraw/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Deposit" }));
    await waitFor(() => {
      expect(screen.getByTestId("location-search")).toHaveTextContent("tab=deposit");
      expect(screen.getByText(/Amount to deposit/i)).toBeInTheDocument();
    });
  }, 15000);

  it("updates the amount input and processes a deposit", async () => {
    let resolveSubmit!: () => void;
    const submitPromise = new Promise<void>((resolve) => {
      resolveSubmit = resolve;
    });
    mockDepositMutateAsync.mockReturnValue(submitPromise);

    renderDashboard("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

    expect(await screen.findByText(/Review Transaction/i)).toBeInTheDocument();

    const input = screen.getByPlaceholderText("0.00");
    fireEvent.change(input, { target: { value: "100" } });
    expect(input).toHaveValue(100);

    fireEvent.click(screen.getByRole("button", { name: "Review Transaction" }));

    const reviewConfirmButton = await screen.findByRole("button", { name: /Confirm deposit/i });
    fireEvent.click(reviewConfirmButton);

    await waitFor(() => {
      expect(mockDepositMutateAsync).toHaveBeenCalled();
    }, { timeout: 10000 });

    expect(screen.getByText(/Fee quote/i)).toBeInTheDocument();

    // Resolve the mocked API call
    resolveSubmit();

    await waitFor(() => {
      expect(screen.getByText(/Finalized/i)).toBeInTheDocument();
    }, { timeout: 10000 });
  }, 15000);

  it("plays the first deposit confetti once per wallet", async () => {
    renderDashboard("GFIRSTDEPOSITWALLET000000000000000000000000000000");

    const input = await screen.findByPlaceholderText("0.00");
    fireEvent.change(input, { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Review Transaction" }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirm deposit/i }));

    await waitFor(() => {
      expect(mockDepositMutateAsync).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(confetti).toHaveBeenCalled();
    });
    expect(localStorage.getItem("yieldvault:first-deposit:GFIRSTDEPOSITWALLET000000000000000000000000000000")).toBe("true");
  });

  it("shows a View on Explorer link after a successful deposit that returns a transaction hash", async () => {
    const txHash = "ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890";
    mockDepositMutateAsync.mockResolvedValue({ txHash });

    renderDashboard("GEXPLORERWALLET000000000000000000000000000000000");

    const input = await screen.findByPlaceholderText("0.00");
    fireEvent.change(input, { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Review Transaction" }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirm deposit/i }));

    const explorerLink = await screen.findByRole(
      "link",
      { name: /view on stellar explorer/i },
      { timeout: 10000 },
    );
    expect(explorerLink).toHaveAttribute(
      "href",
      `https://stellar.expert/explorer/testnet/tx/${txHash}`,
    );
  }, 15000);

  it("omits the explorer link when no transaction hash is returned", async () => {
    mockDepositMutateAsync.mockResolvedValue({});

    renderDashboard("GEXPLORERWALLET000000000000000000000000000000000");

    const input = await screen.findByPlaceholderText("0.00");
    fireEvent.change(input, { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Review Transaction" }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirm deposit/i }));

    expect(await screen.findByText(/Finalized/i, {}, { timeout: 10000 })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /view on stellar explorer/i }),
    ).not.toBeInTheDocument();
  }, 15000);

  it("fills the deposit input with max allowable amount via MAX button", async () => {
    renderDashboard("GABC123");

    expect(await screen.findByText(/Review Transaction/i)).toBeInTheDocument();

    const maxButton = screen.getByRole("button", { name: "MAX" });
    fireEvent.click(maxButton);
    const depositInput = screen.getByLabelText("Deposit amount");
    expect(depositInput).toHaveValue(1250.5);
  });

  it("fills the withdraw input with the vault holdings value via MAX button", async () => {
    renderDashboard("GABC123");

    expect(await screen.findByText(/Review Transaction/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    await waitFor(() => {
      expect(screen.getByTestId("location-search")).toHaveTextContent("tab=withdraw");
    });

    fireEvent.click(screen.getByRole("button", { name: "MAX" }));
    // Holdings mock has a single position worth 100 USD, not the deposit (USDC wallet) balance.
    expect(screen.getByLabelText("Withdrawal amount")).toHaveValue(100);
  });

  it("shows inline error and blocks submit for amounts above balance", async () => {
    renderDashboard("GABC123");

    expect(await screen.findByText(/Review Transaction/i)).toBeInTheDocument();

    const input = screen.getByPlaceholderText("0.00");
    fireEvent.change(input, { target: { value: "2000" } });
    fireEvent.blur(input);

    expect(
      screen.getByText(/Deposit amount cannot exceed your available USDC balance./i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review Transaction" })).toBeDisabled();
  });

  it("shows minimum deposit validation and clears error when corrected", async () => {
    renderDashboard("GABC123");

    expect(await screen.findByText(/Review Transaction/i)).toBeInTheDocument();

    const input = screen.getByPlaceholderText("0.00");
    fireEvent.change(input, { target: { value: "0.5" } });
    fireEvent.blur(input);

    expect(screen.getByText(/Minimum deposit is 1.00 USDC./i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review Transaction" })).toBeDisabled();

    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Review Transaction" })).toBeEnabled();
    });
  });

  it("blocks review before the field is blurred once the amount is below the minimum", async () => {
    renderDashboard("GABC123");

    expect(await screen.findByText(/Review Transaction/i)).toBeInTheDocument();

    const input = screen.getByPlaceholderText("0.00");
    fireEvent.change(input, { target: { value: "0.5" } });

    // No blur yet, so no inline error is shown, but the CTA must still be
    // disabled — validity is computed live, not only from touched errors.
    expect(screen.queryByText(/Minimum deposit is 1.00 USDC./i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review Transaction" })).toBeDisabled();
  });

  it("shows a format error for amounts with more than 7 decimal places", async () => {
    renderDashboard("GABC123");

    expect(await screen.findByText(/Review Transaction/i)).toBeInTheDocument();

    const input = screen.getByPlaceholderText("0.00");
    fireEvent.change(input, { target: { value: "10.123456789" } });
    fireEvent.blur(input);

    expect(
      screen.getByText(/up to 7 decimal places/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review Transaction" })).toBeDisabled();
  });

  it("shows an error when a withdrawal exceeds the vault balance", async () => {
    renderDashboard("GABC123", 1250.5, "/?tab=withdraw");

    const input = await screen.findByPlaceholderText("0.00");
    fireEvent.change(input, { target: { value: "150" } });
    fireEvent.blur(input);

    expect(
      screen.getByText(/Withdrawal amount cannot exceed your available vault balance of 100.00./i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review Transaction" })).toBeDisabled();
  });

  it("shows a normalized API error message when data loading fails", async () => {
    vi.useRealTimers();
    vi.mocked(vaultDataHooks.useVaultSummary).mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error("Failed to fetch"),
    } as unknown as UseQueryResult<VaultSummary, Error>);

    renderDashboard("GABC123");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Data unavailable");
    }, { timeout: 3000 });
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load vault data");
  });

  it("prefills the deposit amount from deep links and removes params", async () => {
    renderDashboard("GABC123", 1250.5, "/?tab=deposit&amount=100&ref=partner");

    const input = await screen.findByPlaceholderText("0.00");
    await waitFor(
      () => {
        expect(input).toHaveValue(100);
      },
      { timeout: 10000 },
    );
    expect(screen.getByTestId("location-search")).toHaveTextContent("ref=partner");
  }, 15000);

   it("ignores invalid deep-link amounts and removes deep-link params", async () => {
     renderDashboard("GABC123", 1250.5, "/?tab=deposit&amount=oops");

     const input = await screen.findByPlaceholderText("0.00");
     await waitFor(() => {
       expect((input as HTMLInputElement).value).toBe("");
     });
   });

  it("clears amount input when switching tabs", async () => {
    renderDashboard("GABC123");

    const input = await screen.findByLabelText("Deposit amount");
    fireEvent.change(input, { target: { value: "100" } });
    expect(input).toHaveValue(100);

    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));

    await waitFor(() => {
      expect(screen.getByTestId("location-search")).toHaveTextContent("tab=withdraw");
      expect(screen.getByLabelText("Withdrawal amount")).not.toHaveValue(100);
    });
  }, 15000);

    it("shows inline error and disables submit when XLM balance is insufficient for network fees", async () => {
      renderDashboard("GABC123", 1250.5, "/", 0.01);

      expect(await screen.findByText(/Review Transaction/i)).toBeInTheDocument();

      const input = screen.getByPlaceholderText("0.00");
      fireEvent.change(input, { target: { value: "100" } });
      await waitFor(() => expect(input).toHaveValue(100));
      fireEvent.blur(input);

      await waitFor(() => {
        expect(
          screen.getByText(/Insufficient XLM balance for network fees/i),
        ).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Review Transaction" })).toBeDisabled();
      });
    });

    it("keeps user on amount step when XLM insufficient, rather than allowing review", async () => {
      renderDashboard("GABC123", 1250.5, "/", 0.01);

      expect(await screen.findByText(/Review Transaction/i)).toBeInTheDocument();

      const inputField = screen.getByPlaceholderText("0.00");
      fireEvent.change(inputField, { target: { value: "100" } });

      const reviewBtn = screen.getByRole("button", { name: "Review Transaction" });
      expect(reviewBtn).toBeDisabled();

      fireEvent.click(reviewBtn);

      // Clicking a disabled CTA must not advance the wizard — the confirm
      // step should never be reached while XLM is insufficient.
      await waitFor(() => {
        expect(screen.getByText(/Amount to deposit/i)).toBeInTheDocument();
        expect(screen.queryByText("Confirm Transaction")).not.toBeInTheDocument();
      });
    });

    it("offers a retry action for a retryable transaction failure and resubmits without resetting the form", async () => {
      const networkError = new ApiError({
        code: "NETWORK_ERROR",
        message: "Network request failed.",
        userMessage: "We could not reach the server. Check your connection and try again.",
        retryable: true,
      });
      mockDepositMutateAsync
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce({});

      renderDashboard("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

      const input = await screen.findByPlaceholderText("0.00");
      fireEvent.change(input, { target: { value: "100" } });
      fireEvent.click(screen.getByRole("button", { name: "Review Transaction" }));
      fireEvent.click(await screen.findByRole("button", { name: /Confirm deposit/i }));

      await screen.findByRole("heading", { name: "Transaction Failed" });
      expect(mockDepositMutateAsync).toHaveBeenCalledTimes(1);

      const retryButton = await screen.findByRole("button", { name: "Retry" });
      expect(input).toHaveValue(100);
      fireEvent.click(retryButton);

      await waitFor(() => {
        expect(mockDepositMutateAsync).toHaveBeenCalledTimes(2);
      });
      await screen.findByRole("heading", { name: "Transaction Successful" });
    }, 15000);

    it("does not offer a retry action for a non-retryable validation failure", async () => {
      const validationError = new ValidationError({
        message: "Validation failed",
        userMessage: "Please review the amount and try again.",
        details: [{ field: "amount", message: "Amount exceeds vault cap" }],
      });
      mockDepositMutateAsync.mockRejectedValue(validationError);

      renderDashboard("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

      const input = await screen.findByPlaceholderText("0.00");
      fireEvent.change(input, { target: { value: "100" } });
      fireEvent.click(screen.getByRole("button", { name: "Review Transaction" }));
      fireEvent.click(await screen.findByRole("button", { name: /Confirm deposit/i }));

      await screen.findByRole("heading", { name: "Transaction Failed" });
      expect(await screen.findByRole("button", { name: "Start Over" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    }, 15000);

    it("stops offering retry after repeated failures and shows a limit message", async () => {
      const networkError = new ApiError({
        code: "NETWORK_ERROR",
        message: "Network request failed.",
        userMessage: "We could not reach the server. Check your connection and try again.",
        retryable: true,
      });
      mockDepositMutateAsync.mockRejectedValue(networkError);

      renderDashboard("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

      const input = await screen.findByPlaceholderText("0.00");
      fireEvent.change(input, { target: { value: "100" } });
      fireEvent.click(screen.getByRole("button", { name: "Review Transaction" }));
      fireEvent.click(await screen.findByRole("button", { name: /Confirm deposit/i }));

      await screen.findByRole("heading", { name: "Transaction Failed" });

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const retryButton = await screen.findByRole("button", { name: "Retry" });
        fireEvent.click(retryButton);
        await waitFor(() => {
          expect(mockDepositMutateAsync).toHaveBeenCalledTimes(attempt + 2);
        });
        await screen.findByRole("heading", { name: "Transaction Failed" });
      }

      expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
      expect(screen.getByText(/Still not going through/i)).toBeInTheDocument();
    }, 15000);
  });
