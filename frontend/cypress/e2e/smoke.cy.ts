describe('YieldVault Smoke Tests', () => {
  beforeEach(() => {
    cy.visit('/');
  });

  it('should connect wallet', () => {
    // Mock wallet connection
    cy.contains('button', 'Connect Wallet').click();
    // Assuming connection shows the address or a disconnect button
    cy.contains('button', 'Disconnect').should('be.visible');
  });

  it('should navigate to deposit flow', () => {
    cy.contains('button', 'Connect Wallet').click();
    cy.contains('button', 'Deposit').click();
    cy.contains('Deposit amount').should('be.visible');
  });

  it('should navigate to withdrawal flow', () => {
    cy.contains('button', 'Connect Wallet').click();
    cy.contains('button', 'Withdraw').click();
    cy.contains('Withdrawal amount').should('be.visible');
  });

  it('should view transaction history', () => {
    cy.contains('button', 'Connect Wallet').click();
    // Assuming there's a link to history or it's accessible via URL
    cy.visit('/transactions');
    cy.contains('Transaction History').should('be.visible');
    cy.get('table').should('be.visible');
  });
});
