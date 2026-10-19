const PUBLIC_SOROBAN_RPC = "https://soroban-testnet.stellar.org";
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

/** Soroban RPC host fragments, used to map an RPC URL onto a network. */
const TESTNET_SOROBAN_RPC_HOST = "soroban-testnet.stellar.org";
const MAINNET_SOROBAN_RPC_HOST = "soroban-mainnet.stellar.org";

/**
 * Public defaults for the testnet/mainnet endpoints. Every one of them can be
 * overridden through the matching `VITE_` variable (see `.env.example`).
 */
const TESTNET_HORIZON_URL = "https://horizon-testnet.stellar.org";
const MAINNET_HORIZON_URL = "https://horizon.stellar.org";
const TESTNET_EXPLORER_URL = "https://stellar.expert/explorer/testnet";
const MAINNET_EXPLORER_URL = "https://stellar.expert/explorer/public";
const XLM_PRICE_API_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd";

export type StellarNetwork = "testnet" | "mainnet";

const networkPassphrase =
  import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE || TESTNET_PASSPHRASE;

/**
 * Horizon endpoints per network. `VITE_HORIZON_URL` replaces the default of the
 * network the build is configured for (it is also the value returned by
 * `networkConfig.horizonUrl`).
 */
export const horizonBaseUrls: Record<StellarNetwork, string> = {
  testnet: import.meta.env.VITE_HORIZON_URL || TESTNET_HORIZON_URL,
  mainnet: import.meta.env.VITE_HORIZON_URL || MAINNET_HORIZON_URL,
};

/**
 * Stellar Expert base URLs per network. `VITE_STELLAR_EXPLORER_URL` replaces the
 * default of the network the build is configured for.
 */
export const stellarExplorerBaseUrls: Record<StellarNetwork, string> = {
  testnet: import.meta.env.VITE_STELLAR_EXPLORER_URL || TESTNET_EXPLORER_URL,
  mainnet: import.meta.env.VITE_STELLAR_EXPLORER_URL || MAINNET_EXPLORER_URL,
};

export interface NetworkConfig {
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
  isTestnet: boolean;
  /** Horizon endpoint for the configured network. */
  horizonUrl: string;
  /** Stellar Expert base URL for the configured network. */
  explorerUrl: string;
  /** Price API endpoint used for the XLM/USD reference rate. */
  xlmPriceApiUrl: string;
}

const isTestnet = networkPassphrase === TESTNET_PASSPHRASE;

export const networkConfig: NetworkConfig = {
  rpcUrl: import.meta.env.VITE_SOROBAN_RPC_URL || PUBLIC_SOROBAN_RPC,
  networkPassphrase,
  contractId: import.meta.env.VITE_VAULT_CONTRACT_ID || "",
  isTestnet,
  horizonUrl: horizonBaseUrls[isTestnet ? "testnet" : "mainnet"],
  explorerUrl: stellarExplorerBaseUrls[isTestnet ? "testnet" : "mainnet"],
  xlmPriceApiUrl: import.meta.env.VITE_XLM_PRICE_API_URL || XLM_PRICE_API_URL,
};

/**
 * Resolve the Horizon endpoint that matches a Soroban RPC URL. Unknown hosts
 * fall back to the Horizon endpoint of the configured network.
 */
export function getHorizonUrlForRpcUrl(rpcUrl: string): string {
  if (rpcUrl.includes(TESTNET_SOROBAN_RPC_HOST)) {
    return horizonBaseUrls.testnet;
  }
  if (rpcUrl.includes(MAINNET_SOROBAN_RPC_HOST)) {
    return horizonBaseUrls.mainnet;
  }
  return networkConfig.horizonUrl;
}

export const hasCustomRpcConfig = Boolean(import.meta.env.VITE_SOROBAN_RPC_URL);
