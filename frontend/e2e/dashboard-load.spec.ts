/**
 * Flow 1: Dashboard Load
 *
 * Validates that the home page renders vault stats correctly from the API,
 * navigation works, and the unauthenticated state is handled properly.
 */
import { test, expect } from './fixtures';

test.describe('Dashboard load', () => {
  test('renders vault stats from the API on home page load', async ({ appPage: page }) => {
    await page.goto('/');

    // Hero section
    await expect(page.getByText('Institutional Yields,')).toBeVisible();
    await expect(page.getByText('Decentralized Access.')).toBeVisible();

    // Vault panel heading
    await expect(page.getByText('Global RWA Yield Fund')).toBeVisible();

    // APY from mock data (8.45%)
    await expect(page.getByText('8.45%')).toBeVisible();

    // TVL from mock data ($12,450,800)
    await expect(page.getByText('$12,450,800')).toBeVisible();

    // Strategy name from mock data
    await expect(page.getByText('Franklin BENJI Connector')).toBeVisible();

    // Underlying asset
    await expect(page.getByText('Sovereign Debt', { exact: true })).toBeVisible();
  });

  test('shows wallet-not-connected overlay on the deposit panel', async ({ appPage: page }) => {
    await page.goto('/');

    await expect(page.getByText('Wallet Not Connected')).toBeVisible();
    await expect(
      page.getByText('Please connect your Freighter wallet to deposit USDC and earn RWA yields.'),
    ).toBeVisible();

    // Connect button in navbar must be present
    await expect(page.getByRole('button', { name: /Connect Freighter/i })).toBeVisible();
  });

  test('navbar links navigate to the correct routes', async ({ appPage: page }) => {
    await page.goto('/');

    // Navigate to Analytics
    await page.getByRole('link', { name: 'Analytics' }).click();
    await expect(page).toHaveURL('/analytics');
    await expect(page.getByText('Project Analytics')).toBeVisible();

    // Navigate to Portfolio
    await page.getByRole('link', { name: 'Portfolio' }).click();
    await expect(page).toHaveURL('/portfolio');
    await expect(page.getByRole('heading', { name: 'Your Portfolio' })).toBeVisible();

    // Navigate back to Vaults (home)
    await page.getByRole('link', { name: 'Vaults' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByText('Global RWA Yield Fund')).toBeVisible();
  });

  test('analytics page shows live vault metrics', async ({ appPage: page }) => {
    await page.goto('/analytics');

    await expect(page.getByText('Project Analytics')).toBeVisible();

    // TVL card
    await expect(page.getByText('Total Value Locked')).toBeVisible();
    await expect(page.getByText('$12,450,800')).toBeVisible();

    // Participant count from mock data (1,248)
    await expect(page.getByText('1,248')).toBeVisible();

    // Strategy stability from mock data (99.9%)
    await expect(page.getByText('99.9%')).toBeVisible();
  });

  test('unknown routes redirect to home', async ({ appPage: page }) => {
    await page.goto('/does-not-exist');
    await expect(page).toHaveURL('/');
    await expect(page.getByText('Global RWA Yield Fund')).toBeVisible();
  });
});
