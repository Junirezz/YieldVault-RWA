import { useMemo } from "react";
import type { DataTableState } from "./useDataTableState";

interface ServerDataTableOptions {
  state: DataTableState;
}

export function useServerDataTable({ state }: ServerDataTableOptions) {
  return useMemo(
    () => ({
      query: {
        search: state.search,
        sortBy: state.sortBy,
        direction: state.sortDirection,
        page: state.page,
        pageSize: state.pageSize,
      },
    }),
    [state.page, state.pageSize, state.search, state.sortBy, state.sortDirection],
  );
}
