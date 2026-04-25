import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import ApiStatusBanner from "../components/ApiStatusBanner";
import Badge from "../components/Badge";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import PageHeader from "../components/PageHeader";
import {
  normalizeApiError,
  isValidationError,
  type ApiError,
  type ValidationError,
} from "../lib/api";
import {
  formatAmount,
  formatTimestamp,
  truncateHash,
  getTransactions,
  type Transaction,
} from "../lib/transactionApi";
import { useClientDataTable } from "../hooks/useClientDataTable";
import { useDataTableState } from "../hooks/useDataTableState";
import { getStellarExplorerUrl } from "../lib/security";
import { networkConfig } from "../config/network";

interface TransactionHistoryProps {
  walletAddress: string | null;
}

type TxTypeFilter = "all" | "deposit" | "withdrawal";
const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

function getPageSizeStorageKey(walletAddress: string | null): string {
  return `yieldvault:transactions:page-size:${walletAddress ?? "guest"}`;
}

function loadPreferredPageSize(walletAddress: string | null): number {
  try {
    const raw = localStorage.getItem(getPageSizeStorageKey(walletAddress));
    const parsed = raw ? Number(raw) : Number.NaN;
    if (PAGE_SIZE_OPTIONS.includes(parsed as (typeof PAGE_SIZE_OPTIONS)[number])) {
      return parsed;
    }
  } catch {
    // localStorage unavailable; fall back to defaults
  }
  return DEFAULT_PAGE_SIZE;
}

function persistPreferredPageSize(walletAddress: string | null, pageSize: number): void {
  try {
    localStorage.setItem(getPageSizeStorageKey(walletAddress), String(pageSize));
  } catch {
    // localStorage unavailable; silently ignore
  }
}

const columns: DataTableColumn<Transaction>[] = [
  {
    id: "type",
    header: "Type",
    sortable: true,
    cell: (row) => (
      <Badge variant="status" color={row.type === "deposit" ? "cyan" : "error"}>
        {row.type}
      </Badge>
    ),
  },
  {
    id: "amount",
    header: "Amount",
    sortable: true,
    cell: (row) => <span>{formatAmount(row.amount, row.asset)}</span>,
  },
  {
    id: "asset",
    header: "Asset",
    sortable: false,
    cell: (row) => <span>{row.asset ?? "—"}</span>,
  },
  {
    id: "date",
    header: "Date",
    sortable: true,
    cell: (row) => <span>{formatTimestamp(row.timestamp)}</span>,
  },
  {
    id: "hash",
    header: "Transaction Hash",
    sortable: false,
    cell: (row) => (
      <a
        href={getStellarExplorerUrl(
          row.transactionHash,
          networkConfig.isTestnet ? "testnet" : "mainnet",
        )}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: "var(--accent-cyan)", textDecoration: "none" }}
        title={row.transactionHash}
      >
        {truncateHash(row.transactionHash)}
      </a>
    ),
  },
];

