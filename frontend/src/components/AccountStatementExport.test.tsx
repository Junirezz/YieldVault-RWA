import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AccountStatementExport from "./AccountStatementExport";
import * as transactionApi from "../lib/transactionApi";
import * as exportDownload from "../lib/exportDownload";
import type { PortfolioHolding } from "../lib/portfolioApi";

vi.mock("../lib/transactionApi", async (importOriginal) => {
  const actual = await importOriginal<typeof transactionApi>();
  return {
    ...actual,
    getTransactions: vi.fn(),
  };
});

vi.mock("../lib/exportDownload", async (importOriginal) => {
  const actual = await importOriginal<typeof exportDownload>();
  return {
    ...actual,
    downloadTextFile: vi.fn(),
  };
});

const mockGetTransactions = vi.mocked(transactionApi.getTransactions);
const mockDownloadTextFile = vi.mocked(exportDownload.downloadTextFile);

const WALLET = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const holdings: PortfolioHolding[] = [
  {
    id: "pos-1",
    asset: "USDC",
    vaultId: "vault-1",
    vaultName: "Sovereign Debt",
    symbol: "yvUSDC",
    shares: 100,
    apy: 0.08,
    valueUsd: 1000,
    unrealizedGainUsd: 25,
    issuer: "YieldVault",
    status: "active",
  },
];

describe("AccountStatementExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTransactions.mockResolvedValue([
      {
        id: "1",
        type: "deposit",
        status: "completed",
        amount: "100.00",
        asset: "USDC",
        timestamp: "2026-03-15T12:00:00Z",
        transactionHash: "tx-hash-abcdef1234567890abcdef1234567890ab",
      },
    ]);
  });

  it("opens the export dialog and downloads a CSV statement", async () => {
    render(
      <AccountStatementExport walletAddress={WALLET} holdings={holdings} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /export statement/i }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/account statement/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /download statement/i }));

    await waitFor(() => {
      expect(mockDownloadTextFile).toHaveBeenCalledTimes(1);
    });

    const arg = mockDownloadTextFile.mock.calls[0][0];
    expect(arg.fileName).toMatch(/^yieldvault_statement_gaaaaa_.*\.csv$/);
    expect(arg.mimeType).toContain("text/csv");
    expect(arg.content).toContain(WALLET);
    expect(arg.content).toContain("Sovereign Debt");
    expect(mockGetTransactions).toHaveBeenCalled();
  });

  it("downloads JSON when JSON format is selected", async () => {
    render(
      <AccountStatementExport
        walletAddress={WALLET}
        holdings={holdings}
        transactions={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /export statement/i }));
    fireEvent.click(screen.getByLabelText("JSON"));
    fireEvent.click(screen.getByRole("button", { name: /download statement/i }));

    await waitFor(() => {
      expect(mockDownloadTextFile).toHaveBeenCalledTimes(1);
    });

    const arg = mockDownloadTextFile.mock.calls[0][0];
    expect(arg.fileName).toMatch(/\.json$/);
    expect(arg.mimeType).toContain("application/json");
    expect(JSON.parse(arg.content).summary.walletAddress).toBe(WALLET);
    expect(mockGetTransactions).not.toHaveBeenCalled();
  });

  it("filters statement by custom date range", async () => {
    render(
      <AccountStatementExport
        walletAddress={WALLET}
        holdings={holdings}
        transactions={[
          {
            id: "1",
            type: "deposit",
            status: "completed",
            amount: "100.00",
            asset: "USDC",
            timestamp: "2026-01-10T12:00:00Z",
            transactionHash: "tx-1",
          },
          {
            id: "2",
            type: "withdraw",
            status: "completed",
            amount: "50.00",
            asset: "USDC",
            timestamp: "2026-03-20T12:00:00Z",
            transactionHash: "tx-2",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /export statement/i }));

    const startInput = screen.getByLabelText(/start date/i);
    const endInput = screen.getByLabelText(/end date/i);

    fireEvent.change(startInput, { target: { value: "2026-03-01" } });
    fireEvent.change(endInput, { target: { value: "2026-03-31" } });

    fireEvent.click(screen.getByRole("button", { name: /download statement/i }));

    await waitFor(() => {
      expect(mockDownloadTextFile).toHaveBeenCalledTimes(1);
    });

    const arg = mockDownloadTextFile.mock.calls[0][0];
    expect(arg.content).toContain("tx-2");
    expect(arg.content).not.toContain("tx-1");
  });

  it("closes modal on cancel click", async () => {
    render(<AccountStatementExport walletAddress={WALLET} holdings={holdings} />);

    fireEvent.click(screen.getByRole("button", { name: /export statement/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("surfaces an error when transaction fetch fails", async () => {
    mockGetTransactions.mockRejectedValue(new Error("Horizon unavailable"));

    render(<AccountStatementExport walletAddress={WALLET} holdings={holdings} />);

    fireEvent.click(screen.getByRole("button", { name: /export statement/i }));
    fireEvent.click(screen.getByRole("button", { name: /download statement/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Horizon unavailable");
    expect(mockDownloadTextFile).not.toHaveBeenCalled();
  });
});
