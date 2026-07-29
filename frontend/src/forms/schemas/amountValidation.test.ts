import { describe, it, expect } from "vitest";
import { AMOUNT_PATTERN, parseAmountInput } from "./amountValidation";

describe("AMOUNT_PATTERN", () => {
  it("matches the API's AmountSchema pattern", () => {
    expect(AMOUNT_PATTERN.source).toBe("^\\d+(\\.\\d{1,7})?$");
  });

  it("accepts whole numbers and up to 7 decimal places", () => {
    expect(AMOUNT_PATTERN.test("10")).toBe(true);
    expect(AMOUNT_PATTERN.test("0.1")).toBe(true);
    expect(AMOUNT_PATTERN.test("10.1234567")).toBe(true);
  });

  it("rejects more than 7 decimal places", () => {
    expect(AMOUNT_PATTERN.test("10.12345678")).toBe(false);
  });

  it("rejects scientific notation", () => {
    expect(AMOUNT_PATTERN.test("1e5")).toBe(false);
    expect(AMOUNT_PATTERN.test("1E5")).toBe(false);
  });

  it("rejects a leading sign or leading dot", () => {
    expect(AMOUNT_PATTERN.test("+10")).toBe(false);
    expect(AMOUNT_PATTERN.test("-10")).toBe(false);
    expect(AMOUNT_PATTERN.test(".5")).toBe(false);
  });
});

describe("parseAmountInput", () => {
  it("returns ok:false with a required message for empty input", () => {
    expect(parseAmountInput("")).toEqual({
      ok: false,
      error: "Amount is required.",
    });
    expect(parseAmountInput("   ")).toEqual({
      ok: false,
      error: "Amount is required.",
    });
  });

  it("returns ok:false for non-numeric input", () => {
    expect(parseAmountInput("abc")).toEqual({
      ok: false,
      error: "Enter a valid number.",
    });
  });

  it("returns ok:false for NaN and Infinity strings", () => {
    expect(parseAmountInput(String(Number.NaN))).toEqual({
      ok: false,
      error: "Enter a valid number.",
    });
    expect(parseAmountInput(String(Number.POSITIVE_INFINITY))).toEqual({
      ok: false,
      error: "Enter a valid number.",
    });
  });

  it("returns ok:false for zero or negative amounts", () => {
    expect(parseAmountInput("0")).toEqual({
      ok: false,
      error: "Amount must be greater than 0.",
    });
    expect(parseAmountInput("-10")).toEqual({
      ok: false,
      error: "Amount must be greater than 0.",
    });
  });

  it("returns a format error for scientific notation", () => {
    const result = parseAmountInput("1e5");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/up to 7 decimal places/);
    }
  });

  it("returns a format error for more than 7 decimal places", () => {
    const result = parseAmountInput("1.123456789");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/up to 7 decimal places/);
    }
  });

  it("returns ok:true with the parsed numeric amount for valid input", () => {
    expect(parseAmountInput("100")).toEqual({ ok: true, amount: 100 });
    expect(parseAmountInput("100.50")).toEqual({ ok: true, amount: 100.5 });
    expect(parseAmountInput("  10.1234567  ")).toEqual({
      ok: true,
      amount: 10.1234567,
    });
  });
});
