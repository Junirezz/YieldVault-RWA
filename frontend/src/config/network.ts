import { getSelectedNetwork, type StellarNetwork } from "./selectedNetwork";

export type { StellarNetwork } from "./selectedNetwork";

const PUBLIC_TESTNET_RPC = "https://soroban-testnet.stellar.org";
const PUBLIC_MAINNET_RPC = "https://soroban-mainnet.stellar.org";
export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
export const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";

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

const networkPassphrase =
  import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE || TESTNET_PASSPHRASE;

/** Network the build was configured for (before any user selection). */
export const configuredNetwork: StellarNetwork =
  networkPassphrase === TESTNET_PASSPHRASE ? "testnet" : "mainnet";

const configuredRpcUrl = import.meta.env.VITE_SOROBAN_RPC_URL || "";

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

/** Soroban RPC endpoints per network. */
export const sorobanRpcUrls: Record<StellarNetwork, string> = {
  testnet:
    configuredNetwork === "testnet" && configuredRpcUrl
      ? configuredRpcUrl
      : PUBLIC_TESTNET_RPC,
  mainnet:
    configuredNetwork === "mainnet" && configuredRpcUrl
      ? configuredRpcUrl
      : PUBLIC_MAINNET_RPC,
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

/** Build a complete endpoint set for one network. */
export function getNetworkConfig(network: StellarNetwork = getSelectedNetwork(configuredNetwork)): NetworkConfig {
  const isTestnet = network === "testnet";
  return {
    rpcUrl: sorobanRpcUrls[network],
    networkPassphrase:
      network === configuredNetwork ? networkPassphrase : isTestnet ? TESTNET_PASSPHRASE : MAINNET_PASSPHRASE,
    contractId: import.meta.env.VITE_VAULT_CONTRACT_ID || "",
    isTestnet,
    horizonUrl: horizonBaseUrls[network],
    explorerUrl: stellarExplorerBaseUrls[network],
    xlmPriceApiUrl: import.meta.env.VITE_XLM_PRICE_API_URL || XLM_PRICE_API_URL,
  };
}

/**
 * Live view of the configuration for the user's selected network. Consumers
 * can keep importing this object: every property is resolved on access, so an
 * in-app network switch is immediately reflected in RPC, Horizon and explorer
 * URLs without a reload.
 */
export const networkConfig: NetworkConfig = {
  get rpcUrl() { return getNetworkConfig().rpcUrl; },
  get networkPassphrase() { return getNetworkConfig().networkPassphrase; },
  get contractId() { return getNetworkConfig().contractId; },
  get isTestnet() { return getNetworkConfig().isTestnet; },
  get horizonUrl() { return getNetworkConfig().horizonUrl; },
  get explorerUrl() { return getNetworkConfig().explorerUrl; },
  get xlmPriceApiUrl() { return getNetworkConfig().xlmPriceApiUrl; },
};

/**
 * Resolve the Horizon endpoint that matches a Soroban RPC URL. Unknown hosts
 * fall back to the Horizon endpoint of the selected network.
 */
export function getHorizonUrlForRpcUrl(rpcUrl: string): string {
  if (rpcUrl.includes(TESTNET_SOROBAN_RPC_HOST)) {
    return horizonBaseUrls.testnet;
  }
  if (rpcUrl.includes(MAINNET_SOROBAN_RPC_HOST)) {
    return horizonBaseUrls.mainnet;
  }
  return horizonBaseUrls[getSelectedNetwork(configuredNetwork)];
}

export const hasCustomRpcConfig = Boolean(import.meta.env.VITE_SOROBAN_RPC_URL);