const TransactionHistory: React.FC<TransactionHistoryProps> = ({
  walletAddress,
}) => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ApiError | ValidationError | null>(null);
  const preferredPageSize = React.useMemo(
    () => loadPreferredPageSize(walletAddress),
    [walletAddress],
  );

  const { state, setSearch, setSort, setPage, setPageSize } = useDataTableState(
    {
      defaultSortBy: "date",
      defaultSortDirection: "desc",
      defaultPageSize: preferredPageSize,
    },
  );
  const [searchInput, setSearchInput] = useState(state.search);

  const [searchParams, setSearchParams] = useSearchParams();
  const txType = (searchParams.get("txType") ?? "all") as TxTypeFilter;

  const setTxType = (value: TxTypeFilter) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("txType", value);
    nextParams.set("page", "1");
    setSearchParams(nextParams, { replace: true });
  };

  // Date range from URL
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";

  const setDateFrom = (value: string) => {
    const nextParams = new URLSearchParams(searchParams);
    if (value) nextParams.set("dateFrom", value);
    else nextParams.delete("dateFrom");
    nextParams.set("page", "1");
    setSearchParams(nextParams, { replace: true });
  };

  const setDateTo = (value: string) => {
    const nextParams = new URLSearchParams(searchParams);
    if (value) nextParams.set("dateTo", value);
    else nextParams.delete("dateTo");
    nextParams.set("page", "1");
    setSearchParams(nextParams, { replace: true });
  };

  const clearAllFilters = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("txType");
    nextParams.delete("dateFrom");
    nextParams.delete("dateTo");
    nextParams.set("page", "1");
    setSearchParams(nextParams, { replace: true });
    setSearchInput("");
    setSearch("");
  };

  const hasActiveFilters =
    txType !== "all" ||
    Boolean(dateFrom) ||
    Boolean(dateTo) ||
    Boolean(state.search);

  useEffect(() => {
    setSearchInput(state.search);
  }, [state.search]);

  useEffect(() => {
    if (searchInput === state.search) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSearch(searchInput);
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [searchInput, setSearch, state.search]);

  useEffect(() => {
    if (!walletAddress) {
      return;
    }

    let isMounted = true;

    const loadTransactions = async () => {
      setIsLoading(true);

      try {
        const data = await getTransactions({
          walletAddress,
          limit: state.pageSize,
          order: state.sortDirection,
          type: txType,
        });
        if (!isMounted) return;
        setTransactions(data);
        setError(null);
      } catch (unknownError) {
        if (!isMounted) return;
        if (isValidationError(unknownError)) {
          setError(unknownError);
        } else {
          setError(normalizeApiError(unknownError));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadTransactions();

    return () => {
      isMounted = false;
    };
  }, [walletAddress, state.pageSize, state.sortDirection, txType]);

  const { rows, sortedRows, page, totalItems, totalPages } = useClientDataTable(
    {
      rows: transactions,
      state,
      getSearchValue: (row) =>
        `${row.type} ${row.asset ?? ""} ${row.transactionHash}`,
      getSortValue: (row, columnId) => {
        switch (columnId) {
          case "type":
            return row.type;
          case "amount":
            return row.amount !== null ? parseFloat(row.amount) : 0;
          case "date":
            return row.timestamp;
          default:
            return row.timestamp;
        }
      },
      filterRow: (row) => {
        if (dateFrom) {
          const from = new Date(dateFrom);
          from.setHours(0, 0, 0, 0);
          if (new Date(row.timestamp) < from) return false;
        }
        if (dateTo) {
          const to = new Date(dateTo);
          to.setHours(23, 59, 59, 999);
          if (new Date(row.timestamp) > to) return false;
        }
        return true;
      },
    },
  );

  const buildCsvContent = (transactionsToExport: Transaction[]) => {
    const headers = ["date", "type", "amount", "share price", "fee", "tx hash"];

    const escapeCsvValue = (value: string) => `"${value.replace(/"/g, '""')}"`;

    const csvRows = transactionsToExport.map((transaction) => [
      formatTimestamp(transaction.timestamp),
      transaction.type,
      formatAmount(transaction.amount, transaction.asset),
      "",
      "",
      transaction.transactionHash,
    ]);

    return [headers, ...csvRows]
      .map((columns) => columns.map(escapeCsvValue).join(","))
      .join("\r\n");
  };

  const handleExportCsv = () => {
    const csvContent = buildCsvContent(sortedRows);
    const fileName = `transactions_${new Date().toISOString().slice(0, 10)}.csv`;
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url =
      typeof URL !== "undefined" && URL.createObjectURL
        ? URL.createObjectURL(blob)
        : `data:text/csv;charset=utf-8,${encodeURIComponent(csvContent)}`;

    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    if (
      typeof URL !== "undefined" &&
      URL.revokeObjectURL &&
      url.startsWith("blob:")
    ) {
      URL.revokeObjectURL(url);
    }
  };

  const emptyMessage =
    txType !== "all"
      ? "No transactions matched the current filter."
      : "No transactions found for this wallet.";

  return (
    <div className="glass-panel" style={{ padding: "32px" }}>
      <PageHeader
        title={
          <>
            Transaction <span className="text-gradient">History</span>
          </>
        }
        description="View all your past deposits and withdrawals."
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Transactions" }]}
        statusChips={
          walletAddress
            ? [
                {
                  label: `${transactions.length} Total`,
                  variant: "cyan",
                },
                {
                  label: isLoading ? "Loading..." : "Up to date",
                  variant: isLoading ? "warning" : "success",
                },
              ]
            : undefined
        }
      />

      {!walletAddress ? (
        <div style={{ textAlign: "center", padding: "48px" }}>
          <p style={{ color: "var(--text-secondary)" }}>
            Please connect your wallet to view your transaction history.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-lg">
          {error && <ApiStatusBanner error={error} />}

          <section
            className="glass-panel"
            style={{ padding: "24px", background: "var(--bg-muted)" }}
            aria-labelledby="transactions-heading"
          >
            <div className="portfolio-toolbar">
              <div>
                <h2 id="transactions-heading" style={{ marginBottom: "6px" }}>
                  Transactions
                </h2>
                <p
                  className="text-body-sm"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Sort and filter your deposit and withdrawal history.
                </p>
              </div>

              <div className="portfolio-toolbar-controls">
                <label className="input-group" style={{ minWidth: "220px" }}>
                  <span className="text-body-sm">Search transactions</span>
                  <div className="input-wrapper">
                    <input
                      aria-label="Search transactions"
                      className="input-field"
                      type="search"
                      placeholder="Search asset, hash, type..."
                      value={searchInput}
                      onChange={(event) => setSearchInput(event.target.value)}
                      style={{
                        fontSize: "var(--text-base)",
                        fontFamily: "var(--font-sans)",
                      }}
                    />
                  </div>
                </label>

                <label className="input-group" style={{ minWidth: "160px" }}>
                  <span className="text-body-sm">Type</span>
                  <div className="input-wrapper">
                    <select
                      aria-label="Filter by type"
                      value={txType}
                      onChange={(e) =>
                        setTxType(e.target.value as TxTypeFilter)
                      }
                      className="portfolio-select"
                    >
                      <option value="all">All</option>
                      <option value="deposit">Deposit</option>
                      <option value="withdrawal">Withdrawal</option>
                    </select>
                  </div>
                </label>

                <label className="input-group" style={{ minWidth: "140px" }}>
                  <span className="text-body-sm">From date</span>
                  <div className="input-wrapper">
                    <input
                      aria-label="Filter from date"
                      className="input-field"
                      type="date"
                      value={dateFrom}
                      max={dateTo || undefined}
                      onChange={(e) => setDateFrom(e.target.value)}
                      style={{
                        fontSize: "var(--text-base)",
                        fontFamily: "var(--font-sans)",
                      }}
                    />
                  </div>
                </label>

                <label className="input-group" style={{ minWidth: "140px" }}>
                  <span className="text-body-sm">To date</span>
                  <div className="input-wrapper">
                    <input
                      aria-label="Filter to date"
                      className="input-field"
                      type="date"
                      value={dateTo}
                      min={dateFrom || undefined}
                      onChange={(e) => setDateTo(e.target.value)}
                      style={{
                        fontSize: "var(--text-base)",
                        fontFamily: "var(--font-sans)",
                      }}
                    />
                  </div>
                </label>

                <label className="input-group" style={{ minWidth: "120px" }}>
                  <span className="text-body-sm">Rows</span>
                  <div className="input-wrapper">
                    <select
                      aria-label="Rows per page"
                      value={state.pageSize}
                      onChange={(e) => {
                        const nextSize = Number(e.target.value);
                        persistPreferredPageSize(walletAddress, nextSize);
                        setPageSize(nextSize);
                      }}
                      className="portfolio-select"
                    >
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                    </select>
                  </div>
                </label>

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleExportCsv}
                  style={{ alignSelf: "flex-end", height: "42px" }}
                >
                  Export CSV
                </button>

                {hasActiveFilters && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={clearAllFilters}
                    style={{ alignSelf: "flex-end", height: "42px" }}
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            </div>

            <div
              className="text-body-sm"
              style={{ color: "var(--text-secondary)", marginBottom: "16px" }}
            >
              {isLoading
                ? "Loading transactions..."
                : `${totalItems} transactions found`}
            </div>

            {isLoading ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "48px",
                  color: "var(--text-secondary)",
                }}
              >
                Loading transactions...
              </div>
            ) : (
              <DataTable
                caption="Transaction history"
                columns={columns}
                rows={rows}
                rowKey={(row) => row.id}
                emptyMessage={emptyMessage}
                isLoading={isLoading}
                skeletonRows={state.pageSize}
                sortBy={state.sortBy}
                sortDirection={state.sortDirection}
                onSortChange={setSort}
                pagination={{
                  page,
                  pageSize: state.pageSize,
                  totalItems,
                  totalPages,
                }}
                onPageChange={setPage}
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
};

export default TransactionHistory;
