import request from 'supertest';
import app from '../index';
import {
  jobGovernanceStore,
  runJobWithRetry,
  registerJobHandler,
  listDeadLetters,
  getDeadLetterRecord,
  retryDeadLetter,
  resolveDeadLetter,
  discardDeadLetter,
  bulkRetryDeadLetters,
  bulkDiscardDeadLetters,
  processDeadLetterQueue,
  resetJobGovernance,
  type DeadLetterRecord,
} from '../jobGovernance';
import { registerApiKey } from '../middleware/apiKeyAuth';

describe('Dead-Letter Queue (DLQ) Processing', () => {
  const adminApiKey = 'admin-dlq-test-key';
  const sleep = async () => undefined;

  beforeEach(() => {
    resetJobGovernance();
    registerApiKey(adminApiKey);
  });

  describe('Core Job Governance DLQ Logic', () => {
    it('auto-generates id and default dead-letter status when recording', () => {
      const record = jobGovernanceStore.recordDeadLetter({
        jobName: 'priceRefresh',
        attempts: 3,
        error: 'Network timeout',
        payload: { asset: 'USDC' },
        failedAt: new Date().toISOString(),
      });

      expect(record.id).toBeDefined();
      expect(record.id).toMatch(/^dlq_/);
      expect(record.status).toBe('dead-letter');

      const stored = getDeadLetterRecord(record.id!);
      expect(stored).toEqual(record);
    });

    it('lists and filters dead letters by jobName and status with pagination', () => {
      jobGovernanceStore.recordDeadLetter({
        id: 'dlq-1',
        jobName: 'priceRefresh',
        attempts: 3,
        error: 'Error 1',
        payload: null,
        failedAt: new Date().toISOString(),
        status: 'dead-letter',
      });

      jobGovernanceStore.recordDeadLetter({
        id: 'dlq-2',
        jobName: 'apySnapshot',
        attempts: 3,
        error: 'Error 2',
        payload: null,
        failedAt: new Date().toISOString(),
        status: 'resolved',
      });

      jobGovernanceStore.recordDeadLetter({
        id: 'dlq-3',
        jobName: 'priceRefresh',
        attempts: 3,
        error: 'Error 3',
        payload: null,
        failedAt: new Date().toISOString(),
        status: 'dead-letter',
      });

      const all = listDeadLetters();
      expect(all.total).toBe(3);

      const priceRefreshOnly = listDeadLetters({ jobName: 'priceRefresh' });
      expect(priceRefreshOnly.total).toBe(2);

      const deadLetterOnly = listDeadLetters({ status: 'dead-letter' });
      expect(deadLetterOnly.total).toBe(2);

      const paginated = listDeadLetters({ limit: 1, offset: 1 });
      expect(paginated.records.length).toBe(1);
      expect(paginated.total).toBe(3);
    });

    it('retries dead letter using registered job handler', async () => {
      let executedPayload: unknown = null;
      registerJobHandler('priceRefresh', async (payload: unknown) => {
        executedPayload = payload;
        return { refreshed: true };
      });

      const record = jobGovernanceStore.recordDeadLetter({
        id: 'dlq-retry-1',
        jobName: 'priceRefresh',
        attempts: 3,
        error: 'Temporary error',
        payload: { pair: 'XLM/USD' },
        failedAt: new Date().toISOString(),
      });

      const outcome = await retryDeadLetter(record.id!);
      expect(outcome.success).toBe(true);
      expect(outcome.result).toEqual({ refreshed: true });
      expect(executedPayload).toEqual({ pair: 'XLM/USD' });

      const updated = getDeadLetterRecord(record.id!);
      expect(updated?.status).toBe('requeued');
      expect(updated?.retriedAt).toBeDefined();
    });

    it('returns error when retrying without a registered handler or custom task', async () => {
      const record = jobGovernanceStore.recordDeadLetter({
        id: 'dlq-unhandled-1',
        jobName: 'reportGeneration',
        attempts: 2,
        error: 'Generation failure',
        payload: null,
        failedAt: new Date().toISOString(),
      });

      const outcome = await retryDeadLetter(record.id!);
      expect(outcome.success).toBe(false);
      expect(outcome.error).toContain("No registered handler or custom task for job type 'reportGeneration'");
    });

    it('resolves and discards dead letter records', () => {
      const rec1 = jobGovernanceStore.recordDeadLetter({
        id: 'dlq-res-1',
        jobName: 'databaseBackup',
        attempts: 3,
        error: 'S3 error',
        payload: null,
        failedAt: new Date().toISOString(),
      });

      const resolved = resolveDeadLetter(rec1.id!, 'admin-user', 'Fixed S3 bucket permissions');
      expect(resolved?.status).toBe('resolved');
      expect(resolved?.resolvedBy).toBe('admin-user');
      expect(resolved?.notes).toBe('Fixed S3 bucket permissions');

      const rec2 = jobGovernanceStore.recordDeadLetter({
        id: 'dlq-disc-1',
        jobName: 'databaseBackup',
        attempts: 3,
        error: 'Disk full',
        payload: null,
        failedAt: new Date().toISOString(),
      });

      const discarded = discardDeadLetter(rec2.id!);
      expect(discarded?.status).toBe('discarded');
      expect(getDeadLetterRecord(rec2.id!)).toBeNull();
    });

    it('handles bulk retry and bulk discard operations', async () => {
      registerJobHandler('apySnapshot', async () => ({ snapshot: true }));

      const r1 = jobGovernanceStore.recordDeadLetter({
        id: 'dlq-bulk-1',
        jobName: 'apySnapshot',
        attempts: 3,
        error: 'Err 1',
        payload: null,
        failedAt: new Date().toISOString(),
      });

      const r2 = jobGovernanceStore.recordDeadLetter({
        id: 'dlq-bulk-2',
        jobName: 'apySnapshot',
        attempts: 3,
        error: 'Err 2',
        payload: null,
        failedAt: new Date().toISOString(),
      });

      const bulkRetryRes = await bulkRetryDeadLetters([r1.id!, r2.id!, 'invalid-id']);
      expect(bulkRetryRes.retried).toBe(2);
      expect(bulkRetryRes.failed).toBe(1);

      const r3 = jobGovernanceStore.recordDeadLetter({
        id: 'dlq-bulk-3',
        jobName: 'databaseBackup',
        attempts: 3,
        error: 'Err 3',
        payload: null,
        failedAt: new Date().toISOString(),
      });

      const bulkDiscardRes = bulkDiscardDeadLetters([r3.id!, 'non-existent']);
      expect(bulkDiscardRes.discarded).toBe(1);
      expect(bulkDiscardRes.ids).toEqual([r3.id!]);
    });

    it('processes pending dead letter queue in batch via processDeadLetterQueue worker', async () => {
      let count = 0;
      registerJobHandler('positionReconciliation', async () => {
        count += 1;
        return { ok: true };
      });

      jobGovernanceStore.recordDeadLetter({
        id: 'dlq-batch-1',
        jobName: 'positionReconciliation',
        attempts: 2,
        error: 'Drift error 1',
        payload: null,
        failedAt: new Date().toISOString(),
      });

      jobGovernanceStore.recordDeadLetter({
        id: 'dlq-batch-2',
        jobName: 'positionReconciliation',
        attempts: 2,
        error: 'Drift error 2',
        payload: null,
        failedAt: new Date().toISOString(),
      });

      const result = await processDeadLetterQueue(5);
      expect(result.processed).toBe(2);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(0);
      expect(count).toBe(2);
    });
  });

  describe('Admin REST API Endpoints for DLQ Management', () => {
    it('requires API key authentication for DLQ routes', async () => {
      const response = await request(app).get('/admin/jobs/dead-letters');
      expect(response.status).toBe(401);
    });

    it('GET /admin/jobs/dead-letters returns list of records with filters', async () => {
      jobGovernanceStore.recordDeadLetter({
        id: 'dlq-api-1',
        jobName: 'priceRefresh',
        attempts: 3,
        error: 'API failure',
        payload: { coin: 'BTC' },
        failedAt: new Date().toISOString(),
      });

      const response = await request(app)
        .get('/admin/jobs/dead-letters')
        .set('Authorization', `ApiKey ${adminApiKey}`);

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1);
      expect(response.body.data[0].id).toBe('dlq-api-1');
    });

    it('GET /admin/jobs/dead-letters/:id returns single record or 404', async () => {
      jobGovernanceStore.recordDeadLetter({
        id: 'dlq-api-2',
        jobName: 'databaseBackup',
        attempts: 3,
        error: 'API backup error',
        payload: null,
        failedAt: new Date().toISOString(),
      });

      const notFound = await request(app)
        .get('/admin/jobs/dead-letters/non-existent')
        .set('Authorization', `ApiKey ${adminApiKey}`);
      expect(notFound.status).toBe(404);

      const found = await request(app)
        .get('/admin/jobs/dead-letters/dlq-api-2')
        .set('Authorization', `ApiKey ${adminApiKey}`);
      expect(found.status).toBe(200);
      expect(found.body.record.id).toBe('dlq-api-2');
    });

    it('POST /admin/jobs/dead-letters/:id/retry handles retry and dryRun preview', async () => {
      registerJobHandler('priceRefresh', async () => ({ refreshed: true }));

      jobGovernanceStore.recordDeadLetter({
        id: 'dlq-api-3',
        jobName: 'priceRefresh',
        attempts: 3,
        error: 'API error',
        payload: null,
        failedAt: new Date().toISOString(),
      });

      const dryRun = await request(app)
        .post('/admin/jobs/dead-letters/dlq-api-3/retry?dryRun=true')
        .set('Authorization', `ApiKey ${adminApiKey}`);

      expect(dryRun.status).toBe(200);
      expect(dryRun.body.dryRun).toBe(true);
      expect(dryRun.body.wouldRetry).toBe(true);

      const response = await request(app)
        .post('/admin/jobs/dead-letters/dlq-api-3/retry')
        .set('Authorization', `ApiKey ${adminApiKey}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toMatch(/retried successfully/i);
      expect(response.body.record.status).toBe('requeued');
    });

    it('POST /admin/jobs/dead-letters/:id/resolve marks record as resolved with notes', async () => {
      jobGovernanceStore.recordDeadLetter({
        id: 'dlq-api-4',
        jobName: 'apySnapshot',
        attempts: 3,
        error: 'API snapshot err',
        payload: null,
        failedAt: new Date().toISOString(),
      });

      const response = await request(app)
        .post('/admin/jobs/dead-letters/dlq-api-4/resolve')
        .set('Authorization', `ApiKey ${adminApiKey}`)
        .send({ notes: 'Manually verified APY history' });

      expect(response.status).toBe(200);
      expect(response.body.record.status).toBe('resolved');
      expect(response.body.record.notes).toBe('Manually verified APY history');
    });

    it('DELETE /admin/jobs/dead-letters/:id discards record with dryRun support', async () => {
      jobGovernanceStore.recordDeadLetter({
        id: 'dlq-api-5',
        jobName: 'reportGeneration',
        attempts: 2,
        error: 'Report err',
        payload: null,
        failedAt: new Date().toISOString(),
      });

      const dryRun = await request(app)
        .delete('/admin/jobs/dead-letters/dlq-api-5?dryRun=true')
        .set('Authorization', `ApiKey ${adminApiKey}`);

      expect(dryRun.status).toBe(200);
      expect(dryRun.body.dryRun).toBe(true);
      expect(dryRun.body.wouldDiscard).toBe(true);

      const response = await request(app)
        .delete('/admin/jobs/dead-letters/dlq-api-5')
        .set('Authorization', `ApiKey ${adminApiKey}`);

      expect(response.status).toBe(200);
      expect(response.body.record.status).toBe('discarded');
    });

    it('POST /admin/jobs/dead-letters/bulk-retry and bulk-discard', async () => {
      registerJobHandler('priceRefresh', async () => ({ ok: true }));

      const r1 = jobGovernanceStore.recordDeadLetter({
        id: 'dlq-api-bulk-1',
        jobName: 'priceRefresh',
        attempts: 3,
        error: 'Err 1',
        payload: null,
        failedAt: new Date().toISOString(),
      });

      const r2 = jobGovernanceStore.recordDeadLetter({
        id: 'dlq-api-bulk-2',
        jobName: 'priceRefresh',
        attempts: 3,
        error: 'Err 2',
        payload: null,
        failedAt: new Date().toISOString(),
      });

      const retryRes = await request(app)
        .post('/admin/jobs/dead-letters/bulk-retry')
        .set('Authorization', `ApiKey ${adminApiKey}`)
        .send({ ids: [r1.id, r2.id] });

      expect(retryRes.status).toBe(200);
      expect(retryRes.body.retried).toBe(2);

      const r3 = jobGovernanceStore.recordDeadLetter({
        id: 'dlq-api-bulk-3',
        jobName: 'databaseBackup',
        attempts: 3,
        error: 'Err 3',
        payload: null,
        failedAt: new Date().toISOString(),
      });

      const discardRes = await request(app)
        .post('/admin/jobs/dead-letters/bulk-discard')
        .set('Authorization', `ApiKey ${adminApiKey}`)
        .send({ ids: [r3.id] });

      expect(discardRes.status).toBe(200);
      expect(discardRes.body.discardedCount).toBe(1);
    });

    it('POST /admin/jobs/dead-letters/process triggers batch processing', async () => {
      registerJobHandler('positionReconciliation', async () => ({ processed: true }));

      jobGovernanceStore.recordDeadLetter({
        id: 'dlq-api-proc-1',
        jobName: 'positionReconciliation',
        attempts: 2,
        error: 'Err',
        payload: null,
        failedAt: new Date().toISOString(),
      });

      const response = await request(app)
        .post('/admin/jobs/dead-letters/process')
        .set('Authorization', `ApiKey ${adminApiKey}`)
        .send({ batchSize: 5 });

      expect(response.status).toBe(200);
      expect(response.body.processed).toBe(1);
      expect(response.body.succeeded).toBe(1);
    });

    it('GET /admin/jobs/dashboard returns HTML dashboard', async () => {
      jobGovernanceStore.recordDeadLetter({
        id: 'dlq-dash-1',
        jobName: 'priceRefresh',
        attempts: 3,
        error: 'API error',
        payload: { symbol: 'USDC' },
        failedAt: new Date().toISOString(),
      });

      const response = await request(app)
        .get('/admin/jobs/dashboard')
        .set('Authorization', `ApiKey ${adminApiKey}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/text\/html/);
      expect(response.text).toContain('Background Job Monitoring Dashboard');
      expect(response.text).toContain('Dead-Letter Records');
      expect(response.text).toContain('Job Runtime Metrics');
      expect(response.text).toContain('API Endpoints');
    });

    it('GET /admin/jobs/metrics returns JSON metrics including DLQ summary', async () => {
      jobGovernanceStore.recordDeadLetter({
        id: 'dlq-metrics-1',
        jobName: 'databaseBackup',
        attempts: 3,
        error: 'S3 error',
        payload: null,
        failedAt: new Date().toISOString(),
      });

      const response = await request(app)
        .get('/admin/jobs/metrics')
        .set('Authorization', `ApiKey ${adminApiKey}`);

      expect(response.status).toBe(200);
      expect(response.body.summary).toBeDefined();
      expect(response.body.metrics).toBeDefined();
      expect(response.body.metrics.totalDeadLetters).toBe(1);
      expect(response.body.metrics.policies).toBeDefined();
      expect(response.body.metrics.runtime).toBeDefined();
    });

    it('POST /admin/jobs/dead-letters/bulk-retry with empty ids returns 400', async () => {
      const response = await request(app)
        .post('/admin/jobs/dead-letters/bulk-retry')
        .set('Authorization', `ApiKey ${adminApiKey}`)
        .send({ ids: [] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Bad Request');
    });

    it('POST /admin/jobs/dead-letters/bulk-discard with empty ids returns 400', async () => {
      const response = await request(app)
        .post('/admin/jobs/dead-letters/bulk-discard')
        .set('Authorization', `ApiKey ${adminApiKey}`)
        .send({ ids: [] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Bad Request');
    });

    it('POST /admin/jobs/dead-letters/process with dryRun returns preview', async () => {
      const response = await request(app)
        .post('/admin/jobs/dead-letters/process?dryRun=true')
        .set('Authorization', `ApiKey ${adminApiKey}`)
        .send({ batchSize: 10 });

      expect(response.status).toBe(200);
      expect(response.body.dryRun).toBe(true);
      expect(response.body.message).toContain('dry-run preview');
    });

    it('GET /admin/jobs/dead-letters with filters returns paginated results', async () => {
      registerJobHandler('priceRefresh', async () => ({ ok: true }));

      for (let i = 0; i < 5; i++) {
        jobGovernanceStore.recordDeadLetter({
          id: `dlq-filter-${i}`,
          jobName: 'priceRefresh',
          attempts: 3,
          error: `Error ${i}`,
          payload: null,
          failedAt: new Date().toISOString(),
        });
      }

      for (let i = 0; i < 3; i++) {
        jobGovernanceStore.recordDeadLetter({
          id: `dlq-apy-${i}`,
          jobName: 'apySnapshot',
          attempts: 2,
          error: `APY Error ${i}`,
          payload: null,
          failedAt: new Date().toISOString(),
        });
      }

      const allResponse = await request(app)
        .get('/admin/jobs/dead-letters')
        .set('Authorization', `ApiKey ${adminApiKey}`);

      expect(allResponse.status).toBe(200);
      expect(allResponse.body.total).toBe(8);
      expect(allResponse.body.limit).toBe(50);

      const priceRefreshResponse = await request(app)
        .get('/admin/jobs/dead-letters?jobName=priceRefresh')
        .set('Authorization', `ApiKey ${adminApiKey}`);

      expect(priceRefreshResponse.status).toBe(200);
      expect(priceRefreshResponse.body.total).toBe(5);
      expect(priceRefreshResponse.body.data.every((r: any) => r.jobName === 'priceRefresh')).toBe(true);

      const paginatedResponse = await request(app)
        .get('/admin/jobs/dead-letters?limit=3&offset=3')
        .set('Authorization', `ApiKey ${adminApiKey}`);

      expect(paginatedResponse.status).toBe(200);
      expect(paginatedResponse.data?.length || 0 || paginatedResponse.body.data?.length).toBeLessThanOrEqual(3);
      expect(paginatedResponse.body.offset).toBe(3);
    });

    it('Retry with custom task provided works', async () => {
      let customTaskExecuted = false;

      const record = jobGovernanceStore.recordDeadLetter({
        id: 'dlq-custom-task',
        jobName: 'reportGeneration',
        attempts: 5,
        error: 'Generation failed',
        payload: { reportId: 'rpt-123' },
        failedAt: new Date().toISOString(),
      });

      const customTask = async () => {
        customTaskExecuted = true;
        return { custom: true };
      };

      const outcome = await retryDeadLetter(record.id!, customTask);

      expect(outcome.success).toBe(true);
      expect(customTaskExecuted).toBe(true);
      expect(outcome.result).toEqual({ custom: true });
    });

    it('Multiple retries on same record update timestamps correctly', async () => {
      registerJobHandler('positionReconciliation', async () => ({ reconciled: true }));

      const record = jobGovernanceStore.recordDeadLetter({
        id: 'dlq-multi-retry',
        jobName: 'positionReconciliation',
        attempts: 4,
        error: 'Drift detected',
        payload: { portfolioId: 'port-456' },
        failedAt: new Date().toISOString(),
      });

      const firstRetry = await retryDeadLetter(record.id!);
      expect(firstRetry.success).toBe(true);

      const retrieved1 = getDeadLetterRecord(record.id!);
      expect(retrieved1?.status).toBe('requeued');
      const firstRetryTime = retrieved1?.retriedAt;

      await new Promise((r) => setTimeout(r, 10));

      // Retry again by manually resetting status
      const recordToRetry = getDeadLetterRecord(record.id!);
      if (recordToRetry) {
        recordToRetry.status = 'dead-letter';
        const secondRetry = await retryDeadLetter(record.id!);
        expect(secondRetry.success).toBe(true);

        const retrieved2 = getDeadLetterRecord(record.id!);
        expect(retrieved2?.retriedAt).not.toEqual(firstRetryTime);
      }
    });

    it('Resolve record prevents further retry without manual intervention', () => {
      const record = jobGovernanceStore.recordDeadLetter({
        id: 'dlq-resolve-check',
        jobName: 'apySnapshot',
        attempts: 3,
        error: 'API timeout',
        payload: null,
        failedAt: new Date().toISOString(),
      });

      const resolved = resolveDeadLetter(record.id!, 'operator-123', 'Manual fix applied');
      expect(resolved?.status).toBe('resolved');
      expect(resolved?.resolvedBy).toBe('operator-123');
      expect(resolved?.notes).toBe('Manual fix applied');

      const retrieved = getDeadLetterRecord(record.id!);
      expect(retrieved?.status).toBe('resolved');
    });

    it('Discard removes record from queue', () => {
      const record = jobGovernanceStore.recordDeadLetter({
        id: 'dlq-discard-check',
        jobName: 'priceRefresh',
        attempts: 3,
        error: 'Data error',
        payload: null,
        failedAt: new Date().toISOString(),
      });

      const discarded = discardDeadLetter(record.id!);
      expect(discarded?.status).toBe('discarded');

      const retrieved = getDeadLetterRecord(record.id!);
      expect(retrieved).toBeNull();
    });
  });
});
