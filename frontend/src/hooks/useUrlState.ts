import { useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";

export type SortDirection = "asc" | "desc";

export interface UrlStateConfig<TFilters extends Record<string, string>> {
  defaultPage?: number;
  defaultPageSize?: number;
  defaultSortBy?: string;
  defaultSortDirection?: SortDirection;
  defaultFilters?: TFilters;
}

export function useUrlState<TFilters extends Record<string, string>>(
  config: UrlStateConfig<TFilters>,
) {
  const [searchParams, setSearchParams] = useSearchParams();

  const state = useMemo(() => {
    const pageRaw = searchParams.get("page");
    const pageSizeRaw = searchParams.get("pageSize");
    const sortDirectionRaw =
      searchParams.get("direction") ?? searchParams.get("sortDirection");
    // Support both "direction" and "sortDirection" as URL param names
    const sortDirectionRaw = searchParams.get("direction") ?? searchParams.get("sortDirection");

    const pageNum = Number(pageRaw);
    const page =
      pageRaw !== null && Number.isFinite(pageNum) && pageNum > 0
        ? pageNum
        : config.defaultPage ?? 1;

    const pageSizeNum = Number(pageSizeRaw);
    const pageSize =
      pageSizeRaw !== null && Number.isFinite(pageSizeNum) && pageSizeNum > 0
        ? Math.min(pageSizeNum, 100) // clamp max page size to 100 for safety
        : config.defaultPageSize ?? 25;

    const sortBy = searchParams.get("sortBy") ?? config.defaultSortBy ?? "";
    const sortDirection: SortDirection =
      sortDirectionRaw === "asc" || sortDirectionRaw === "desc"
        ? sortDirectionRaw
        : config.defaultSortDirection ?? "asc";

    const filters = { ...config.defaultFilters } as TFilters;
    if (config.defaultFilters) {
      Object.keys(config.defaultFilters).forEach((key) => {
        const val = searchParams.get(key);
        if (val !== null) {
          (filters as Record<string, string>)[key] = val;
        }
      });
    }

    return {
      page,
      pageSize,
      sortBy,
      sortDirection,
      filters,
    };
  }, [searchParams, config]);

  const updateUrl = useCallback(
    (updates: Partial<typeof state>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);

          if (updates.page !== undefined) {
            next.set("page", String(updates.page));
          }
          if (updates.pageSize !== undefined) {
            next.set("pageSize", String(updates.pageSize));
          }
          if (updates.sortBy !== undefined) {
            next.set("sortBy", updates.sortBy);
          }
          if (updates.sortDirection !== undefined) {
            next.set("direction", updates.sortDirection);
            next.delete("sortDirection");
          }

          if (updates.filters !== undefined) {
            Object.keys(updates.filters).forEach((key) => {
              const val = (updates.filters as Record<string, string>)[key];
              if (val !== undefined && val !== null && val !== "") {
                next.set(key, String(val));
              } else {
                next.delete(key);
              }
            });
          }

          return next;
        },
        // We use shallow routing / replace to ensure the back button works naturally without filling history with every minor state change, 
        // however push is better for explicit filter application. React-router's setSearchParams defaults to push, but we use replace for pagination maybe?
        // Actually, for filters being "shareable via URL" and "back/forward navigation restores state correctly", it is sometimes better to push when filters change, 
        // but replace when typing in a search box. Let's use standard push except for rapid changes. The prompt says "without full reload (shallow routing)".
        // `setSearchParams` does shallow routing by default. We won't pass `{ replace: true }` so the user can use the back button to undo filter/page changes!
        // Wait, the prompt says: "Ensure back/forward navigation restores state correctly". If we use `replace: true`, back button leaves the page entirely.
        // So we just omit `replace: true` to let it push to history, OR we can let the caller decide.
        // Let's omit `replace: true` (or use it conditionally). For now, default `setSearchParams(next)` pushes to history.
      );
    },
    [setSearchParams],
  );

  const setPage = useCallback(
    (page: number) => updateUrl({ page }),
    [updateUrl],
  );

  const setPageSize = useCallback(
    (pageSize: number) => updateUrl({ pageSize, page: 1 }),
    [updateUrl],
  );

  const setSort = useCallback(
    (sortBy: string, sortDirection?: SortDirection) => {
      if (!sortDirection) {
        sortDirection =
          state.sortBy === sortBy && state.sortDirection === "asc"
            ? "desc"
            : "asc";
      }
      updateUrl({ sortBy, sortDirection, page: 1 });
    },
    [updateUrl, state.sortBy, state.sortDirection],
  );

  const setFilters = useCallback(
    (newFilters: Partial<TFilters>) => {
      updateUrl({ filters: { ...state.filters, ...newFilters }, page: 1 });
    },
    [updateUrl, state.filters],
  );

  const reset = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("page");
      next.delete("pageSize");
      next.delete("sortBy");
      next.delete("sortDirection");
      next.delete("direction");

      if (config.defaultFilters) {
        Object.keys(config.defaultFilters).forEach((key) => {
          next.delete(key);
        });
      }
      return next;
    });
  }, [setSearchParams, config.defaultFilters]);

  const setSearch = useCallback(
    (searchQuery: string) => {
      setFilters({ search: searchQuery } as unknown as Partial<TFilters>);
    },
    [setFilters],
  );

  return {
    state,
    setPage,
    setPageSize,
    setSort,
    setFilters,
    setSearch,
    reset,
  };
}
