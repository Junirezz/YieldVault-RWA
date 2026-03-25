import { useMemo } from "react";
import type { DataTableState } from "./useDataTableState";

export interface ClientTableConfig<T> {
  rows: T[];
  state: DataTableState;
  getSearchValue: (row: T) => string;
  getSortValue: (row: T, columnId: string) => string | number;
}

export function useClientDataTable<T>({
  rows,
  state,
  getSearchValue,
  getSortValue,
}: ClientTableConfig<T>) {
  const filteredRows = useMemo(() => {
    const search = state.search.trim().toLowerCase();
    if (!search) {
      return rows;
    }

    return rows.filter((row) =>
      getSearchValue(row).toLowerCase().includes(search),
    );
  }, [getSearchValue, rows, state.search]);

  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((left, right) => {
      const leftValue = getSortValue(left, state.sortBy);
      const rightValue = getSortValue(right, state.sortBy);

      if (leftValue === rightValue) {
        return 0;
      }

      if (leftValue > rightValue) {
        return state.sortDirection === "asc" ? 1 : -1;
      }

      return state.sortDirection === "asc" ? -1 : 1;
    });
  }, [filteredRows, getSortValue, state.sortBy, state.sortDirection]);

  const totalItems = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / state.pageSize));
  const safePage = Math.min(state.page, totalPages);
  const startIndex = (safePage - 1) * state.pageSize;
  const paginatedRows = sortedRows.slice(startIndex, startIndex + state.pageSize);

  return {
    rows: paginatedRows,
    totalItems,
    totalPages,
    page: safePage,
  };
}
