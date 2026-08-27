export const THEME_STORAGE_KEY = "yieldvault-theme";
export const LEGACY_THEME_KEY = "theme";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const THEME_CHANGE_EVENT = "yieldvault-theme-change";

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "dark";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? getSystemTheme() : preference;
}

export function loadThemePreference(): ThemePreference {
  try {
    const stored =
      localStorage.getItem(THEME_STORAGE_KEY) ?? localStorage.getItem(LEGACY_THEME_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // storage unavailable
  }
  return "system";
}

export function persistThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
    localStorage.setItem(LEGACY_THEME_KEY, resolveTheme(preference));
  } catch {
    // storage quota exceeded or unavailable
  }
}

export function applyResolvedTheme(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  root.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", resolved === "dark" ? "#0a0b10" : "#f8fafc");
  }
}

export function subscribeToSystemTheme(
  callback: (theme: ResolvedTheme) => void,
): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = (event: MediaQueryListEvent) => {
    callback(event.matches ? "dark" : "light");
  };
  media.addEventListener("change", handler);
  return () => media.removeEventListener("change", handler);
}

export function dispatchThemeChange(preference: ThemePreference): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: preference }));
}

export function subscribeToThemeChange(
  callback: (preference: ThemePreference) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const handler = (event: Event) => {
    const preference = (event as CustomEvent<ThemePreference>).detail;
    if (preference === "light" || preference === "dark" || preference === "system") {
      callback(preference);
    }
  };
  window.addEventListener(THEME_CHANGE_EVENT, handler);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, handler);
}
