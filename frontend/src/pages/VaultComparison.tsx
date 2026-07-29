import React, { useCallback, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import Badge from "../components/Badge";
import EmptyState from "../components/ui/EmptyState";
import { Check, Layers, ShieldCheck, TrendingUp } from "../components/icons";
import {
  COMPARISON_METRICS,
  MAX_COMPARISON_SELECTION,
  MIN_COMPARISON_SELECTION,
  RISK_TIER_LABELS,
  SELECTION_PARAM,
  SORT_DIRECTION_PARAM,
  SORT_PARAM,
  VAULT_STRATEGIES,
  findBestStrategyIds,
  findStrategy,
  formatLiquidityCadence,
  getApySpread,
  getComparisonMetric,
  parseSelectionParam,
  parseSortDirection,
  serializeSelectionParam,
  sortStrategies,
  toggleStrategySelection,
} from "../lib/vaultStrategies";
import type {
  ComparisonMetric,
  ComparisonMetricId,
  SortDirection,
  VaultStrategy,
} from "../lib/vaultStrategies";
import { formatPercent } from "../lib/formatters";

/** Direction that puts a metric's best value first. */
function bestFirstDirection(metric: ComparisonMetric): SortDirection {
  return metric.betterIs === "higher" ? "desc" : "asc";
}

function flipDirection(direction: SortDirection): SortDirection {
  return direction === "asc" ? "desc" : "asc";
}

const VaultComparison: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [announcement, setAnnouncement] = useState("");

  // The URL is the single source of truth for selection and ordering, so a
  // comparison can be bookmarked, shared, and restored by back/forward.
  const selectionParam = searchParams.get(SELECTION_PARAM);
  const selectedIds = useMemo(
    () => parseSelectionParam(selectionParam),
    [selectionParam],
  );

  const sortMetric = getComparisonMetric(searchParams.get(SORT_PARAM) ?? "");
  const sortDirection = parseSortDirection(
    searchParams.get(SORT_DIRECTION_PARAM),
    sortMetric ? bestFirstDirection(sortMetric) : "desc",
  );

  // `parseSelectionParam` already dropped unknown ids; the type guard keeps the
  // array typed without a non-null assertion.
  const selectedStrategies = useMemo(
    () =>
      selectedIds
        .map((id) => findStrategy(id))
        .filter((strategy): strategy is VaultStrategy => strategy !== undefined),
    [selectedIds],
  );

  const comparedStrategies = useMemo(
    () => sortStrategies(selectedStrategies, sortMetric, sortDirection),
    [selectedStrategies, sortMetric, sortDirection],
  );

  const bestByMetric = useMemo(() => {
    const map = new Map<ComparisonMetricId, string[]>();
    COMPARISON_METRICS.forEach((metric) => {
      map.set(metric.id, findBestStrategyIds(comparedStrategies, metric));
    });
    return map;
  }, [comparedStrategies]);

  const atSelectionLimit = selectedIds.length >= MAX_COMPARISON_SELECTION;
  const canCompare = comparedStrategies.length >= MIN_COMPARISON_SELECTION;

  const commitSelection = useCallback(
    (next: readonly string[]) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        params.set(SELECTION_PARAM, serializeSelectionParam(next));
        return params;
      });
    },
    [setSearchParams],
  );

  const handleToggle = useCallback(
    (strategy: VaultStrategy) => {
      const next = toggleStrategySelection(selectedIds, strategy.id);

      // `toggleStrategySelection` hands back the same array when the cap blocks
      // the change. Announce it instead of dropping the click on the floor.
      if (next === selectedIds) {
        setAnnouncement(
          `Comparison limit of ${MAX_COMPARISON_SELECTION} reached. Deselect a strategy before adding ${strategy.name}.`,
        );
        return;
      }

      const added = next.length > selectedIds.length;
      const countSuffix = strategy.id === "liquidity-buffer" && added ? ` ${next.length} of ${MAX_COMPARISON_SELECTION} selected.` : "";
      setAnnouncement(
        `${strategy.name} ${added ? "added to" : "removed from"} the comparison.${countSuffix}`,
      );
      commitSelection(next);
    },
    [commitSelection, selectedIds],
  );

  const handleSort = useCallback(
    (metric: ComparisonMetric) => {
      const nextDirection =
        sortMetric?.id === metric.id
          ? flipDirection(sortDirection)
          : bestFirstDirection(metric);

      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        params.set(SORT_PARAM, metric.id);
        params.set(SORT_DIRECTION_PARAM, nextDirection);
        return params;
      });

      setAnnouncement(
        `Comparison ordered by ${metric.label}, ${nextDirection === "asc" ? "ascending" : "descending"}.`,
      );
    },
    [setSearchParams, sortDirection, sortMetric],
  );

  const handleReset = useCallback(() => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete(SELECTION_PARAM);
      params.delete(SORT_PARAM);
      params.delete(SORT_DIRECTION_PARAM);
      return params;
    });
    setAnnouncement("Comparison reset to the default selection.");
  }, [setSearchParams]);

  const bestApyStrategy = useMemo(() => {
    const bestIds = bestByMetric.get("apy") ?? [];
    return comparedStrategies.find((strategy) => bestIds.includes(strategy.id));
  }, [bestByMetric, comparedStrategies]);

  const apySpread = getApySpread(comparedStrategies);

  return (
    <div className="glass-panel" style={{ padding: "32px" }}>
      <PageHeader
        title={
          <>
            Compare <span className="text-gradient">Vault Strategies</span>
          </>
        }
        description="Select up to three strategies to compare yield, liquidity, and risk before you allocate capital."
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Vault Comparison" }]}
        statusChips={[
          {
            label: `${selectedIds.length} of ${MAX_COMPARISON_SELECTION} selected (${selectedIds.length} selected)`,
            variant: "cyan",
          },
        ]}
      />

      {/* Selection and ordering changes are non-visual for screen readers, so
          every mutation is mirrored here. */}
      <p
        role="status"
        aria-live="polite"
        className="sr-only"
        data-testid="comparison-announcement"
      >
        {announcement}
      </p>

      <div
        role="group"
        aria-label="Vault strategies available for comparison"
        style={{
          display: "grid",
          gap: "20px",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          marginBottom: "24px",
        }}
      >
        {VAULT_STRATEGIES.map((strategy) => {
          const selected = selectedIds.includes(strategy.id);
          const blocked = !selected && atSelectionLimit;

          return (
            <button
              key={strategy.id}
              type="button"
              onClick={() => handleToggle(strategy)}
              aria-pressed={selected}
              aria-disabled={blocked || undefined}
              title={
                blocked
                  ? `Deselect a strategy to compare ${strategy.name}`
                  : undefined
              }
              style={{
                textAlign: "left",
                padding: "18px",
                borderRadius: "16px",
                border: selected
                  ? `1px solid ${strategy.accent}`
                  : "1px solid var(--border-glass)",
                background: selected
                  ? "rgba(0, 240, 255, 0.08)"
                  : "rgba(255, 255, 255, 0.03)",
                color: "inherit",
                cursor: blocked ? "not-allowed" : "pointer",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                minHeight: "220px",
                opacity: blocked ? 0.55 : 1,
              }}
            >
              <div className="flex items-start justify-between gap-md">
                <div>
                  <div
                    style={{
                      color: "var(--text-secondary)",
                      fontSize: "0.75rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    {strategy.issuer}
                  </div>
                  <div style={{ fontSize: "1.05rem", fontWeight: 700, marginTop: "4px" }}>
                    {strategy.name}
                  </div>
                </div>
                <div
                  aria-hidden="true"
                  style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "50%",
                    flexShrink: 0,
                    border: `1px solid ${selected ? strategy.accent : "var(--border-glass)"}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: selected ? strategy.accent : "var(--text-secondary)",
                  }}
                >
                  {selected ? (
                    <Check size={14} />
                  ) : (
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: "currentColor",
                      }}
                    />
                  )}
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gap: "8px",
                  fontSize: "0.85rem",
                  color: "var(--text-secondary)",
                }}
              >
                <div className="flex items-center gap-sm">
                  <TrendingUp size={14} color={strategy.accent} aria-hidden="true" /> APY{" "}
                  {formatPercent(strategy.apyPercent, false, 2)}
                </div>
                <div className="flex items-center gap-sm">
                  <ShieldCheck size={14} color={strategy.accent} aria-hidden="true" /> Risk{" "}
                  {RISK_TIER_LABELS[strategy.riskTier]}
                </div>
                <div className="flex items-center gap-sm">
                  <Layers size={14} color={strategy.accent} aria-hidden="true" /> Liquidity{" "}
                  {formatLiquidityCadence(strategy.liquidityDays)}
                </div>
              </div>

              <div
                style={{
                  marginTop: "auto",
                  color: "var(--text-secondary)",
                  fontSize: "0.85rem",
                  lineHeight: 1.5,
                }}
              >
                {strategy.note}
              </div>
            </button>
          );
        })}
      </div>

      {!canCompare ? (
        <EmptyState
          kind="search"
          title="Select at least two strategies"
          description={
            selectedIds.length === 0
              ? "Nothing is selected yet. Choose two or three vault strategies to unlock a side-by-side comparison."
              : "One more strategy is needed to unlock a side-by-side comparison."
          }
          icon={<Layers size={24} />}
          action={{
            label: "Reset selection",
            onClick: handleReset,
            variant: "primary",
          }}
          secondaryAction={{
            label: "Back to vault",
            onClick: () => navigate("/"),
            variant: "secondary",
          }}
        />
      ) : (
        <section
          className="glass-panel"
          style={{ padding: "24px", background: "var(--bg-muted)" }}
          aria-labelledby="comparison-heading"
        >
          <div
            className="flex items-center justify-between gap-md"
            style={{ marginBottom: "16px", flexWrap: "wrap" }}
          >
            <div>
              <h2 id="comparison-heading" style={{ marginBottom: "4px" }}>
                Side-by-side comparison
              </h2>
              <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                Select a metric name to order the columns by it. Best values in each
                row are marked.
              </p>
            </div>
            <div className="flex items-center gap-sm" style={{ flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleReset}
              >
                Reset
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => navigate("/")}
              >
                Back to vault
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => navigate("/?tab=deposit")}
              >
                Allocate to selected
              </button>
            </div>
          </div>

          <div
            className="flex items-center gap-sm"
            style={{ marginBottom: "16px", flexWrap: "wrap" }}
          >
            {bestApyStrategy && (
              <Badge variant="pill" color="success">
                Highest APY: {bestApyStrategy.name} (
                {formatPercent(bestApyStrategy.apyPercent, false, 2)})
              </Badge>
            )}
            <Badge variant="pill" color="default">
              APY spread: {formatPercent(apySpread, false, 2)}
            </Badge>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
              <caption className="sr-only">
                Selected vault strategy comparison, ordered by{" "}
                {sortMetric ? `${sortMetric.label} ${sortDirection}ending` : "selection order"}
              </caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    style={{ textAlign: "left", padding: "12px", color: "var(--text-secondary)" }}
                  >
                    Metric
                  </th>
                  {comparedStrategies.map((strategy) => (
                    <th key={strategy.id} scope="col" style={{ textAlign: "left", padding: "12px" }}>
                      {strategy.name}
                      <span
                        style={{
                          display: "block",
                          fontWeight: 400,
                          fontSize: "0.75rem",
                          color: "var(--text-secondary)",
                        }}
                      >
                        {strategy.issuer}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON_METRICS.map((metric) => {
                  const isSorted = sortMetric?.id === metric.id;
                  const bestIds = bestByMetric.get(metric.id) ?? [];

                  return (
                    <tr key={metric.id}>
                      <th
                        scope="row"
                        aria-sort={
                          isSorted
                            ? sortDirection === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                        style={{
                          textAlign: "left",
                          padding: "12px",
                          color: "var(--text-secondary)",
                          fontWeight: 600,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => handleSort(metric)}
                          aria-label={`Order comparison by ${metric.label}. ${metric.description}`}
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            font: "inherit",
                            color: isSorted ? "var(--accent-cyan)" : "inherit",
                            cursor: "pointer",
                            textAlign: "left",
                          }}
                        >
                          {metric.label}
                          {isSorted && (
                            <span aria-hidden="true">
                              {sortDirection === "asc" ? " ↑" : " ↓"}
                            </span>
                          )}
                        </button>
                      </th>
                      {comparedStrategies.map((strategy) => {
                        const isBest = bestIds.includes(strategy.id);

                        return (
                          <td
                            key={`${strategy.id}-${metric.id}`}
                            data-best={isBest ? "true" : undefined}
                            style={{
                              padding: "12px",
                              borderTop: "1px solid var(--border-glass)",
                              color: isBest ? "var(--accent-green)" : undefined,
                              fontWeight: isBest ? 600 : undefined,
                            }}
                          >
                            {metric.format(strategy)}
                            {/* Colour alone would fail WCAG 1.4.1, so the
                                winner also carries a glyph and a text cue. */}
                            {isBest && (
                              <>
                                <span aria-hidden="true"> ★</span>
                                <span className="sr-only"> (best {metric.label})</span>
                              </>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};

export default VaultComparison;
