import { test as base, type Page } from '@playwright/test';

// Inline fixture data — avoids JSON import attribute requirements across Node versions
const vaultSummary = {
  tvl: 12450800,
  apy: 8.45,
  participantCount: 1248,
  monthlyGrowthPct: 12.5,
  strategyStabilityPct: 99.9,
  assetLabel: 'Sovereign Debt',
  exchangeRate: 1.084,
  networkFeeEstimate: '~0.00001 XLM',
  updatedAt: '2026-03-25T10:00:00.000Z',
  strategy: {
    id: 'stellar-benji',
    name: 'Franklin BENJI Connector',
    issuer: 'Franklin Templeton',
    network: 'Stellar',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    status: 'active',
    description:
      'Connector strategy that routes vault yield updates from BENJI-issued tokenized money market exposure on Stellar.',
  },
};

const portfolioHoldings = [
  {
    id: 'hold-1',
    asset: 'USDC Treasury Pool',
    vaultName: 'Stellar RWA Yield Fund',
    symbol: 'yvUSDC',
    shares: 1250.5,
    apy: 8.45,
    valueUsd: 1250.5,
    unrealizedGainUsd: 42.15,
    issuer: 'Franklin Templeton',
    status: 'active',
  },
  {
    id: 'hold-2',
    asset: 'Government Bond Basket',
    vaultName: 'Sovereign Income Sleeve',
    symbol: 'yvBOND',
    shares: 840.12,
    apy: 7.2,
    valueUsd: 894.41,
    unrealizedGainUsd: 25.22,
    issuer: 'WisdomTree',
    status: 'active',
  },
  {
    id: 'hold-3',
    asset: 'Short Duration Credit',
    vaultName: 'Liquidity Ladder',
    symbol: 'yvCASH',
    shares: 500.33,
    apy: 6.85,
    valueUsd: 512.9,
    unrealizedGainUsd: 11.48,
    issuer: 'Circle Reserve',
    status: 'pending',
  },
  {
    id: 'hold-4',
    asset: 'Tokenized T-Bills',
    vaultName: 'USD Treasury Express',
    symbol: 'yvUSTB',
    shares: 1380,
    apy: 5.95,
    valueUsd: 1404.32,
    unrealizedGainUsd: 19.77,
    issuer: 'OpenEden',
    status: 'active',
  },
  {
    id: 'hold-5',
    asset: 'Yield Bearing Cash',
    vaultName: 'Prime Reserve Strategy',
    symbol: 'yvPRIME',
    shares: 320.42,
    apy: 7.9,
    valueUsd: 337.08,
    unrealizedGainUsd: 9.66,
    issuer: 'Hashnote',
    status: 'active',
  },
  {
    id: 'hold-6',
    asset: 'EM Debt Blend',
    vaultName: 'Global Carry Vault',
    symbol: 'yvEMD',
    shares: 214.1,
    apy: 9.1,
    valueUsd: 228.55,
    unrealizedGainUsd: 14.07,
    issuer: 'Templeton',
    status: 'pending',
  },
];

/**
 * Intercept mock API routes so tests are fully deterministic.
 */
export async function interceptApiRoutes(page: Page) {
  await page.route('**/mock-api/vault-summary.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(vaultSummary),
    }),
  );
  await page.route('**/mock-api/portfolio-holdings.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(portfolioHoldings),
    }),
  );
}

/**
 * Stub the Freighter browser extension message protocol.
 *
 * @stellar/freighter-api communicates with the extension via window.postMessage
 * using the source key "FREIGHTER_EXTERNAL_MSG_REQUEST". The extension responds
 * with "FREIGHTER_EXTERNAL_MSG_RESPONSE". We intercept those messages and reply
 * with the appropriate shape so the app believes a wallet is connected.
 *
 * The stub is stateful: call page.evaluate(() => window.__freighterStub.disconnect())
 * to make subsequent isAllowed() calls return false, simulating a real disconnect.
 *
 * This must be injected via addInitScript so it runs before the app bundle.
 */
export async function stubFreighterConnected(page: Page, address: string) {
  await page.addInitScript((addr) => {
    // Stateful stub — tests can call window.__freighterStub.disconnect()
    const stub = { connected: true };
    (window as unknown as Record<string, unknown>).__freighterStub = stub;

    window.addEventListener('message', (event) => {
      if (
        event.source !== window ||
        !event.data ||
        event.data.source !== 'FREIGHTER_EXTERNAL_MSG_REQUEST'
      ) {
        return;
      }

      const { messageId, type } = event.data as { messageId: number; type: string };

      let response: Record<string, unknown> = {
        source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE',
        messagedId: messageId, // note: the library uses "messagedId" (typo in source)
      };

      switch (type) {
        case 'REQUEST_ALLOWED_STATUS':
        case 'SET_ALLOWED_STATUS':
          response = { ...response, isAllowed: stub.connected };
          break;
        case 'REQUEST_PUBLIC_KEY':
          response = { ...response, publicKey: stub.connected ? addr : '' };
          break;
        case 'REQUEST_ACCESS':
          response = { ...response, publicKey: stub.connected ? addr : '' };
          break;
        case 'REQUEST_CONNECTION_STATUS':
          response = { ...response, isConnected: stub.connected };
          break;
        case 'REQUEST_NETWORK_DETAILS':
          response = {
            ...response,
            networkDetails: {
              network: 'TESTNET',
              networkName: 'Test SDF Network',
              networkUrl: 'https://horizon-testnet.stellar.org',
              networkPassphrase: 'Test SDF Network ; September 2015',
              sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
            },
          };
          break;
        default:
          return;
      }

      window.postMessage(response, window.location.origin);
    });
  }, address);
}

export async function stubFreighterDisconnected(page: Page) {
  await page.addInitScript(() => {
    const stub = { connected: false };
    (window as unknown as Record<string, unknown>).__freighterStub = stub;

    window.addEventListener("message", (event) => {
      if (
        event.source !== window ||
        !event.data ||
        event.data.source !== "FREIGHTER_EXTERNAL_MSG_REQUEST"
      ) {
        return;
      }

      const { messageId, type } = event.data as { messageId: number; type: string };

      let response: Record<string, unknown> = {
        source: "FREIGHTER_EXTERNAL_MSG_RESPONSE",
        messagedId: messageId,
      };

      switch (type) {
        case "REQUEST_ALLOWED_STATUS":
        case "SET_ALLOWED_STATUS":
          response = { ...response, isAllowed: false };
          break;
        case "REQUEST_PUBLIC_KEY":
        case "REQUEST_ACCESS":
          response = { ...response, publicKey: "" };
          break;
        case "REQUEST_CONNECTION_STATUS":
          response = { ...response, isConnected: false };
          break;
        case "REQUEST_NETWORK_DETAILS":
          response = {
            ...response,
            networkDetails: {
              network: "TESTNET",
              networkName: "Test SDF Network",
              networkUrl: "https://horizon-testnet.stellar.org",
              networkPassphrase: "Test SDF Network ; September 2015",
              sorobanRpcUrl: "https://soroban-testnet.stellar.org",
            },
          };
          break;
        default:
          return;
      }

      window.postMessage(response, window.location.origin);
    });
  });
}

type Fixtures = {
  /** Page with API routes intercepted — no wallet connected */
  appPage: Page;
};

export const test = base.extend<Fixtures>({
  appPage: async ({ page }, use) => {
    await interceptApiRoutes(page);
    await use(page);
  },
});

export { expect } from '@playwright/test';
