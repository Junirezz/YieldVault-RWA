/* eslint-disable react-hooks/rules-of-hooks */
import { test as base, expect, type Page } from '@playwright/test';

// Inline fixture data — avoids JSON import attribute requirements across Node versions
export const vaultSummary = {
  tvl: 12450800,
  depositCap: 15_000_000,
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

/** TVL at deposit cap — drives `isCapReached` in VaultContext (utilization >= 1). */
export const vaultSummaryAtCapacity = {
  ...vaultSummary,
  tvl: vaultSummary.depositCap,
};

const HORIZON_USDC_ISSUER =
  'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQLE2KKWY3NO';

function buildHorizonAccountBody(accountId: string) {
  return JSON.stringify({
    id: accountId,
    account_id: accountId,
    sequence: '12884901882',
    subentry_count: 0,
    balances: [
      { asset_type: 'native', balance: '5.0000000' },
      {
        asset_type: 'credit_alphanum4',
        asset_code: 'USDC',
        asset_issuer: HORIZON_USDC_ISSUER,
        balance: '1250.5000000',
      },
    ],
    _links: {
      self: { href: `https://horizon-testnet.stellar.org/accounts/${accountId}` },
      transactions: {
        href: `https://horizon-testnet.stellar.org/accounts/${accountId}/transactions{?cursor,limit,order}`,
        templated: true,
      },
      operations: {
        href: `https://horizon-testnet.stellar.org/accounts/${accountId}/operations{?cursor,limit,order}`,
        templated: true,
      },
    },
  });
}

function buildHorizonOperationsBody() {
  return JSON.stringify({
    _embedded: {
      records: [
        {
          id: '12884905984',
          type: 'payment',
          from: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
          to: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
          amount: '100.0000000',
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: HORIZON_USDC_ISSUER,
          created_at: '2026-03-25T10:00:00.000Z',
          transaction_hash:
            'abc123def4567890abcdef1234567890abcdef1234567890abcdef1234567890',
        },
      ],
    },
  });
}

const portfolioHoldings = [
  {
    id: 'hold-1',
    asset: 'USDC Treasury Pool',
    vaultId: 'vault-1',
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
    vaultId: 'vault-2',
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
    vaultId: 'vault-3',
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
    vaultId: 'vault-4',
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
    vaultId: 'vault-5',
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
    vaultId: 'vault-6',
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

const vaultHealth = [
  {
    vaultId: 'vault-1',
    name: 'Stellar RWA Yield Fund',
    status: 'healthy',
    latencyMs: 48,
    uptimePct: 99.98,
    lastCheckedAt: '2026-07-24T08:45:00.000Z',
    message: 'All systems operational',
  },
  {
    vaultId: 'vault-2',
    name: 'Sovereign Income Sleeve',
    status: 'healthy',
    latencyMs: 62,
    uptimePct: 99.95,
    lastCheckedAt: '2026-07-24T08:45:00.000Z',
    message: 'All systems operational',
  },
  {
    vaultId: 'vault-3',
    name: 'Liquidity Ladder',
    status: 'degraded',
    latencyMs: 420,
    uptimePct: 98.2,
    lastCheckedAt: '2026-07-24T08:45:00.000Z',
    message: 'Elevated settlement latency',
  },
  {
    vaultId: 'vault-4',
    name: 'USD Treasury Express',
    status: 'healthy',
    latencyMs: 55,
    uptimePct: 99.99,
    lastCheckedAt: '2026-07-24T08:45:00.000Z',
    message: 'All systems operational',
  },
  {
    vaultId: 'vault-5',
    name: 'Prime Reserve Strategy',
    status: 'healthy',
    latencyMs: 71,
    uptimePct: 99.91,
    lastCheckedAt: '2026-07-24T08:45:00.000Z',
    message: 'All systems operational',
  },
  {
    vaultId: 'vault-6',
    name: 'Global Carry Vault',
    status: 'unhealthy',
    latencyMs: 2100,
    uptimePct: 94.5,
    lastCheckedAt: '2026-07-24T08:45:00.000Z',
    message: 'Oracle feed unreachable',
  },
];

/**
 * Intercept mock API routes so tests are fully deterministic.
 */
async function fulfillHorizonRoute(route: import('@playwright/test').Route) {
  if (route.request().method() !== 'GET') {
    await route.continue();
    return;
  }

  const url = route.request().url();

  if (url.includes('/operations')) {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { date: new Date().toUTCString() },
      body: buildHorizonOperationsBody(),
    });
    return;
  }

  const accountMatch = url.match(/\/accounts\/([^/?]+)/);
  const accountId = accountMatch?.[1] ?? 'unknown';
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { date: new Date().toUTCString() },
    body: buildHorizonAccountBody(accountId),
  });
}

