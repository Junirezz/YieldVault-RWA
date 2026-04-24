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
  type ValidationError 
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

interface TransactionHistoryProps {
  walletAddress: string | null;
}

type TxTypeFilter = "all" | "deposit" | "withdrawal";

const columns: DataTableColumn<Transaction>[] = [
  {
    id: "type",
    header: "Type",
    sortable: true,
    cell: (row) => (
      <Badge
        variant="status"
        color={row.type === "deposit" ? "cyan" : "error"}
      >
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
        href={getStellarExplorerUrl(row.transactionHash, "testnet")}
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

  const { state, setSort, setPage, setPageSize } = useDataTableState({
    defaultSortBy: "date",
    defaultSortDirection: "desc",
    defaultPageSize: 10,
  });

  const [searchParams, setSearchParams] = useSearchParams();
  const txType = (searchParams.get("txType") ?? "all") as TxTypeFilter;

  const setTxType = (value: TxTypeFilter) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("txType", value);
    nextParams.set("page", "1");
    setSearchParams(nextParams, { replace: true });
  };

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

  const { rows, page, totalItems, totalPages } = useClientDataTable({
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
  });

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
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Transactions" },
        ]}
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
                <h2 id="transactions-heading" style={{ marginBottom: "6px" }}>Transactions</h2>
                <p className="text-body-sm" style={{ color: "var(--text-secondary)" }}>
                  Sort and filter your deposit and withdrawal history.
                </p>
              </div>

              <div className="portfolio-toolbar-controls">
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

                <label className="input-group" style={{ minWidth: "120px" }}>
                  <span className="text-body-sm">Rows</span>
                  <div className="input-wrapper">
                    <select
                      aria-label="Rows per page"
                      value={state.pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                      className="portfolio-select"
                    >
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                    </select>
                  </div>
                </label>
              </div>
            </div>

            <div className="text-body-sm" style={{ color: "var(--text-secondary)", marginBottom: "16px" }}>
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
