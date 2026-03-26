import React from "react";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";

export interface PaginationProps {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
}

export const Pagination: React.FC<PaginationProps> = ({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [4, 6, 8, 10, 20, 50],
}) => {
  const totalPages = Math.ceil(totalItems / pageSize) || 1;
  const startItem = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, totalItems);

  const getPageNumbers = () => {
    const maxVisiblePages = 5;
    if (totalPages <= maxVisiblePages) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    const pages: (number | string)[] = [];
    if (page <= 3) {
      pages.push(1, 2, 3, 4, "...", totalPages);
    } else if (page >= totalPages - 2) {
      pages.push(
        1,
        "...",
        totalPages - 3,
        totalPages - 2,
        totalPages - 1,
        totalPages,
      );
    } else {
      pages.push(1, "...", page - 1, page, page + 1, "...", totalPages);
    }
    return pages;
  };

  return (
    <div className="pagination-container" aria-label="Pagination">
      <div className="pagination-summary" aria-live="polite">
        Showing <strong>{startItem}–{endItem}</strong> of{" "}
        <strong>{totalItems}</strong> results
      </div>

      <div className="pagination-controls-wrapper">
        {onPageSizeChange && (
          <div className="pagination-size-selector">
            <label htmlFor="pageSizeSelect" className="sr-only">
              Rows per page
            </label>
            <span className="pagination-size-label" aria-hidden="true">
              Rows:
            </span>
            <select
              id="pageSizeSelect"
              className="pagination-select"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              aria-label="Rows per page"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
        )}

        <nav className="pagination-nav-buttons" aria-label="Page navigation">
          <button
            type="button"
            className="btn btn-outline pagination-btn-nav"
            onClick={() => onPageChange?.(page - 1)}
            disabled={page <= 1}
            aria-label="Go to previous page"
          >
            <ChevronLeft size={16} />
          </button>

          <div className="pagination-pages">
            {getPageNumbers().map((p, i) => {
              if (p === "...") {
                return (
                  <span
                    key={`ellipsis-${i}`}
                    className="pagination-ellipsis"
                    aria-hidden="true"
                  >
                    <MoreHorizontal size={16} />
                  </span>
                );
              }
              const pageNum = p as number;
              return (
                <button
                  key={pageNum}
                  type="button"
                  className={`pagination-page-btn ${
                    pageNum === page ? "active" : ""
                  }`}
                  onClick={() => onPageChange?.(pageNum)}
                  aria-current={pageNum === page ? "page" : undefined}
                  aria-label={`Go to page ${pageNum}`}
                >
                  {pageNum}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className="btn btn-outline pagination-btn-nav"
            onClick={() => onPageChange?.(page + 1)}
            disabled={page >= totalPages}
            aria-label="Go to next page"
          >
            <ChevronRight size={16} />
          </button>
        </nav>
      </div>
    </div>
  );
};
