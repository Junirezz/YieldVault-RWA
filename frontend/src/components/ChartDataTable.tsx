/**
 * ChartDataTable
 *
 * Provides a non-visual, screen-reader-accessible data table for Recharts
 * views.  Two modes coexist:
 *
 *   1. A visually-hidden <table> that is **always present** in the DOM so
 *      AT users discover the data without needing to interact with the chart.
 *
 *   2. A visible "View as table / View as chart" toggle so sighted keyboard
 *      users can examine exact values without relying on the chart tooltip.
 *
 * Usage:
 *   <ChartDataTable
 *     caption="Daily yield earnings"
 *     columns={["Date", "Yield (USD)"]}
 *     rows={data.map(d => [d.date, formatCurrency(d.yield, ...)])}
 *     summaryLabel="30 days · $1 234.56 total"
 *   />
 */
import React, { useState, useId, useRef } from "react";

export interface ChartDataTableProps {
  /** <caption> text — identifies the table to AT users. */
  caption: string;
  /** Column header labels. */
  columns: readonly string[];
  /**
   * Table rows.  Each element is an ordered array of cell values matching
   * `columns`.  Cell values may be strings or numbers.
   */
  rows: ReadonlyArray<ReadonlyArray<string | number>>;
  /**
   * Short summary announced to screen readers (aria-live) when the data
   * changes.  E.g. "30 days · $1 234.56 total".
   */
  summaryLabel?: string;
  /**
   * Accessible label for the chart container that this table describes.
   * Used as the aria-describedby on the chart wrapper when connected via
   * `tableId`.
   */
  id?: string;
}

export const ChartDataTable: React.FC<ChartDataTableProps> = ({
  caption,
  columns,
  rows,
  summaryLabel,
  id,
}) => {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const tableId = id ?? `chart-data-table-${generatedId}`;
  const toggleRef = useRef<HTMLButtonElement>(null);

  function handleToggle() {
    setVisible((v) => !v);
  }

  return (
    <div className="chart-data-table-wrapper">
      {/* Visible toggle — always rendered so keyboard users can reach it */}
      <button
        ref={toggleRef}
        type="button"
        className="chart-data-table-toggle btn btn-outline"
        aria-expanded={visible}
        aria-controls={tableId}
        onClick={handleToggle}
        style={{
          fontSize: "0.75rem",
          padding: "4px 10px",
          marginBottom: visible ? "8px" : "0",
        }}
      >
        {visible ? "View as chart" : "View as table"}
      </button>

      {/*
       * The <table> is always in the DOM so screen readers can discover it.
       * When `visible` is false it is styled with .sr-only (visually hidden
       * but NOT display:none, which would remove it from the accessibility
       * tree on some browsers).
       */}
      <div
        id={tableId}
        className={visible ? "chart-data-table-visible" : "sr-only"}
        role="region"
        aria-label={caption}
      >
        {summaryLabel && (
          <p
            role="status"
            aria-live="polite"
            className="chart-data-table-summary"
            style={{
              fontSize: "0.78rem",
              color: "var(--text-secondary)",
              marginBottom: "6px",
            }}
          >
            {summaryLabel}
          </p>
        )}

        <div
          style={
            visible
              ? { maxHeight: "260px", overflowY: "auto", overflowX: "auto" }
              : undefined
          }
        >
          <table
            className="data-table chart-data-table"
            style={visible ? { width: "100%", fontSize: "0.8rem" } : undefined}
          >
            <caption className={visible ? "sr-only" : undefined}>{caption}</caption>
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col} scope="col">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="data-table-empty">
                    No data available.
                  </td>
                </tr>
              ) : (
                rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{cell}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ChartDataTable;
