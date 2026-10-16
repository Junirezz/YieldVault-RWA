import {
  DEFAULT_READ_QUERY_BUDGET_MS,
  DEFAULT_WRITE_QUERY_BUDGET_MS,
  evaluateQueryPerformance,
  executeWithBudget,
  getQueryBudget,
  InMemoryAlertCooldownStore,
  QUERY_BUDGETS,
  recordQueryPerformance,
  RedisAlertCooldownStore,
  resetAlertCooldowns,
  triggerSlowQueryAlert,
  withQueryBudget,
  wrapQuery,
} from '../queryBudgets';
import type Redis from 'ioredis';
import { classifySqlAction, DatabaseManager, type IDatabasePool } from '../database';
import { dbQueryBudgetBreachTotal } from '../metrics';

const QUERY_ENV_KEYS = [
  'ALERT_TYPE',
  'PAGERDUTY_INTEGRATION_KEY',
  'QUERY_ALERT_TYPE',
  'QUERY_BUDGETS_JSON',
  'QUERY_READ_BUDGET_MS',
  'QUERY_WRITE_BUDGET_MS',
  'REDIS_URL',
  'SLACK_WEBHOOK_URL',
  'SLOW_QUERY_ALERT_COOLDOWN_MS',
  'SLOW_QUERY_ALERT_TIMEOUT_MS',
  'SLOW_QUERY_CRITICAL_MULTIPLIER',
  'SLOW_QUERY_PAGERDUTY_INTEGRATION_KEY',
  'SLOW_QUERY_SLACK_WEBHOOK_URL',
] as const;

