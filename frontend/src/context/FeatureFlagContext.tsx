import React, { createContext, useContext } from "react";
const FLAG_KEYS = ["ANALYTICS_PAGE"] as const;
export type FeatureFlagKey = (typeof FLAG_KEYS)[number];

type FeatureFlagMap = Record<FeatureFlagKey, boolean>;

const resolveFlags = (): FeatureFlagMap => {
  return FLAG_KEYS.reduce((acc, key) => {
    acc[key] = import.meta.env[`VITE_FF_${key}`] === "true";
    return acc;
  }, {} as FeatureFlagMap);
}

const FeatureFlagContext = createContext<FeatureFlagMap | null>(null);

export const FeatureFlagProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const flags = resolveFlags();
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