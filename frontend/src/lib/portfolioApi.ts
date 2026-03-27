import { apiClient } from "./apiClient";

export interface PortfolioHolding {
  id: string;
  asset: string;
  vaultName: string;
  symbol: string;
  shares: number;
  apy: number;
  valueUsd: number;
  unrealizedGainUsd: number;
  issuer: string;
  status: "active" | "pending";
}


export async function getPortfolioHoldings() {
  return apiClient.get<PortfolioHolding[]>("/mock-api/portfolio-holdings.json");
}
