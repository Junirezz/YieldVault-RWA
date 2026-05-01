import request from 'supertest';
import app from '../index';
import { registerApiKey } from '../middleware/apiKeyAuth';
import { resetWebhookState } from '../webhookDelivery';
import { resetAuditLogs } from '../auditLog';

describe('Admin backend features', () => {
  const adminKey = 'admin-feature-test-key';
  const authHeader = { Authorization: `ApiKey ${adminKey}` };

  beforeAll(() => {
    registerApiKey(adminKey);
  });

  beforeEach(() => {
    resetWebhookState();
    resetAuditLogs();
  });

  it('registers webhook endpoint and records delivery for transaction events', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => 'ok',
      } as Response);

    const webhookResponse = await request(app)
      .post('/admin/webhooks')
      .set(authHeader)
      .send({
        url: 'https://example.com/webhook',
        eventTypes: ['transaction.deposit.created'],
      });

    expect(webhookResponse.status).toBe(201);

    const depositResponse = await request(app)
      .post('/api/v1/vault/deposits')
      .send({
        amount: '125.00',
        asset: 'USDC',
        walletAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz234567',
      });

    expect(depositResponse.status).toBe(201);

    await new Promise((resolve) => setTimeout(resolve, 30));

    const deliveriesResponse = await request(app)
      .get('/admin/webhooks/deliveries')
      .set(authHeader);

    expect(deliveriesResponse.status).toBe(200);
    expect(deliveriesResponse.body.deliveries.length).toBeGreaterThan(0);
    expect(deliveriesResponse.body.deliveries[0].eventType).toBe('transaction.deposit.created');

    fetchMock.mockRestore();
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
});
