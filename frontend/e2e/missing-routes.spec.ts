/**
 * Missing-routes coverage — #1573
 *
 * Covers the six routes that had zero E2E tests:
 *   /analytics, /compare, /vault-health, /audit-log,
 *   /receipt/:txHash, and /admin (gated + ungated).
 *
 * All API calls are intercepted via fixtures so tests are fully deterministic
 * and never hit a real network.
 */
import { test, expect, interceptApiRoutes, stubFreighterConnected } from './fixtures';

const MOCK_ADDRESS = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const FAKE_TX_HASH = 'abc123def4567890abcdef1234567890abcdef1234567890abcdef1234567890ab';

// ─── /analytics ──────────────────────────────────────────────────────────────

test.describe('/analytics', () => {
  test('renders page header and TVL stat card from mock data', async ({ page }) => {
    await interceptApiRoutes(page);
    await page.goto('/analytics');

    // PageHeader title (from i18n key analytics.staticTitle, falls back to
    // "Project Analytics" in the default locale fixture)
    await expect(
      page.getByRole('heading', { level: 1 }),
    ).toBeVisible({ timeout: 10_000 });

    // TVL card is always rendered when tvl > 0 (mock data has 12 450 800)
    await expect(page.getByText('Total Value Locked')).toBeVisible({ timeout: 10_000 });

    // Vault Participants stat card
    await expect(page.getByText('Vault Participants')).toBeVisible();

    // Strategy Stability stat card
    await expect(page.getByText('Strategy Stability')).toBeVisible();

    // Page must not show "Feature Unavailable" (that's the feature-flag off path)
    await expect(page.getByText('Feature Unavailable')).not.toBeVisible();
  });

  test('breadcrumb links back to home', async ({ page }) => {
    await interceptApiRoutes(page);
    await page.goto('/analytics');

    await expect(page.getByRole('link', { name: /home/i })).toBeVisible({ timeout: 10_000 });
  });
});

// ─── /compare ────────────────────────────────────────────────────────────────

