import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSlippage } from "./useSlippage";
import {
  SLIPPAGE_DEFAULT_PERCENT,
  SLIPPAGE_MAX_PERCENT,
  SLIPPAGE_MIN_PERCENT,
} from "../forms/schemas/slippageSchema";

const STORAGE_KEY = "yv_slippage_percent";
const LEGACY_STORAGE_KEY = "yv_slippage_bps";

describe("useSlippage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns the default slippage when nothing is stored", () => {
    const { result } = renderHook(() => useSlippage());
    expect(result.current.slippage).toBe(SLIPPAGE_DEFAULT_PERCENT);
  });

  it("persists values under the renamed percent key", () => {
    const { result } = renderHook(() => useSlippage());

    act(() => {
      result.current.setSlippage(1.5);
    });

    expect(result.current.slippage).toBe(1.5);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("1.5");
  });

  it("migrates a value stored under the legacy misnamed key", () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, "0.75");

    const { result } = renderHook(() => useSlippage());

    expect(result.current.slippage).toBe(0.75);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("0.75");
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });

  it("ignores an invalid legacy value and falls back to the default", () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, "not-a-number");

    const { result } = renderHook(() => useSlippage());

    expect(result.current.slippage).toBe(SLIPPAGE_DEFAULT_PERCENT);
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });

  it("falls back to the default when the stored value is out of range", () => {
    localStorage.setItem(STORAGE_KEY, "75");

    const { result } = renderHook(() => useSlippage());

    expect(result.current.slippage).toBe(SLIPPAGE_DEFAULT_PERCENT);
  });

  it("clamps out-of-range values on write", () => {
    const { result } = renderHook(() => useSlippage());

    act(() => {
      result.current.setSlippage(80);
    });
    expect(result.current.slippage).toBe(SLIPPAGE_MAX_PERCENT);

    act(() => {
      result.current.setSlippage(0.01);
    });
    expect(result.current.slippage).toBe(SLIPPAGE_MIN_PERCENT);
  });

  it("falls back to the default when a non-finite value is written", () => {
    const { result } = renderHook(() => useSlippage());

    act(() => {
      result.current.setSlippage(Number.NaN);
    });

    expect(result.current.slippage).toBe(SLIPPAGE_DEFAULT_PERCENT);
  });

  it("flags high slippage above the warning threshold", () => {
    const { result } = renderHook(() => useSlippage());

    act(() => {
      result.current.setSlippage(10);
    });

    expect(result.current.isHighSlippage).toBe(true);
    expect(result.current.minReceived(100)).toBe(90);
  });
});
