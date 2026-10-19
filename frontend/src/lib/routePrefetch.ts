import { lazy } from "react";

export const routeImports = {
  "/": () => import("../pages/Home"),
  "/portfolio": () => import("../pages/Portfolio"),
  "/analytics": () => import("../pages/Analytics"),
  "/transactions": () => import("../pages/TransactionHistory"),
  "/compare": () => import("../pages/VaultComparison"),
  "/vault-health": () => import("../pages/VaultHealthDashboard"),
  "/settings": () => import("../pages/Settings"),
  "/admin": () => import("../pages/Admin"),
  "/ui-kit": () => import("../pages/UIPreview"),
} as const;

export type PrefetchableRoute = keyof typeof routeImports;

/**
 * Routes on the critical dashboard path. Prefetched during the first idle
 * window after mount so the initial navigation is instant.
 */
export const PRIMARY_ROUTES: readonly PrefetchableRoute[] = [
  "/",
  "/portfolio",
  "/analytics",
  "/transactions",
];

/**
 * Heavy routes (charts, comparison tables, settings forms) that used to stay
 * cold until the user clicked them. Issue #1569: now covered by the idle
 * prefetch and by nav hover/focus handlers.
 */
export const HEAVY_ROUTES: readonly PrefetchableRoute[] = [
  "/compare",
  "/vault-health",
  "/settings",
];

/** Every route eligible for prefetching. */
export const PREFETCHABLE_ROUTES: readonly PrefetchableRoute[] = [
  ...PRIMARY_ROUTES,
  ...HEAVY_ROUTES,
  "/admin",
  "/ui-kit",
];

const prefetchedRoutes = new Set<string>();

export interface PrefetchStat {
  path: PrefetchableRoute;
  status: "pending" | "fulfilled" | "rejected";
  startedAt: number;
  durationMs: number | null;
  error?: string;
}

/** One sample recorded when the router commits to a new location. */
export interface NavigationMetric {
  path: string;
  at: number;
  /** Latest observed Largest Contentful Paint, in ms, when available. */
  lcpMs: number | null;
  /** Whether the route's chunk was prefetched before navigation. */
  prefetched: boolean;
}

export interface RoutePrefetchMetrics {
  latestLcpMs: number | null;
  prefetched: PrefetchableRoute[];
  stats: PrefetchStat[];
  navigations: NavigationMetric[];
}

const prefetchStats = new Map<PrefetchableRoute, PrefetchStat>();
const navigationMetrics: NavigationMetric[] = [];
const NAVIGATION_METRIC_LIMIT = 50;

let latestLcpMs: number | null = null;
let lcpObserver: PerformanceObserver | null = null;