test.describe('/compare', () => {
  test('renders strategy selection grid', async ({ page }) => {
    await interceptApiRoutes(page);
    await page.goto('/compare');

    await expect(
      page.getByRole('heading', { level: 1 }),
    ).toBeVisible({ timeout: 10_000 });

    // Strategy cards are rendered as buttons with aria-pressed
    const strategyCards = page.getByRole('button', { name: /APY/ });
    await expect(strategyCards.first()).toBeVisible({ timeout: 10_000 });
  });

  test('shows empty-state prompt when fewer than two strategies are selected', async ({ page }) => {
    await interceptApiRoutes(page);
    await page.goto('/compare');

    // No pre-selection → empty state
    await expect(
      page.getByText(/Select at least two strategies/i),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('renders side-by-side comparison table when two strategies are pre-selected via URL', async ({ page }) => {
    await interceptApiRoutes(page);
    // Pre-select two strategies via the URL param used by the component (SELECTION_PARAM = "strategies")
    await page.goto('/compare?strategies=benji%2Cliquidity-buffer');

    // The comparison table heading appears once two+ strategies are selected
    await expect(
      page.getByRole('heading', { name: /Side-by-side comparison/i }),
    ).toBeVisible({ timeout: 10_000 });

    // APY metric row must be in the table
    await expect(page.getByRole('button', { name: /Order comparison by APY/i })).toBeVisible();
  });
});

// ─── /vault-health ───────────────────────────────────────────────────────────

test.describe('/vault-health', () => {
  test('renders vault health dashboard with mocked health records', async ({ page }) => {
    await interceptApiRoutes(page);
    await page.goto('/vault-health');

    // Page heading
    await expect(
      page.getByRole('heading', { name: /Vault Health/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Summary metric cards
    await expect(page.getByText('Avg Latency')).toBeVisible({ timeout: 10_000 });

    // Table headers
    const table = page.getByRole('table', { name: 'Vault health records' });
    await expect(table).toBeVisible({ timeout: 10_000 });
    await expect(table.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Latency' })).toBeVisible();
  });

  test('shows vault names from mock fixture', async ({ page }) => {
    await interceptApiRoutes(page);
    await page.goto('/vault-health');

    // Mock fixture includes these two vaults
    await expect(page.getByText('Stellar RWA Yield Fund')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Sovereign Income Sleeve')).toBeVisible();
  });

  test('time-range radio buttons are all present', async ({ page }) => {
    await interceptApiRoutes(page);
    await page.goto('/vault-health');

    const radioGroup = page.getByRole('radiogroup', { name: /Time range/i });
    await expect(radioGroup).toBeVisible({ timeout: 10_000 });
    await expect(radioGroup.getByRole('radio', { name: '24h' })).toBeVisible();
    await expect(radioGroup.getByRole('radio', { name: '7d' })).toBeVisible();
    await expect(radioGroup.getByRole('radio', { name: '30d' })).toBeVisible();
  });
});

// ─── /audit-log ──────────────────────────────────────────────────────────────

test.describe('/audit-log', () => {
  test('renders audit log page with header and filter controls', async ({ page }) => {
    await interceptApiRoutes(page);
    // Stub the audit-log API so the page doesn't show an error state
    await page.route('**/api/v1/audit-logs**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'audit-1',
              timestamp: '2026-10-01T09:00:00.000Z',
              operation: 'deposit',
              actor: MOCK_ADDRESS,
              details: { amount: '1000', asset: 'USDC' },
            },
            {
              id: 'audit-2',
              timestamp: '2026-10-01T08:30:00.000Z',
              operation: 'withdraw',
              actor: MOCK_ADDRESS,
              details: { amount: '500', asset: 'USDC' },
            },
          ],
          pagination: { count: 2, limit: 20, total: 2, hasNextPage: false },
          timestamp: new Date().toISOString(),
        }),
      }),
    );
    await page.goto('/audit-log');

    // Page heading
    await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible({
      timeout: 10_000,
    });

    // Operation filter dropdown
    await expect(page.getByRole('combobox', { name: /Operation/i })).toBeVisible({ timeout: 10_000 });

    // Actor filter input
    await expect(page.getByRole('textbox', { name: /Actor/i })).toBeVisible();
  });

  test('renders audit entries from API response', async ({ page }) => {
    await interceptApiRoutes(page);
    await page.route('**/api/v1/audit-logs**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'audit-1',
              timestamp: '2026-10-01T09:00:00.000Z',
              operation: 'deposit',
              actor: MOCK_ADDRESS,
              details: { amount: '1000', asset: 'USDC' },
            },
          ],
          pagination: { count: 1, limit: 20, total: 1, hasNextPage: false },
          timestamp: new Date().toISOString(),
        }),
      }),
    );
    await page.goto('/audit-log');

    // The audit table should appear
    const table = page.getByRole('table', { name: 'Audit log entries' });
    await expect(table).toBeVisible({ timeout: 10_000 });

    // Deposit badge
    await expect(page.getByText('Deposit').first()).toBeVisible();
  });

  test('shows empty state when API returns no entries', async ({ page }) => {
    await interceptApiRoutes(page);
    await page.route('**/api/v1/audit-logs**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [],
          pagination: { count: 0, limit: 20, total: 0, hasNextPage: false },
          timestamp: new Date().toISOString(),
        }),
      }),
    );
    await page.goto('/audit-log');

    await expect(
      page.getByText('No audit log entries found'),
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ─── /receipt/:txHash ────────────────────────────────────────────────────────

test.describe('/receipt/:txHash', () => {
  test('renders transaction receipt card for a found transaction', async ({ page }) => {
    await interceptApiRoutes(page);

    // Stub Horizon transaction and operations endpoints
    await page.route(`**/transactions/${FAKE_TX_HASH}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          hash: FAKE_TX_HASH,
          created_at: '2026-10-01T09:00:00.000Z',
          fee_charged: '100',
          source_account: MOCK_ADDRESS,
          operation_count: 1,
          ledger: 50001,
        }),
      }),
    );
    await page.route(`**/transactions/${FAKE_TX_HASH}/operations`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          _embedded: {
            records: [
              {
                type: 'payment',
                amount: '100.0000000',
                asset_type: 'credit_alphanum4',
                asset_code: 'USDC',
                from: MOCK_ADDRESS,
                to: MOCK_ADDRESS,
              },
            ],
          },
        }),
      }),
    );

    await page.goto(`/receipt/${FAKE_TX_HASH}`);

    // Receipt card heading
    await expect(
      page.getByRole('heading', { name: 'Transaction Receipt' }),
    ).toBeVisible({ timeout: 15_000 });

    // Status badge shows "Completed"
    await expect(page.getByText('Completed')).toBeVisible();

    // Key fields
    await expect(page.getByText('Transaction Hash')).toBeVisible();
    await expect(page.getByText('Network Fee')).toBeVisible();
    await expect(page.getByText('Wallet Address')).toBeVisible();

    // Action buttons
    await expect(page.getByRole('button', { name: 'Print Receipt' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export JSON' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'View All Transactions' })).toBeVisible();
  });

  test('shows not-found empty state for a missing transaction', async ({ page }) => {
    await interceptApiRoutes(page);

    // Stub 404 on all Horizon transaction endpoints for this hash
    await page.route(`**/transactions/${FAKE_TX_HASH}**`, (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
    );

    await page.goto(`/receipt/${FAKE_TX_HASH}`);

    await expect(
      page.getByText('Transaction not found'),
    ).toBeVisible({ timeout: 15_000 });

    // Back-to-app link is shown
    await expect(page.getByRole('link', { name: 'Back to app' })).toBeVisible();
  });
});

// ─── /admin ──────────────────────────────────────────────────────────────────

test.describe('/admin — non-admin wallet', () => {
  test('redirects non-admin wallet away from /admin', async ({ page }) => {
    await interceptApiRoutes(page);
    // MOCK_ADDRESS is an investor, not in VITE_ADMIN_WALLETS
    await stubFreighterConnected(page, MOCK_ADDRESS);
    await page.goto('/admin');

    // ProtectedRoute redirects to home when role !== "admin"
    await expect(page).toHaveURL('/', { timeout: 10_000 });
    await expect(page.getByText('Global RWA Yield Fund')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('/admin — unauthenticated', () => {
  test('redirects unauthenticated user away from /admin', async ({ page }) => {
    await interceptApiRoutes(page);
    await page.goto('/admin');

    await expect(page).toHaveURL('/', { timeout: 10_000 });
  });
});
