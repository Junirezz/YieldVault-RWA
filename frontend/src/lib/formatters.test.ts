import { describe, it, expect } from "vitest";
import {
  formatNumber,
  formatCurrency,
  formatCompactNumber,
  formatPercent,
} from "./formatters";

describe("formatters", () => {
  describe("formatNumber", () => {
    it("formats numbers with default 2 decimal places", () => {
      expect(formatNumber(1234.567)).toBe("1,234.57");
      expect(formatNumber(1000)).toBe("1,000");
    });

    it("formats numbers with custom decimal places", () => {
      expect(formatNumber(1234.5678, 4)).toBe("1,234.5678");
      expect(formatNumber(1000, 0)).toBe("1,000");
    });
  });

  describe("formatCurrency", () => {
    it("formats as USD by default", () => {
      expect(formatCurrency(1234.56)).toBe("$1,234.56");
      expect(formatCurrency(1000)).toBe("$1,000.00");
    });

    it("formats with custom currency", () => {
      const formatted = formatCurrency(1234.56, "EUR");
      // Depending on node version/locale, this could be "€1,234.56" or similar.
      // We check that it contains the number and some symbol
      expect(formatted).toContain("1,234.56");
      expect(formatted).not.toContain("$");
    });
  });

  describe("formatCompactNumber", () => {
    it("formats thousands", () => {
      expect(formatCompactNumber(1200)).toBe("1.2K");
      expect(formatCompactNumber(1000)).toBe("1K");
    });

    it("formats millions", () => {
      expect(formatCompactNumber(1500000)).toBe("1.5M");
      expect(formatCompactNumber(2000000)).toBe("2M");
    });
  });

  describe("formatPercent", () => {
    it("formats normal numbers as percent", () => {
      expect(formatPercent(5)).toBe("5%");
      expect(formatPercent(5.555)).toBe("5.56%");
    });

    it("formats decimal values as percent when specified", () => {
      expect(formatPercent(0.05, true)).toBe("5.00%");
      expect(formatPercent(0.05555, true)).toBe("5.56%");
    });
  });
});
