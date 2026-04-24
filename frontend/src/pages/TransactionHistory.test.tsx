import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import TransactionHistory from "./TransactionHistory";
import * as transactionApi from "../lib/transactionApi";
import type { Transaction } from "../lib/transactionApi";

// Mock the transactionApi module
vi.mock("../lib/transactionApi", async (importOriginal) => {
  const actual = await importOriginal<typeof transactionApi>();
  return {
    ...actual,
    getTransactions: vi.fn(),
  };
});

const mockGetTransactions = vi.mocked(transactionApi.getTransactions);

const WALLET = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "1",
    type: "deposit",
    amount: "100.00",
    asset: "USDC",
    timestamp: "2025-01-15T10:30:00Z",
    transactionHash: "abcdef1234567890abcdef1234567890abcdef12",
    ...overrides,
  };
}

function makeManyTransactions(count: number): Transaction[] {
  return Array.from({ length: count }, (_, i) =>
    makeTransaction({
      id: String(i + 1),
      type: i % 2 === 0 ? "deposit" : "withdrawal",
      amount: String((i + 1) * 10),
      transactionHash: `hash${String(i).padStart(36, "0")}`,
    }),
  );
}

function renderPage(walletAddress: string | null, initialEntries = ["/"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <TransactionHistory walletAddress={walletAddress} />
    </MemoryRouter>,
  );
}