export async function interceptApiRoutes(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('hasSeenWalkthrough', 'true');
    // Privacy mode defaults to masked identifiers; disable for stable E2E address matchers.
    window.localStorage.setItem(
      'yieldvault-preferences:guest',
      JSON.stringify({ maskSensitiveValues: false }),
    );
    // Match Cypress: skip service-worker registration so Playwright route mocks
    // are not bypassed by cross-origin fetches issued from the SW context.
    (window as Window & { Cypress?: boolean }).Cypress = true;
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => {
          void registration.unregister();
        });
      });
    }
    // Privacy masking is on by default; disable it so address/balance assertions stay stable.
    try {
      localStorage.setItem(
        'yieldvault-preferences:guest',
        JSON.stringify({
          theme: 'dark',
          locale: 'en-US',
          currency: 'USD',
          notifications: {
            depositAlerts: true,
            withdrawalAlerts: true,
            yieldUpdates: true,
            priceAlerts: false,
            weeklyReport: true,
            securityAlerts: true,
          },
          compactMode: false,
          showBalances: true,
          maskSensitiveValues: false,
          precision: 2,
        }),
      );
    } catch {
      // ignore quota / private mode
    }
  });

  await page.route('**/sw.js', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'text/plain',
      body: 'disabled in e2e',
    }),
  );

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
  await page.route('**/mock-api/vault-health.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(vaultHealth),
    }),
  );

  await page.route(/horizon(-testnet)?\.stellar\.org/i, fulfillHorizonRoute);
}

/** Wait until the connected wallet banner shows the mocked USDC balance. */
export async function waitForMockUsdcBalance(page: Page) {
  await expect(page.getByLabel('USDC wallet balance')).toContainText('1250.50', {
    timeout: 20_000,
  });
}

export function vaultActionTab(page: Page, tab: 'Deposit' | 'Withdraw') {
  return page.getByRole('button', { name: tab, exact: true });
}

/** Fill a deposit amount and wait for client-side validation to enable review. */
export async function fillDepositAmount(page: Page, amount: string) {
  const amountInput = page.getByLabel('Deposit amount');
  await amountInput.fill(amount);
  await amountInput.blur();
  const reviewBtn = page.getByRole('button', { name: /Review Transaction/i });
  await expect(reviewBtn).toBeEnabled({ timeout: 15_000 });
  return { amountInput, reviewBtn };
}

/** Approve USDC on the review step when the allowance gate is shown. */
export async function approveUsdcIfNeeded(page: Page) {
  const approveBtn = page.getByRole('button', { name: 'Approve USDC' });
  if (await approveBtn.isVisible()) {
    await approveBtn.click();
    await expect(approveBtn).not.toBeVisible({ timeout: 5_000 });
  }
}

/** Confirm the secondary transaction summary modal opened by the vault wizard. */
export async function confirmInTransactionModal(page: Page) {
  const dialog = page.getByRole('dialog', { name: /Confirm (deposit|withdraw)/i });
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  const confirmAnyway = dialog.getByRole('button', { name: /Confirm Anyway/i });
  if (await confirmAnyway.isVisible()) {
    await confirmAnyway.click();
    return;
  }
  await dialog.getByRole('button', { name: /^Confirm$/i }).click();
}

/** Complete the vault wizard review step for deposits or withdrawals. */
export async function completeVaultReviewStep(
  page: Page,
  action: 'deposit' | 'withdraw',
) {
  const reviewBtn = page.getByRole('button', { name: /Review Transaction/i });
  await expect(reviewBtn).toBeEnabled({ timeout: 15_000 });
  await reviewBtn.click();
  await expect(page.getByText('Confirm Transaction')).toBeVisible();
  if (action === 'deposit') {
    await approveUsdcIfNeeded(page);
  }
  const confirmBtn = page.getByRole('button', {
    name: action === 'deposit' ? /Confirm deposit/i : /Confirm withdraw/i,
  });
  await expect(confirmBtn).toBeEnabled({ timeout: 10_000 });
  await confirmBtn.click();
  await confirmInTransactionModal(page);
  await expect(page.getByText('Transaction Successful')).toBeVisible({
    timeout: 20_000,
  });
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
    window.localStorage.setItem(
      `yieldvault-preferences:${addr}`,
      JSON.stringify({ maskSensitiveValues: false }),
    );
    window.localStorage.setItem(
      'yieldvault-preferences:guest',
      JSON.stringify({ maskSensitiveValues: false }),
    );
    try {
      const raw = localStorage.getItem('yieldvault-preferences:guest');
      const base = raw ? JSON.parse(raw) : { maskSensitiveValues: false };
      localStorage.setItem(
        `yieldvault-preferences:${addr}`,
        JSON.stringify({ ...base, maskSensitiveValues: false }),
      );
    } catch {
      // ignore
    }

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
        messagedId: messageId,
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

/**
 * Starts disconnected; flips to connected after SET_ALLOWED_STATUS / REQUEST_ACCESS
 * so deposit-flow e2e can exercise the real Connect Freighter button.
 */
export async function stubFreighterManualConnect(page: Page, address: string) {
  await page.addInitScript((addr) => {
    window.localStorage.setItem(
      `yieldvault-preferences:${addr}`,
      JSON.stringify({ maskSensitiveValues: false }),
    );
    window.localStorage.setItem(
      'yieldvault-preferences:guest',
      JSON.stringify({ maskSensitiveValues: false }),
    );
    try {
      const raw = localStorage.getItem('yieldvault-preferences:guest');
      const base = raw ? JSON.parse(raw) : { maskSensitiveValues: false };
      localStorage.setItem(
        `yieldvault-preferences:${addr}`,
        JSON.stringify({ ...base, maskSensitiveValues: false }),
      );
    } catch {
      // ignore
    }

    const stub = { connected: false };
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
        messagedId: messageId,
      };

      switch (type) {
        case 'SET_ALLOWED_STATUS':
        case 'REQUEST_ACCESS':
          stub.connected = true;
          response = { ...response, isAllowed: true, publicKey: addr };
          break;
        case 'REQUEST_ALLOWED_STATUS':
          response = { ...response, isAllowed: stub.connected };
          break;
        case 'REQUEST_PUBLIC_KEY':
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
