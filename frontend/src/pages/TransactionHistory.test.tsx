import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TransactionHistory from "./TransactionHistory";
import * as transactionApi from "../lib/transactionApi";
import type { Transaction } from "../lib/transactionApi";
import { ToastProvider } from "../context/ToastContext";
import {
  getPreferenceStorageKey,
  setTransactionPageSize,
  setTransactionViewMode,
} from "../lib/userPreferenceStore";

vi.mock("../hooks/useTransactionTimeline", () => ({
  useTransactionTimeline: () => ({
    status: "pending",
    elapsedSeconds: 0,
    errorMessage: undefined,
    reset: vi.fn(),
  }),
}));

// Hoisted so it can be referenced inside vi.mock factories
const mockNetworkConfig = vi.hoisted(() => ({
  isTestnet: true,
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  contractId: "",
}));

vi.mock("../config/network", () => ({
  networkConfig: mockNetworkConfig,
}));

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
const SECOND_WALLET = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "1",
    type: "deposit",
    status: "completed",
    amount: "100.00",
    asset: "USDC",
    timestamp: "2025-01-15T10:30:00Z",
    transactionHash: "fixture-transaction-default",
    // Deliberately not 40 chars — the pre-commit AWS secret regex flags /[A-Za-z0-9/+=]{40}/.
    transactionHash: "tx-hash-abcdef1234567890abcdef1234567890ab",
    ...overrides,
  };
}

function makeManyTransactions(count: number): Transaction[] {
  return Array.from({ length: count }, (_, i) =>
    makeTransaction({
      id: String(i + 1),
      type: i % 2 === 0 ? "deposit" : "withdrawal",
      amount: String((i + 1) * 10),
      transactionHash: `tx-hash-${String(i).padStart(32, "0")}`,
    }),
  );
}