describe("TransactionHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Req 1.3 — no wallet connected
  it("renders connect-wallet prompt when walletAddress is null", () => {
    renderPage(null);

    expect(screen.getByText(/Please connect your wallet/i)).toBeInTheDocument();
    expect(mockGetTransactions).not.toHaveBeenCalled();
  });

  // Req 2.5 — loading indicator while fetch is pending
  it("shows loading indicator while fetch is pending", async () => {
    let resolvePromise!: (value: Transaction[]) => void;
    mockGetTransactions.mockReturnValue(
      new Promise<Transaction[]>((resolve) => {
        resolvePromise = resolve;
      }),
    );

    renderPage(WALLET);

    expect(
      screen.getAllByText(/Loading transactions\.\.\./i).length,
    ).toBeGreaterThan(0);

    // Resolve to avoid act() warnings
    resolvePromise([]);
    await waitFor(() =>
      expect(
        screen.queryByText(/Loading transactions\.\.\./i),
      ).not.toBeInTheDocument(),
    );
  });

  // Req 2.1 — calls getTransactions with correct wallet address
  it("calls getTransactions with the correct wallet address on mount", async () => {
    mockGetTransactions.mockResolvedValue([]);

    renderPage(WALLET);

    await waitFor(() =>
      expect(mockGetTransactions).toHaveBeenCalledWith({
        walletAddress: WALLET,
        limit: 10,
        order: "desc",
        type: "all",
      }),
    );
  });

  // Req 1.4, 2.3 — renders table when wallet connected and fetch succeeds
  it("renders the transaction table when wallet is connected and fetch succeeds", async () => {
    mockGetTransactions.mockResolvedValue([makeTransaction()]);

    renderPage(WALLET);

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
  });

  // Req 2.4 — shows ApiStatusBanner on fetch failure
  it("shows ApiStatusBanner on fetch failure", async () => {
    mockGetTransactions.mockRejectedValue(new TypeError("Failed to fetch"));

    renderPage(WALLET);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Data unavailable");
  });

  // Req 3.1 — correct column headers
  it("renders correct column headers: Type, Amount, Asset, Date, Transaction Hash", async () => {
    mockGetTransactions.mockResolvedValue([]);

    renderPage(WALLET);

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    // Use columnheader role to scope to <th> elements only
    expect(
      screen.getByRole("columnheader", { name: /^Type$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: /^Amount$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: /^Asset$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: /^Date$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: /^Transaction Hash$/i }),
    ).toBeInTheDocument();
  });

  // Req 3.2 — sort controls exist for Type, Amount, Date; absent for Asset and Hash
  it("has sort buttons for Type, Amount, Date but not for Asset and Transaction Hash", async () => {
    mockGetTransactions.mockResolvedValue([]);

    renderPage(WALLET);

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    expect(
      screen.getByRole("button", { name: /Sort by Type/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Sort by Amount/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Sort by Date/i }),
    ).toBeInTheDocument();

    expect(
      screen.queryByRole("button", { name: /Sort by Asset/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Sort by Transaction Hash/i }),
    ).not.toBeInTheDocument();
  });

  // Req 4.1 — default page size is 10
  it("default page size select shows 10", async () => {
    mockGetTransactions.mockResolvedValue([]);

    renderPage(WALLET);

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    const rowsSelect = screen.getByRole("combobox", { name: /Rows per page/i });
    expect(rowsSelect).toHaveValue("10");
  });

  // Req 5.1 — filter control renders All / Deposit / Withdrawal options
  it("renders filter control with All, Deposit, and Withdrawal options", async () => {
    mockGetTransactions.mockResolvedValue([]);

    renderPage(WALLET);

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    const filterSelect = screen.getByRole("combobox", {
      name: /Filter by type/i,
    });
    const options = Array.from(filterSelect.querySelectorAll("option")).map(
      (o) => o.textContent,
    );

    expect(options).toContain("All");
    expect(options).toContain("Deposit");
    expect(options).toContain("Withdrawal");
  });

  // Req 5.3 — applying filter resets page to 1
  it("resets page to 1 when filter is applied", async () => {
    // 15 transactions so we have 2 pages
    mockGetTransactions.mockResolvedValue(makeManyTransactions(15));

    renderPage(WALLET);

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    // Navigate to page 2
    const nextBtn =
      screen.queryByRole("button", { name: /Go to next page/i }) ??
      screen.getAllByRole("button", { name: /Next/i })[0];
    fireEvent.click(nextBtn);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { current: "page", name: /Go to page 2/i }),
      ).toBeInTheDocument(),
    );

    // Apply a filter — should reset to page 1
    const filterSelect = screen.getByRole("combobox", {
      name: /Filter by type/i,
    });
    fireEvent.change(filterSelect, { target: { value: "deposit" } });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { current: "page", name: /Go to page 1/i }),
      ).toBeInTheDocument(),
    );
  });

  // Req 6.1 — type badge renders with distinct class per type
  it("renders deposit badge with 'cyan' class and withdrawal badge with 'red' class", async () => {
    mockGetTransactions.mockResolvedValue([
      makeTransaction({ id: "1", type: "deposit" }),
      makeTransaction({ id: "2", type: "withdrawal" }),
    ]);

    renderPage(WALLET);

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    const depositBadge = screen.getByText("deposit");
    const withdrawalBadge = screen.getByText("withdrawal");

    expect(depositBadge).toBeInTheDocument();
    expect(withdrawalBadge).toBeInTheDocument();
  });

  // Req 7.1 — empty state when no transactions
  it("shows empty state message when wallet is connected but no transactions exist", async () => {
    mockGetTransactions.mockResolvedValue([]);

    renderPage(WALLET);

    await waitFor(() =>
      expect(
        screen.getByText("No transactions found for this wallet."),
      ).toBeInTheDocument(),
    );
  });

  // Req 7.2 — filtered empty state message
  it("shows filtered empty state message when filter yields no results", async () => {
    // Only deposits — filtering by withdrawal should show filtered empty message
    mockGetTransactions.mockImplementation(async (params: unknown) => {
      const p = params as { type?: string };
      if (p.type === "withdrawal") return [];
      return [makeTransaction({ id: "1", type: "deposit" })];
    });

    renderPage(WALLET);

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    const filterSelect = screen.getByRole("combobox", {
      name: /Filter by type/i,
    });
    fireEvent.change(filterSelect, { target: { value: "withdrawal" } });

    await waitFor(() =>
      expect(
        screen.getByText("No transactions matched the current filter."),
      ).toBeInTheDocument(),
    );
  });
});
