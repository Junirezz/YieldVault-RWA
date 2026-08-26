import React, { createContext, useContext, useEffect, useLayoutEffect, useState } from "react";
import {
  usePreferences,
  type UserPreferences,
  type Theme,
  type Locale,
  type Currency,
  type NotificationPreferences,
} from '../hooks/usePreferences';
import { useUserPreferenceStore } from '../hooks/useUserPreferenceStore';
import type {
  ChartMode,
  ChartModePreferences,
  TableDensity,
  TransactionPageSize,
  TransactionViewMode,
  UserPreferenceStoreData,
} from '../lib/userPreferenceStore';
import {
  applyResolvedTheme,
  dispatchThemeChange,
  getSystemTheme,
  persistThemePreference,
  resolveTheme,
  subscribeToSystemTheme,
  type ResolvedTheme,
} from "../lib/theme";

interface PreferencesContextType {
  preferences: UserPreferences;
  /** Resolved theme: 'light' | 'dark' (system pref resolved). */
  resolvedTheme: 'light' | 'dark';
  userPreferenceStore: UserPreferenceStoreData;
  chartModes: ChartModePreferences;
  tableDensity: TableDensity;
  setTheme: (theme: Theme) => void;
  setLocale: (locale: Locale) => void;
  setCurrency: (currency: Currency) => void;
  setNotification: (key: keyof NotificationPreferences, value: boolean) => void;
  toggleCompactMode: () => void;
  toggleShowBalances: () => void;
  toggleMaskSensitiveValues: () => void;
  setPrecision: (precision: number) => void;
  resetToDefaults: () => void;
  setChartMode: (chartKey: keyof ChartModePreferences, mode: ChartMode) => void;
  setTableDensity: (density: TableDensity) => void;
  setTransactionViewMode: (mode: TransactionViewMode) => void;
  setTransactionPageSize: (pageSize: TransactionPageSize) => void;
  resetUserPreferenceStore: () => void;
}

const PreferencesContext = createContext<PreferencesContextType | undefined>(undefined);

interface PreferencesProviderProps {
  children: React.ReactNode;
  walletAddress?: string | null;
}

export const PreferencesProvider: React.FC<PreferencesProviderProps> = ({
  children,
  walletAddress,
}) => {
  const {
    preferences,
    setTheme,
    setLocale,
    setCurrency,
    setNotification,
    toggleCompactMode,
    toggleShowBalances,
    toggleMaskSensitiveValues,
    setPrecision,
    resetToDefaults,
  } = usePreferences(walletAddress);

  const {
    store: userPreferenceStore,
    chartModes,
    tables,
    setChartMode,
    setTableDensity,
    setTransactionViewMode,
    setTransactionPageSize,
    resetStore: resetUserPreferenceStore,
  } = useUserPreferenceStore(walletAddress);

  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);

  useEffect(() => subscribeToSystemTheme(setSystemTheme), []);

  const resolvedTheme: ResolvedTheme =
    preferences.theme === "system" ? systemTheme : preferences.theme;

  useLayoutEffect(() => {
    persistThemePreference(preferences.theme);
    applyResolvedTheme(resolveTheme(preferences.theme));
    dispatchThemeChange(preferences.theme);
  }, [preferences.theme, resolvedTheme]);

  // Apply compact mode class
  useEffect(() => {
    if (preferences.compactMode) {
      document.documentElement.classList.add('compact-mode');
    } else {
      document.documentElement.classList.remove('compact-mode');
    }
  }, [preferences.compactMode]);

  // Apply table density preference to document root
  useEffect(() => {
    document.documentElement.setAttribute('data-table-density', tables.density);
  }, [tables.density]);

  const value: PreferencesContextType = {
    preferences,
    resolvedTheme,
    userPreferenceStore,
    chartModes,
    tableDensity: tables.density,
    setTheme,
    setLocale,
    setCurrency,
    setNotification,
    toggleCompactMode,
    toggleShowBalances,
    toggleMaskSensitiveValues,
    setPrecision,
    resetToDefaults,
    setChartMode,
    setTableDensity,
    setTransactionViewMode,
    setTransactionPageSize,
    resetUserPreferenceStore,
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

// eslint-disable-next-line react-refresh/only-export-components
export const useOptionalPreferencesContext = (): PreferencesContextType | undefined => {
  return useContext(PreferencesContext);
};