describe('Query Performance Budgets and Slow Query Alerts', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    for (const key of QUERY_ENV_KEYS) delete process.env[key];
    process.env.SLOW_QUERY_ALERT_COOLDOWN_MS = '1000';
    resetAlertCooldowns();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const key of QUERY_ENV_KEYS) delete process.env[key];
    resetAlertCooldowns();
  });

  describe('getQueryBudget()', () => {
    it('returns built-in budgets for known model/action pairs', () => {
      expect(getQueryBudget('User', 'findUnique')).toBe(50);
      expect(getQueryBudget('SharePriceSnapshot', 'create')).toBe(150);
    });

    it('returns built-in budgets for uncovered hot paths (Issue #1560)', () => {
      // EventOutbox hot paths
      expect(getQueryBudget('EventOutbox', 'findUnique')).toBe(50);
      expect(getQueryBudget('EventOutbox', 'findFirst')).toBe(50);
      expect(getQueryBudget('EventOutbox', 'findMany')).toBe(100);
      expect(getQueryBudget('EventOutbox', 'create')).toBe(100);
      expect(getQueryBudget('EventOutbox', 'update')).toBe(100);
      expect(getQueryBudget('EventOutbox', 'updateMany')).toBe(100);
      expect(getQueryBudget('EventOutbox', 'deleteMany')).toBe(150);
      expect(getQueryBudget('EventOutbox', 'count')).toBe(50);

      // BulkExportJob hot paths
      expect(getQueryBudget('BulkExportJob', 'findUnique')).toBe(50);
      expect(getQueryBudget('BulkExportJob', 'findFirst')).toBe(50);
      expect(getQueryBudget('BulkExportJob', 'findMany')).toBe(100);
      expect(getQueryBudget('BulkExportJob', 'create')).toBe(150);
      expect(getQueryBudget('BulkExportJob', 'update')).toBe(150);
      expect(getQueryBudget('BulkExportJob', 'upsert')).toBe(150);
      expect(getQueryBudget('BulkExportJob', 'deleteMany')).toBe(150);

      // EmailQueue hot paths
      expect(getQueryBudget('EmailQueue', 'findUnique')).toBe(50);
      expect(getQueryBudget('EmailQueue', 'findFirst')).toBe(50);
      expect(getQueryBudget('EmailQueue', 'findMany')).toBe(100);
      expect(getQueryBudget('EmailQueue', 'create')).toBe(100);
      expect(getQueryBudget('EmailQueue', 'update')).toBe(100);
      expect(getQueryBudget('EmailQueue', 'deleteMany')).toBe(150);

      // TransactionBackfill hot paths
      expect(getQueryBudget('TransactionBackfill', 'findUnique')).toBe(50);
      expect(getQueryBudget('TransactionBackfill', 'findFirst')).toBe(50);
      expect(getQueryBudget('TransactionBackfill', 'findMany')).toBe(100);
      expect(getQueryBudget('TransactionBackfill', 'create')).toBe(150);
      expect(getQueryBudget('TransactionBackfill', 'update')).toBe(150);
      expect(getQueryBudget('TransactionBackfill', 'upsert')).toBe(150);
      expect(getQueryBudget('TransactionBackfill', 'deleteMany')).toBe(150);

      // TransactionBackfillJob hot paths
      expect(getQueryBudget('TransactionBackfillJob', 'findUnique')).toBe(50);
      expect(getQueryBudget('TransactionBackfillJob', 'findFirst')).toBe(50);
      expect(getQueryBudget('TransactionBackfillJob', 'findMany')).toBe(100);
      expect(getQueryBudget('TransactionBackfillJob', 'create')).toBe(150);
      expect(getQueryBudget('TransactionBackfillJob', 'update')).toBe(150);
      expect(getQueryBudget('TransactionBackfillJob', 'upsert')).toBe(150);
      expect(getQueryBudget('TransactionBackfillJob', 'deleteMany')).toBe(150);
    });

    it('resolves model aliases and case normalization', () => {
      // TransactionBackfill <-> TransactionBackfillJob alias resolution
      expect(getQueryBudget('TransactionBackfill', 'findMany')).toBe(100);
      expect(getQueryBudget('TransactionBackfillJob', 'findMany')).toBe(100);

      // Case normalization fallback
      expect(getQueryBudget('eventOutbox', 'findMany')).toBe(100);
      expect(getQueryBudget('bulkExportJob', 'findUnique')).toBe(50);
      expect(getQueryBudget('emailQueue', 'create')).toBe(100);
      expect(getQueryBudget('transactionBackfillJob', 'update')).toBe(150);
    });

    it('returns configurable read and write defaults', () => {
      process.env.QUERY_READ_BUDGET_MS = '75';
      process.env.QUERY_WRITE_BUDGET_MS = '250';

      expect(getQueryBudget('UnknownModel', 'findMany')).toBe(75);
      expect(getQueryBudget('raw_primary', 'select')).toBe(75);
      expect(getQueryBudget('UnknownModel', 'update')).toBe(250);
    });

    it('falls back when default budget configuration is invalid', () => {
      process.env.QUERY_READ_BUDGET_MS = '-1';
      process.env.QUERY_WRITE_BUDGET_MS = 'not-a-number';

      expect(getQueryBudget('UnknownModel', 'count')).toBe(DEFAULT_READ_QUERY_BUDGET_MS);
      expect(getQueryBudget('UnknownModel', 'create')).toBe(DEFAULT_WRITE_QUERY_BUDGET_MS);
    });

    it('applies validated JSON overrides ahead of built-in budgets', () => {
      process.env.QUERY_BUDGETS_JSON = JSON.stringify({
        'User.findUnique': 25,
        'raw_replica.select': 400,
      });

      expect(getQueryBudget('User', 'findUnique')).toBe(25);
      expect(getQueryBudget('raw_replica', 'select')).toBe(400);
    });

    it('ignores malformed or unsafe overrides', () => {
      process.env.QUERY_BUDGETS_JSON = JSON.stringify({
        'User.findUnique': -5,
        'bad key': 1,
      });

      expect(getQueryBudget('User', 'findUnique')).toBe(50);
      expect(getQueryBudget('bad key', 'unknown')).toBe(DEFAULT_WRITE_QUERY_BUDGET_MS);
    });
  });

  describe('evaluateQueryPerformance()', () => {
    it('classifies warning and critical breaches by budget ratio', () => {
      const warning = evaluateQueryPerformance({
        model: 'User',
        action: 'findUnique',
        durationMs: 75,
        source: 'prisma',
      });
      const critical = evaluateQueryPerformance({
        model: 'User',
        action: 'findUnique',
        durationMs: 151,
        source: 'prisma',
      });

      expect(warning).toMatchObject({ breached: true, severity: 'warning', budgetMs: 50 });
      expect(critical).toMatchObject({ breached: true, severity: 'critical', budgetMs: 50 });
    });

    it('normalizes metric labels and invalid durations', () => {
      const result = evaluateQueryPerformance({
        model: ' raw model ',
        action: 'find-many!',
        durationMs: Number.NaN,
        source: 'postgres',
      });

      expect(result).toMatchObject({
        model: 'raw_model',
        action: 'find_many_',
        durationMs: 0,
        breached: false,
      });
    });
  });

  describe('triggerSlowQueryAlert()', () => {
    it('delivers Slack alerts and returns the delivery outcome', async () => {
      process.env.QUERY_ALERT_TYPE = 'slack';
      process.env.SLOW_QUERY_SLACK_WEBHOOK_URL = 'https://hooks.slack.test/query';
      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

      const result = await triggerSlowQueryAlert('User', 'findUnique', 120, 50);

      expect(result).toEqual({ outcome: 'delivered', channels: ['slack'] });
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(JSON.parse(options.body).text).toContain('User.findUnique');
    });

    it('atomically suppresses concurrent duplicate alerts during cooldown', async () => {
      process.env.QUERY_ALERT_TYPE = 'slack';
      process.env.SLOW_QUERY_SLACK_WEBHOOK_URL = 'https://hooks.slack.test/query';
      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

      const results = await Promise.all(
        Array.from({ length: 20 }, () => triggerSlowQueryAlert('Transaction', 'findMany', 400, 150))
      );

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(results.filter((result) => result.outcome === 'delivered')).toHaveLength(1);
      expect(results.filter((result) => result.outcome === 'suppressed')).toHaveLength(19);
    });

    it('does not let warning cooldown suppress a later critical alert', async () => {
      process.env.QUERY_ALERT_TYPE = 'slack';
      process.env.SLOW_QUERY_SLACK_WEBHOOK_URL = 'https://hooks.slack.test/query';
      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

      await triggerSlowQueryAlert('User', 'findUnique', 60, 50, { severity: 'warning' });
      await triggerSlowQueryAlert('User', 'findUnique', 200, 50, { severity: 'critical' });

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('reports non-2xx alert responses as delivery failures', async () => {
      process.env.QUERY_ALERT_TYPE = 'slack';
      process.env.SLOW_QUERY_SLACK_WEBHOOK_URL = 'https://hooks.slack.test/query';
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });

      const result = await triggerSlowQueryAlert('User', 'findUnique', 120, 50);

      expect(result).toEqual({ outcome: 'delivery_failed', channels: [] });
    });

    it('sends both channels with critical PagerDuty severity and a dedup key', async () => {
      process.env.QUERY_ALERT_TYPE = 'both';
      process.env.SLOW_QUERY_SLACK_WEBHOOK_URL = 'https://hooks.slack.test/query';
      process.env.SLOW_QUERY_PAGERDUTY_INTEGRATION_KEY = 'pd-key';
      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 202 });

      const result = await triggerSlowQueryAlert('Transaction', 'findMany', 600, 150, {
        severity: 'critical',
        source: 'prisma',
      });

      expect(result.channels).toEqual(expect.arrayContaining(['slack', 'pagerduty']));
      const pagerDutyCall = (global.fetch as jest.Mock).mock.calls.find(
        ([url]) => url === 'https://events.pagerduty.com/v2/enqueue'
      );
      const body = JSON.parse(pagerDutyCall[1].body);
      expect(body.payload.severity).toBe('critical');
      expect(body.dedup_key).toMatch(/^yieldvault-slow-query-/);
    });
  });

  describe('distributed alert cooldown', () => {
    it('uses one atomic Redis SET NX PX reservation', async () => {
      const set = jest.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
      const store = new RedisAlertCooldownStore(
        { set } as unknown as Redis,
        new InMemoryAlertCooldownStore()
      );

      await expect(store.tryAcquire('slow-query:test', 1000)).resolves.toBe(true);
      await expect(store.tryAcquire('slow-query:test', 1000)).resolves.toBe(false);
      expect(set).toHaveBeenCalledWith('slow-query:test', '1', 'PX', 1000, 'NX');
    });

    it('falls back to process-local suppression when Redis is unavailable', async () => {
      const set = jest.fn().mockRejectedValue(new Error('redis unavailable'));
      const store = new RedisAlertCooldownStore(
        { set } as unknown as Redis,
        new InMemoryAlertCooldownStore()
      );

      await expect(store.tryAcquire('slow-query:test', 1000)).resolves.toBe(true);
      await expect(store.tryAcquire('slow-query:test', 1000)).resolves.toBe(false);
    });
  });

  describe('recordQueryPerformance()', () => {
    it('records a budget breach metric and logs locally without external channels', async () => {
      const before = await counterValue('BudgetMetricModel', 'findMany', 'prisma', 'critical');

      const result = await recordQueryPerformance({
        model: 'BudgetMetricModel',
        action: 'findMany',
        durationMs: 500,
        source: 'prisma',
      });

      const after = await counterValue('BudgetMetricModel', 'findMany', 'prisma', 'critical');
      expect(result).toMatchObject({ breached: true, severity: 'critical' });
      expect(after - before).toBe(1);
    });
  });

  describe('raw PostgreSQL integration', () => {
    it.each([
      ['SELECT 1', 'select'],
      ['  -- comment\nUPDATE vault SET value = 1', 'update'],
      ['/* report */ WITH rows AS (SELECT 1) SELECT * FROM rows', 'with'],
      ['', 'unknown'],
    ])('classifies %j as %s without exposing SQL text', (sql, expected) => {
      expect(classifySqlAction(sql)).toBe(expected);
    });

    it('records raw queries routed through DatabaseManager', async () => {
      process.env.QUERY_BUDGETS_JSON = JSON.stringify({ 'raw_replica.select': 0.001 });
      const pool: IDatabasePool = {
        query: jest.fn().mockResolvedValue({ rows: [{ value: 1 }] }),
        end: jest.fn().mockResolvedValue(undefined),
        isHealthy: jest.fn().mockResolvedValue(true),
      };
      const manager = new DatabaseManager(pool, pool);
      const before = await counterValue('raw_replica', 'select', 'postgres', 'critical');

      await manager.query('SELECT 1');
      await new Promise((resolve) => setImmediate(resolve));

      const after = await counterValue('raw_replica', 'select', 'postgres', 'critical');
      expect(after - before).toBe(1);
    });
  });

  describe('withQueryBudget() and query wrapper enforcement', () => {
    it('executes a query within budget and returns the result', async () => {
      const data = { id: 'evt-123', status: 'pending' };
      const result = await withQueryBudget('EventOutbox', 'findUnique', async () => data);
      expect(result).toBe(data);
    });

    it('works with the wrapQuery alias', async () => {
      const data = [{ id: 'job-1' }];
      const result = await wrapQuery('BulkExportJob', 'findMany', async () => data);
      expect(result).toBe(data);
    });

    it('propagates errors when wrapped query function throws', async () => {
      await expect(
        withQueryBudget('EmailQueue', 'create', async () => {
          throw new Error('Database connection failed');
        })
      ).rejects.toThrow('Database connection failed');
    });

    it('enforces budget in query wrapper when duration exceeds budget', async () => {
      process.env.QUERY_BUDGETS_JSON = JSON.stringify({ 'EventOutbox.findMany': 0.001 });
      const before = await counterValue('EventOutbox', 'findMany', 'prisma', 'critical');
      let capturedBreach: any = null;

      const result = await withQueryBudget(
        'EventOutbox',
        'findMany',
        async () => {
          await new Promise((r) => setTimeout(r, 10));
          return [{ id: 'evt-1' }];
        },
        {
          onBreach: (evaluation) => {
            capturedBreach = evaluation;
          },
        }
      );

      expect(result).toEqual([{ id: 'evt-1' }]);
      await new Promise((resolve) => setImmediate(resolve));
      const after = await counterValue('EventOutbox', 'findMany', 'prisma', 'critical');
      expect(after - before).toBe(1);
      expect(capturedBreach).toMatchObject({
        model: 'EventOutbox',
        action: 'findMany',
        breached: true,
      });
    });

    it('executeWithBudget returns both query result and performance evaluation', async () => {
      const { result, evaluation } = await executeWithBudget(
        'BulkExportJob',
        'findUnique',
        async () => ({ id: 'export-999', status: 'completed' })
      );

      expect(result).toEqual({ id: 'export-999', status: 'completed' });
      expect(evaluation.model).toBe('BulkExportJob');
      expect(evaluation.action).toBe('findUnique');
      expect(evaluation.budgetMs).toBe(50);
      expect(evaluation.breached).toBe(false);
    });

    it('executeWithBudget captures failed queries and records evaluation', async () => {
      let breachTriggered = false;
      await expect(
        executeWithBudget(
          'EmailQueue',
          'update',
          async () => {
            throw new Error('Deadlock detected');
          },
          {
            onEvaluation: (evalResult) => {
              expect(evalResult.failed).toBe(true);
              breachTriggered = true;
            },
          }
        )
      ).rejects.toThrow('Deadlock detected');

      expect(breachTriggered).toBe(true);
    });
  });

  describe('budget-exceeded tests for uncovered hot paths (Issue #1560)', () => {
    describe('EventOutbox hot paths', () => {
      it('triggers warning breach when duration exceeds EventOutbox.findMany budget', async () => {
        const before = await counterValue('EventOutbox', 'findMany', 'prisma', 'warning');

        const evaluation = await recordQueryPerformance({
          model: 'EventOutbox',
          action: 'findMany',
          durationMs: 120, // Budget is 100ms, < 300ms (warning)
          source: 'prisma',
        });

        const after = await counterValue('EventOutbox', 'findMany', 'prisma', 'warning');
        expect(evaluation).toMatchObject({
          model: 'EventOutbox',
          action: 'findMany',
          budgetMs: 100,
          breached: true,
          severity: 'warning',
        });
        expect(after - before).toBe(1);
      });

      it('triggers critical breach and alerts when duration heavily exceeds EventOutbox.create budget', async () => {
        process.env.QUERY_ALERT_TYPE = 'slack';
        process.env.SLOW_QUERY_SLACK_WEBHOOK_URL = 'https://hooks.slack.test/query';
        global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

        const before = await counterValue('EventOutbox', 'create', 'prisma', 'critical');

        const evaluation = await recordQueryPerformance({
          model: 'EventOutbox',
          action: 'create',
          durationMs: 350, // Budget is 100ms, >= 300ms (critical)
          source: 'prisma',
        });

        const after = await counterValue('EventOutbox', 'create', 'prisma', 'critical');
        expect(evaluation).toMatchObject({
          model: 'EventOutbox',
          action: 'create',
          budgetMs: 100,
          breached: true,
          severity: 'critical',
        });
        expect(after - before).toBe(1);
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });
    });

    describe('BulkExportJob hot paths', () => {
      it('triggers warning breach when duration exceeds BulkExportJob.findMany budget', async () => {
        const before = await counterValue('BulkExportJob', 'findMany', 'prisma', 'warning');

        const evaluation = await recordQueryPerformance({
          model: 'BulkExportJob',
          action: 'findMany',
          durationMs: 130, // Budget is 100ms
          source: 'prisma',
        });

        const after = await counterValue('BulkExportJob', 'findMany', 'prisma', 'warning');
        expect(evaluation).toMatchObject({
          model: 'BulkExportJob',
          action: 'findMany',
          budgetMs: 100,
          breached: true,
          severity: 'warning',
        });
        expect(after - before).toBe(1);
      });

      it('triggers critical breach when duration heavily exceeds BulkExportJob.create budget', async () => {
        const before = await counterValue('BulkExportJob', 'create', 'prisma', 'critical');

        const evaluation = await recordQueryPerformance({
          model: 'BulkExportJob',
          action: 'create',
          durationMs: 500, // Budget is 150ms, >= 450ms (critical)
          source: 'prisma',
        });

        const after = await counterValue('BulkExportJob', 'create', 'prisma', 'critical');
        expect(evaluation).toMatchObject({
          model: 'BulkExportJob',
          action: 'create',
          budgetMs: 150,
          breached: true,
          severity: 'critical',
        });
        expect(after - before).toBe(1);
      });
    });

    describe('EmailQueue hot paths', () => {
      it('triggers warning breach when duration exceeds EmailQueue.findMany budget', async () => {
        const before = await counterValue('EmailQueue', 'findMany', 'prisma', 'warning');

        const evaluation = await recordQueryPerformance({
          model: 'EmailQueue',
          action: 'findMany',
          durationMs: 110, // Budget is 100ms
          source: 'prisma',
        });

        const after = await counterValue('EmailQueue', 'findMany', 'prisma', 'warning');
        expect(evaluation).toMatchObject({
          model: 'EmailQueue',
          action: 'findMany',
          budgetMs: 100,
          breached: true,
          severity: 'warning',
        });
        expect(after - before).toBe(1);
      });

      it('triggers critical breach when duration heavily exceeds EmailQueue.create budget', async () => {
        const before = await counterValue('EmailQueue', 'create', 'prisma', 'critical');

        const evaluation = await recordQueryPerformance({
          model: 'EmailQueue',
          action: 'create',
          durationMs: 310, // Budget is 100ms, >= 300ms (critical)
          source: 'prisma',
        });

        const after = await counterValue('EmailQueue', 'create', 'prisma', 'critical');
        expect(evaluation).toMatchObject({
          model: 'EmailQueue',
          action: 'create',
          budgetMs: 100,
          breached: true,
          severity: 'critical',
        });
        expect(after - before).toBe(1);
      });
    });

    describe('TransactionBackfill and TransactionBackfillJob hot paths', () => {
      it('triggers warning breach when duration exceeds TransactionBackfill.findMany budget', async () => {
        const before = await counterValue('TransactionBackfill', 'findMany', 'prisma', 'warning');

        const evaluation = await recordQueryPerformance({
          model: 'TransactionBackfill',
          action: 'findMany',
          durationMs: 125, // Budget is 100ms
          source: 'prisma',
        });

        const after = await counterValue('TransactionBackfill', 'findMany', 'prisma', 'warning');
        expect(evaluation).toMatchObject({
          model: 'TransactionBackfill',
          action: 'findMany',
          budgetMs: 100,
          breached: true,
          severity: 'warning',
        });
        expect(after - before).toBe(1);
      });

      it('triggers critical breach when duration heavily exceeds TransactionBackfillJob.create budget', async () => {
        const before = await counterValue('TransactionBackfillJob', 'create', 'prisma', 'critical');

        const evaluation = await recordQueryPerformance({
          model: 'TransactionBackfillJob',
          action: 'create',
          durationMs: 500, // Budget is 150ms, >= 450ms (critical)
          source: 'prisma',
        });

        const after = await counterValue('TransactionBackfillJob', 'create', 'prisma', 'critical');
        expect(evaluation).toMatchObject({
          model: 'TransactionBackfillJob',
          action: 'create',
          budgetMs: 150,
          breached: true,
          severity: 'critical',
        });
        expect(after - before).toBe(1);
      });

      it('enforces budget for TransactionBackfill.upsert via wrapper', async () => {
        const evaluation = evaluateQueryPerformance({
          model: 'TransactionBackfill',
          action: 'upsert',
          durationMs: 200,
          source: 'prisma',
        });

        expect(evaluation).toMatchObject({
          model: 'TransactionBackfill',
          action: 'upsert',
          budgetMs: 150,
          breached: true,
          severity: 'warning',
        });
      });
    });
  });
});

async function counterValue(
  model: string,
  action: string,
  source: string,
  severity: string
): Promise<number> {
  const metric = await dbQueryBudgetBreachTotal.get();
  return (
    metric.values.find(
      (value) =>
        value.labels.model === model &&
        value.labels.action === action &&
        value.labels.source === source &&
        value.labels.severity === severity
    )?.value ?? 0
  );
}
