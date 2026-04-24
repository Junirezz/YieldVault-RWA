/**
 * Formatting utilities for numbers, currencies, and other values.
 */

const DEFAULT_LOCALE = "en-US";

export const numberFormatter = new Intl.NumberFormat(DEFAULT_LOCALE, {
  maximumFractionDigits: 2,
});

export const currencyFormatter = new Intl.NumberFormat(DEFAULT_LOCALE, {
  style: "currency",
  currency: "USD",
});

/**
 * Formats a number with up to `maxDecimals` decimal places.
 */
export function formatNumber(value: number, maxDecimals: number = 2): string {
  if (maxDecimals === 2) {
    return numberFormatter.format(value);
  }
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    maximumFractionDigits: maxDecimals,
  }).format(value);
}

/**
 * Formats a number as a currency string.
 */
export function formatCurrency(value: number, currencyCode: string = "USD", maxDecimals: number = 2): string {
  if (currencyCode === "USD" && maxDecimals === 2) {
    return currencyFormatter.format(value);
  }
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: maxDecimals,
  }).format(value);
}

/**
 * Formats a number as a compact string (e.g., 1.2K, 3.4M).
 */
export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * Formats a number as a percentage string. 
 * Expects value in 0-100 range if `isDecimal` is false, or 0-1 range if true.
 */
export function formatPercent(value: number, isDecimal: boolean = false): string {
  if (isDecimal) {
    return new Intl.NumberFormat(DEFAULT_LOCALE, {
      style: "percent",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }
  return `${formatNumber(value, 2)}%`;
}
