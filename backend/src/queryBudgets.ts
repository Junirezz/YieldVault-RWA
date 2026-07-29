/**
 * Query performance budgets and slow-query alerting (Issue #1050).
 *
 * All database entry points report through this module so budget evaluation,
 * metrics, structured logs, severity, and alert cooldowns stay consistent.
 */

import crypto from 'crypto';
import Redis from 'ioredis';
import { logger } from './middleware/structuredLogging';
import {
  observeDbQueryDuration,
  recordDbQueryBudgetBreach,
  recordDbSlowQueryAlert,
  setDbQueryBudget,
} from './metrics';

export const DEFAULT_READ_QUERY_BUDGET_MS = 100;
export const DEFAULT_WRITE_QUERY_BUDGET_MS = 200;
export const DEFAULT_ALERT_COOLDOWN_MS = 15 * 60 * 1000;
export const DEFAULT_ALERT_TIMEOUT_MS = 5000;
export const DEFAULT_CRITICAL_MULTIPLIER = 3;

/** Built-in budgets for known hot paths. `QUERY_BUDGETS_JSON` can override them. */
export const QUERY_BUDGETS: Readonly<Record<string, number>> = Object.freeze({
  'User.findUnique': 50,
  'VaultState.findUnique': 50,
  'SharePriceSnapshot.create': 150,
  'Transaction.findMany': 150,
  'Referral.findUnique': 50,
  'WebhookEndpoint.findMany': 100,
  'WebhookDelivery.findMany': 150,
});

const READ_ACTIONS = new Set([
  'findUnique',
  'findFirst',
  'findMany',
  'count',
  'queryRaw',
  'aggregate',
  'groupBy',
  'select',
  'with',
  'show',
  'explain',
]);

export type QueryPerformanceSource = 'prisma' | 'postgres';
export type QueryBreachSeverity = 'warning' | 'critical';
export type SlowQueryAlertOutcome = 'delivered' | 'logged' | 'suppressed' | 'delivery_failed';

export interface QueryPerformanceSample {
  model: string;
  action: string;
  durationMs: number;
  source: QueryPerformanceSource;
  failed?: boolean;
}

export interface QueryPerformanceEvaluation extends QueryPerformanceSample {
  budgetMs: number;
  ratio: number;
  breached: boolean;
  severity: QueryBreachSeverity;
}

export interface SlowQueryAlertResult {
  outcome: SlowQueryAlertOutcome;
  channels: Array<'slack' | 'pagerduty'>;
}

interface AlertCooldownStore {
  tryAcquire(key: string, ttlMs: number): Promise<boolean>;
  clear(): void;
}

export class InMemoryAlertCooldownStore implements AlertCooldownStore {
  private readonly expiresAtByKey = new Map<string, number>();

  async tryAcquire(key: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const expiresAt = this.expiresAtByKey.get(key) ?? 0;
    if (expiresAt > now) return false;
    this.expiresAtByKey.set(key, now + ttlMs);
    return true;
  }

  clear(): void {
    this.expiresAtByKey.clear();
  }
}

export class RedisAlertCooldownStore implements AlertCooldownStore {
  constructor(
    private readonly redis: Redis,
    private readonly fallback: InMemoryAlertCooldownStore
  ) {}

  async tryAcquire(key: string, ttlMs: number): Promise<boolean> {
    try {
      const result = await this.redis.set(key, '1', 'PX', ttlMs, 'NX');
      return result === 'OK';
    } catch (error) {
      logger.log('warn', 'Redis slow-query cooldown unavailable; using local fallback', {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.fallback.tryAcquire(key, ttlMs);
    }
  }

  clear(): void {
    this.fallback.clear();
  }
}

const localCooldownStore = new InMemoryAlertCooldownStore();
let redisCooldownStore: RedisAlertCooldownStore | null = null;
let redisCooldownUrl: string | null = null;
let budgetOverrideCacheRaw: string | undefined;
let budgetOverrideCache: Record<string, number> = {};

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readBudgetOverrides(): Record<string, number> {
  const raw = process.env.QUERY_BUDGETS_JSON;
  if (raw === budgetOverrideCacheRaw) return budgetOverrideCache;

  budgetOverrideCacheRaw = raw;
  budgetOverrideCache = {};
  if (!raw) return budgetOverrideCache;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('expected a JSON object');
    }

    for (const [key, value] of Object.entries(parsed)) {
      if (
        /^[A-Za-z][A-Za-z0-9_]{0,63}\.[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) &&
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value > 0
      ) {
        budgetOverrideCache[key] = value;
      } else {
        logger.log('warn', 'Ignoring invalid query budget override', { key });
      }
    }
  } catch (error) {
    logger.log('error', 'Ignoring malformed QUERY_BUDGETS_JSON', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return budgetOverrideCache;
}

function normalizeLabel(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9_]/g, '_')
    .slice(0, 64);
  return normalized || fallback;
}

