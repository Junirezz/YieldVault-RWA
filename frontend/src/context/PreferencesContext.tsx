import React, { createContext, useContext, useEffect, useMemo } from 'react';
import {
  usePreferences,
  type UserPreferences,
  type Theme,
  type Locale,
  type Currency,
  type NotificationPreferences,
} from '../hooks/usePreferences';

interface PreferencesContextType {
  preferences: UserPreferences;
  /** Resolved theme: 'light' | 'dark' (system pref resolved). */
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  setLocale: (locale: Locale) => void;
  setCurrency: (currency: Currency) => void;
  setNotification: (key: keyof NotificationPreferences, value: boolean) => void;
  toggleCompactMode: () => void;
  toggleShowBalances: () => void;
  resetToDefaults: () => void;
}

const PreferencesContext = createContext<PreferencesContextType | undefined>(undefined);

export const PreferencesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    preferences,
    setTheme,
    setLocale,
    setCurrency,
    setNotification,
    toggleCompactMode,
    toggleShowBalances,
    resetToDefaults,
  } = usePreferences();

  // Resolve 'system' to an actual light/dark value
  const resolvedTheme = useMemo((): 'light' | 'dark' => {
    if (preferences.theme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return preferences.theme;
  }, [preferences.theme]);

  // Apply resolved theme to document root
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme);
    // Persist the raw preference so ThemeContext (ThemeToggle) stays in sync
    localStorage.setItem('theme', resolvedTheme);
  }, [resolvedTheme]);

  // Apply compact mode class
  useEffect(() => {
    if (preferences.compactMode) {
      document.documentElement.classList.add('compact-mode');
    } else {
      document.documentElement.classList.remove('compact-mode');
    }
  }, [preferences.compactMode]);

  const value: PreferencesContextType = {
    preferences,
    resolvedTheme,
    setTheme,
    setLocale,
    setCurrency,
    setNotification,
    toggleCompactMode,
    toggleShowBalances,
    resetToDefaults,
  };

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const usePreferencesContext = (): PreferencesContextType => {
  const ctx = useContext(PreferencesContext);
  if (!ctx) {
    throw new Error('usePreferencesContext must be used within a PreferencesProvider');
  }
  return ctx;
};
