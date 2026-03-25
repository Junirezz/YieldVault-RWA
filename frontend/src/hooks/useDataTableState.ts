import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { TableSortDirection } from "../components/DataTable";

export interface DataTableState {
  search: string;
  sortBy: string;
  sortDirection: TableSortDirection;
  page: number;
  pageSize: number;
}

interface UseDataTableStateOptions {
  defaultSearch?: string;
  defaultSortBy: string;
  defaultSortDirection?: TableSortDirection;
  defaultPage?: number;
  defaultPageSize?: number;
}

export function useDataTableState(options: UseDataTableStateOptions) {
  const [searchParams, setSearchParams] = useSearchParams();

  const state = useMemo<DataTableState>(() => {
    const pageValue = Number(searchParams.get("page") ?? options.defaultPage ?? 1);
    const pageSizeValue = Number(
      searchParams.get("pageSize") ?? options.defaultPageSize ?? 5,
    );
    const sortDirection = searchParams.get("direction");

    return {
      search: searchParams.get("search") ?? options.defaultSearch ?? "",
      sortBy: searchParams.get("sortBy") ?? options.defaultSortBy,
      sortDirection:
        sortDirection === "asc" || sortDirection === "desc"
          ? sortDirection
          : options.defaultSortDirection ?? "asc",
      page: Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1,
      pageSize:
        Number.isFinite(pageSizeValue) && pageSizeValue > 0
          ? pageSizeValue
          : options.defaultPageSize ?? 5,
    };
  }, [options.defaultPage, options.defaultPageSize, options.defaultSearch, options.defaultSortBy, options.defaultSortDirection, searchParams]);

  const updateState = (nextState: Partial<DataTableState>) => {
    const mergedState = {
      ...state,
      ...nextState,
    };

    const nextParams = new URLSearchParams(searchParams);

    nextParams.set("search", mergedState.search);
    nextParams.set("sortBy", mergedState.sortBy);
    nextParams.set("direction", mergedState.sortDirection);
    nextParams.set("page", String(mergedState.page));
    nextParams.set("pageSize", String(mergedState.pageSize));

    setSearchParams(nextParams, { replace: true });
  };

  return {
    state,
    setSearch: (search: string) => updateState({ search, page: 1 }),
    setSort: (sortBy: string) =>
      updateState({
        sortBy,
        sortDirection:
          state.sortBy === sortBy && state.sortDirection === "asc" ? "desc" : "asc",
        page: 1,
      }),
    setPage: (page: number) => updateState({ page }),
    setPageSize: (pageSize: number) => updateState({ pageSize, page: 1 }),
  };
}
