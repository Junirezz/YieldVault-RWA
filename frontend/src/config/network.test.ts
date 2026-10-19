import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("networkConfig", () => {
  it("falls back to the public testnet endpoints and defaults", async () => {
    const { networkConfig, horizonBaseUrls, stellarExplorerBaseUrls } =
      await import("./network");

    expect(networkConfig.isTestnet).toBe(true);
    expect(networkConfig.rpcUrl).toBe("https://soroban-testnet.stellar.org");
    expect(networkConfig.horizonUrl).toBe(horizonBaseUrls.testnet);
    expect(networkConfig.horizonUrl).toBe("https://horizon-testnet.stellar.org");
    expect(networkConfig.explorerUrl).toBe(stellarExplorerBaseUrls.testnet);
    expect(networkConfig.explorerUrl).toBe(
      "https://stellar.expert/explorer/testnet",
    );
    expect(networkConfig.xlmPriceApiUrl).toBe(
      "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd",
    );
  });

  it("derives mainnet endpoints from the mainnet passphrase", async () => {
    vi.stubEnv(
      "VITE_STELLAR_NETWORK_PASSPHRASE",
      "Public Global Stellar Network ; September 2015",
    );
    vi.resetModules();

    const { networkConfig } = await import("./network");

    expect(networkConfig.isTestnet).toBe(false);
    expect(networkConfig.horizonUrl).toBe("https://horizon.stellar.org");
    expect(networkConfig.explorerUrl).toBe(
      "https://stellar.expert/explorer/public",
    );
  });

  it("lets VITE_ variables override the endpoint defaults", async () => {
    vi.stubEnv("VITE_HORIZON_URL", "https://horizon.example.test");
    vi.stubEnv("VITE_STELLAR_EXPLORER_URL", "https://explorer.example.test");
    vi.stubEnv("VITE_XLM_PRICE_API_URL", "https://price.example.test/xlm");
    vi.resetModules();

    const { networkConfig } = await import("./network");

    expect(networkConfig.horizonUrl).toBe("https://horizon.example.test");
    expect(networkConfig.explorerUrl).toBe("https://explorer.example.test");
    expect(networkConfig.xlmPriceApiUrl).toBe("https://price.example.test/xlm");
  });

  it("maps a Soroban RPC URL onto the matching Horizon endpoint", async () => {
    const { getHorizonUrlForRpcUrl, horizonBaseUrls } = await import(
      "./network"
    );

    expect(getHorizonUrlForRpcUrl("https://soroban-testnet.stellar.org")).toBe(
      horizonBaseUrls.testnet,
    );
    expect(getHorizonUrlForRpcUrl("https://soroban-mainnet.stellar.org")).toBe(
      horizonBaseUrls.mainnet,
    );
    // Unknown hosts fall back to the configured network.
    expect(getHorizonUrlForRpcUrl("https://rpc.example.test")).toBe(
      horizonBaseUrls.testnet,
    );
  });
});
