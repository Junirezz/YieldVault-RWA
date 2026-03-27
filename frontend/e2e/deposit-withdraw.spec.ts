/**
 * Flow 2: Deposit & Withdraw Transaction
 */
import { test, expect, interceptApiRoutes, stubFreighterConnected, stubFreighterDisconnected } from './fixtures';

const MOCK_ADDRESS = 'GABC1TEST2STELLAR3ADDRESS4FAKE5XYZ6ABCDEFGHIJKLMNOPQRSTU';
const SHORT_ADDR = `${MOCK_ADDRESS.substring(0, 5)}...${MOCK_ADDRESS.substring(MOCK_ADDRESS.length - 4)}`;

// Tests that verify unauthenticated UI  no Freighter stub injected
test.describe('Deposit panel  no wallet', () => {
  test.beforeEach(async ({ page }) => {
    await interceptApiRoutes(page);
    await stubFreighterDisconnected(page);
  });

  test('deposit panel shows wallet-not-connected overlay', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Wallet Not Connected')).toBeVisible();
    await expect(page.getByRole('button', { name: /Approve & Deposit/i })).toBeVisible();
  });

  test('submit button is disabled when amount is empty or zero', async ({ page }) => {
    await page.goto('/');
    const submitBtn = page.getByRole('button', { name: /Approve & Deposit/i });
    await expect(submitBtn).toBeDisabled();
    await page.getByPlaceholder('0.00').fill('0');
    await expect(submitBtn).toBeDisabled();
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
    await page.goto('/');
    await expect(page.getByText(SHORT_ADDR)).toBeVisible({ timeout: 5000 });
  });

  test('deposit overlay is removed after wallet connects', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(SHORT_ADDR)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Wallet Not Connected')).not.toBeVisible();
  });

  test('deposit tab is active by default and can switch to withdraw', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(SHORT_ADDR)).toBeVisible({ timeout: 5000 });

    const depositTab = page.getByRole('button', { name: 'Deposit', exact: true });
    const withdrawTab = page.getByRole('button', { name: 'Withdraw', exact: true });

    await expect(page.getByText('Amount to deposit')).toBeVisible();
    await withdrawTab.click();
    await expect(page.getByText('Amount to withdraw')).toBeVisible();
    await depositTab.click();
    await expect(page.getByText('Amount to deposit')).toBeVisible();
  });

  test('MAX button fills the amount input with the current balance', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(SHORT_ADDR)).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: 'MAX' }).click();
    const value = await page.getByPlaceholder('0.00').inputValue();
    expect(value).toBeTruthy();
  });

  test('performs a deposit and updates the balance', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(SHORT_ADDR)).toBeVisible({ timeout: 5000 });

    const amountInput = page.getByPlaceholder('0.00');
    const submitBtn = page.getByRole('button', { name: /Approve & Deposit/i });

    await amountInput.fill('100');
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    await expect(page.getByRole('button', { name: /Processing Transaction/i })).toBeVisible();
    // Initial balance 1250.50 + 100 = 1350.50
    await expect(page.getByText('1350.50')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /Approve & Deposit/i })).toBeVisible();
  });

  test('performs a withdrawal and updates the balance', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(SHORT_ADDR)).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
    await expect(page.getByText('Amount to withdraw')).toBeVisible();

    await page.getByPlaceholder('0.00').fill('50');
    const submitBtn = page.getByRole('button', { name: /Withdraw Funds/i });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    await expect(page.getByRole('button', { name: /Processing Transaction/i })).toBeVisible();
    // 1250.50 - 50 = 1200.50
    await expect(page.getByText('1200.50')).toBeVisible({ timeout: 5000 });
  });

  test('disconnect button clears wallet state and shows connect button', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(SHORT_ADDR)).toBeVisible({ timeout: 5000 });

    // Disable the stub so the auto-connect effect does not re-fire after disconnect
    await page.evaluate(() => {
      (window as unknown as { __freighterStub: { connected: boolean } }).__freighterStub.connected = false;
    });

    await page.getByRole('button', { name: /Disconnect Wallet/i }).click();

    await expect(page.getByRole('button', { name: /Connect Freighter/i })).toBeVisible({ timeout: 3000 });
    await expect(page.getByText('Wallet Not Connected')).toBeVisible();
  });
});