function now(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

/**
 * Prefetches a route chunk exactly once. Best-effort: failures are recorded and
 * the route is removed from the in-flight set so a later hover can retry.
 */
export function prefetchRoute(path: PrefetchableRoute): Promise<void> {
  if (prefetchedRoutes.has(path)) return Promise.resolve();
  if (typeof window === "undefined") return Promise.resolve();

  prefetchedRoutes.add(path);
  const startedAt = now();
  const stat: PrefetchStat = {
    path,
    status: "pending",
    startedAt,
    durationMs: null,
  };
  prefetchStats.set(path, stat);

  return routeImports[path]()
    .then(() => {
      stat.status = "fulfilled";
      stat.durationMs = now() - startedAt;
    })
    .catch((error: unknown) => {
      stat.status = "rejected";
      stat.durationMs = now() - startedAt;
      stat.error = error instanceof Error ? error.message : String(error);
      // Allow a later hover/focus to retry a failed chunk load.
      prefetchedRoutes.delete(path);
    });
}

function prefetchRoutes(
  routes: readonly PrefetchableRoute[],
  excludePath?: string,
): void {
  for (const path of routes) {
    if (path !== excludePath) {
      void prefetchRoute(path);
    }
  }
}

/**
 * Prefetches all dashboard routes, including the heavy ones that were
 * previously left cold. Called from an idle callback in `App.tsx`.
 */
export function prefetchDashboardRoutes(excludePath?: string): void {
  prefetchRoutes(PRIMARY_ROUTES, excludePath);
  prefetchRoutes(HEAVY_ROUTES, excludePath);
}

/** Prefetches only the heavy routes (useful for a second, longer idle slice). */
export function prefetchHeavyRoutes(excludePath?: string): void {
  prefetchRoutes(HEAVY_ROUTES, excludePath);
}

/**
 * Handlers that warm a route on the first sign of user intent. Attach these to
 * nav links (`<NavLink {...getRoutePrefetchHandlers("/compare")} />`).
 *
 * `onPointerEnter` covers mouse/pen, `onTouchStart` covers touch devices that
 * never fire hover, and `onFocus` covers keyboard navigation.
 */
export function getRoutePrefetchHandlers(path: PrefetchableRoute) {
  const warm = () => {
    void prefetchRoute(path);
  };

  return {
    onMouseEnter: warm,
    onPointerEnter: warm,
    onFocus: warm,
    onTouchStart: warm,
  };
}

/**
 * Starts observing Largest Contentful Paint so prefetch effectiveness can be
 * measured in the field. Returns a cleanup function.
 */
export function observeLcp(): () => void {
  if (typeof PerformanceObserver === "undefined") {
    return () => undefined;
  }

  try {
    lcpObserver?.disconnect();
    lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1] as
        | (PerformanceEntry & { renderTime?: number; loadTime?: number })
        | undefined;
      if (!last) return;
      latestLcpMs = last.renderTime ?? last.loadTime ?? last.startTime;
    });
    lcpObserver.observe({
      type: "largest-contentful-paint",
      buffered: true,
    } as PerformanceObserverInit);
  } catch {
    // Unsupported browser / restricted environment — measurement is optional.
    return () => undefined;
  }

  return () => {
    lcpObserver?.disconnect();
    lcpObserver = null;
  };
}

/**
 * Records a navigation together with the latest LCP sample and whether the
 * destination chunk was already prefetched. Comparing `prefetched: true` vs
 * `false` samples gives the LCP improvement attributable to prefetching.
 */
export function recordRouteNavigation(path: string): void {
  const metric: NavigationMetric = {
    path,
    at: now(),
    lcpMs: latestLcpMs,
    prefetched: prefetchedRoutes.has(path),
  };

  navigationMetrics.push(metric);
  if (navigationMetrics.length > NAVIGATION_METRIC_LIMIT) {
    navigationMetrics.shift();
  }

  if (typeof performance !== "undefined" && typeof performance.mark === "function") {
    try {
      performance.mark(`route-nav:${path}`);
    } catch {
      // performance.mark is best-effort only.
    }
  }
}

/** Snapshot used by tests and by an optional analytics beacon. */
export function getRoutePrefetchMetrics(): RoutePrefetchMetrics {
  return {
    latestLcpMs,
    prefetched: Array.from(prefetchedRoutes) as PrefetchableRoute[],
    stats: Array.from(prefetchStats.values()),
    navigations: [...navigationMetrics],
  };
}

/** Clears measurement state. Exposed for tests. */
export function resetRoutePrefetchStateForTests(): void {
  prefetchedRoutes.clear();
  prefetchStats.clear();
  navigationMetrics.length = 0;
  latestLcpMs = null;
  lcpObserver?.disconnect();
  lcpObserver = null;
}

export const LazyHome = lazy(routeImports["/"]);
export const LazyPortfolio = lazy(routeImports["/portfolio"]);
export const LazyAnalytics = lazy(routeImports["/analytics"]);
export const LazyTransactionHistory = lazy(routeImports["/transactions"]);
export const LazyVaultComparison = lazy(routeImports["/compare"]);
export const LazyVaultHealth = lazy(routeImports["/vault-health"]);
export const LazySettings = lazy(routeImports["/settings"]);
export const LazyUIPreview = lazy(routeImports["/ui-kit"]);
