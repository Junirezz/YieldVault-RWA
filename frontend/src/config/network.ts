const PUBLIC_SOROBAN_RPC = "https://soroban-testnet.stellar.org";
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

export interface NetworkConfig {
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
  isTestnet: boolean;
}

export const networkConfig: NetworkConfig = {
  rpcUrl: import.meta.env.VITE_SOROBAN_RPC_URL || PUBLIC_SOROBAN_RPC,
  networkPassphrase:
    import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE || TESTNET_PASSPHRASE,
  contractId: import.meta.env.VITE_VAULT_CONTRACT_ID || "",
  isTestnet:
    (import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE || TESTNET_PASSPHRASE) ===
    TESTNET_PASSPHRASE,
};

export const hasCustomRpcConfig = Boolean(import.meta.env.VITE_SOROBAN_RPC_URL);
