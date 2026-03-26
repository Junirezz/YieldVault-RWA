import React, { useEffect, useState } from "react";
import ApiStatusBanner from "../components/ApiStatusBanner";
import {
  DataTable,
  type DataTableColumn,
} from "../components/DataTable";
import { normalizeApiError, type ApiError } from "../lib/api";
import {
  getPortfolioHoldings,
  type PortfolioHolding,
} from "../lib/portfolioApi";
import { useClientDataTable } from "../hooks/useClientDataTable";
import { useUrlState } from "../hooks/useUrlState";
import { useServerDataTable } from "../hooks/useServerDataTable";
import { useToast } from "../context/ToastContext";

interface PortfolioProps {
  walletAddress: string | null;
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

const columns: DataTableColumn<PortfolioHolding>[] = [
  {
    id: "asset",
    header: "Asset",
    sortable: true,
    width: "28%",
    cell: (row) => (
      <div>
        <div style={{ fontWeight: 600 }}>{row.asset}</div>
        <div style={{ color: "var(--text-secondary)", fontSize: "0.82rem" }}>
          {row.vaultName}
        </div>
      </div>
    ),
  },
  {
    id: "shares",
    header: "Shares",
    sortable: true,
    align: "right",
    cell: (row) => (
      <div>
        <div style={{ fontWeight: 600 }}>
          {numberFormatter.format(row.shares)} {row.symbol}
        </div>
        <div style={{ color: "var(--text-secondary)", fontSize: "0.82rem" }}>
          Issuer: {row.issuer}
        </div>
      </div>
    ),
  },
  {
    id: "apy",
    header: "APY",
    sortable: true,
    align: "right",
    cell: (row) => (
      <span style={{ color: "var(--accent-cyan)", fontWeight: 600 }}>
        {row.apy.toFixed(2)}%
      </span>
    ),
  },
  {
    id: "valueUsd",
    header: "Value",
    sortable: true,
    align: "right",
    cell: (row) => <span>{currencyFormatter.format(row.valueUsd)}</span>,
  },
  {
    id: "unrealizedGainUsd",
    header: "Unrealized Gain",
    sortable: true,
    align: "right",
    cell: (row) => (
      <span
        style={{
          color:
            row.unrealizedGainUsd >= 0
              ? "var(--accent-cyan)"
              : "var(--text-error)",
          fontWeight: 600,
        }}
      >
        {row.unrealizedGainUsd >= 0 ? "+" : ""}
        {currencyFormatter.format(row.unrealizedGainUsd)}
      </span>
    ),
  },
];

const Portfolio: React.FC<PortfolioProps> = ({ walletAddress }) => {
  const toast = useToast();
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const { state: urlState, setSearch, setSort, setPage, setPageSize, setFilters, reset } = useUrlState<{ status: string, search: string }>({
    defaultSortBy: "valueUsd",
    defaultSortDirection: "desc",
    defaultPageSize: 4,
    defaultFilters: { status: "all", search: "" },
  });

  const state = {
    ...urlState,
    search: urlState.filters.search || "",
  };

  useServerDataTable({ state });

  useEffect(() => {
    if (!walletAddress) {
      return;
    }

    let isMounted = true;

    const loadHoldings = async () => {
      setIsLoading(true);

      try {
        const response = await getPortfolioHoldings();
        if (!isMounted) {
          return;
        }
        setHoldings(response);
        setError(null);
      } catch (unknownError) {
        if (!isMounted) {
          return;
        }
        const nextError = normalizeApiError(unknownError);
        setError(nextError);
        toast.error({
          title: "Portfolio sync failed",
          description: nextError.userMessage,
        });
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadHoldings();

    return () => {
      isMounted = false;
    };
  }, [toast, walletAddress]);

  const filteredHoldings = React.useMemo(() => {
    if (!urlState.filters.status || urlState.filters.status === "all") {
      return holdings;
    }
    return holdings.filter((h) => h.status === urlState.filters.status);
  }, [holdings, urlState.filters.status]);

  const { rows, page, totalItems, totalPages } = useClientDataTable({
    rows: filteredHoldings,
    state,
    getSearchValue: (row) =>
      `${row.asset} ${row.vaultName} ${row.symbol} ${row.issuer} ${row.status}`,
    getSortValue: (row, columnId) => {
      switch (columnId) {
        case "asset":
          return row.asset;
        case "shares":
          return row.shares;
        case "apy":
          return row.apy;
        case "valueUsd":
          return row.valueUsd;
        case "unrealizedGainUsd":
          return row.unrealizedGainUsd;
        default:
          return row.valueUsd;
      }
    },
  });

  const totalValue = holdings.reduce((sum, holding) => sum + holding.valueUsd, 0);
  const totalGain = holdings.reduce(
    (sum, holding) => sum + holding.unrealizedGainUsd,
    0,
  );

  return (
    <div className="glass-panel" style={{ padding: "32px" }}>
      <header style={{ textAlign: "center", marginBottom: "48px" }}>
        <h1 style={{ fontSize: "2.5rem", marginBottom: "16px" }}>
          Your <span className="text-gradient">Portfolio</span>
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "1.1rem" }}>
          Overview of your deposited real-world assets.
        </p>
      </header>

      {!walletAddress ? (
        <div style={{ textAlign: "center", padding: "48px" }}>
          <p style={{ color: "var(--text-secondary)" }}>
            Please connect your wallet to view your portfolio.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-lg">
          {error && <ApiStatusBanner error={error} />}

          <div
            className="portfolio-summary-grid"
            style={{ display: "grid", gap: "24px", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
          >
            <div
              className="glass-panel"
              style={{ padding: "24px", background: "var(--bg-muted)" }}
            >
              <div style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>
                Total Assets
              </div>
              <div style={{ fontSize: "1.8rem", fontWeight: 600 }}>
                {currencyFormatter.format(totalValue)}
              </div>
            </div>
            <div
              className="glass-panel"
              style={{ padding: "24px", background: "var(--bg-muted)" }}
            >
              <div style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>
                Unrealized Gain
              </div>
              <div
                style={{
                  fontSize: "1.2rem",
                  color: "var(--accent-cyan)",
                  fontWeight: 600,
                }}
              >
                +{currencyFormatter.format(totalGain)}
              </div>
            </div>
          </div>

          <section
            className="glass-panel"
            style={{ padding: "24px", background: "var(--bg-muted)" }}
            aria-label="Portfolio holdings"
          >
            <div className="portfolio-toolbar">
              <div>
                <h3 style={{ marginBottom: "6px" }}>Holdings</h3>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.92rem" }}>
                  Sort, search, and page through all current vault positions.
                </p>
              </div>

              <div className="portfolio-toolbar-controls">
                <label className="input-group" style={{ minWidth: "180px" }}>
                  <span>Status Filter</span>
                  <div className="input-wrapper">
                    <select
                      className="portfolio-select"
                      value={urlState.filters.status || "all"}
                      onChange={(e) => setFilters({ status: e.target.value })}
                      aria-label="Filter by status"
                    >
                      <option value="all">All Statuses</option>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                </label>

                <label className="input-group" style={{ minWidth: "220px" }}>
                  <span>Search holdings</span>
                  <div className="input-wrapper">
                    <input
                      className="input-field"
                      type="search"
                      placeholder="Search asset, vault, issuer..."
                      value={urlState.filters.search || ""}
                      onChange={(event) => setSearch(event.target.value)}
                      style={{ fontSize: "1rem", fontFamily: "var(--font-sans)" }}
                    />
                  </div>
                </label>

                {(urlState.filters.search || (urlState.filters.status && urlState.filters.status !== "all")) && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={reset}
                    style={{ alignSelf: "flex-end", height: "42px" }}
                  >
                    Reset Filters
                  </button>
                )}
              </div>
            </div>

            <div
              style={{
                color: "var(--text-secondary)",
                fontSize: "0.86rem",
                marginBottom: "16px",
              }}
            >
              {isLoading ? "Loading holdings..." : `${totalItems} holdings found`}
            </div>

            <DataTable
              caption="Portfolio holdings"
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              emptyMessage={
                isLoading
                  ? "Loading holdings..."
                  : "No holdings matched the current filters."
              }
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
              onPageSizeChange={setPageSize}
              renderRowDetails={(row) => (
                <div className="portfolio-row-meta">
                  <span className={`tag ${row.status === "active" ? "cyan" : ""}`}>
                    {row.status}
                  </span>
                  <span>{row.symbol}</span>
                </div>
              )}
            />
          </section>
        </div>
      )}
    </div>
  );
};

export default Portfolio;
