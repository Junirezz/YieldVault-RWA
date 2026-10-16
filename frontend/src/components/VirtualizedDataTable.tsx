import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "../i18n";
import { Pagination } from "./Pagination";
import { TableSkeleton } from "./Skeleton";
import { useDelayedLoading } from "../hooks/useDelayedLoading";
import { getColumnSortState } from "./dataTableSort";
import type { TableSortDirection, TableSortKey } from "./dataTableSort";
import type { DataTableColumn } from "./DataTable";

/** Row height in pixels — keep in sync with .data-table th/td padding. */
export const VIRTUALIZED_ROW_HEIGHT = 52;

/** Enable virtualization when row count meets or exceeds this threshold. */
export const VIRTUALIZATION_THRESHOLD = 50;

interface PaginationState {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

interface VirtualizedDataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  emptyMessage: ReactNode;
  sortBy?: string;
  sortDirection?: TableSortDirection;
  onSortChange?: (columnId: string) => void;
  /** Active multi-column sort; supersedes `sortBy` / `sortDirection`. */
  sortKeys?: readonly TableSortKey[];
  /** Multi-column sort handler; `additive` mirrors the Shift modifier. */
  onSortToggle?: (columnId: string, additive: boolean) => void;
  pagination?: PaginationState;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  renderRowDetails?: (row: T) => ReactNode;
  onRowClick?: (row: T) => void;
  selectedRowKey?: string | null;
  isLoading?: boolean;
  skeletonRows?: number;
  /** Fixed viewport height for the scrollable body. */
  maxHeight?: number;
}

function getCellAlignment(align: DataTableColumn<unknown>["align"]) {
  if (align === "center") return "center";
  if (align === "right") return "right";
  return "left";
}

export function shouldVirtualizeTransactionList(rowCount: number): boolean {
  return rowCount >= VIRTUALIZATION_THRESHOLD;
}

export function VirtualizedDataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  emptyMessage,
  sortBy,
  sortDirection = "asc",
  onSortChange,
  sortKeys,
  onSortToggle,
  pagination,
  onPageChange,
  onPageSizeChange,
  renderRowDetails,
  onRowClick,
  selectedRowKey,
  isLoading = false,
  skeletonRows = 5,
  maxHeight = 600,
}: VirtualizedDataTableProps<T>) {
  const { t } = useTranslation();
  const delayedLoading = useDelayedLoading(isLoading);
  // The scroll container wraps the whole table so thead and tbody stay in the
  // same table element — screen readers can correctly associate header cells
  // with data cells.
  const parentRef = useRef<HTMLDivElement>(null);

  const handleRowKeyDown = (
    event: KeyboardEvent<HTMLTableRowElement>,
    row: T,
  ) => {
    if (!onRowClick) return;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onRowClick(row);
    }
  };

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => VIRTUALIZED_ROW_HEIGHT,
    overscan: 8,
  });

  const activateSort = (columnId: string, additive: boolean) => {
    if (onSortToggle) {
      onSortToggle(columnId, additive);
      return;
    }
    onSortChange?.(columnId);
  };

  const handleHeaderKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    columnId: string,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activateSort(columnId, event.shiftKey);
    }
  };

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalHeight = rowVirtualizer.getTotalSize();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? totalHeight - virtualRows[virtualRows.length - 1].end
      : 0;

  return (
    <div className="data-table-shell glass-panel" aria-busy={delayedLoading}>
      {/*
       * Single scroll container wrapping one <table>.
       * thead uses position:sticky so it remains visible while the body
       * scrolls, without ever leaving the table — preserving the DOM
       * relationship that lets screen readers map headers to cells.
       */}
      <div
        ref={parentRef}
        className="data-table-scroll"
        style={{ maxHeight, overflowY: "auto", overflowX: "auto" }}
        data-testid="virtualized-table-body"
      >
        <table className="data-table" style={{ width: "100%" }}>
          <caption className="sr-only">{caption}</caption>

          <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
            <tr>
              {columns.map((column) => {
                const sortState = getColumnSortState(
                  column.id,
                  column.sortable,
                  sortKeys,
                  sortBy,
                  sortDirection,
                );

                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={sortState.ariaSort}
                    style={{
                      width: column.width,
                      textAlign: getCellAlignment(column.align),
                    }}
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        className="data-table-sort"
                        onClick={(event) =>
                          activateSort(column.id, event.shiftKey)
                        }
                        onKeyDown={(event) =>
                          handleHeaderKeyDown(event, column.id)
                        }
                        aria-label={`${t("dataTable.sortBy")} ${column.header}`}
                      >
                        <span>{column.header}</span>
                        <span
                          className="data-table-sort-indicator"
                          aria-hidden="true"
                        >
                          {sortState.direction
                            ? sortState.direction === "asc"
                              ? "↑"
                              : "↓"
                            : "↕"}
                        </span>
                        {sortState.priority !== null && (
                          <span
                            className="data-table-sort-priority"
                            aria-hidden="true"
                          >
                            {sortState.priority}
                          </span>
                        )}
                      </button>
                    ) : (
                      <span>{column.header}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {delayedLoading ? (
              <TableSkeleton columns={columns.length} rows={skeletonRows} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="data-table-empty">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              <>
                {paddingTop > 0 && (
                  <tr aria-hidden="true">
                    <td
                      colSpan={columns.length}
                      style={{ height: paddingTop, padding: 0, border: "none" }}
                    />
                  </tr>
                )}
                {virtualRows.map((virtualRow) => {
                  const row = rows[virtualRow.index];
                  const key = rowKey(row);
                  const isSelected = selectedRowKey === key;

                  return (
                    <tr
                      key={key}
                      tabIndex={onRowClick ? 0 : undefined}
                      className={`data-table-row${onRowClick ? " data-table-row--interactive" : ""}${isSelected ? " data-table-row--selected" : ""}`}
                      data-index={virtualRow.index}
                      style={{ height: VIRTUALIZED_ROW_HEIGHT }}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      onKeyDown={(event) => handleRowKeyDown(event, row)}
                      aria-selected={onRowClick ? isSelected : undefined}
                      role={onRowClick ? "button" : undefined}
                      aria-label={
                        onRowClick ? t("dataTable.viewRowDetails") : undefined
                      }
                    >
                      {columns.map((column, columnIndex) => {
                        const content = column.cell
                          ? column.cell(row)
                          : column.accessor?.(row);

                        return (
                          <td
                            key={column.id}
                            data-label={column.header}
                            style={{
                              textAlign: getCellAlignment(column.align),
                            }}
                          >
                            {content}
                            {renderRowDetails && columnIndex === 0 && (
                              <div className="data-table-mobile-detail">
                                {renderRowDetails(row)}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {paddingBottom > 0 && (
                  <tr aria-hidden="true">
                    <td
                      colSpan={columns.length}
                      style={{
                        height: paddingBottom,
                        padding: 0,
                        border: "none",
                      }}
                    />
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* Single pagination control — the custom prev/next block that was
          previously duplicated here has been removed. */}
      {pagination && (
        <div className="data-table-pagination">
          <Pagination
            page={pagination.page}
            pageSize={pagination.pageSize}
            totalItems={pagination.totalItems}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
          />
        </div>
      )}
    </div>
  );
}
