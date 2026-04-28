/**
 * Flow 2: Deposit & Withdraw Transaction
 */
import type { Page } from '@playwright/test';
import {
  test,
  expect,
  interceptApiRoutes,
  stubFreighterConnected,
  stubFreighterDisconnected,
  vaultSummaryAtCapacity,
} from './fixtures';

/** Valid Stellar public key (G + 55 base32 chars) for API validation in submitDeposit / submitWithdrawal. */
const MOCK_ADDRESS = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const SHORT_ADDR = `${MOCK_ADDRESS.substring(0, 5)}...${MOCK_ADDRESS.substring(MOCK_ADDRESS.length - 4)}`;

async function goToConnectedVault(page: Page) {
  await page.goto('/');
  await expect(page.getByText(SHORT_ADDR)).toBeVisible({ timeout: 5000 });
  await expect(page.getByLabel('USDC wallet balance')).toContainText('1250.50', { timeout: 20_000 });
}

// Tests that verify unauthenticated UI  no Freighter stub injected
test.describe('Deposit panel  no wallet', () => {
  test.beforeEach(async ({ page }) => {
    await interceptApiRoutes(page);
    await stubFreighterDisconnected(page);
  });

  test('deposit panel shows wallet-not-connected overlay', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Wallet Not Connected')).toBeVisible();
    await expect(page.getByRole('button', { name: /Review Transaction/i })).toBeVisible();
  });

  test('review button is disabled when amount is empty or zero', async ({ page }) => {
    await page.goto('/');
    const reviewBtn = page.getByRole('button', { name: /Review Transaction/i });
    await expect(reviewBtn).toBeDisabled();
    await page.getByPlaceholder('0.00').fill('0');
    await expect(reviewBtn).toBeDisabled();
  });

  test('strategy info panel shows exchange rate and network fee', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('1 yvUSDC = 1.084 USDC')).toBeVisible();
    await expect(page.getByText('~0.00001 XLM')).toBeVisible();
    await expect(page.getByText('BENJI Strategy')).toBeVisible();
  });
});

