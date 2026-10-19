import { beforeEach, describe, expect, it } from "vitest";
import {
  HEAVY_ROUTES,
  PREFETCHABLE_ROUTES,
  PRIMARY_ROUTES,
  getRoutePrefetchHandlers,
  getRoutePrefetchMetrics,
  recordRouteNavigation,
  resetRoutePrefetchStateForTests,
} from "./routePrefetch";

describe("route prefetch coverage (issue #1569)", () => {
  it("includes the previously cold heavy routes", () => {
    expect(HEAVY_ROUTES).toEqual(
      expect.arrayContaining(["/compare", "/vault-health", "/settings"]),
    );
  });

  it("exposes every primary and heavy route as prefetchable", () => {
    for (const route of [...PRIMARY_ROUTES, ...HEAVY_ROUTES]) {
      expect(PREFETCHABLE_ROUTES).toContain(route);
    }
  });

  it("provides hover, focus and touch handlers for nav links", () => {
    const handlers = getRoutePrefetchHandlers("/compare");
    expect(typeof handlers.onMouseEnter).toBe("function");
    expect(typeof handlers.onPointerEnter).toBe("function");
    expect(typeof handlers.onFocus).toBe("function");
    expect(typeof handlers.onTouchStart).toBe("function");
  });
});

describe("route prefetch measurement", () => {
  beforeEach(() => {
    resetRoutePrefetchStateForTests();
  });

  it("records navigation samples with prefetch status", () => {
    recordRouteNavigation("/vault-health");

    const metrics = getRoutePrefetchMetrics();
    expect(metrics.navigations).toHaveLength(1);
    expect(metrics.navigations[0]).toMatchObject({
      path: "/vault-health",
      prefetched: false,
    });
  });

  it("starts with no prefetched routes after a reset", () => {
    expect(getRoutePrefetchMetrics().prefetched).toEqual([]);
  });
});
