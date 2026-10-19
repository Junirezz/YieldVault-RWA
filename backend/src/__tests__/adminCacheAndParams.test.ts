import request from 'supertest';
import app from '../index';
import { registerApiKey } from '../middleware/apiKeyAuth';

describe('Admin cache regex and id validation (Issues #1609 & #1610)', () => {
  const adminKey = 'admin-cache-params-test-key';
  const authHeader = { Authorization: `ApiKey ${adminKey}` };

  beforeAll(() => {
    registerApiKey(adminKey);
  });

  describe('Issue #1609: DELETE /admin/cache regex constraints', () => {
    it('rejects ReDoS vulnerable patterns with 400 quickly (<100ms)', async () => {
      const start = Date.now();
      const res = await request(app)
        .delete('/admin/cache')
        .query({ pattern: '(a+)+$' })
        .set(authHeader);
      const elapsed = Date.now() - start;

      expect(res.status).toBe(400);
      expect(elapsed).toBeLessThan(100);
      expect(res.body.error).toBe('Bad Request');
    });

    it('rejects regex pattern exceeding 100 characters with 400', async () => {
      const longPattern = 'a'.repeat(101);
      const res = await request(app)
        .delete('/admin/cache')
        .query({ pattern: longPattern })
        .set(authHeader);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Bad Request');
    });

    it('rejects invalid regex syntax with 400', async () => {
      const res = await request(app)
        .delete('/admin/cache')
        .query({ pattern: '[unclosed-bracket' })
        .set(authHeader);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Bad Request');
    });

    it('supports dryRun=true to preview matches without deleting', async () => {
      const res = await request(app)
        .delete('/admin/cache')
        .query({ pattern: '^vault:', dryRun: 'true' })
        .set(authHeader);

      expect(res.status).toBe(200);
      expect(res.body.dryRun).toBe(true);
      expect(res.body.wouldInvalidate).toBe(true);
      expect(res.body.stats).toBeDefined();
    });
  });

  describe('Issue #1610: Admin id-based routes validation and URI decode error handling', () => {
    it('returns 400 (not 500) for malformed URI-encoded idempotency key', async () => {
      const res = await request(app)
        .delete('/admin/idempotency/keys/%E0%A4%A')
        .set(authHeader);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Bad Request');
      expect(res.body.message).toMatch(/failed to decode|malformed uri/i);
    });

    it('rejects invalid/malformed id parameters with 400 across admin id routes', async () => {
      const badId = 'invalid id with spaces & symbols!';

      // DELETE /admin/webhooks/:id
      const resWebhook = await request(app)
        .delete(`/admin/webhooks/${encodeURIComponent(badId)}`)
        .set(authHeader);
      expect(resWebhook.status).toBe(400);

      // POST /admin/webhooks/:id/verify
      const resVerify = await request(app)
        .post(`/admin/webhooks/${encodeURIComponent(badId)}/verify`)
        .set(authHeader);
      expect(resVerify.status).toBe(400);

      // POST /admin/webhooks/dead-letter/:id/retry
      const resDeadLetter = await request(app)
        .post(`/admin/webhooks/dead-letter/${encodeURIComponent(badId)}/retry`)
        .set(authHeader);
      expect(resDeadLetter.status).toBe(400);

      // GET /admin/receipts/:id
      const resReceipt = await request(app)
        .get(`/admin/receipts/${encodeURIComponent(badId)}`)
        .set(authHeader);
      expect(resReceipt.status).toBe(400);

      // GET /admin/receipts/:id/verify
      const resReceiptVerify = await request(app)
        .get(`/admin/receipts/${encodeURIComponent(badId)}/verify`)
        .set(authHeader);
      expect(resReceiptVerify.status).toBe(400);

      // DELETE /admin/feature-flags/overrides/:id
      const resFeatureFlag = await request(app)
        .delete(`/admin/feature-flags/overrides/${encodeURIComponent(badId)}`)
        .set(authHeader);
      expect(resFeatureFlag.status).toBe(400);

      // POST /admin/emails/replay/:id
      const resEmailReplay = await request(app)
        .post(`/admin/emails/replay/${encodeURIComponent(badId)}`)
        .set(authHeader);
      expect(resEmailReplay.status).toBe(400);

      // DELETE /admin/wallet-aliases/:canonicalId
      const resWalletAlias = await request(app)
        .delete(`/admin/wallet-aliases/${encodeURIComponent(badId)}`)
        .set(authHeader);
      expect(resWalletAlias.status).toBe(400);

      // GET /admin/exports/bulk/jobs/:id
      const resBulkJob = await request(app)
        .get(`/admin/exports/bulk/jobs/${encodeURIComponent(badId)}`)
        .set(authHeader);
      expect(resBulkJob.status).toBe(400);

      // GET /admin/exports/bulk/artifacts/:artifactId
      const resArtifact = await request(app)
        .get(`/admin/exports/bulk/artifacts/${encodeURIComponent(badId)}`)
        .set(authHeader);
      expect(resArtifact.status).toBe(400);

      // GET /admin/jobs/dead-letters/:id
      const resDeadLetterJob = await request(app)
        .get(`/admin/jobs/dead-letters/${encodeURIComponent(badId)}`)
        .set(authHeader);
      expect(resDeadLetterJob.status).toBe(400);

      // POST /admin/jobs/dead-letters/:id/retry
      const resRetryJob = await request(app)
        .post(`/admin/jobs/dead-letters/${encodeURIComponent(badId)}/retry`)
        .set(authHeader);
      expect(resRetryJob.status).toBe(400);

      // DELETE /admin/jobs/dead-letters/:id
      const resDeleteJob = await request(app)
        .delete(`/admin/jobs/dead-letters/${encodeURIComponent(badId)}`)
        .set(authHeader);
      expect(resDeleteJob.status).toBe(400);
    });
  });
});
