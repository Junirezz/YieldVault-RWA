import { networkConfig } from "../config/network";

export interface StrategyMetadata {
  id: string;
  name: string;
  issuer: string;
  network: string;
  rpcUrl: string;
  status: "active" | "inactive";
  description: string;
}

export const benjiStrategy: StrategyMetadata = {
  id: "stellar-benji",
  name: "Franklin BENJI Connector",
  issuer: "Franklin Templeton",
  network: "Stellar",
  rpcUrl: networkConfig.rpcUrl,
  status: "active",
  description:
    "Connector strategy that routes vault yield updates from BENJI-issued tokenized money market exposure on Stellar.",
};
