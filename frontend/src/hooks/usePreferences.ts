import { useState, useCallback, useEffect } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type Locale = 'en-US' | 'en-GB' | 'de-DE' | 'fr-FR' | 'ja-JP' | 'zh-CN';
export type Currency = 'USD' | 'XLM';

export interface NotificationPreferences {
  depositAlerts: boolean;
  withdrawalAlerts: boolean;
  yieldUpdates: boolean;
  priceAlerts: boolean;
  weeklyReport: boolean;
  securityAlerts: boolean;
}

export interface UserPreferences {
  theme: Theme;
  locale: Locale;
  currency: Currency;
  notifications: NotificationPreferences;
  compactMode: boolean;
  showBalances: boolean;
}

const STORAGE_KEY_PREFIX = "yieldvault-preferences";

const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'dark',
  locale: 'en-US',
  currency: 'USD',
  notifications: {
    depositAlerts: true,
    withdrawalAlerts: true,
    yieldUpdates: true,
    priceAlerts: false,
    weeklyReport: true,
    securityAlerts: true,
  },
  compactMode: false,
  showBalances: true,
};

function getStorageKey(walletAddress?: string | null): string {
  const walletScope = walletAddress?.trim() ? walletAddress.trim() : "guest";
  return `${STORAGE_KEY_PREFIX}:${walletScope}`;
}

function loadPreferences(walletAddress?: string | null): UserPreferences {
  try {
    const raw = localStorage.getItem(getStorageKey(walletAddress));
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    return {
      ...DEFAULT_PREFERENCES,
      ...parsed,
      notifications: {
        ...DEFAULT_PREFERENCES.notifications,
        ...(parsed.notifications ?? {}),
      },
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function savePreferences(prefs: UserPreferences, walletAddress?: string | null): void {
  try {
    localStorage.setItem(getStorageKey(walletAddress), JSON.stringify(prefs));
  } catch {
    // storage quota exceeded or unavailable — silently ignore
  }
}

export function usePreferences(walletAddress?: string | null) {
  const [preferences, setPreferencesState] = useState<UserPreferences>(() =>
    loadPreferences(walletAddress),
  );

  useEffect(() => {
    setPreferencesState(loadPreferences(walletAddress));
  }, [walletAddress]);

  const setPreferences = useCallback((updater: Partial<UserPreferences> | ((prev: UserPreferences) => UserPreferences)) => {
    setPreferencesState(prev => {
      const next =
        typeof updater === 'function'
          ? updater(prev)
          : { ...prev, ...updater };
      savePreferences(next, walletAddress);
      return next;
    });
  }, [walletAddress]);

  const setTheme = useCallback((theme: Theme) => {
    setPreferences({ theme });
  }, [setPreferences]);

  const setLocale = useCallback((locale: Locale) => {
    setPreferences({ locale });
  }, [setPreferences]);

  const setCurrency = useCallback((currency: Currency) => {
    setPreferences({ currency });
  }, [setPreferences]);

  const setNotification = useCallback((key: keyof NotificationPreferences, value: boolean) => {
    setPreferences(prev => ({
      ...prev,
      notifications: { ...prev.notifications, [key]: value },
    }));
  }, [setPreferences]);

  const toggleCompactMode = useCallback(() => {
    setPreferences(prev => ({ ...prev, compactMode: !prev.compactMode }));
  }, [setPreferences]);

  const toggleShowBalances = useCallback(() => {
    setPreferences(prev => ({ ...prev, showBalances: !prev.showBalances }));
  }, [setPreferences]);

  const resetToDefaults = useCallback(() => {
    savePreferences(DEFAULT_PREFERENCES, walletAddress);
    setPreferencesState(DEFAULT_PREFERENCES);
  }, [walletAddress]);

  return {
    preferences,
    setTheme,
    setLocale,
    setCurrency,
    setNotification,
    toggleCompactMode,
    toggleShowBalances,
    resetToDefaults,
  };
}
