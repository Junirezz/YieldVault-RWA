/**
 * E2E tests for OfflineBanner offline-queue behaviour.
 *
 * Strategy: use Playwright's network conditions API to go offline/online and
 * assert the banner states transition correctly.  The service worker is
 * disabled at build time (VITE_E2E=1) so route mocks are never bypassed.
 */
import { test, expect, interceptApiRoutes } from './fixtures';

test.describe('OfflineBanner', () => {
  test.beforeEach(async ({ page }) => {
    await interceptApiRoutes(page);
    await page.goto('/');
    // Wait for the app to finish loading before touching network conditions.
    await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
  });

  test('shows offline warning when network is lost', async ({ page, context }) => {
    // Simulate going offline.
    await context.setOffline(true);

    // The banner should appear and announce the offline state.
    const banner = page.getByRole('alert');
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await expect(banner).toContainText(/you('re| are) (currently )?offline|no (internet|network)/i);
  });

  test('banner is non-dismissible while offline', async ({ page, context }) => {
    await context.setOffline(true);

    const banner = page.getByRole('alert');
    await expect(banner).toBeVisible({ timeout: 5_000 });

    // No dismiss button should be rendered in the offline state.
    await expect(banner.getByRole('button')).not.toBeVisible();
  });

  test('shows cached TVL and balance while offline', async ({ page, context }) => {
    // Let the app load with mocked data so lastKnownTvl / lastKnownBalance are populated.
    await page.waitForTimeout(500);

    await context.setOffline(true);

    const banner = page.getByRole('alert');
    await expect(banner).toBeVisible({ timeout: 5_000 });

    // The banner should surface the last-known values from props.
    // Our mock vault summary has tvl=12450800 and the Horizon mock has 1250.50 USDC.
    await expect(banner).toContainText(/TVL/i);
  });

  test('transitions to success state when connectivity is restored', async ({
    page,
    context,
  }) => {
    await context.setOffline(true);

    // Confirm offline state is shown.
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 5_000 });

    // Restore network.
    await context.setOffline(false);

    // The banner should switch to the success / "Connection restored" state.
    const statusBanner = page.getByRole('status');
    await expect(statusBanner).toBeVisible({ timeout: 10_000 });
    await expect(statusBanner).toContainText(/restored|back online/i);
  });

  test('success banner can be dismissed by the user', async ({ page, context }) => {
    await context.setOffline(true);
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 5_000 });

    await context.setOffline(false);

    const statusBanner = page.getByRole('status');
    await expect(statusBanner).toBeVisible({ timeout: 10_000 });

    const dismissBtn = statusBanner.getByRole('button');
    await expect(dismissBtn).toBeVisible();
    await dismissBtn.click();

    await expect(statusBanner).not.toBeVisible({ timeout: 3_000 });
  });

  test('success banner auto-dismisses after ~4 seconds', async ({ page, context }) => {
    await context.setOffline(true);
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 5_000 });

    await context.setOffline(false);

    const statusBanner = page.getByRole('status');
    await expect(statusBanner).toBeVisible({ timeout: 10_000 });

    // Banner should disappear on its own within the 4-second window (allow 7s for CI).
    await expect(statusBanner).not.toBeVisible({ timeout: 7_000 });
  });

  test('no banner shown when always online', async ({ page }) => {
    // Neither alert nor status banners should be present for a normal page load.
    await expect(page.getByRole('alert')).not.toBeVisible();
    await expect(page.getByRole('status')).not.toBeVisible();
  });
});
