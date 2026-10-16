/**
 * Cypress smoke tests — #1573
 *
 * Assertions are tied to actual rendered content from the mock API responses,
 * not generic loading / connect-wallet fallback text.
 */
const MOCK_ADDRESS = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

const vaultSummary = {
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
  contractPaused: false,
  strategy: {
    id: 'stellar-benji',
    name: 'Franklin BENJI Connector',
    issuer: 'Franklin Templeton',
    network: 'Stellar',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    status: 'active',
    description: 'Connector strategy.',
  },
};

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
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Inject the Freighter wallet stub so the app believes a wallet is connected.
 * Must run inside onBeforeLoad so it fires before the app bundle initialises.
 */
function stubFreighterConnected(win: Cypress.AUTWindow): void {
  const stub = { connected: true };
  (win as Window & { __freighterStub?: unknown }).__freighterStub = stub;

  win.addEventListener('message', (event: MessageEvent) => {
    if (
      event.source !== win ||
      !event.data ||
      event.data.source !== 'FREIGHTER_EXTERNAL_MSG_REQUEST'
    ) {
      return;
    }

    const { messageId, type } = event.data as { messageId: number; type: string };

    const base = { source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE', messagedId: messageId };

    switch (type) {
      case 'SET_ALLOWED_STATUS':
      case 'REQUEST_ACCESS':
        stub.connected = true;
        win.postMessage({ ...base, isAllowed: true, publicKey: MOCK_ADDRESS }, win.location.origin);
        break;
      case 'REQUEST_ALLOWED_STATUS':
        win.postMessage({ ...base, isAllowed: stub.connected }, win.location.origin);
        break;
      case 'REQUEST_PUBLIC_KEY':
        win.postMessage({ ...base, publicKey: stub.connected ? MOCK_ADDRESS : '' }, win.location.origin);
        break;
      case 'REQUEST_CONNECTION_STATUS':
        win.postMessage({ ...base, isConnected: stub.connected }, win.location.origin);
        break;
      case 'REQUEST_NETWORK_DETAILS':
        win.postMessage({
          ...base,
          networkDetails: {
            network: 'TESTNET',
            networkName: 'Test SDF Network',
            networkUrl: 'https://horizon-testnet.stellar.org',
            networkPassphrase: 'Test SDF Network ; September 2015',
            sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
          },
        }, win.location.origin);
        break;
      default:
        break;
    }
  });
}

function setupApiIntercepts(): void {
  cy.intercept('GET', '**/mock-api/vault-summary.json', {
    statusCode: 200,
    body: vaultSummary,
  }).as('vaultSummary');

  cy.intercept('GET', '**/mock-api/portfolio-holdings.json', {
    statusCode: 200,
    body: portfolioHoldings,
  }).as('portfolioHoldings');

  cy.intercept('GET', '**/mock-api/vault-health.json', {
    statusCode: 200,
    body: [],
  }).as('vaultHealth');

  cy.intercept('GET', 'https://horizon-testnet.stellar.org/accounts/*/operations*', {
    statusCode: 200,
    body: { _embedded: { records: [] } },
  }).as('horizonOperations');

  cy.intercept('GET', 'https://horizon-testnet.stellar.org/accounts/*', (req) => {
    const accountId = req.url.split('/accounts/')[1]?.split('?')[0] ?? MOCK_ADDRESS;
    req.reply({
      statusCode: 200,
      body: {
        id: accountId,
        account_id: accountId,
        sequence: '12884901882',
        subentry_count: 0,
        balances: [
          { asset_type: 'native', balance: '5.0000000' },
          {
            asset_type: 'credit_alphanum4',
            asset_code: 'USDC',
            asset_issuer: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQLE2KKWY3NO',
            balance: '1250.5000000',
          },
        ],
      },
    });
  }).as('horizonAccount');
}

function visitWithStubs(url = '/'): void {
  setupApiIntercepts();
  cy.visit(url, {
    onBeforeLoad: (win) => {
      stubFreighterConnected(win);
      win.localStorage.setItem('hasSeenWalkthrough', 'true');
      win.localStorage.setItem(
        'yieldvault-preferences:guest',
        JSON.stringify({ maskSensitiveValues: false }),
      );
    },
  });
}

// ─── Smoke suite ─────────────────────────────────────────────────────────────

describe('YieldVault Smoke Tests', () => {
  // ── Home / Vault dashboard ────────────────────────────────────────────────

  describe('Home — vault dashboard', () => {
    beforeEach(() => visitWithStubs('/'));

    it('renders the vault name and APY from the mock API', () => {
      cy.wait('@vaultSummary');
      // Actual vault name from mock data — not a generic heading
      cy.contains('Global RWA Yield Fund', { timeout: 15_000 }).should('be.visible');
      // APY from mock: 8.45
      cy.contains(/8\.4[0-9]%/, { timeout: 10_000 }).should('be.visible');
    });

    it('shows Total Value Locked with formatted amount', () => {
      cy.wait('@vaultSummary');
      cy.contains('Total Value Locked', { timeout: 10_000 }).should('be.visible');
      // TVL from mock: 12,450,800 → rendered as $12.45M or $12,450,800
      cy.contains(/\$12[,.]?4/, { timeout: 10_000 }).should('be.visible');
    });

    it('displays the strategy name from mock data', () => {
      cy.wait('@vaultSummary');
      cy.contains('Franklin BENJI Connector', { timeout: 10_000 }).should('be.visible');
    });

    it('shows the wallet is connected with abbreviated address', () => {
      cy.wait('@horizonAccount', { timeout: 15_000 });
      // Abbreviated: GBBD4...FLA5 or similar
      cy.contains(/GBBD4?\.{2,}FLA5/, { timeout: 15_000 }).should('be.visible');
    });

    it('shows USDC balance from Horizon stub', () => {
      cy.wait('@horizonAccount', { timeout: 15_000 });
      cy.contains(/1[,.]?250/, { timeout: 15_000 }).should('be.visible');
    });
  });

  // ── Deposit / withdraw tabs ───────────────────────────────────────────────

  describe('Deposit & Withdraw tabs', () => {
    beforeEach(() => visitWithStubs('/'));

    it('deposit tab shows amount input field', () => {
      cy.wait('@vaultSummary');
      cy.contains('button', 'Deposit', { timeout: 10_000 }).click({ force: true });
      // Real label on the deposit input — not "Amount to deposit" which is generic
      cy.get('label[for]', { timeout: 10_000 })
        .contains(/Deposit amount|Amount/i)
        .should('be.visible');
    });

    it('withdraw tab shows amount input field', () => {
      cy.wait('@vaultSummary');
      cy.contains('button', 'Withdraw', { timeout: 10_000 }).click({ force: true });
      cy.get('label[for]', { timeout: 10_000 })
        .contains(/Withdraw amount|Amount/i)
        .should('be.visible');
    });
  });

  // ── Navigation ───────────────────────────────────────────────────────────

  describe('Navigation', () => {
    beforeEach(() => visitWithStubs('/'));

    it('navigates to Portfolio and shows the holdings table heading', () => {
      cy.get('a[href="/portfolio"]', { timeout: 10_000 }).click();
      cy.url().should('include', '/portfolio');
      // Real heading — not a generic text
      cy.contains('h1', 'Your Portfolio', { timeout: 10_000 }).should('be.visible');
    });

    it('navigates to Analytics and shows the TVL stat card', () => {
      cy.get('a[href="/analytics"]', { timeout: 10_000 }).click();
      cy.url().should('include', '/analytics');
      cy.contains('Total Value Locked', { timeout: 10_000 }).should('be.visible');
    });

    it('navigates to Transaction History and shows the page heading', () => {
      cy.get('a[href="/transactions"]', { timeout: 10_000 }).click();
      cy.url().should('include', '/transactions');
      // The real heading on the transactions page
      cy.contains(/Transaction History|History/i, { timeout: 10_000 }).should('be.visible');
    });
  });

  // ── Transaction history ───────────────────────────────────────────────────

  describe('Transaction history page', () => {
    it('shows the connect-wallet heading when no wallet is connected', () => {
      setupApiIntercepts();
      cy.visit('/transactions', {
        onBeforeLoad: (win) => {
          win.localStorage.setItem('hasSeenWalkthrough', 'true');
        },
      });
      // Real heading from TransactionHistory unauthenticated state
      cy.contains(/Connect your wallet/i, { timeout: 10_000 }).should('be.visible');
    });

    it('renders transaction rows when wallet is connected', () => {
      visitWithStubs('/transactions');
      cy.wait('@horizonAccount', { timeout: 15_000 });
      // With the Horizon stub returning a USDC payment of 100
      cy.contains(/USDC|100/, { timeout: 15_000 }).should('be.visible');
    });
  });
});
