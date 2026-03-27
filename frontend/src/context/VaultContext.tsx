import React, {
  createContext,
  useContext,
  useEffect,
} from "react";
import type { ApiError } from "../lib/api";
import { subscribeToApiTelemetry } from "../lib/api";
import type { VaultSummary } from "../lib/vaultApi";
import { networkConfig } from "../config/network";
import { useVaultSummary } from "../hooks/useVaultData";

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
  const { data, isLoading, error: queryError, refetch } = useVaultSummary();

  const summary: VaultSummary = data
    ? {
        ...data,
        strategy: {
          ...data.strategy,
          rpcUrl: networkConfig.rpcUrl,
        },
      }
    : DEFAULT_SUMMARY;

  const error: ApiError | null = queryError
    ? {
        code: "FETCH_ERROR",
        message: queryError.message,
        userMessage: "Failed to load vault data",
        statusCode: 500,
      }
    : null;

  const lastUpdate = new Date(summary.updatedAt);

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

  const refresh = async () => {
    await refetch();
  };

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
