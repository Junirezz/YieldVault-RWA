import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

describe("usePrefersReducedMotion", () => {
  it("returns false when the user has no reduced-motion preference", () => {
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(typeof result.current).toBe("boolean");
  });

  it("returns true when matchMedia reports reduced motion", () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
        onchange: null,
      })) as typeof window.matchMedia;

    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
    window.matchMedia = original;
  });
});