// Tests that require a connected wallet via Freighter stub
test.describe('Deposit & Withdraw  connected wallet', () => {
  test.beforeEach(async ({ page }) => {
    await interceptApiRoutes(page);
    await stubFreighterConnected(page, MOCK_ADDRESS);
  });

  test('auto-connects wallet on mount when Freighter is already allowed', async ({ page }) => {
    await goToConnectedVault(page);
  });

  test('deposit overlay is removed after wallet connects', async ({ page }) => {
    await goToConnectedVault(page);
    await expect(page.getByText('Wallet Not Connected')).not.toBeVisible();
  });

  test('deposit tab is active by default and can switch to withdraw', async ({ page }) => {
    await goToConnectedVault(page);

    const depositTab = page.getByRole('tab', { name: 'Deposit', exact: true });
    const withdrawTab = page.getByRole('tab', { name: 'Withdraw', exact: true });

    await expect(page.getByText('Amount to deposit')).toBeVisible();
    await withdrawTab.click();
    await expect(page.getByText('Amount to withdraw')).toBeVisible();
    await depositTab.click();
    await expect(page.getByText('Amount to deposit')).toBeVisible();
  });

  test('MAX button pre-fills the deposit field with the displayed wallet balance', async ({ page }) => {
    await goToConnectedVault(page);
    const walletBanner = page.getByLabel('USDC wallet balance');
    await expect(walletBanner).toBeVisible();
    const bannerText = (await walletBanner.textContent()) ?? '';
    const match = bannerText.match(/USDC:\s*([\d.]+)/);
    expect(match, 'expected USDC balance in wallet banner').toBeTruthy();
    const expectedBalance = match![1];
    await page.getByRole('button', { name: 'MAX' }).click();
    await expect(page.getByLabel('Deposit amount')).toHaveValue(expectedBalance);
  });

  test('performs a deposit wizard flow and updates the balance', async ({ page }) => {
    await goToConnectedVault(page);

    const amountInput = page.getByLabel('Deposit amount');
    const reviewBtn = page.getByRole('button', { name: /Review Transaction/i });

    await amountInput.fill('100');
    await expect(reviewBtn).toBeEnabled();
    await reviewBtn.click();

    // Step 2: Review
    await expect(page.getByText('Confirm Transaction')).toBeVisible();
    const confirmBtn = page.getByRole('button', { name: /Confirm deposit/i });
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    // Step 3: Result
    await expect(page.getByText('Transaction Successful')).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: /Done/i }).click();
    await expect(page.getByRole('button', { name: /Review Transaction/i })).toBeVisible();
  });

  test('performs a withdrawal wizard flow and updates the balance', async ({ page }) => {
    await goToConnectedVault(page);

    await page.getByRole('tab', { name: 'Withdraw', exact: true }).click();
    await expect(page.getByText('Amount to withdraw')).toBeVisible();

    await page.getByLabel('Withdrawal amount').fill('50');
    const reviewBtn = page.getByRole('button', { name: /Review Transaction/i });
    await expect(reviewBtn).toBeEnabled();
    await reviewBtn.click();

    // Step 2: Review
    await expect(page.getByText('Confirm Transaction')).toBeVisible();
    const confirmBtn = page.getByRole('button', { name: /Confirm withdrawal/i });
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    // Step 3: Result
    await expect(page.getByText('Transaction Successful')).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: /Done/i }).click();
    await expect(page.getByRole('tab', { name: 'Withdraw', exact: true })).toBeVisible();
  });

  test('deposit review stays disabled with an empty amount field', async ({ page }) => {
    await goToConnectedVault(page);
    const depositInput = page.getByLabel('Deposit amount');
    await expect(depositInput).toHaveValue('');
    await expect(page.getByRole('button', { name: /Review Transaction/i })).toBeDisabled();
  });

  test('deposit review stays disabled when amount exceeds available USDC balance', async ({ page }) => {
    await goToConnectedVault(page);
    await page.getByLabel('Deposit amount').fill('999999');
    await expect(page.getByRole('button', { name: /Review Transaction/i })).toBeDisabled();
    await expect(page.getByRole('alert')).toContainText(/exceed/i);
  });

  test('deposit is blocked when the vault is at capacity', async ({ page }) => {
    await page.route('**/mock-api/vault-summary.json', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(vaultSummaryAtCapacity),
      });
    });
    await goToConnectedVault(page);
    await expect(page.getByText('Vault Capacity Reached')).toBeVisible();
    await expect(page.getByLabel('Deposit amount')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'MAX' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Vault is full' })).toBeDisabled();
  });

  test('switching deposit/withdraw tabs clears the amount field', async ({ page }) => {
    await goToConnectedVault(page);
    await page.getByLabel('Deposit amount').fill('123.45');
    await page.getByRole('tab', { name: 'Withdraw', exact: true }).click();
    await expect(page.getByLabel('Withdrawal amount')).toHaveValue('');
    await page.getByRole('tab', { name: 'Deposit', exact: true }).click();
    await expect(page.getByLabel('Deposit amount')).toHaveValue('');
  });

  test('disconnect button clears wallet state and shows connect button', async ({ page }) => {
    await goToConnectedVault(page);

    // Disable the stub so the auto-connect effect does not re-fire after disconnect
    await page.evaluate(() => {
      (window as unknown as { __freighterStub: { connected: boolean } }).__freighterStub.connected = false;
    });

    await page.getByRole('button', { name: /Disconnect Wallet/i }).click();

    await expect(page.getByRole('button', { name: /Connect Freighter/i })).toBeVisible({ timeout: 3000 });
    await expect(page.getByText('Wallet Not Connected')).toBeVisible();
  });
});
