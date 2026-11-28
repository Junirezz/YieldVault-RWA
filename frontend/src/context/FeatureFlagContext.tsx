import React, { createContext, useContext, useEffect, useState } from "react";
import type { PublicFeatureFlagKey } from "../lib/api";
import { fetchPublicConfig } from "../lib/publicConfig";

const FLAG_KEYS = ["ANALYTICS_PAGE"] as const;
export type FeatureFlagKey = (typeof FLAG_KEYS)[number];

type FeatureFlagMap = Record<FeatureFlagKey, boolean>;

/**
 * Maps frontend flag keys onto the backend's public feature-flag keys exposed
 * by `GET /config` (see `PublicConfigSchema` in @yieldvault/api-schemas).
 */
const PUBLIC_FLAG_KEY_BY_FEATURE: Record<FeatureFlagKey, PublicFeatureFlagKey> = {
  ANALYTICS_PAGE: "analytics-page",
};

/**
 * Build-time fallback (fail-closed). Used until the runtime `/config` response
 * arrives and retained if that request fails, so the app still boots offline.
 */
const resolveBuildTimeFlags = (): FeatureFlagMap => {
  return FLAG_KEYS.reduce((acc, key) => {
    acc[key] = import.meta.env[`VITE_FF_${key}`] === "true";
    return acc;
  }, {} as FeatureFlagMap);
};

const FeatureFlagContext = createContext<FeatureFlagMap | null>(null);

export const FeatureFlagProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [flags, setFlags] = useState<FeatureFlagMap>(resolveBuildTimeFlags);

  useEffect(() => {
    let cancelled = false;

    fetchPublicConfig()
      .then((config) => {
        if (cancelled) return;
        setFlags(
          FLAG_KEYS.reduce((acc, key) => {
            acc[key] = config.features[PUBLIC_FLAG_KEY_BY_FEATURE[key]] === true;
            return acc;
          }, {} as FeatureFlagMap),
        );
      })
      .catch(() => {
        // Runtime config unavailable — keep the build-time fallback.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <FeatureFlagContext.Provider value={flags}>
      {children}
    </FeatureFlagContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useFeatureFlag = (flag: FeatureFlagKey): boolean => {
  const ctx = useContext(FeatureFlagContext);
  if (!ctx) throw new Error("useFeatureFlag must be used within FeatureFlagProvider");
  return ctx[flag];
}