function renderPage(walletAddress: string | null, initialEntries = ["/"]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <TransactionHistory walletAddress={walletAddress} />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("TransactionHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockNetworkConfig.isTestnet = true;
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Req 1.3 — no wallet connected
  it("renders connect-wallet prompt when walletAddress is null", () => {
    renderPage(null);

    expect(screen.getByRole("heading", { name: /Connect your wallet/i })).toBeInTheDocument();
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

    expect(screen.getAllByText(/Loading\.\.\./i).length).toBeGreaterThan(0);

    // Resolve to avoid act() warnings
    resolvePromise([]);
    await waitFor(() =>
      expect(screen.queryAllByText(/Loading\.\.\./i).length).toBe(0),
    );
  });

  // Req 2.1 — calls getTransactions with correct wallet address
  it("calls getTransactions with the correct wallet address on mount", async () => {
    mockGetTransactions.mockResolvedValue([]);

    renderPage(WALLET);

    await waitFor(() =>
      expect(mockGetTransactions).toHaveBeenCalledWith({
        walletAddress: WALLET,
        limit: 200,
      }),
    );
  });

  // Req 1.4, 2.3 — renders table when wallet connected and fetch succeeds
  it("renders the transaction table when wallet is connected and fetch succeeds", async () => {
    mockGetTransactions.mockResolvedValue([makeTransaction()]);

    renderPage(WALLET);

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
  });

  it("renders an Export CSV button and downloads current transactions", async () => {
    const appendSpy = vi.spyOn(document.body, "appendChild");
    const removeSpy = vi.spyOn(document.body, "removeChild");
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click");

    mockGetTransactions.mockResolvedValue([
      makeTransaction({ id: "1", amount: "123.45", asset: "USDC" }),
      makeTransaction({
        id: "2",
        amount: "67.89",
        asset: "XLM",
        type: "withdrawal",
      }),
    ]);

    renderPage(WALLET);

    const exportButton = await screen.findByRole("button", {
      name: /Export CSV/i,
    });

    fireEvent.click(exportButton);

    expect(clickSpy).toHaveBeenCalled();
    expect(appendSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();

    const appendedCall = appendSpy.mock.calls.find(
      (call) => call[0] instanceof HTMLAnchorElement,
    );
    expect(appendedCall).toBeDefined();

    const appendedLink = appendedCall?.[0] as HTMLAnchorElement;
    expect(appendedLink.getAttribute("download")).toMatch(
      /^transactions_\d{4}-\d{2}-\d{2}\.csv$/,
    );
    expect(appendedLink.getAttribute("href")).toMatch(
      /^(blob:|data:text\/csv;charset=utf-8,)/,
    );
  });

  // Req 2.4 — shows ApiStatusBanner on fetch failure
  it("shows ApiStatusBanner on fetch failure", async () => {
    mockGetTransactions.mockRejectedValue(new TypeError("Failed to fetch"));

    renderPage(WALLET);

    // The banner and the contextual error empty state are both announced.
    const alerts = await screen.findAllByRole("alert");
    expect(
      alerts.some((alert) => alert.textContent?.includes("Data unavailable")),
    ).toBe(true);
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

  it("restores stored page size preference for the current wallet", async () => {
    localStorage.setItem(`yieldvault:transactions:page-size:${WALLET}`, "25");
    mockGetTransactions.mockResolvedValue([]);

    renderPage(WALLET);

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    const rowsSelect = screen.getByRole("combobox", { name: /Rows per page/i });
    expect(rowsSelect).toHaveValue("25");
  });

  it("stores page size preference per wallet without cross-wallet leakage", async () => {
    mockGetTransactions.mockResolvedValue([]);
    const { unmount } = renderPage(WALLET);

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    fireEvent.change(screen.getByRole("combobox", { name: /Rows per page/i }), {
      target: { value: "50" },
    });
    const stored = JSON.parse(localStorage.getItem(getPreferenceStorageKey(WALLET))!);
    expect(stored.data.tables.transactionPageSize).toBe(50);

    unmount();
    renderPage(SECOND_WALLET);

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.getByRole("combobox", { name: /Rows per page/i })).toHaveValue("10");
    expect(localStorage.getItem(getPreferenceStorageKey(SECOND_WALLET))).toBeNull();
  });

  // Req 5.1 — filter control renders Deposit / Withdrawal checkboxes
  it("renders type filter checkboxes for Deposit and Withdrawal", async () => {
    mockGetTransactions.mockResolvedValue([]);

    renderPage(WALLET);

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    expect(
      screen.getByRole("checkbox", { name: /Filter by Type Deposit/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /Filter by Type Withdrawal/i }),
    ).toBeInTheDocument();
  });

  it("filters transactions with a debounced client-side search input", async () => {
    mockGetTransactions.mockResolvedValue([
      makeTransaction({ id: "1", asset: "USDC", type: "deposit" }),
      makeTransaction({
        id: "2",
        asset: "EURC",
        type: "withdrawal",
        transactionHash: "tx-hash-eurcdef1234567890abcdef1234567890",
      }),
    ]);

    renderPage(WALLET);

    const table = await screen.findByRole("table");
    await waitFor(() =>
      expect(within(table).getByText("USDC")).toBeInTheDocument(),
    );

    const searchInput = screen.getByRole("searchbox", {
      name: /Search transactions/i,
    });
    expect(searchInput).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: "EURC" } });

    expect(mockGetTransactions).toHaveBeenCalledTimes(1);
    expect(within(table).getByText("USDC")).toBeInTheDocument();

    await waitFor(
      () =>
        expect(within(table).queryByText("USDC")).not.toBeInTheDocument(),
      { timeout: 2000 },
    );
    expect(within(table).getByText("EURC")).toBeInTheDocument();
    expect(mockGetTransactions).toHaveBeenCalledTimes(1);

    fireEvent.change(searchInput, { target: { value: "" } });

    await waitFor(() => {
      expect(within(table).getByText("USDC")).toBeInTheDocument();
      expect(within(table).getByText("EURC")).toBeInTheDocument();
    });
    expect(mockGetTransactions).toHaveBeenCalledTimes(1);
  });

  // Req 5.3 — applying filter resets page to 1
  it("resets page to 1 when filter is applied", async () => {
    setTransactionViewMode("paginated", WALLET);
    setTransactionPageSize(10, WALLET);
    // 15 transactions so we have 2 pages
    localStorage.setItem(`yieldvault:transactions:view-mode:${WALLET}`, "paginated");
    localStorage.setItem(`yieldvault:transactions:page-size:${WALLET}`, "10");
    mockGetTransactions.mockResolvedValue(makeManyTransactions(15));

    renderPage(WALLET, ["/?page=2&pageSize=10"]);

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    // Navigate to page 2
    const nextBtn =
      screen.queryByRole("button", { name: /Go to next page/i }) ??
      screen.getAllByRole("button", { name: /Next/i })[0];
    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { current: "page", name: /Go to page 2/i }),
      ).toBeInTheDocument();
    });

    // Apply a filter — should reset to page 1
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Filter by Type Deposit/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { current: "page", name: /Go to page 1/i }),
      ).toBeInTheDocument();
    });
  });

  // Req 6.1 — type badge renders with distinct class per type
  it("renders deposit badge with 'cyan' class and withdrawal badge with 'red' class", async () => {
    mockGetTransactions.mockResolvedValue([
      makeTransaction({ id: "1", type: "deposit" }),
      makeTransaction({ id: "2", type: "withdrawal" }),
    ]);

    renderPage(WALLET);

    await waitFor(() => expect(mockGetTransactions).toHaveBeenCalled());

    await waitFor(() => {
      expect(screen.getByText("deposit")).toBeInTheDocument();
      expect(screen.getByText("withdrawal")).toBeInTheDocument();
    });
  });

  // Req 7.1 — empty state when no transactions
  it("shows empty state message when wallet is connected but no transactions exist", async () => {
    mockGetTransactions.mockResolvedValue([]);

    renderPage(WALLET);

    await waitFor(() =>
      expect(
        screen.getByText("No transactions yet"),
      ).toBeInTheDocument(),
    );
  });

  // Req 7.2 — filtered empty state message
  it("shows filtered empty state message when filter yields no results", async () => {
    // Only deposits — filtering by withdrawal should show filtered empty message
    mockGetTransactions.mockImplementation(async (params) => {
      const queryParams = params as { type?: string };
      if (queryParams.type === "withdrawal") return [];
      return [makeTransaction({ id: "1", type: "deposit" })];
    });
    mockGetTransactions.mockResolvedValue([
      makeTransaction({ id: "1", type: "deposit", status: "completed" }),
    ]);

    renderPage(WALLET);

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    fireEvent.click(
      screen.getByRole("checkbox", { name: /Filter by Type Withdrawal/i }),
    );

    await waitFor(() =>
      expect(
        screen.getByText("No transactions found"),
      ).toBeInTheDocument(),
    );
  });

  // New: clear filters hides the clear button
  it("Clear Filters button hides itself after clearing active filters", async () => {
    mockGetTransactions.mockResolvedValue([makeTransaction()]);

    render(
      <MemoryRouter initialEntries={["/?search=USDC"]}>
        <QueryClientProvider
          client={
            new QueryClient({
              defaultOptions: { queries: { retry: false } },
            })
          }
        >
          <ToastProvider>
            <TransactionHistory walletAddress={WALLET} />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    // "Clear all filters" is the aria-label on the clear button in TransactionFilterPanel
    const clearBtn = await screen.findByRole("button", {
      name: /Clear all filters/i,
    });
    expect(clearBtn).toBeInTheDocument();

    fireEvent.click(clearBtn);

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /Clear all filters/i }),
      ).not.toBeInTheDocument(),
    );
  });

  // New: empty state with active filters shows Reset filters action
  it("shows 'Reset filters' action button in empty state when filters are active", async () => {
    // All completed; filtering to 'failed' yields no results
    mockGetTransactions.mockResolvedValue([
      makeTransaction({ id: "1", status: "completed" }),
    ]);

    render(
      <MemoryRouter initialEntries={["/?statuses=failed"]}>
        <QueryClientProvider
          client={
            new QueryClient({
              defaultOptions: { queries: { retry: false } },
            })
          }
        >
          <ToastProvider>
            <TransactionHistory walletAddress={WALLET} />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByText("No transactions found")).toBeInTheDocument(),
    );

    expect(
      screen.getByRole("button", { name: /Reset filters/i }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Stellar Explorer link — network-aware URL (issue #294)
// ---------------------------------------------------------------------------

const VALID_HASH = "a".repeat(64);

describe("TransactionHistory — Stellar Explorer link network", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockNetworkConfig.isTestnet = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("generates a testnet explorer URL when networkConfig.isTestnet is true", async () => {
    mockNetworkConfig.isTestnet = true;
    mockGetTransactions.mockResolvedValue([
      makeTransaction({ transactionHash: VALID_HASH, status: "completed" }),
    ]);

    renderPage(WALLET);

    const link = await screen.findByTitle(VALID_HASH);
    expect(link).toHaveAttribute(
      "href",
      `https://stellar.expert/explorer/testnet/tx/${VALID_HASH}`,
    );
  });

  it("generates a mainnet explorer URL when networkConfig.isTestnet is false", async () => {
    mockNetworkConfig.isTestnet = false;
    mockGetTransactions.mockResolvedValue([
      makeTransaction({ transactionHash: VALID_HASH }),
    ]);

    renderPage(WALLET);

    const link = await screen.findByTitle(VALID_HASH);
    expect(link).toHaveAttribute(
      "href",
      `https://stellar.expert/explorer/public/tx/${VALID_HASH}`,
    );
  });

  it("renders the explorer link with correct security attributes", async () => {
    mockGetTransactions.mockResolvedValue([
      makeTransaction({ transactionHash: VALID_HASH }),
    ]);

    renderPage(WALLET);

    const link = await screen.findByTitle(VALID_HASH);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});

// ---------------------------------------------------------------------------
// Amount range filtering
// ---------------------------------------------------------------------------

describe("TransactionHistory — amount range filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockNetworkConfig.isTestnet = true;
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("hides rows below amountMin when amountMin param is set in URL", async () => {
    mockGetTransactions.mockResolvedValue([
      makeTransaction({ id: "1", amount: "50", asset: "USDC" }),
      makeTransaction({
        id: "2",
        amount: "200",
        asset: "USDC",
        transactionHash: "tx-hash-20000000000000000000000000000000",
      }),
      makeTransaction({
        id: "3",
        amount: "500",
        asset: "USDC",
        transactionHash: "tx-hash-50000000000000000000000000000000",
      }),
    ]);

    render(
      <MemoryRouter initialEntries={["/?amountMin=100"]}>
        <QueryClientProvider
          client={
            new QueryClient({
              defaultOptions: { queries: { retry: false } },
            })
          }
        >
          <ToastProvider>
            <TransactionHistory walletAddress={WALLET} />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    const table = screen.getByRole("table");

    // 50 should be hidden; 200 and 500 should be visible
    await waitFor(() =>
      expect(within(table).queryAllByText(/50 USDC/).length).toBe(0),
    );
    expect(within(table).getByText("200 USDC")).toBeInTheDocument();
    expect(within(table).getByText("500 USDC")).toBeInTheDocument();
  }, 15_000);

  it("hides rows above amountMax when amountMax param is set in URL", async () => {
    mockGetTransactions.mockResolvedValue([
      makeTransaction({ id: "1", amount: "50", asset: "USDC" }),
      makeTransaction({
        id: "2",
        amount: "200",
        asset: "USDC",
        transactionHash: "tx-hash-20000000000000000000000000000000",
      }),
      makeTransaction({
        id: "3",
        amount: "500",
        asset: "USDC",
        transactionHash: "tx-hash-50000000000000000000000000000000",
      }),
    ]);

    render(
      <MemoryRouter initialEntries={["/?amountMax=150"]}>
        <QueryClientProvider
          client={
            new QueryClient({
              defaultOptions: { queries: { retry: false } },
            })
          }
        >
          <ToastProvider>
            <TransactionHistory walletAddress={WALLET} />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    const table = screen.getByRole("table");

    // Only 50 should be visible
    await waitFor(() =>
      expect(within(table).queryAllByText(/500 USDC/).length).toBe(0),
    );
    expect(within(table).getByText("50 USDC")).toBeInTheDocument();
    expect(within(table).queryAllByText(/200 USDC/).length).toBe(0);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Status filtering
// ---------------------------------------------------------------------------

describe("TransactionHistory — status filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockNetworkConfig.isTestnet = true;
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows only matching status rows when statuses param is set in URL", async () => {
    mockGetTransactions.mockResolvedValue([
      makeTransaction({ id: "1", status: "completed", asset: "USDC" }),
      makeTransaction({
        id: "2",
        status: "pending",
        asset: "EURC",
        transactionHash: "fixture-transaction-pending",
        transactionHash: "tx-hash-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
      makeTransaction({
        id: "3",
        status: "failed",
        asset: "XLM",
        transactionHash: "fixture-transaction-failed",
        transactionHash: "tx-hash-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      }),
    ]);

    render(
      <MemoryRouter initialEntries={["/?statuses=pending"]}>
        <QueryClientProvider
          client={
            new QueryClient({
              defaultOptions: { queries: { retry: false } },
            })
          }
        >
          <ToastProvider>
            <TransactionHistory walletAddress={WALLET} />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    const table = await screen.findByRole("table");

    // Only EURC (pending) should survive the filter
    await waitFor(() =>
      expect(within(table).queryAllByText("USDC").length).toBe(0),
    );
    expect(within(table).getByText("EURC")).toBeInTheDocument();
    expect(within(table).queryAllByText("XLM").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Asset filtering
// ---------------------------------------------------------------------------

describe("TransactionHistory — asset filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockNetworkConfig.isTestnet = true;
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows only rows matching the exact asset when asset param is set in URL", async () => {
    mockGetTransactions.mockResolvedValue([
      makeTransaction({ id: "1", asset: "USDC", amount: "100" }),
      makeTransaction({
        id: "2",
        asset: "XLM",
        amount: "200",
        transactionHash: "xlm0000000000000000000000000000000000000",
      }),
      makeTransaction({
        id: "3",
        asset: "EURC",
        amount: "300",
        transactionHash: "eurc000000000000000000000000000000000000",
      }),
    ]);

    render(
      <MemoryRouter initialEntries={["/?asset=XLM"]}>
        <QueryClientProvider
          client={
            new QueryClient({
              defaultOptions: { queries: { retry: false } },
            })
          }
        >
          <ToastProvider>
            <TransactionHistory walletAddress={WALLET} />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    const table = screen.getByRole("table");

    await waitFor(() =>
      expect(within(table).queryAllByText("USDC").length).toBe(0),
    );
    expect(within(table).getByText("XLM")).toBeInTheDocument();
    expect(within(table).queryAllByText("EURC").length).toBe(0);
  });

  it("restores the asset select from the URL and updates it via the filter panel", async () => {
    mockGetTransactions.mockResolvedValue([
      makeTransaction({ id: "1", asset: "USDC" }),
      makeTransaction({
        id: "2",
        asset: "XLM",
        transactionHash: "xlm0000000000000000000000000000000000000",
      }),
    ]);

    render(
      <MemoryRouter initialEntries={["/?asset=USDC"]}>
        <QueryClientProvider
          client={
            new QueryClient({
              defaultOptions: { queries: { retry: false } },
            })
          }
        >
          <ToastProvider>
            <TransactionHistory walletAddress={WALLET} />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    const assetSelect = screen.getByRole("combobox", { name: /Asset/i });
    expect(assetSelect).toHaveValue("USDC");

    fireEvent.change(assetSelect, { target: { value: "XLM" } });

    const table = screen.getByRole("table");
    await waitFor(() =>
      expect(within(table).queryAllByText("USDC").length).toBe(0),
    );
    expect(within(table).getByText("XLM")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// URL shareability
// ---------------------------------------------------------------------------

describe("TransactionHistory — URL shareability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockNetworkConfig.isTestnet = true;
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("restores date range inputs from URL on mount", async () => {
    mockGetTransactions.mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={["/?dateFrom=2026-01-01&dateTo=2026-06-30"]}>
        <QueryClientProvider
          client={
            new QueryClient({
              defaultOptions: { queries: { retry: false } },
            })
          }
        >
          <ToastProvider>
            <TransactionHistory walletAddress={WALLET} />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    const dateFromInput = screen.getByLabelText(/Filter from date/i);
    const dateToInput = screen.getByLabelText(/Filter to date/i);

    expect(dateFromInput).toHaveValue("2026-01-01");
    expect(dateToInput).toHaveValue("2026-06-30");
  });

  it("restores amount range inputs from URL on mount", async () => {
    mockGetTransactions.mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={["/?amountMin=10&amountMax=500"]}>
        <QueryClientProvider
          client={
            new QueryClient({
              defaultOptions: { queries: { retry: false } },
            })
          }
        >
          <ToastProvider>
            <TransactionHistory walletAddress={WALLET} />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    const amountMinInput = screen.getByLabelText(/Minimum transaction amount/i);
    const amountMaxInput = screen.getByLabelText(/Maximum transaction amount/i);

    expect(amountMinInput).toHaveValue(10);
    expect(amountMaxInput).toHaveValue(500);
  });
});

// ---------------------------------------------------------------------------
// Transaction detail drawer
// ---------------------------------------------------------------------------

const DRAWER_HASH = "b".repeat(64);

describe("TransactionHistory — detail drawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockNetworkConfig.isTestnet = true;
    localStorage.clear();
    localStorage.setItem(`yieldvault:transactions:view-mode:${WALLET}`, "paginated");
    localStorage.setItem(`yieldvault:transactions:page-size:${WALLET}`, "10");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the detail drawer when a table row is clicked", async () => {
    mockGetTransactions.mockResolvedValue([
      makeTransaction({
        id: "drawer-tx",
        transactionHash: DRAWER_HASH,
        status: "completed",
      }),
    ]);

    renderPage(WALLET);

    const table = await screen.findByRole("table");
    const row = within(table).getByRole("button", {
      name: /View row details/i,
    });
    fireEvent.click(row);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Transaction Details")).toBeInTheDocument();
    expect(screen.getByText(DRAWER_HASH)).toBeInTheDocument();
  });

  it("does not open the drawer when the explorer hash link is clicked", async () => {
    mockGetTransactions.mockResolvedValue([
      makeTransaction({
        id: "drawer-tx",
        transactionHash: DRAWER_HASH,
        status: "completed",
      }),
    ]);

    renderPage(WALLET);

    const link = await screen.findByTitle(DRAWER_HASH);
    fireEvent.click(link);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the drawer when Escape is pressed", async () => {
    mockGetTransactions.mockResolvedValue([
      makeTransaction({
        id: "drawer-tx",
        transactionHash: DRAWER_HASH,
        status: "completed",
      }),
    ]);

    renderPage(WALLET);

    const table = await screen.findByRole("table");
    const row = await within(table).findByRole("button", {
      name: /View row details/i,
    });
    fireEvent.click(row);

    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("marks the selected row with the selected class", async () => {
    mockGetTransactions.mockResolvedValue([
      makeTransaction({
        id: "drawer-tx",
        transactionHash: DRAWER_HASH,
        status: "completed",
      }),
    ]);

    renderPage(WALLET);

    const table = await screen.findByRole("table");
    const row = await within(table).findByRole("button", {
      name: /View row details/i,
    });
    fireEvent.click(row);

    expect(row).toHaveClass("data-table-row--selected");
  });
});

// ---------------------------------------------------------------------------
// Advanced sort — multi-column ordering, URL sync, announcements
// ---------------------------------------------------------------------------

/** Rows that tie on status so a secondary key has something to break. */
function makeSortFixtures(): Transaction[] {
  return [
    makeTransaction({
      id: "a",
      status: "completed",
      amount: "10",
      timestamp: "2026-01-01T00:00:00Z",
      transactionHash: "aaa0000000000000000000000000000000000000",
    }),
    makeTransaction({
      id: "b",
      status: "pending",
      amount: "5",
      timestamp: "2026-02-01T00:00:00Z",
      transactionHash: "bbb0000000000000000000000000000000000000",
    }),
    makeTransaction({
      id: "c",
      status: "completed",
      amount: "50",
      timestamp: "2026-03-01T00:00:00Z",
      transactionHash: "ccc0000000000000000000000000000000000000",
    }),
    makeTransaction({
      id: "d",
      status: "pending",
      amount: "80",
      timestamp: "2026-04-01T00:00:00Z",
      transactionHash: "ddd0000000000000000000000000000000000000",
    }),
  ];
}

/** Hash cell text, in the order the table renders it. */
function renderedHashPrefixes(): string[] {
  const table = screen.getByRole("table");
  return within(table)
    .getAllByRole("link")
    .map((link) => link.getAttribute("title")?.slice(0, 3) ?? "");
}

function renderAt(initialEntries: string[], walletAddress = WALLET) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ToastProvider>
          <TransactionHistory walletAddress={walletAddress} />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("TransactionHistory — advanced sort", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockNetworkConfig.isTestnet = true;
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to newest first", async () => {
    mockGetTransactions.mockResolvedValue(makeSortFixtures());

    renderAt(["/"]);

    await screen.findByRole("table");
    await waitFor(() =>
      expect(renderedHashPrefixes()).toEqual(["ddd", "ccc", "bbb", "aaa"]),
    );
  });

  it("restores a multi-column ordering from the URL", async () => {
    mockGetTransactions.mockResolvedValue(makeSortFixtures());

    renderAt(["/?sort=status:asc,amount:desc"]);

    await screen.findByRole("table");
    // pending before completed (lifecycle order), each group by amount descending
    await waitFor(() =>
      expect(renderedHashPrefixes()).toEqual(["ddd", "bbb", "ccc", "aaa"]),
    );
  });

  it("still honours the legacy single-column sort params", async () => {
    mockGetTransactions.mockResolvedValue(makeSortFixtures());

    renderAt(["/?sortBy=amount&direction=asc"]);

    await screen.findByRole("table");
    await waitFor(() =>
      expect(renderedHashPrefixes()).toEqual(["bbb", "aaa", "ccc", "ddd"]),
    );
  });

  it("sorts amounts numerically rather than as text", async () => {
    mockGetTransactions.mockResolvedValue([
      makeTransaction({
        id: "1",
        amount: "9",
        transactionHash: "aaa0000000000000000000000000000000000000",
      }),
      makeTransaction({
        id: "2",
        amount: "100",
        transactionHash: "bbb0000000000000000000000000000000000000",
      }),
      makeTransaction({
        id: "3",
        amount: "20",
        transactionHash: "ccc0000000000000000000000000000000000000",
      }),
    ]);

    renderAt(["/?sort=amount:asc"]);

    await screen.findByRole("table");
    await waitFor(() =>
      expect(renderedHashPrefixes()).toEqual(["aaa", "ccc", "bbb"]),
    );
  });

  it("marks the sorted column with aria-sort and leaves the others unsorted", async () => {
    mockGetTransactions.mockResolvedValue(makeSortFixtures());

    renderAt(["/?sort=amount:asc"]);

    await screen.findByRole("table");
    expect(
      screen.getByRole("columnheader", { name: /^Amount$/i }),
    ).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByRole("columnheader", { name: /^Type$/i })).toHaveAttribute(
      "aria-sort",
      "none",
    );
  });

  it("replaces the sort when a header is clicked without a modifier", async () => {
    mockGetTransactions.mockResolvedValue(makeSortFixtures());

    renderAt(["/?sort=status:asc"]);

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /Sort by Amount/i }));

    await waitFor(() =>
      expect(
        screen.getByRole("columnheader", { name: /^Amount$/i }),
      ).toHaveAttribute("aria-sort", "descending"),
    );
    expect(screen.getByRole("columnheader", { name: /^Status$/i })).toHaveAttribute(
      "aria-sort",
      "none",
    );
  });

  it("adds a tiebreaker when a header is shift-clicked, keeping the first key", async () => {
    mockGetTransactions.mockResolvedValue(makeSortFixtures());

    renderAt(["/?sort=status:asc"]);

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /Sort by Amount/i }), {
      shiftKey: true,
    });

    await waitFor(() =>
      expect(renderedHashPrefixes()).toEqual(["ddd", "bbb", "ccc", "aaa"]),
    );
    expect(screen.getByRole("columnheader", { name: /^Status$/i })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    expect(screen.getByRole("columnheader", { name: /^Amount$/i })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
  });

  it("shows sort priority numbers only while more than one column is sorted", async () => {
    mockGetTransactions.mockResolvedValue(makeSortFixtures());

    renderAt(["/?sort=status:asc,amount:desc"]);

    await screen.findByRole("table");
    const statusHeader = screen.getByRole("columnheader", { name: /^Status$/i });
    const amountHeader = screen.getByRole("columnheader", { name: /^Amount$/i });
    expect(
      statusHeader.querySelector(".data-table-sort-priority"),
    ).toHaveTextContent("1");
    expect(
      amountHeader.querySelector(".data-table-sort-priority"),
    ).toHaveTextContent("2");

    // Dropping back to a single key removes the now-meaningless "1".
    fireEvent.click(screen.getByRole("button", { name: /Sort by Type/i }));

    await waitFor(() =>
      expect(
        screen
          .getByRole("columnheader", { name: /^Type$/i })
          .querySelector(".data-table-sort-priority"),
      ).toBeNull(),
    );
  });

  it("announces the new ordering, which aria-sort alone does not do", async () => {
    mockGetTransactions.mockResolvedValue(makeSortFixtures());

    renderAt(["/"]);

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /Sort by Amount/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/Table sorted by Amount Descending/i),
      ).toBeInTheDocument(),
    );
  });

  it("explains a refused sort instead of appearing to ignore the click", async () => {
    mockGetTransactions.mockResolvedValue(makeSortFixtures());

    renderAt(["/?sort=date:desc,amount:desc,type:asc"]);

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /Sort by Status/i }), {
      shiftKey: true,
    });

    await waitFor(() =>
      expect(
        screen.getByText(/Cannot add another sort column/i),
      ).toBeInTheDocument(),
    );
    // The existing three keys are untouched.
    expect(screen.getByRole("columnheader", { name: /^Status$/i })).toHaveAttribute(
      "aria-sort",
      "none",
    );
  });

  it("returns to page 1 when the ordering changes", async () => {
    mockGetTransactions.mockResolvedValue(makeManyTransactions(15));

    renderAt(["/?page=2&pageSize=10"]);

    await screen.findByRole("table");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { current: "page", name: /Go to page 2/i }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /Sort by Amount/i }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { current: "page", name: /Go to page 1/i }),
      ).toBeInTheDocument(),
    );
  });

  it("orders rows with no amount last, in both directions", async () => {
    mockGetTransactions.mockResolvedValue([
      makeTransaction({
        id: "1",
        amount: null,
        transactionHash: "aaa0000000000000000000000000000000000000",
      }),
      makeTransaction({
        id: "2",
        amount: "5",
        transactionHash: "bbb0000000000000000000000000000000000000",
      }),
      makeTransaction({
        id: "3",
        amount: "500",
        transactionHash: "ccc0000000000000000000000000000000000000",
      }),
    ]);

    const view = renderAt(["/?sort=amount:asc"]);
    await screen.findByRole("table");
    await waitFor(() =>
      expect(renderedHashPrefixes()).toEqual(["bbb", "ccc", "aaa"]),
    );
    view.unmount();

    renderAt(["/?sort=amount:desc"]);
    await screen.findByRole("table");
    await waitFor(() =>
      expect(renderedHashPrefixes()).toEqual(["ccc", "bbb", "aaa"]),
    );
  });

  it("edits the ordering through the sort panel", async () => {
    mockGetTransactions.mockResolvedValue(makeSortFixtures());

    renderAt(["/?sort=status:asc,amount:desc"]);

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /Edit how the transaction table is sorted/i }));

    // Promoting amount above status flips which key groups the rows.
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Increase sort priority of Amount/i,
      }),
    );

    await waitFor(() =>
      expect(renderedHashPrefixes()).toEqual(["ddd", "ccc", "aaa", "bbb"]),
    );
  });

  it("resets to the default ordering from the sort panel", async () => {
    mockGetTransactions.mockResolvedValue(makeSortFixtures());

    renderAt(["/?sort=amount:asc"]);

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /Edit how the transaction table is sorted/i }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Reset to the default sort order/i,
      }),
    );

    await waitFor(() =>
      expect(renderedHashPrefixes()).toEqual(["ddd", "ccc", "bbb", "aaa"]),
    );
  });
});