function getCooldownStore(): AlertCooldownStore {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return localCooldownStore;
  if (redisCooldownStore && redisCooldownUrl === redisUrl) return redisCooldownStore;

  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    // Queue the first atomic reservation while a lazy connection is being
    // established; retries remain bounded so Redis outages fall back quickly.
    enableOfflineQueue: true,
    connectTimeout: parsePositiveNumber(process.env.REDIS_CONNECT_TIMEOUT_MS, 2000),
    maxRetriesPerRequest: 1,
  });
  redis.on('error', (error) => {
    logger.log('error', 'Redis slow-query cooldown error', { error: error.message });
  });
  redisCooldownUrl = redisUrl;
  redisCooldownStore = new RedisAlertCooldownStore(redis, localCooldownStore);
  return redisCooldownStore;
}

/**
 * Resolves an exact model/action override, then a built-in budget, then the
 * configured read/write default.
 */
export function getQueryBudget(model: string, action: string): number {
  const key = `${model}.${action}`;
  const overrides = readBudgetOverrides();
  if (overrides[key] !== undefined) return overrides[key];
  if (QUERY_BUDGETS[key] !== undefined) return QUERY_BUDGETS[key];

  return READ_ACTIONS.has(action)
    ? parsePositiveNumber(process.env.QUERY_READ_BUDGET_MS, DEFAULT_READ_QUERY_BUDGET_MS)
    : parsePositiveNumber(process.env.QUERY_WRITE_BUDGET_MS, DEFAULT_WRITE_QUERY_BUDGET_MS);
}

export function evaluateQueryPerformance(
  sample: QueryPerformanceSample
): QueryPerformanceEvaluation {
  const model = normalizeLabel(sample.model, 'unknown');
  const action = normalizeLabel(sample.action, 'unknown');
  const durationMs =
    Number.isFinite(sample.durationMs) && sample.durationMs >= 0 ? sample.durationMs : 0;
  const budgetMs = getQueryBudget(model, action);
  const ratio = budgetMs > 0 ? durationMs / budgetMs : 0;
  const criticalMultiplier = parsePositiveNumber(
    process.env.SLOW_QUERY_CRITICAL_MULTIPLIER,
    DEFAULT_CRITICAL_MULTIPLIER
  );

  return {
    ...sample,
    model,
    action,
    durationMs,
    budgetMs,
    ratio,
    breached: durationMs >= budgetMs,
    severity: ratio >= criticalMultiplier ? 'critical' : 'warning',
  };
}

/**
 * Records query latency and emits a cooldown-aware alert for budget breaches.
 * Callers intentionally do not await this function on request paths.
 */
