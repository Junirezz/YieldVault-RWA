/**
 * Flow 3: Portfolio Page
 */
import { test, expect, interceptApiRoutes, stubFreighterConnected } from './fixtures';

const MOCK_ADDRESS = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const SHORT_ADDR = `${MOCK_ADDRESS.substring(0, 5)}...${MOCK_ADDRESS.substring(MOCK_ADDRESS.length - 4)}`;

test.describe('Portfolio page  unauthenticated', () => {
  test('shows connect-wallet prompt when no wallet is connected', async ({ page }) => {
    await interceptApiRoutes(page);
    await page.goto('/portfolio');
    await expect(page.getByRole('heading', { name: 'Your Portfolio' })).toBeVisible();
    await expect(page.getByText('Please connect your wallet to view your portfolio.')).toBeVisible();
    await expect(page.getByRole('table')).not.toBeVisible();
  });
});

test.describe('Portfolio page  authenticated', () => {
  test.beforeEach(async ({ page }) => {
    await interceptApiRoutes(page);
    await stubFreighterConnected(page, MOCK_ADDRESS);
  });

  test('loads and displays portfolio holdings after wallet connects', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByText(SHORT_ADDR)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Total Net Value')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Portfolio holdings' })).toBeVisible();
    // Highest value holding from mock data (sorted by valueUsd desc)
    await expect(page.getByText('Tokenized T-Bills')).toBeVisible();
  });

  test('displays correct total portfolio value', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByText(SHORT_ADDR)).toBeVisible({ timeout: 5000 });
    // Sum: 1250.5 + 894.41 + 512.9 + 1404.32 + 337.08 + 228.55 = $4,627.76
    await expect(page.getByText('$4,627.76')).toBeVisible({ timeout: 5000 });
  });

  test('search filter narrows holdings results', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByText(SHORT_ADDR)).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('table', { name: 'Portfolio holdings' })).toBeVisible();

    const searchInput = page.getByPlaceholder('Search asset, vault, issuer...');
    await searchInput.fill('Franklin');

    await expect(page.getByText('USDC Treasury Pool')).toBeVisible();
    await expect(page.getByText('Tokenized T-Bills')).not.toBeVisible();
    await expect(page.getByText('1 positions found')).toBeVisible();
  });

  test('clearing search restores all holdings', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByText(SHORT_ADDR)).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('table', { name: 'Portfolio holdings' })).toBeVisible();

    const searchInput = page.getByPlaceholder('Search asset, vault, issuer...');
    await searchInput.fill('Franklin');
    await expect(page.getByText('1 positions found')).toBeVisible();
    await searchInput.clear();
    await expect(page.getByText('6 positions found')).toBeVisible();
  });

  test('rows-per-page selector changes visible row count', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByText(SHORT_ADDR)).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('table', { name: 'Portfolio holdings' })).toBeVisible();

    // Default page size 4 => 4 data rows + 1 header = 5 rows total
    const rows = page.getByRole('row');
    await expect(rows).toHaveCount(5);

    await page.getByRole('combobox', { name: 'Rows per page' }).selectOption('6');
    // 6 data rows + 1 header = 7
    await expect(rows).toHaveCount(7);
  });

  test('column sort changes row order', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByText(SHORT_ADDR)).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('table', { name: 'Portfolio holdings' })).toBeVisible();

    // Default sort: valueUsd desc  Tokenized T-Bills ($1,404.32) is first
    const firstDataRow = page.getByRole('row').nth(1);
    await expect(firstDataRow.getByRole('cell').first()).toContainText('Tokenized T-Bills');

    // First click on APY sorts asc (lowest first: Tokenized T-Bills 5.95%)
    // Second click sorts desc (highest first: EM Debt Blend 9.1%)
    const apyHeader = page.getByRole('columnheader', { name: 'APY' });
    await apyHeader.click(); // asc
    await apyHeader.click(); // desc
    await expect(page.getByRole('row').nth(1).getByRole('cell').first()).toContainText('EM Debt Blend');
  });
});