// ---------------------------------------------------------------------------
// Advanced filters — presets, chips, contradictory ranges
// ---------------------------------------------------------------------------

describe("TransactionHistory — advanced filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockNetworkConfig.isTestnet = true;
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("summarises the applied filters as removable chips", async () => {
    mockGetTransactions.mockResolvedValue([makeTransaction()]);

    renderAt(["/?types=deposit&statuses=completed&asset=USDC"]);

    await screen.findByRole("table");
    const group = screen.getByRole("group", { name: /Active filters/i });
    expect(within(group).getByText("Type: Deposit")).toBeInTheDocument();
    expect(within(group).getByText("Status: Completed")).toBeInTheDocument();
    expect(within(group).getByText("Asset: USDC")).toBeInTheDocument();
  });

  it("lifts one filter from a chip and leaves the rest applied", async () => {
    mockGetTransactions.mockResolvedValue([
      makeTransaction({ id: "1", type: "deposit", asset: "USDC" }),
      makeTransaction({
        id: "2",
        type: "withdrawal",
        asset: "XLM",
        transactionHash: "xlm0000000000000000000000000000000000000",
      }),
    ]);

    renderAt(["/?types=deposit&asset=USDC"]);

    await screen.findByRole("table");
    fireEvent.click(
      screen.getByRole("button", { name: /Asset: USDC, remove this filter/i }),
    );

    await waitFor(() =>
      expect(screen.queryByText("Asset: USDC")).not.toBeInTheDocument(),
    );
    // The type filter survives, so the withdrawal stays hidden.
    expect(screen.getByText("Type: Deposit")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).queryAllByText("XLM")).toHaveLength(0);
  });

  it("removes only the clicked value from a multi-value filter", async () => {
    mockGetTransactions.mockResolvedValue([makeTransaction()]);

    renderAt(["/?types=deposit,withdrawal"]);

    await screen.findByRole("table");
    fireEvent.click(
      screen.getByRole("button", { name: /Type: Deposit, remove this filter/i }),
    );

    await waitFor(() =>
      expect(screen.queryByText("Type: Deposit")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Type: Withdrawal")).toBeInTheDocument();
  });

  it("applies a relative date range as absolute dates, so a shared link cannot drift", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-07-28T09:30:00Z"));
    mockGetTransactions.mockResolvedValue([makeTransaction()]);

    renderAt(["/"]);

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }));

    await waitFor(() =>
      expect(screen.getByLabelText(/Filter from date/i)).toHaveValue("2026-07-22"),
    );
    expect(screen.getByLabelText(/Filter to date/i)).toHaveValue("2026-07-28");
  });

  it("marks the preset that the current range corresponds to", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-07-28T09:30:00Z"));
    mockGetTransactions.mockResolvedValue([makeTransaction()]);

    renderAt(["/?dateFrom=2026-06-29&dateTo=2026-07-28"]);

    await screen.findByRole("table");
    expect(screen.getByRole("button", { name: "Last 30 days" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("filters by a date range on inclusive UTC day boundaries", async () => {
    mockGetTransactions.mockResolvedValue([
      makeTransaction({
        id: "1",
        timestamp: "2026-03-15T00:00:00Z",
        transactionHash: "aaa0000000000000000000000000000000000000",
      }),
      makeTransaction({
        id: "2",
        timestamp: "2026-03-15T23:59:59Z",
        transactionHash: "bbb0000000000000000000000000000000000000",
      }),
      makeTransaction({
        id: "3",
        timestamp: "2026-03-16T00:00:01Z",
        transactionHash: "ccc0000000000000000000000000000000000000",
      }),
    ]);

    renderAt(["/?dateFrom=2026-03-15&dateTo=2026-03-15&sort=date:asc"]);

    await screen.findByRole("table");
    await waitFor(() => expect(renderedHashPrefixes()).toEqual(["aaa", "bbb"]));
  });

  it("excludes rows with no amount once an amount bound is set", async () => {
    mockGetTransactions.mockResolvedValue([
      makeTransaction({
        id: "1",
        amount: null,
        transactionHash: "aaa0000000000000000000000000000000000000",
      }),
      makeTransaction({
        id: "2",
        amount: "500",
        transactionHash: "bbb0000000000000000000000000000000000000",
      }),
    ]);

    renderAt(["/?amountMin=100"]);

    await screen.findByRole("table");
    await waitFor(() => expect(renderedHashPrefixes()).toEqual(["bbb"]));
  });

  it("explains a contradictory date range and keeps showing the rows", async () => {
    mockGetTransactions.mockResolvedValue([
      makeTransaction({ id: "1", asset: "USDC" }),
    ]);

    renderAt(["/?dateFrom=2026-06-01&dateTo=2026-01-01"]);

    await screen.findByRole("table");
    expect(
      screen.getByText(/from date is after the to date/i),
    ).toBeInTheDocument();
    // An empty table here would read as "you have no transactions".
    const table = screen.getByRole("table");
    expect(within(table).getByText("USDC")).toBeInTheDocument();
  });

  it("explains a contradictory amount range and keeps showing the rows", async () => {
    mockGetTransactions.mockResolvedValue([
      makeTransaction({ id: "1", asset: "USDC", amount: "100" }),
    ]);

    renderAt(["/?amountMin=500&amountMax=10"]);

    await screen.findByRole("table");
    expect(
      screen.getByText(/minimum amount is above the maximum/i),
    ).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("USDC")).toBeInTheDocument();
  });

  it("narrows rather than widens when the search has several terms", async () => {
    mockGetTransactions.mockResolvedValue([
      makeTransaction({
        id: "1",
        type: "deposit",
        asset: "USDC",
        transactionHash: "aaa0000000000000000000000000000000000000",
      }),
      makeTransaction({
        id: "2",
        type: "withdrawal",
        asset: "XLM",
        transactionHash: "bbb0000000000000000000000000000000000000",
      }),
    ]);

    renderAt(["/?search=xlm+withdrawal"]);

    await screen.findByRole("table");
    await waitFor(() => expect(renderedHashPrefixes()).toEqual(["bbb"]));
  });

  it("matches the asset filter regardless of case", async () => {
    mockGetTransactions.mockResolvedValue([
      makeTransaction({ id: "1", asset: "USDC" }),
      makeTransaction({
        id: "2",
        asset: "XLM",
        transactionHash: "xlm0000000000000000000000000000000000000",
      }),
    ]);

    renderAt(["/?asset=usdc"]);

    await screen.findByRole("table");
    const table = screen.getByRole("table");
    await waitFor(() =>
      expect(within(table).getByText("USDC")).toBeInTheDocument(),
    );
    expect(within(table).queryAllByText("XLM")).toHaveLength(0);
  });

  it("keeps the ordering when a filter changes", async () => {
    mockGetTransactions.mockResolvedValue(makeSortFixtures());

    renderAt(["/?sort=amount:asc"]);

    await screen.findByRole("table");
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Filter by Status Completed/i }),
    );

    await waitFor(() => expect(renderedHashPrefixes()).toEqual(["aaa", "ccc"]));
    expect(
      screen.getByRole("columnheader", { name: /^Amount$/i }),
    ).toHaveAttribute("aria-sort", "ascending");
  });

  it("shows an error empty state instead of deposit guidance when the history fails to load", async () => {
    mockGetTransactions.mockRejectedValueOnce(new Error("horizon down"));

    renderAt(["/"]);

    expect(
      await screen.findByText(/transactions unavailable/i),
    ).toBeInTheDocument();
    const retry = await screen.findByRole("button", { name: /try again/i });
    expect(retry).toBeInTheDocument();
    // Failure guidance must not tell the user there are simply no transactions.
    expect(screen.queryByText(/no transactions yet/i)).toBeNull();

    mockGetTransactions.mockResolvedValue([makeTransaction()]);
    fireEvent.click(retry);

    await screen.findByRole("table");
  });
});
