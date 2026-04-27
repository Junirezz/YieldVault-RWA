const MOCK_ADDRESS = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

describe('YieldVault Smoke Tests', () => {
  beforeEach(() => {
    // Stub Freighter API messages
    cy.on('window:before:load', (win) => {
      win.addEventListener('message', (event) => {
        if (
          event.data &&
          event.data.source === 'FREIGHTER_EXTERNAL_MSG_REQUEST'
        ) {
          const { messageId, type } = event.data;
          let response: any = {
            source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE',
            messagedId: messageId,
          };

          switch (type) {
            case 'REQUEST_ALLOWED_STATUS':
            case 'SET_ALLOWED_STATUS':
              response.isAllowed = true;
              break;
            case 'REQUEST_PUBLIC_KEY':
            case 'REQUEST_ACCESS':
              response.publicKey = MOCK_ADDRESS;
              break;
            case 'REQUEST_CONNECTION_STATUS':
              response.isConnected = true;
              break;
            case 'REQUEST_NETWORK_DETAILS':
              response.networkDetails = {
                network: 'TESTNET',
                networkUrl: 'https://horizon-testnet.stellar.org',
                networkPassphrase: 'Test SDF Network ; September 2015',
              };
              break;
          }
          win.postMessage(response, win.location.origin);
        }
      });
    });

    cy.visit('/');
  });

  it('should connect wallet', () => {
    cy.contains('button', 'Connect Freighter').click();
    // After connecting, the disconnect button (aria-label) should be visible
    cy.get('button[aria-label="Disconnect Wallet"]').should('be.visible');
  });

  it('should navigate to deposit flow', () => {
    cy.contains('button', 'Connect Freighter').click();
    cy.contains('button', 'Deposit').click();
    cy.contains('Amount to deposit').should('be.visible');
  });

  it('should navigate to withdrawal flow', () => {
    cy.contains('button', 'Connect Freighter').click();
    cy.contains('button', 'Withdraw').click();
    cy.contains('Amount to withdraw').should('be.visible');
  });

  it('should view transaction history', () => {
    cy.contains('button', 'Connect Freighter').click();
    cy.visit('/transactions');
    cy.contains('Transaction History').should('be.visible');
    cy.get('table').should('be.visible');
  });
});
