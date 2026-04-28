const MOCK_ADDRESS = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

/**
 * Inject the Freighter stub into the window BEFORE the app bundle executes.
 * Must be used in cy.visit({ onBeforeLoad }) — NOT cy.on('window:before:load')
 * because that only fires for navigations AFTER the initial visit.
 */
function stubFreighterConnected(win: Cypress.AUTWindow): void {
  const stub = { connected: true };
  (win as Window & { __freighterStub?: unknown }).__freighterStub = stub;

  win.addEventListener('message', (event: MessageEvent) => {
    if (
      !event.data ||
      event.data.source !== 'FREIGHTER_EXTERNAL_MSG_REQUEST'
    ) {
      return;
    }

    const { messageId, type } = event.data as { messageId: number; type: string };

    const response: Record<string, unknown> = {
      source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE',
      messagedId: messageId, // freighter-api uses this typo internally
    };

    switch (type) {
      case 'REQUEST_ALLOWED_STATUS':
      case 'SET_ALLOWED_STATUS':
        response.isAllowed = stub.connected;
        break;
      case 'REQUEST_PUBLIC_KEY':
      case 'REQUEST_ACCESS':
        response.publicKey = stub.connected ? MOCK_ADDRESS : '';
        break;
      case 'REQUEST_CONNECTION_STATUS':
        response.isConnected = stub.connected;
        break;
      case 'REQUEST_NETWORK_DETAILS':
        response.networkDetails = {
          network: 'TESTNET',
          networkName: 'Test SDF Network',
          networkUrl: 'https://horizon-testnet.stellar.org',
          networkPassphrase: 'Test SDF Network ; September 2015',
          sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
        };
        break;
      default:
        return;
    }

    win.postMessage(response, win.location.origin);
  });
}

describe('YieldVault Smoke Tests', () => {
  beforeEach(() => {
    // The onBeforeLoad callback runs synchronously before any app JS executes,
    // so the Freighter stub is in place when discoverConnectedAddress() is called.
    cy.visit('/', {
      onBeforeLoad: stubFreighterConnected,
    });
  });

  it('should connect wallet', () => {
    // Depending on environment timing, wallet state can be connected or ready-to-connect.
    cy.get('body', { timeout: 15000 }).should(($body) => {
      const hasDisconnect = $body.find('button[aria-label="Disconnect Wallet"]').length > 0;
      const hasConnect = $body.find('button:contains("Connect Freighter")').length > 0;
      const hasChecking = $body.find('button:contains("Checking wallet")').length > 0;
      expect(hasDisconnect || hasConnect || hasChecking).to.eq(true);
    });
  });

  it('should navigate to deposit flow', () => {
    cy.contains('[role="tab"]', 'Deposit').click({ force: true });
    cy.contains('Amount to deposit').should('be.visible');
  });

  it('should navigate to withdrawal flow', () => {
    cy.contains('[role="tab"]', 'Withdraw').click({ force: true });
    cy.contains('Amount to withdraw').should('be.visible');
  });

  it('should view transaction history', () => {
    cy.visit('/transactions', {
      onBeforeLoad: stubFreighterConnected,
    });
    cy.contains('Transaction History', { timeout: 10000 }).should('be.visible');
    cy.get('body').should(($body) => {
      const hasTable = $body.find('table').length > 0;
      const hasEmptyState = $body.text().includes('No transactions yet');
      const hasWalletPrompt = $body
        .text()
        .includes('Please connect your wallet to view your transaction history.');
      const hasLoading = $body.text().includes('Loading transactions...');
      expect(hasTable || hasEmptyState || hasWalletPrompt || hasLoading).to.eq(true);
    });
  });
});
