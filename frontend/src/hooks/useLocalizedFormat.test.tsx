import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useLocalizedFormat } from "./useLocalizedFormat";
import { PreferencesProvider } from "../context/PreferencesContext";
import React from "react";

function createWrapper(locale = "en-US") {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <PreferencesProvider walletAddress="test-wallet">
        {children}
      </PreferencesProvider>
    );
  };
}

describe("useLocalizedFormat", () => {
  it("returns formatting functions", () => {
    const { result } = renderHook(() => useLocalizedFormat(), {
      wrapper: createWrapper(),
    });

    expect(typeof result.current.fmt.number).toBe("function");
    expect(typeof result.current.fmt.currency).toBe("function");
    expect(typeof result.current.fmt.percent).toBe("function");
    expect(typeof result.current.fmt.compact).toBe("function");
    expect(typeof result.current.fmt.date).toBe("function");
    expect(result.current.locale).toBe("en-US");
  });

  it("formats numbers with locale separators", () => {
    const { result } = renderHook(() => useLocalizedFormat(), {
      wrapper: createWrapper(),
    });

    // en-US uses comma as thousands separator
    expect(result.current.fmt.number(1234567.89)).toBe("1,234,567.89");
    expect(result.current.fmt.number(1000)).toBe("1,000");
  });

  it("formats currency with locale", () => {
    const { result } = renderHook(() => useLocalizedFormat(), {
      wrapper: createWrapper(),
    });

    expect(result.current.fmt.currency(99.99)).toBe("$99.99");
  });

  it("formats percent with locale", () => {
    const { result } = renderHook(() => useLocalizedFormat(), {
      wrapper: createWrapper(),
    });

    expect(result.current.fmt.percent(5.25)).toBe("5.25%");
  });

  it("formats compact numbers", () => {
    const { result } = renderHook(() => useLocalizedFormat(), {
      wrapper: createWrapper(),
    });

    const formatted = result.current.fmt.compact(1_200_000);
    expect(formatted).toMatch(/1\.2/);
  });

  it("formats dates with locale", () => {
    const { result } = renderHook(() => useLocalizedFormat(), {
      wrapper: createWrapper(),
    });

    const dateStr = result.current.fmt.date(new Date("2025-06-15"), {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    expect(dateStr).toContain("2025");
    expect(dateStr).toContain("15");
  });

  it("number formatting respects custom options", () => {
    const { result } = renderHook(() => useLocalizedFormat(), {
      wrapper: createWrapper(),
    });

    expect(result.current.fmt.number(1234.5678, { maximumFractionDigits: 4 })).toBe(
      "1,234.5678",
    );
    expect(result.current.fmt.number(1234, { maximumFractionDigits: 0 })).toBe("1,234");
  });
});
