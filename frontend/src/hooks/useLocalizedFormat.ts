import { useMemo } from "react";
import { usePreferencesContext } from "../context/PreferencesContext";
import {
  formatNumber,
  formatCurrency,
  formatPercent,
  formatCompactNumber,
  formatDate,
  type NumberFormatOptions,
  type CurrencyFormatOptions,
  type PercentFormatOptions,
  type DateFormatOptions,
} from "../lib/formatters";

/**
 * Returns locale-aware formatting functions that automatically use the
 * user's preferred locale from PreferencesContext.
 *
 * @example
 * ```tsx
 * const { fmt } = useLocalizedFormat();
 *
 * // Uses user's locale automatically
 * fmt.number(1234.56)           // "1,234.56" in en-US, "1.234,56" in de-DE
 * fmt.currency(99.99)           // "$99.99" in en-US, "€99,99" in de-DE
 * fmt.percent(5.25)             // "5.25%" in en-US, "5,25 %" in de-DE
 * fmt.compact(1_200_000)        // "1.2M" in en-US, "1,2 Mio." in de-DE
 * fmt.date(new Date())          // locale-formatted date string
 *
 * // Override locale per-call if needed
 * fmt.number(1234.56, { locale: "zh-CN" })
 * ```
 */
export function useLocalizedFormat() {
  const { preferences } = usePreferencesContext();
  const locale = preferences.locale;

  const fmt = useMemo(
    () => ({
      /**
       * Formats a number with locale-appropriate separators.
       */
      number: (value: number, options?: NumberFormatOptions): string =>
        formatNumber(value, { ...options, locale }),

      /**
       * Formats a number as a currency string with locale-appropriate
       * currency symbol and separators.
       */
      currency: (value: number, options?: CurrencyFormatOptions): string =>
        formatCurrency(value, { ...options, locale }),

      /**
       * Formats a number as a percentage string.
       * @param value - Number in 0-100 range (unless `isDecimal: true`)
       */
      percent: (value: number, options?: PercentFormatOptions): string =>
        formatPercent(value, { ...options, locale }),

      /**
       * Formats a large number in compact notation (e.g., 1.2K, 3.4M).
       */
      compact: (value: number): string => formatCompactNumber(value, locale),

      /**
       * Formats a date with locale-appropriate formatting.
       */
      date: (
        value: string | number | Date,
        formatOptions?: Intl.DateTimeFormatOptions,
      ): string => formatDate(value, { formatOptions, locale } as DateFormatOptions),
    }),
    [locale],
  );

  return { fmt, locale };
}
