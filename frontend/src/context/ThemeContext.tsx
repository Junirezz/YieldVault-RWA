import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  applyResolvedTheme,
  dispatchThemeChange,
  loadThemePreference,
  persistThemePreference,
  resolveTheme,
  subscribeToSystemTheme,
  subscribeToThemeChange,
  type ResolvedTheme,
  type ThemePreference,
} from "../lib/theme";

type Theme = ThemePreference;

interface ThemeContextType {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function applyPreference(preference: ThemePreference) {
  persistThemePreference(preference);
  applyResolvedTheme(resolveTheme(preference));
  dispatchThemeChange(preference);
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(() => loadThemePreference());
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => resolveTheme("system"));

  const resolvedTheme = theme === "system" ? systemTheme : theme;

  useEffect(() => {
    applyResolvedTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    persistThemePreference(theme);
  }, [theme]);

  useEffect(() => subscribeToSystemTheme(setSystemTheme), []);

  useEffect(() => {
    return subscribeToThemeChange((next) => {
      setThemeState((current) => (current === next ? current : next));
    });
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyPreference(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === "light" ? "dark" : "light");
  }, [resolvedTheme, setTheme]);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme, toggleTheme }),
    [theme, resolvedTheme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useOptionalTheme = () => useContext(ThemeContext);
