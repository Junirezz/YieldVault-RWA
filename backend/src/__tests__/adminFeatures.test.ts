import request from 'supertest';
import app from '../index';
import { registerApiKey } from '../middleware/apiKeyAuth';
import { resetWebhookState } from '../webhookDelivery';
import { resetAuditLogs } from '../auditLog';
import { resetTransactionBackfillJobsForTests } from '../transactionBackfill';
import { resetExportManifestsForTests } from '../exportManifest';
import { eventOutboxService } from '../eventOutbox';

describe('Admin backend features', () => {
  const adminKey = 'admin-feature-test-key';
  const authHeader = { Authorization: `ApiKey ${adminKey}` };

  beforeAll(() => {
    registerApiKey(adminKey);
  });

  beforeEach(async () => {
    await resetWebhookState();
    resetAuditLogs();
    resetTransactionBackfillJobsForTests();
    resetExportManifestsForTests();
  });

  it('registers webhook endpoint and records delivery for transaction events', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => 'ok',
      } as Response);
    const secret = 'super-secret-webhook-key';

    const webhookResponse = await request(app)
      .post('/admin/webhooks')
      .set(authHeader)
      .send({
        url: 'https://example.com/webhook',
        eventTypes: ['transaction.deposit.created'],
        secret,
      });

    expect(webhookResponse.status).toBe(201);
    expect(webhookResponse.body.endpoint.secret).toBeUndefined();
    expect(webhookResponse.body.endpoint.hasSecret).toBe(true);

    const previousAllowlistEnabled = process.env.ALLOWLIST_ENABLED;
    process.env.ALLOWLIST_ENABLED = 'false';

    const depositResponse = await request(app)
      .post('/api/v1/vault/deposits')
      .send({
        amount: '125.00',
        asset: 'USDC',
        walletAddress: 'G234567ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQ',
      });

    if (typeof previousAllowlistEnabled === 'string') {
      process.env.ALLOWLIST_ENABLED = previousAllowlistEnabled;
    } else {
      delete process.env.ALLOWLIST_ENABLED;
    }

    expect(depositResponse.status).toBe(201);

    // The deposit handler writes the event to the outbox fire-and-forget, so
    // wait for that write to land before explicitly draining it — the
    // background poller isn't guaranteed to run within a fixed test delay.
    await new Promise((resolve) => setTimeout(resolve, 30));
    await eventOutboxService.processOutbox(10);

    const deliveriesResponse = await request(app)
      .get('/admin/webhooks/deliveries')
      .set(authHeader);

    expect(deliveriesResponse.status).toBe(200);
    expect(deliveriesResponse.body.deliveries.length).toBeGreaterThan(0);
    expect(deliveriesResponse.body.deliveries[0].eventType).toBe('transaction.deposit.created');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/webhook',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-YieldVault-Signature': expect.any(String),
        }),
      }),
    );

    const listResponse = await request(app)
      .get('/admin/webhooks')
      .set(authHeader);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.endpoints[0].secret).toBeUndefined();
    expect(listResponse.body.endpoints[0].hasSecret).toBe(true);

    fetchMock.mockRestore();
  });

  it('verifies webhook signatures without exposing secrets', async () => {
    const payload = {
      eventType: 'transaction.deposit.created',
      payload: {
        transactionId: 'tx-verify-1',
      },
    };

    const signatureResponse = await request(app)
      .post('/webhooks/verify')
      .send({
        secret: 'verify-secret',
        payload,
      });

    expect(signatureResponse.status).toBe(200);
    expect(signatureResponse.body.algorithm).toBe('HMAC-SHA256');
    expect(signatureResponse.body.signature).toHaveLength(64);
    expect(signatureResponse.body.verified).toBeNull();

    const verificationResponse = await request(app)
      .post('/webhooks/verify')
      .send({
        secret: 'verify-secret',
        payload,
        signature: signatureResponse.body.signature,
      });

    expect(verificationResponse.status).toBe(200);
    expect(verificationResponse.body.verified).toBe(true);
  });

  it('returns audit logs for admin actions', async () => {
    const cacheStats = await request(app)
      .get('/admin/cache/stats')
      .set(authHeader);

    expect(cacheStats.status).toBe(200);

    const auditLogs = await request(app)
      .get('/admin/audit/logs')
      .set(authHeader)
      .query({ limit: 10 });

    expect(auditLogs.status).toBe(200);
    expect(auditLogs.body.logs.length).toBeGreaterThan(0);
    expect(auditLogs.body.metrics).toHaveProperty('totalEntries');
  });

  it('exposes prisma runtime config and job monitoring dashboard', async () => {
    const prismaConfig = await request(app)
      .get('/admin/prisma/config')
      .set(authHeader);

    expect(prismaConfig.status).toBe(200);
    expect(prismaConfig.body.config).toHaveProperty('prismaPoolSize');
    expect(prismaConfig.body.config).toHaveProperty('prismaQueryTimeoutMs');

    const monitorResponse = await request(app)
      .get('/admin/jobs/monitor')
      .set(authHeader);

    expect(monitorResponse.status).toBe(200);
    expect(monitorResponse.body).toHaveProperty('jobHealth');
    expect(monitorResponse.body).toHaveProperty('jobs');
    expect(monitorResponse.body).toHaveProperty('webhooks');

    const dashboardResponse = await request(app)
      .get('/admin/jobs/dashboard')
      .set(authHeader);

    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.text).toContain('Background Job Monitoring');
  });

  it('starts controlled transaction backfill and supports idempotent resume', async () => {
    const first = await request(app)
      .post('/admin/transactions/backfill')
      .set(authHeader)
      .send({
        startLedger: 10,
        endLedger: 15,
        batchSize: 2,
        dryRun: true,
        rpcUrl: 'https://example-rpc.invalid',
        contractId: 'CBACKFILLCONTRACT',
      });

    expect(first.status).toBe(202);
    expect(first.body.job).toHaveProperty('id');
    expect(first.body.job).toHaveProperty('status', 'completed');
    expect(first.body.job.progress).toHaveProperty('totalLedgers', 6);

    const second = await request(app)
      .post('/admin/transactions/backfill')
      .set(authHeader)
      .send({
        startLedger: 10,
        endLedger: 15,
        batchSize: 2,
        dryRun: true,
        rpcUrl: 'https://example-rpc.invalid',
        contractId: 'CBACKFILLCONTRACT',
      });

    expect(second.status).toBe(202);
    expect(second.body.job.id).toBe(first.body.job.id);

    const listed = await request(app)
      .get('/admin/transactions/backfill')
      .set(authHeader);
    expect(listed.status).toBe(200);
    expect(listed.body.data.length).toBeGreaterThan(0);

    const detail = await request(app)
      .get(`/admin/transactions/backfill/${first.body.job.id}`)
      .set(authHeader);
    expect(detail.status).toBe(200);
    expect(detail.body.job.id).toBe(first.body.job.id);
  });

  it('stores immutable export manifest records for generated reporting files', async () => {
    const created = await request(app)
      .post('/admin/reports/exports')
      .set(authHeader)
      .send({
        reportType: 'transactions',
        filters: {
          status: 'completed',
          from: '2026-01-01',
          to: '2026-01-31',
        },
      });

    expect(created.status).toBe(201);
    expect(created.body.manifest).toHaveProperty('id');
    expect(created.body.manifest).toHaveProperty('requester');
    expect(created.body.manifest).toHaveProperty('checksum');
    expect(created.body.manifest).toHaveProperty('generatedAt');

    const list = await request(app)
      .get('/admin/reports/exports/manifests')
      .set(authHeader);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);

    const manifestId = created.body.manifest.id;
    const detail = await request(app)
      .get(`/admin/reports/exports/manifests/${manifestId}`)
      .set(authHeader);
    expect(detail.status).toBe(200);
    expect(detail.body.manifest.id).toBe(manifestId);
  });
});
