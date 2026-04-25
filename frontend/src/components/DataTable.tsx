import type { KeyboardEvent, ReactNode } from "react";
import { useTranslation } from "../i18n";
import { Pagination } from "./Pagination";
import Skeleton from "./Skeleton";

export type TableSortDirection = "asc" | "desc";

export interface DataTableColumn<T> {
  id: string;
  header: string;
  accessor?: (row: T) => ReactNode;
  cell?: (row: T) => ReactNode;
  sortable?: boolean;
  width?: string;
  align?: "left" | "center" | "right";
}

interface PaginationState {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  emptyMessage: ReactNode;
  sortBy?: string;
  sortDirection?: TableSortDirection;
  onSortChange?: (columnId: string) => void;
  pagination?: PaginationState;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  renderRowDetails?: (row: T) => ReactNode;
  isLoading?: boolean;
  skeletonRows?: number;
}

function getCellAlignment(align: DataTableColumn<unknown>["align"]) {
  if (align === "center") {
    return "center";
  }

  if (align === "right") {
    return "right";
  }

  return "left";
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  emptyMessage,
  sortBy,
  sortDirection = "asc",
  onSortChange,
  pagination,
  onPageChange,
  onPageSizeChange,
  renderRowDetails,
  isLoading = false,
  skeletonRows = 5,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const handleHeaderKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    columnId: string,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSortChange?.(columnId);
    }
  };

  return (
    <div className="data-table-shell glass-panel">
      <div className="data-table-scroll">
        <table className="data-table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => {
                const isSorted = sortBy === column.id;
                const ariaSort = !column.sortable
                  ? "none"
                  : isSorted
                    ? sortDirection === "asc"
                      ? "ascending"
                      : "descending"
                    : "none";

                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={ariaSort}
                    style={{
                      width: column.width,
                      textAlign: getCellAlignment(column.align),
                    }}
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        className="data-table-sort"
                        onClick={() => onSortChange?.(column.id)}
                        onKeyDown={(event) =>
                          handleHeaderKeyDown(event, column.id)
                        }
                        aria-label={`${t("dataTable.sortBy")} ${column.header}`}
                      >
                        <span>{column.header}</span>
                        <span className="data-table-sort-indicator" aria-hidden="true">
                          {isSorted ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                        </span>
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
            {isLoading ? (
              Array.from({ length: skeletonRows }).map((_, rowIndex) => (
                <tr key={`skeleton-${rowIndex}`} className="data-table-row">
                  {columns.map((column) => (
                    <td
                      key={column.id}
                      style={{
                        textAlign: getCellAlignment(column.align),
                      }}
                    >
                      <Skeleton className="skeleton-text" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="data-table-empty">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={rowKey(row)} tabIndex={0} className="data-table-row">
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
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="data-table-pagination">
          <div className="data-table-pagination-summary">
            {t("dataTable.pageLabel")} {pagination.page}{" "}
            {t("dataTable.pageOf")} {pagination.totalPages}
          </div>
          <div className="data-table-pagination-actions">
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => onPageChange?.(pagination.page - 1)}
              disabled={pagination.page <= 1}
            >
              {t("dataTable.previous")}
            </button>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => onPageChange?.(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
            >
              {t("dataTable.next")}
            </button>
          </div>
        </div>
      )}
      {pagination && (
        <div className="data-table-pagination" style={{ padding: 0 }}>
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