export async function recordQueryPerformance(
  sample: QueryPerformanceSample
): Promise<QueryPerformanceEvaluation> {
  const evaluation = evaluateQueryPerformance(sample);
  const { model, action, source, durationMs, budgetMs, ratio, severity, breached } = evaluation;

  observeDbQueryDuration(model, action, durationMs);
  setDbQueryBudget(model, action, budgetMs);
  if (!breached) return evaluation;

  recordDbQueryBudgetBreach(model, action, source, severity);
  // Some Jest suites intentionally leave background jobs running after their
  // assertions. Avoid writing through Jest's closed console while preserving
  // metrics and direct alert-delivery tests.
  if (process.env.NODE_ENV !== 'test') {
    logger.log(severity === 'critical' ? 'error' : 'warn', 'Database query exceeded budget', {
      model,
      action,
      source,
      durationMs: Math.round(durationMs * 100) / 100,
      budgetMs,
      ratio: Math.round(ratio * 100) / 100,
      severity,
      failed: sample.failed === true,
    });
  }

  try {
    await triggerSlowQueryAlert(model, action, durationMs, budgetMs, {
      severity,
      source,
      failed: sample.failed === true,
    });
  } catch (error) {
    logger.log('error', 'Unexpected slow-query alert failure', {
      model,
      action,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return evaluation;
}

async function postJson(url: string, body: unknown): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    parsePositiveNumber(process.env.SLOW_QUERY_ALERT_TIMEOUT_MS, DEFAULT_ALERT_TIMEOUT_MS)
  );

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`alert endpoint returned HTTP ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Emits one external alert per query key and cooldown window. Redis makes the
 * cooldown shared across replicas; if it is unavailable, local suppression
 * still prevents an alert storm from a single process.
 */
export async function triggerSlowQueryAlert(
  model: string,
  action: string,
  durationMs: number,
  budgetMs: number,
  details: {
    severity?: QueryBreachSeverity;
    source?: QueryPerformanceSource;
    failed?: boolean;
  } = {}
): Promise<SlowQueryAlertResult> {
  const severity = details.severity ?? 'warning';
  const cooldownMs = parsePositiveNumber(
    process.env.SLOW_QUERY_ALERT_COOLDOWN_MS,
    DEFAULT_ALERT_COOLDOWN_MS
  );
  const queryKey = `${model}.${action}`;
  const keyHash = crypto
    .createHash('sha256')
    .update(`${queryKey}:${severity}`)
    .digest('hex')
    .slice(0, 24);
  const acquired = await getCooldownStore().tryAcquire(
    `slow-query-alert:v1:${keyHash}`,
    cooldownMs
  );

  if (!acquired) {
    recordDbSlowQueryAlert(model, action, severity, 'suppressed');
    return { outcome: 'suppressed', channels: [] };
  }

  const alertType = process.env.QUERY_ALERT_TYPE || process.env.ALERT_TYPE || 'slack';
  const slackUrl = process.env.SLOW_QUERY_SLACK_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL;
  const pagerDutyKey =
    process.env.SLOW_QUERY_PAGERDUTY_INTEGRATION_KEY || process.env.PAGERDUTY_INTEGRATION_KEY;
  const deliveries: Array<Promise<'slack' | 'pagerduty'>> = [];

  if ((alertType === 'slack' || alertType === 'both') && slackUrl) {
    deliveries.push(
      postJson(slackUrl, {
        text: `Slow Database Query Alert: ${queryKey}`,
        attachments: [
          {
            color: severity === 'critical' ? 'danger' : 'warning',
            fields: [
              { title: 'Query', value: queryKey, short: true },
              { title: 'Duration', value: `${durationMs.toFixed(2)}ms`, short: true },
              { title: 'Budget', value: `${budgetMs}ms`, short: true },
              { title: 'Severity', value: severity, short: true },
              { title: 'Source', value: details.source ?? 'prisma', short: true },
              { title: 'Failed', value: String(details.failed === true), short: true },
            ],
          },
        ],
      }).then(() => 'slack' as const)
    );
  }

  if ((alertType === 'pagerduty' || alertType === 'both') && pagerDutyKey) {
    deliveries.push(
      postJson('https://events.pagerduty.com/v2/enqueue', {
        routing_key: pagerDutyKey,
        event_action: 'trigger',
        dedup_key: `yieldvault-slow-query-${keyHash}`,
        payload: {
          summary: `Slow Query: ${queryKey} took ${durationMs.toFixed(2)}ms (budget: ${budgetMs}ms)`,
          source: 'yieldvault-backend',
          severity,
          component: 'database',
          group: 'performance',
          class: 'slow-query',
          custom_details: {
            model,
            action,
            durationMs,
            budgetMs,
            source: details.source ?? 'prisma',
            failed: details.failed === true,
          },
        },
      }).then(() => 'pagerduty' as const)
    );
  }

  if (deliveries.length === 0) {
    recordDbSlowQueryAlert(model, action, severity, 'logged');
    return { outcome: 'logged', channels: [] };
  }

  const settled = await Promise.allSettled(deliveries);
  const channels = settled
    .filter(
      (result): result is PromiseFulfilledResult<'slack' | 'pagerduty'> =>
        result.status === 'fulfilled'
    )
    .map((result) => result.value);
  const failures = settled.filter((result) => result.status === 'rejected');

  for (const failure of failures) {
    logger.log('error', 'Failed to deliver slow-query alert', {
      query: queryKey,
      error:
        failure.status === 'rejected' && failure.reason instanceof Error
          ? failure.reason.message
          : String(failure),
    });
  }

  const outcome: SlowQueryAlertOutcome = channels.length > 0 ? 'delivered' : 'delivery_failed';
  recordDbSlowQueryAlert(model, action, severity, outcome);
  return { outcome, channels };
}

export function resetAlertCooldowns(): void {
  localCooldownStore.clear();
  redisCooldownStore?.clear();
  budgetOverrideCacheRaw = undefined;
  budgetOverrideCache = {};
}
