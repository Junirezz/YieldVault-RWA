import { useSyncExternalStore } from "react";
import { en } from "./locales/en";
import { es } from "./locales/es";

export type LocaleCode = "en" | "es";

/** Nested message object: leaves are translated strings (structure mirrors locale files). */
type MessageTree = { readonly [key: string]: string | MessageTree };

const catalogs: Record<LocaleCode, MessageTree> = {
  en: en as MessageTree,
  es: es as MessageTree,
};

let activeLocale: LocaleCode = "en";

const localeListeners = new Set<() => void>();

function notifyLocaleListeners(): void {
  localeListeners.forEach((listener) => listener());
}

function getValueAtPath(root: unknown, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = root;
  for (const segment of segments) {
    if (
      current === null ||
      typeof current !== "object" ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Looks up a translated string for the given dot-separated key (e.g. `nav.vaults`).
 *
 * **Missing keys:** If the key is absent in the active locale and in the English
 * catalog, this function returns the `key` string unchanged. That avoids rendering
 * `undefined`, empty text, or throwing — developers see the key in the UI and can
 * fix the catalog.
 *
 * **Adding a new locale:** Create `frontend/src/i18n/locales/<code>.ts` exporting
 * an object with the same nested shape as `en.ts`. Register it in the `catalogs`
 * map and extend the `LocaleCode` union in this file.
 *
 * **Switching locale:** Call `setLocale('es')` (or another registered code).
 * React components should use {@link useTranslation} so they re-render when the
 * locale changes; plain `t()` reads the current module locale on each call.
 *
 * @param key - Dot-separated path in the locale catalog (e.g. `wallet.connectFreighter`)
 * @returns The resolved string, an English fallback, or `key` if not found
 */
export function t(key: string): string {
  const localized = getValueAtPath(catalogs[activeLocale], key);
  if (typeof localized === "string") {
    return localized;
  }
  const fallbackEn = getValueAtPath(catalogs.en, key);
  if (typeof fallbackEn === "string") {
    return fallbackEn;
  }
  return key;
}

export function getLocale(): LocaleCode {
  return activeLocale;
}

export function setLocale(code: string): void {
  if (code === "en" || code === "es") {
    activeLocale = code;
    notifyLocaleListeners();
  }
}

export function subscribeLocale(onStoreChange: () => void): () => void {
  localeListeners.add(onStoreChange);
  return () => {
    localeListeners.delete(onStoreChange);
  };
}

export function useTranslation(): {
  t: typeof t;
  locale: LocaleCode;
  setLocale: typeof setLocale;
} {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  return { t, locale, setLocale };
}
