import { apiClient } from "./apiClient";
import { validate, PortfolioQuerySchema } from "./api";

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


export async function getPortfolioHoldings(params: unknown) {
  validate(PortfolioQuerySchema, params, "PortfolioQuery");
  return apiClient.get<PortfolioHolding[]>("/mock-api/portfolio-holdings.json");
}
