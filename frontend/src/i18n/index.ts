import i18n from "i18next";
import { initReactI18next, useTranslation as useI18nextTranslation } from "react-i18next";
import { useMemo } from "react";
import { en } from "./locales/en";
import { es } from "./locales/es";

export type LocaleCode = "en" | "es";

export const SUPPORTED_LOCALES: readonly LocaleCode[] = ["en", "es"];

/** Locales that should render with `dir="rtl"` once catalogs are added. */
export const RTL_LOCALES = new Set<string>(["ar", "he", "fa", "ur"]);

export const LOCALE_STORAGE_KEY = "yieldvault.locale";

const catalogs = {
  en: { translation: en },
  es: { translation: es },
} as const;

export function isRtlLocale(locale: string): boolean {
  const base = locale.toLowerCase().split("-")[0];
  return RTL_LOCALES.has(base);
}

export function getTextDirection(locale: string): "rtl" | "ltr" {
  return isRtlLocale(locale) ? "rtl" : "ltr";
}

export function applyDocumentDirection(locale: string): void {
  if (typeof document === "undefined") {
    return;
  }
  const dir = getTextDirection(locale);
  const html = document.documentElement;
  html.setAttribute("dir", dir);
  html.setAttribute("lang", locale);
  html.dataset.locale = locale;
}

function readStoredLocale(): LocaleCode {
  if (typeof window === "undefined") {
    return "en";
  }
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "en" || stored === "es") {
      return stored;
    }
  } catch {
    // Ignore quota / privacy-mode failures.
  }
  return "en";
}

function persistLocale(code: LocaleCode): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, code);
  } catch {
    // Ignore quota / privacy-mode failures.
  }
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: catalogs,
    lng: readStoredLocale(),
    fallbackLng: "en",
    supportedLngs: [...SUPPORTED_LOCALES],
    defaultNS: "translation",
    interpolation: {
      escapeValue: false,
    },
    returnNull: false,
    returnEmptyString: false,
  });
}

applyDocumentDirection(i18n.language || "en");

i18n.on("languageChanged", (lng) => {
  applyDocumentDirection(lng);
});

export function getLocale(): LocaleCode {
  const lng = (i18n.resolvedLanguage || i18n.language || "en").split("-")[0];
  return lng === "es" ? "es" : "en";
}

export function setLocale(code: string): void {
  if (code !== "en" && code !== "es") {
    return;
  }
  persistLocale(code);
  applyDocumentDirection(code);
  void i18n.changeLanguage(code);
}

/**
 * Looks up a translated string. Supports i18next interpolation via an options
 * object (`t('session.warning.message', { minutes: 5 })`) and a string default
 * (`t('missing.key', 'fallback')`) for existing call sites.
 */
export function t(
  key: string,
  defaultValueOrOptions?: string | Record<string, unknown>,
): string {
  if (typeof defaultValueOrOptions === "string") {
    return String(i18n.t(key, { defaultValue: defaultValueOrOptions }));
  }
  if (defaultValueOrOptions && typeof defaultValueOrOptions === "object") {
    return String(i18n.t(key, defaultValueOrOptions));
  }
  const value = i18n.t(key, { defaultValue: key });
  return typeof value === "string" ? value : key;
}

export function useTranslation(): {
  t: typeof t;
  locale: LocaleCode;
  setLocale: typeof setLocale;
  dir: "rtl" | "ltr";
} {
  const { i18n: instance } = useI18nextTranslation();
  const locale: LocaleCode = instance.language?.startsWith("es") ? "es" : "en";
  const dir = getTextDirection(locale);
  return useMemo(
    () => ({ t, locale, setLocale, dir }),
    [locale, dir],
  );
}

export { i18n };
export default i18n;
