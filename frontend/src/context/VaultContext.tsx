import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ApiError } from "../lib/api";
import { normalizeApiError, subscribeToApiTelemetry } from "../lib/api";
import { getVaultSummary, type VaultSummary } from "../lib/vaultApi";
import { networkConfig } from "../config/network";

interface VaultContextType {
  summary: VaultSummary;
  tvl: number;
  apy: number;
  formattedTvl: string;
  formattedApy: string;
  lastUpdate: Date;
  isLoading: boolean;
  error: ApiError | null;
  refresh: () => Promise<void>;
}

const DEFAULT_SUMMARY: VaultSummary = {
  tvl: 12450800,
  apy: 8.45,
  participantCount: 1248,
  monthlyGrowthPct: 12.5,
  strategyStabilityPct: 99.9,
  assetLabel: "Sovereign Debt",
  exchangeRate: 1.084,
  networkFeeEstimate: "~0.00001 XLM",
  updatedAt: "2026-03-25T10:00:00.000Z",
  strategy: {
    id: "stellar-benji",
    name: "Franklin BENJI Connector",
    issuer: "Franklin Templeton",
    network: "Stellar",
    rpcUrl: networkConfig.rpcUrl,
    status: "active",
    description:
      "Connector strategy that routes vault yield updates from BENJI-issued tokenized money market exposure on Stellar.",
  },
};

const VaultContext = createContext<VaultContextType | undefined>(undefined);

export const VaultProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [summary, setSummary] = useState(DEFAULT_SUMMARY);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [lastUpdate, setLastUpdate] = useState(
    new Date(DEFAULT_SUMMARY.updatedAt),
  );

  const refresh = useCallback(async () => {
    setIsLoading(true);

    try {
      const nextSummary = await getVaultSummary();
      setSummary({
        ...nextSummary,
        strategy: {
          ...nextSummary.strategy,
          rpcUrl: networkConfig.rpcUrl,
        },
      });
      setLastUpdate(new Date(nextSummary.updatedAt));
      setError(null);
    } catch (unknownError) {
      setError(normalizeApiError(unknownError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();

    const interval = window.setInterval(() => {
      void refresh();
    }, 30000);

    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const unsubscribe = subscribeToApiTelemetry((event) => {
      if (event.type === "error") {
        console.error("[api]", event.error);
      }
    });

    return unsubscribe;
  }, []);

  const formattedTvl = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(summary.tvl);

  const formattedApy = `${summary.apy.toFixed(2)}%`;

  return (
    <VaultContext.Provider
      value={{
        summary,
        tvl: summary.tvl,
        apy: summary.apy,
        formattedTvl,
        formattedApy,
        lastUpdate,
        isLoading,
        error,
        refresh,
      }}
    >
      {children}
    </VaultContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useVault = () => {
  const context = useContext(VaultContext);
  if (!context) {
    throw new Error("useVault must be used within a VaultProvider");
  }
  return context;
};
