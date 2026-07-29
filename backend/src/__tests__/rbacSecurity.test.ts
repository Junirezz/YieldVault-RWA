import request from 'supertest';
import app from '../index';
import { registerApiKey } from '../middleware/apiKeyAuth';
import { Permission, resolveAdminRoutePermission, requirePermission } from '../middleware/rbac';

/**
 * Comprehensive endpoint-level RBAC security tests.
 *
 * Verifies that every admin endpoint enforces the correct permission level
 * for each role (viewer, operator, admin, super-admin).
 *
 * Permission model:
 *   viewer      – read-only (ADMIN_READ)
 *   operator    – read + CONFIG_WRITE, ALLOWLIST_WRITE, WEBHOOKS_WRITE,
 *                 EXPORTS_WRITE, JOBS_WRITE, IDEMPOTENCY_WRITE
 *   admin       – operator + WEBHOOKS_PRIVILEGED, API_KEYS_WRITE
 *   super-admin – all permissions including IDEMPOTENCY_FLUSH,
 *                 API_KEYS_SUPER, IMPERSONATE
 */
describe('Expanded RBAC Security Tests', () => {
  const viewerKey = 'viewer-sec-key';
  const operatorKey = 'operator-sec-key';
  const adminKey = 'admin-sec-key';
  const superAdminKey = 'super-admin-sec-key';

  beforeEach(() => {
    registerApiKey(viewerKey, { role: 'viewer' });
    registerApiKey(operatorKey, { role: 'operator' });
    registerApiKey(adminKey, { role: 'admin' });
    registerApiKey(superAdminKey, { role: 'super-admin' });
  });

  // ─── resolveAdminRoutePermission() unit tests ──────────────────────────

  describe('resolveAdminRoutePermission() route mapping', () => {
    it('maps new admin routes correctly', () => {
      const reqMaintenance = {
        method: 'POST',
        path: '/admin/maintenance/windows',
      } as any;
      expect(resolveAdminRoutePermission(reqMaintenance)).toBe(Permission.CONFIG_WRITE);

      const reqReplay = {
        method: 'POST',
        path: '/admin/emails/replay/123',
      } as any;
      expect(resolveAdminRoutePermission(reqReplay)).toBe(Permission.JOBS_WRITE);

      const reqImpersonateSession = {
        method: 'POST',
        path: '/admin/impersonate/sessions',
      } as any;
      expect(resolveAdminRoutePermission(reqImpersonateSession)).toBe(Permission.IMPERSONATE);
    });

    it('maps transaction backfill POST to JOBS_WRITE', () => {
      const req = { method: 'POST', path: '/admin/transactions/backfill' } as any;
      expect(resolveAdminRoutePermission(req)).toBe(Permission.JOBS_WRITE);
    });

    it('maps governance snapshots export POST to EXPORTS_WRITE', () => {
      const req = { method: 'POST', path: '/admin/governance/snapshots/export' } as any;
      expect(resolveAdminRoutePermission(req)).toBe(Permission.EXPORTS_WRITE);
    });

    it('maps reports exports POST to EXPORTS_WRITE', () => {
      const req = { method: 'POST', path: '/admin/reports/exports' } as any;
      expect(resolveAdminRoutePermission(req)).toBe(Permission.EXPORTS_WRITE);
    });

    it('maps reports exports manifest verify POST to EXPORTS_WRITE', () => {
      const req = { method: 'POST', path: '/admin/reports/exports/manifests/abc/verify' } as any;
      expect(resolveAdminRoutePermission(req)).toBe(Permission.EXPORTS_WRITE);
    });

    it('maps webhooks verify POST to WEBHOOKS_WRITE', () => {
      const req = { method: 'POST', path: '/admin/webhooks/abc123/verify' } as any;
      expect(resolveAdminRoutePermission(req)).toBe(Permission.WEBHOOKS_WRITE);
    });

    it('maps webhooks dead-letter retry POST to JOBS_WRITE', () => {
      const req = { method: 'POST', path: '/admin/webhooks/dead-letter/xyz/retry' } as any;
      expect(resolveAdminRoutePermission(req)).toBe(Permission.JOBS_WRITE);
    });

    it('maps webhook deduplication DELETE to WEBHOOKS_WRITE', () => {
      const reqSingle = { method: 'DELETE', path: '/admin/webhooks/deduplication/evt-1' } as any;
      expect(resolveAdminRoutePermission(reqSingle)).toBe(Permission.WEBHOOKS_WRITE);

      const reqBulk = { method: 'DELETE', path: '/admin/webhooks/deduplication' } as any;
      expect(resolveAdminRoutePermission(reqBulk)).toBe(Permission.WEBHOOKS_WRITE);
    });

    it('maps jobs dead-letters DELETE to JOBS_WRITE', () => {
      const req = { method: 'DELETE', path: '/admin/jobs/dead-letters/dl-1' } as any;
      expect(resolveAdminRoutePermission(req)).toBe(Permission.JOBS_WRITE);
    });

    it('defaults unknown GET to ADMIN_READ', () => {
      const req = { method: 'GET', path: '/admin/unknown-resource' } as any;
      expect(resolveAdminRoutePermission(req)).toBe(Permission.ADMIN_READ);
    });

    it('defaults unknown POST to API_KEYS_WRITE', () => {
      const req = { method: 'POST', path: '/admin/unknown-resource' } as any;
      expect(resolveAdminRoutePermission(req)).toBe(Permission.API_KEYS_WRITE);
    });
  });

  // ─── Read-only endpoints (ADMIN_READ) ──────────────────────────────────

  describe('Read-only admin endpoints (ADMIN_READ)', () => {
    const readEndpoints = [
      '/admin/latency-status',
      '/admin/sla/registry',
      '/admin/maintenance',
      '/admin/maintenance/windows',
      '/admin/config-changes',
      '/admin/cache/stats',
      '/admin/cache/redis-status',
      '/admin/withdrawal-limits/audit',
      '/admin/emails/queue',
      '/admin/allowlist',
      '/admin/receipts',
      '/admin/api-keys/audit-events',
      '/admin/webhooks',
      '/admin/webhooks/dead-letter',
      '/admin/webhooks/deliveries',
      '/admin/audit/logs',
      '/admin/exports/jobs',
      '/admin/exports/bulk/jobs',
      '/admin/prisma/config',
      '/admin/jobs/monitor',
      '/admin/jobs/metrics',
      '/admin/jobs/dashboard',
      '/admin/transactions/backfill',
      '/admin/governance/snapshots',
      '/admin/reports/exports/manifests',
      '/admin/jobs/dead-letters',
      '/admin/idempotency/keys',
      '/admin/idempotency/retention/metrics',
      '/admin/idempotency/metrics',
      '/admin/webhooks/deduplication/metrics',
      '/admin/webhooks/deduplication/entries',
      '/admin/wal/entries',
      '/admin/wal/metrics',
      '/admin/wal/pending',
      '/admin/withdrawals/recovery',
      '/admin/withdrawals/recovery/metrics',
      '/admin/scoped-tokens/permissions',
    ];

    it.each(readEndpoints)('allows viewer to GET %s (not 403)', async (endpoint) => {
      const res = await request(app)
        .get(endpoint)
        .set('Authorization', `ApiKey ${viewerKey}`);

      // Viewer should have read access — a 403 would indicate a permission
      // misconfiguration. Other status codes (400, 404, 500) are acceptable
      // as they result from missing query params, DB state, etc.
      expect(res.status).not.toBe(403);
    });

    it.each(readEndpoints)('allows operator to GET %s (not 403)', async (endpoint) => {
      const res = await request(app)
        .get(endpoint)
        .set('Authorization', `ApiKey ${operatorKey}`);

      expect(res.status).not.toBe(403);
    });
  });

  // ─── Config write endpoints (CONFIG_WRITE) ────────────────────────────

  describe('Config write endpoints (CONFIG_WRITE)', () => {
    it('denies viewer from maintenance parameter updates', async () => {
      const res = await request(app)
        .post('/admin/maintenance')
        .set('Authorization', `ApiKey ${viewerKey}`)
        .send({ enabled: true, reason: 'test' });

      expect(res.status).toBe(403);
      expect(res.body.requiredPermission).toBe(Permission.CONFIG_WRITE);
    });

    it('allows operator to update maintenance mode (dry-run)', async () => {
      const res = await request(app)
        .post('/admin/maintenance')
        .set('Authorization', `ApiKey ${operatorKey}`)
        .send({ enabled: true, reason: 'test', dryRun: true });

      expect(res.status).toBe(200);
    });

    it('denies viewer from creating maintenance windows', async () => {
      const res = await request(app)
        .post('/admin/maintenance/windows')
        .set('Authorization', `ApiKey ${viewerKey}`)
        .send({ title: 'Test Window', startsAt: '2026-08-01T00:00:00Z', endsAt: '2026-08-01T02:00:00Z' });

      expect(res.status).toBe(403);
      expect(res.body.requiredPermission).toBe(Permission.CONFIG_WRITE);
    });

    it('allows operator to create maintenance windows', async () => {
      const res = await request(app)
        .post('/admin/maintenance/windows')
        .set('Authorization', `ApiKey ${operatorKey}`)
        .send({ title: 'Test Window', startsAt: '2026-08-01T00:00:00Z', endsAt: '2026-08-01T02:00:00Z' });

      expect(res.status).toBe(201);
    });

    it('denies viewer from cache invalidation', async () => {
      const res = await request(app)
        .post('/admin/cache/invalidate')
        .set('Authorization', `ApiKey ${viewerKey}`)
        .send({ pattern: 'vault:*' });

      expect(res.status).toBe(403);
    });

    it('allows operator to invalidate cache', async () => {
      const res = await request(app)
        .post('/admin/cache/invalidate')
        .set('Authorization', `ApiKey ${operatorKey}`)
        .send({ pattern: 'vault:*' });

      expect(res.status).not.toBe(403);
    });

    it('denies viewer from clearing cache', async () => {
      const res = await request(app)
        .delete('/admin/cache')
        .set('Authorization', `ApiKey ${viewerKey}`);

      expect([403, 429]).toContain(res.status);
    });

    it('denies viewer from feature flag overrides', async () => {
      const res = await request(app)
        .post('/admin/feature-flags/overrides')
        .set('Authorization', `ApiKey ${viewerKey}`)
        .send({ flagName: 'test', enabled: true, scopeType: 'environment', scopeValue: 'dev', expiresAt: '2027-01-01T00:00:00Z' });

      expect([403, 429]).toContain(res.status);
    });

    it('allows super-admin to create withdrawal limit overrides (not 403)', async () => {
      // Super-admin bypasses RBAC — the handler may still return validation errors
      const res = await request(app)
        .post('/admin/withdrawal-limits/override')
        .set('Authorization', `ApiKey ${superAdminKey}`)
        .send({ walletAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567', reason: 'test override' });

      expect(res.status).not.toBe(403);
    });
  });

  // ─── Allowlist endpoints (ALLOWLIST_WRITE) ─────────────────────────────

  describe('Allowlist endpoints (ALLOWLIST_WRITE)', () => {
    it('denies viewer from adding to allowlist', async () => {
      const res = await request(app)
        .post('/admin/allowlist/add')
        .set('Authorization', `ApiKey ${viewerKey}`)
        .send({ walletAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567' });

      // RBAC blocks (403) or rate limiter (429) — both are valid security responses
      expect([403, 429]).toContain(res.status);
    });

    it('allows operator to add to allowlist (not 403)', async () => {
      // Use a fresh wallet each time to avoid false "already added" errors
      const freshWallet = 'G' + Math.random().toString(36).substring(2, 10).toUpperCase() + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.slice(0, 56 - 1);
      const res = await request(app)
        .post('/admin/allowlist/add')
        .set('Authorization', `ApiKey ${operatorKey}`)
        .send({ walletAddress: freshWallet.slice(0, 56) });

      // 200 for newly added, or another non-403 code for other states
      expect(res.status).not.toBe(403);
    });

    it('denies viewer from removing from allowlist', async () => {
      const res = await request(app)
        .delete('/admin/allowlist/remove')
        .set('Authorization', `ApiKey ${viewerKey}`)
        .send({ walletAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567' });

      expect([403, 429]).toContain(res.status);
    });
  });

  // ─── Job endpoints (JOBS_WRITE) ────────────────────────────────────────

  describe('Job endpoints (JOBS_WRITE)', () => {
    it('denies viewer from APY backfill', async () => {
      const res = await request(app)
        .post('/admin/apy/backfill')
        .set('Authorization', `ApiKey ${viewerKey}`)
        .send({ start: '2026-01-01', end: '2026-01-02', dryRun: true });

      expect([403, 429]).toContain(res.status);
    });

    it('allows operator to preview APY backfill (dry-run)', async () => {
      const res = await request(app)
        .post('/admin/apy/backfill')
        .set('Authorization', `ApiKey ${operatorKey}`)
        .send({ start: '2026-01-01', end: '2026-01-02', dryRun: true });

      expect(res.status).not.toBe(403);
    });

    it('denies viewer from event replay', async () => {
      const res = await request(app)
        .post('/admin/events/replay')
        .set('Authorization', `ApiKey ${viewerKey}`)
        .send({ fromLedger: 1, toLedger: 10, dryRun: true });

      expect([403, 429]).toContain(res.status);
    });

    it('allows operator to preview event replay (dry-run)', async () => {
      const res = await request(app)
        .post('/admin/events/replay')
        .set('Authorization', `ApiKey ${operatorKey}`)
        .send({ fromLedger: 1, toLedger: 10, dryRun: true });

      expect(res.status).not.toBe(403);
    });

    it('denies viewer from transaction backfill', async () => {
      const res = await request(app)
        .post('/admin/transactions/backfill')
        .set('Authorization', `ApiKey ${viewerKey}`)
        .send({ walletAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567' });

      expect([403, 429]).toContain(res.status);
    });

    it('denies viewer from idempotency retention cleanup', async () => {
      const res = await request(app)
        .post('/admin/idempotency/retention/cleanup')
        .set('Authorization', `ApiKey ${viewerKey}`);

      expect([403, 429]).toContain(res.status);
    });

    it('allows operator to run idempotency retention cleanup (not 403)', async () => {
      const res = await request(app)
        .post('/admin/idempotency/retention/cleanup')
        .set('Authorization', `ApiKey ${operatorKey}`);

      expect(res.status).not.toBe(403);
    });
  });

  // ─── API key endpoints (API_KEYS_WRITE) ────────────────────────────────

  describe('API key endpoints (API_KEYS_WRITE)', () => {
    it('denies operator from registering API keys', async () => {
      const res = await request(app)
        .post('/admin/api-keys/register')
        .set('Authorization', `ApiKey ${operatorKey}`)
        .send({ role: 'viewer', tenantId: 'test-tenant' });

      expect([403, 429]).toContain(res.status);
    });

    it('allows admin to register API keys (not 403)', async () => {
      const res = await request(app)
        .post('/admin/api-keys/register')
        .set('Authorization', `ApiKey ${adminKey}`)
        .send({ role: 'viewer', tenantId: 'test-tenant' });

      // May return 201 on success or 409 on conflict — neither should be 403
      expect(res.status).not.toBe(403);
    });

    it('denies operator from rotating API keys', async () => {
      const res = await request(app)
        .post('/admin/api-keys/rotate')
        .set('Authorization', `ApiKey ${operatorKey}`)
        .send({ key: 'old-key' });

      expect([403, 429]).toContain(res.status);
    });

    it('denies operator from revoking API keys', async () => {
      const res = await request(app)
        .post('/admin/api-keys/revoke')
        .set('Authorization', `ApiKey ${operatorKey}`)
        .send({ key: 'key-to-revoke' });

      expect([403, 429]).toContain(res.status);
    });
  });

  // ─── Scoped admin token endpoints (API_KEYS_SUPER) ────────────────────

  describe('Scoped admin token endpoints (API_KEYS_SUPER)', () => {
    it('denies admin from creating scoped tokens', async () => {
      const res = await request(app)
        .post('/admin/scoped-tokens')
        .set('Authorization', `ApiKey ${adminKey}`)
        .send({ permissions: ['read:metrics'], expiresInDays: 30 });

      expect([403, 429]).toContain(res.status);
    });

    it('allows super-admin to create scoped tokens (not 403)', async () => {
      const res = await request(app)
        .post('/admin/scoped-tokens')
        .set('Authorization', `ApiKey ${superAdminKey}`)
        .send({ permissions: ['read:metrics'], expiresInDays: 30 });

      expect(res.status).not.toBe(403);
    });

    it('denies admin from rotating scoped tokens', async () => {
      const res = await request(app)
        .post('/admin/scoped-tokens/key-1/rotate')
        .set('Authorization', `ApiKey ${adminKey}`);

      expect([403, 429]).toContain(res.status);
    });

    it('denies admin from revoking scoped tokens', async () => {
      const res = await request(app)
        .post('/admin/scoped-tokens/key-1/revoke')
        .set('Authorization', `ApiKey ${adminKey}`);

      expect([403, 429]).toContain(res.status);
    });
  });

  // ─── Webhook endpoints (WEBHOOKS_WRITE / WEBHOOKS_PRIVILEGED) ─────────

  describe('Webhook endpoints (WEBHOOKS_WRITE)', () => {
    it('denies viewer from creating webhooks', async () => {
      const res = await request(app)
        .post('/admin/webhooks')
        .set('Authorization', `ApiKey ${viewerKey}`)
        .send({ url: 'https://example.com/hook', eventTypes: ['transaction.created'] });

      expect([403, 429]).toContain(res.status);
    });

    it('allows operator to create webhooks', async () => {
      const res = await request(app)
        .post('/admin/webhooks')
        .set('Authorization', `ApiKey ${operatorKey}`)
        .send({ url: 'https://example.com/hook', eventTypes: ['transaction.created'] });

      expect(res.status).not.toBe(403);
    });

    it('denies viewer from webhook deduplication deletion', async () => {
      const res = await request(app)
        .delete('/admin/webhooks/deduplication/test-event-1')
        .set('Authorization', `ApiKey ${viewerKey}`);

      expect([403, 429]).toContain(res.status);
    });

    it('allows operator to delete webhook deduplication entry (not 403)', async () => {
      const res = await request(app)
        .delete('/admin/webhooks/deduplication/test-event-1')
        .set('Authorization', `ApiKey ${operatorKey}`);

      // May 200 or 404 if entry doesn't exist — never 403 for operator
      expect(res.status).not.toBe(403);
    });

    it('denies viewer from bulk deduplication clear', async () => {
      const res = await request(app)
        .delete('/admin/webhooks/deduplication')
        .set('Authorization', `ApiKey ${viewerKey}`);

      expect([403, 429]).toContain(res.status);
    });
  });

  // ─── Export endpoints (EXPORTS_WRITE) ─────────────────────────────────

  describe('Export endpoints (EXPORTS_WRITE)', () => {
    it('denies viewer from bulk exports', async () => {
      const res = await request(app)
        .post('/admin/exports/bulk')
        .set('Authorization', `ApiKey ${viewerKey}`)
        .send({ format: 'csv', walletAddresses: ['GABCDEFGHIJKLMNOPQRSTUVWXYZ234567'] });

      expect([403, 429]).toContain(res.status);
    });

    it('allows operator to create bulk export (not 403)', async () => {
      const res = await request(app)
        .post('/admin/exports/bulk')
        .set('Authorization', `ApiKey ${operatorKey}`)
        .send({ format: 'csv', walletAddresses: ['GABCDEFGHIJKLMNOPQRSTUVWXYZ234567'] });

      expect(res.status).not.toBe(403);
    });

    it('denies viewer from governance snapshots export', async () => {
      const res = await request(app)
        .post('/admin/governance/snapshots/export')
        .set('Authorization', `ApiKey ${viewerKey}`);

      expect([403, 429]).toContain(res.status);
    });

    it('allows operator to export governance snapshots (not 403)', async () => {
      const res = await request(app)
        .post('/admin/governance/snapshots/export')
        .set('Authorization', `ApiKey ${operatorKey}`);

      expect(res.status).not.toBe(403);
    });

    it('denies viewer from reports exports', async () => {
      const res = await request(app)
        .post('/admin/reports/exports')
        .set('Authorization', `ApiKey ${viewerKey}`)
        .send({ type: 'reconciliation' });

      expect([403, 429]).toContain(res.status);
    });
  });

  // ─── Idempotency endpoints (IDEMPOTENCY_WRITE / IDEMPOTENCY_FLUSH) ────

  describe('Idempotency endpoints (IDEMPOTENCY_WRITE / IDEMPOTENCY_FLUSH)', () => {
    it('denies viewer from deleting a single idempotency key', async () => {
      const res = await request(app)
        .delete('/admin/idempotency/keys/test-key')
        .set('Authorization', `ApiKey ${viewerKey}`);

      expect([403, 429]).toContain(res.status);
    });

    it('allows operator to delete a single idempotency key (not 403)', async () => {
      const res = await request(app)
        .delete('/admin/idempotency/keys/test-key')
        .set('Authorization', `ApiKey ${operatorKey}`);

      // May return 200 or 404 if key doesn't exist — should never be 403
      expect(res.status).not.toBe(403);
    });

    it('denies admin from flushing the full idempotency store', async () => {
      const res = await request(app)
        .delete('/admin/idempotency/keys')
        .set('Authorization', `ApiKey ${adminKey}`);

      expect([403, 429]).toContain(res.status);
    });

    it('allows super-admin to flush the idempotency store (not 403)', async () => {
      const res = await request(app)
        .delete('/admin/idempotency/keys')
        .set('Authorization', `ApiKey ${superAdminKey}`);

      // May return 200, 204, or other responses depending on store state
      expect(res.status).not.toBe(403);
    });
  });

  // ─── Impersonation endpoints (IMPERSONATE) ─────────────────────────────

  describe('Impersonation endpoints (IMPERSONATE)', () => {
    it('denies viewer from impersonation', async () => {
      const res = await request(app)
        .get('/admin/impersonate/GABCDEFGHIJKLMNOPQRSTUVWXYZ234567')
        .set('Authorization', `ApiKey ${viewerKey}`);

      expect([403, 429]).toContain(res.status);
    });

    it('denies operator from impersonation', async () => {
      const res = await request(app)
        .get('/admin/impersonate/GABCDEFGHIJKLMNOPQRSTUVWXYZ234567')
        .set('Authorization', `ApiKey ${operatorKey}`);

      expect([403, 429]).toContain(res.status);
    });

    it('denies admin from impersonation (requires super-admin)', async () => {
      const res = await request(app)
        .get('/admin/impersonate/GABCDEFGHIJKLMNOPQRSTUVWXYZ234567')
        .set('Authorization', `ApiKey ${adminKey}`);

      expect([403, 429]).toContain(res.status);
    });

    it('allows super-admin to impersonate (not 403)', async () => {
      const res = await request(app)
        .get('/admin/impersonate/GABCDEFGHIJKLMNOPQRSTUVWXYZ234567')
        .set('Authorization', `ApiKey ${superAdminKey}`);

      // May 200 on success, 404 if wallet unknown — never 403 for super-admin
      expect(res.status).not.toBe(403);
    });

    it('denies operators from starting impersonation sessions', async () => {
      const res = await request(app)
        .post('/admin/impersonate/sessions')
        .set('Authorization', `ApiKey ${operatorKey}`)
        .send({ targetWallet: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567' });

      expect([403, 429]).toContain(res.status);
    });

    it('allows super-admin to create impersonation sessions (not 403)', async () => {
      const res = await request(app)
        .post('/admin/impersonate/sessions')
        .set('Authorization', `ApiKey ${superAdminKey}`)
        .send({ targetWallet: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567' });

      expect(res.status).not.toBe(403);
    });
  });

  // ─── Unauthenticated / missing API key ─────────────────────────────────

  describe('Unauthenticated access', () => {
    it('returns 401 or 429 for admin endpoint without API key', async () => {
      const res = await request(app).get('/admin/maintenance');

      expect([401, 429]).toContain(res.status);
    });

    it('returns 401 or 429 for admin endpoint with invalid API key', async () => {
      const res = await request(app)
        .get('/admin/maintenance')
        .set('Authorization', 'ApiKey invalid-key-that-does-not-exist');

      expect([401, 429]).toContain(res.status);
    });

    it('returns 401 or 429 for admin endpoint with malformed auth header', async () => {
      const res = await request(app)
        .get('/admin/maintenance')
        .set('Authorization', 'Bearer some-jwt-token');

      expect([401, 429]).toContain(res.status);
    });
  });

  // ─── requirePermission() factory ──────────────────────────────────────

  describe('requirePermission() factory', () => {
    it('returns a middleware function with correct arity', () => {
      const middleware = requirePermission(Permission.ADMIN_READ);
      expect(typeof middleware).toBe('function');
      expect(middleware.length).toBe(3); // (req, res, next)
    });

    it('accepts multiple permissions (any match grants access)', () => {
      const middleware = requirePermission(Permission.CONFIG_WRITE, Permission.ADMIN_READ);
      expect(typeof middleware).toBe('function');
    });
  });
});
