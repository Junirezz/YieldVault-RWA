import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import { getJobMetrics, JobName } from './jobGovernance';

// Create a Registry which registers the metrics
export const register = new Registry();

// Add a default label which is added to all metrics
register.setDefaultLabels({
  app: 'yieldvault-backend'
});

// Enable the collection of default metrics
collectDefaultMetrics({ register });

// --- Standard HTTP Metrics ---

export const httpRequestCount = new Counter({
  name: 'http_request_count',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

export const httpResponseTime = new Histogram({
  name: 'http_response_time_seconds',
  help: 'Histogram of HTTP response time in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10], // Define custom buckets for response time
  registers: [register],
});

export const activeConnections = new Gauge({
  name: 'http_active_connections',
  help: 'Number of active HTTP connections',
  registers: [register],
});

export const dbQueryDuration = new Histogram({
  name: 'db_query_duration_seconds',
  help: 'Histogram of database query duration in seconds',
  labelNames: ['model', 'action'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register],
});

export const dbQueryBudgetMs = new Gauge({
  name: 'db_query_budget_ms',
  help: 'Configured database query performance budget in milliseconds',
  labelNames: ['model', 'action'],
  registers: [register],
});

export const dbQueryBudgetBreachTotal = new Counter({
  name: 'db_query_budget_breach_total',
  help: 'Total database queries that exceeded their performance budget',
  labelNames: ['model', 'action', 'source', 'severity'],
  registers: [register],
});

export const dbSlowQueryAlertTotal = new Counter({
  name: 'db_slow_query_alert_total',
  help: 'Slow-query alert outcomes after cooldown and delivery processing',
  labelNames: ['model', 'action', 'severity', 'outcome'],
  registers: [register],
});

export const cacheHitCount = new Counter({
  name: 'cache_hit_count',
  help: 'Number of cache hits for GET requests',
  labelNames: ['method', 'route'],
  registers: [register],
});

export const cacheMissCount = new Counter({
  name: 'cache_miss_count',
  help: 'Number of cache misses for GET requests',
  labelNames: ['method', 'route'],
  registers: [register],
});

export const cacheEvictionCount = new Counter({
  name: 'cache_eviction_count',
  help: 'Number of cache evictions due to size limit',
  registers: [register],
});

// --- Vault Specific Metrics ---

export const vaultTvl = new Gauge({
  name: 'vault_tvl_usd',
  help: 'Current Total Value Locked (TVL) in USD',
  registers: [register],
});

export const vaultSharePrice = new Gauge({
  name: 'vault_share_price_usd',
  help: 'Current vault share price in USD',
  registers: [register],
});

/**
 * Updates vault-specific gauges
 * @param tvl Current TVL value
 * @param sharePrice Current share price value
 */
export function updateVaultMetrics(tvl: number, sharePrice: number) {
  vaultTvl.set(tvl);
  vaultSharePrice.set(sharePrice);
}

export function observeDbQueryDuration(model: string, action: string, durationMs: number) {
  dbQueryDuration.observe(
    {
      model,
      action,
    },
    durationMs / 1000,
  );
}

export function setDbQueryBudget(model: string, action: string, budgetMs: number): void {
  dbQueryBudgetMs.set({ model, action }, budgetMs);
}

export function recordDbQueryBudgetBreach(
  model: string,
  action: string,
  source: string,
  severity: string,
): void {
  dbQueryBudgetBreachTotal.inc({ model, action, source, severity });
}

export function recordDbSlowQueryAlert(
  model: string,
  action: string,
  severity: string,
  outcome: string,
): void {
  dbSlowQueryAlertTotal.inc({ model, action, severity, outcome });
}

// --- Job Governance Metrics ---

export const jobDeadLetterCount = new Gauge({
  name: 'job_dead_letter_count',
  help: 'Number of dead-letter records per job',
  labelNames: ['job_name'],
  registers: [register],
});

export const jobHealthStatus = new Gauge({
  name: 'job_health_status',
  help: 'Job health: 1 = up, 0 = degraded',
  labelNames: ['job_name'],
  registers: [register],
});

/**
 * Syncs job governance state into Prometheus gauges.
 * Call this before scraping /metrics so values are current.
 */
export function syncJobGovernanceMetrics(): void {
  const metrics = getJobMetrics();
  const failureCounts = metrics.failureCounts as Record<string, number>;
  const recurringFailures = metrics.recurringFailures as Partial<Record<JobName, number>>;

  for (const [jobName, count] of Object.entries(failureCounts)) {
    jobDeadLetterCount.set({ job_name: jobName }, count);
    jobHealthStatus.set(
      { job_name: jobName },
      jobName in recurringFailures ? 0 : 1,
    );
  }
}

// --- Reconciliation Drift Metrics ---

export const reconciliationDriftTotal = new Counter({
  name: 'reconciliation_drift_total',
  help: 'Total reconciliation drift issues detected by type',
  labelNames: ['issue'],
  registers: [register],
});

export const reconciliationStatus = new Gauge({
  name: 'reconciliation_status',
  help: 'Reconciliation status: 1 = clean, 0 = drift detected',
  registers: [register],
});

export const reconciliationLastRunTimestamp = new Gauge({
  name: 'reconciliation_last_run_timestamp',
  help: 'Unix timestamp of the last automated reconciliation run',
  registers: [register],
});

export function recordReconciliationDrift(issue: string): void {
  reconciliationDriftTotal.inc({ issue });
}

export function setReconciliationStatus(clean: number): void {
  reconciliationStatus.set(clean);
}

export function setReconciliationLastRunTimestamp(unixSeconds: number): void {
  reconciliationLastRunTimestamp.set(unixSeconds);
}

// --- Endpoint SLO Metrics ---

export const endpointSloBreachTotal = new Counter({
  name: 'backend_slo_breach_total',
  help: 'Total endpoint SLO breach alerts emitted',
  labelNames: ['path', 'tier', 'type'],
  registers: [register],
});

export const endpointSloP95LatencyMs = new Gauge({
  name: 'backend_slo_p95_latency_ms',
  help: 'Current rolling P95 latency per endpoint in milliseconds',
  labelNames: ['path', 'tier', 'type'],
  registers: [register],
});

export const endpointSloBudgetMs = new Gauge({
  name: 'backend_slo_budget_ms',
  help: 'Configured P95 latency budget per endpoint in milliseconds',
  labelNames: ['path', 'tier', 'type'],
  registers: [register],
});

export const endpointSloBreach = new Gauge({
  name: 'backend_slo_breach',
  help: 'Endpoint SLO breach state: 1 = breaching, 0 = within budget',
  labelNames: ['path', 'tier', 'type'],
  registers: [register],
});

export function recordSloBreachAlert(path: string, tier: string, type: string): void {
  endpointSloBreachTotal.inc({ path, tier, type });
}

// --- Adaptive Throttle Metrics ---

export const adaptiveThrottleBlockCount = new Counter({
  name: 'adaptive_throttle_block_count',
  help: 'Total number of IPs blocked by adaptive throttle',
  labelNames: ['using_redis'],
  registers: [register],
});

export const adaptiveThrottleActiveBlocks = new Gauge({
  name: 'adaptive_throttle_active_blocks',
  help: 'Current number of IPs actively blocked by adaptive throttle',
  labelNames: ['using_redis'],
  registers: [register],
});

// --- Withdrawal Partial-Failure Recovery Metrics (Issue #954) ---

export const withdrawalSagaTotal = new Counter({
  name: 'withdrawal_saga_total',
  help: 'Terminal outcomes of multi-step withdrawal sagas',
  labelNames: ['plan', 'outcome'],
  registers: [register],
});

export const withdrawalSagaStepFailureTotal = new Counter({
  name: 'withdrawal_saga_step_failure_total',
  help: 'Withdrawal saga step failures by step and failure classification',
  labelNames: ['step', 'classification'],
  registers: [register],
});

export const withdrawalSagaCompensationTotal = new Counter({
  name: 'withdrawal_saga_compensation_total',
  help: 'Withdrawal saga compensating actions executed, by step and result',
  labelNames: ['step', 'result'],
  registers: [register],
});

export const withdrawalSagaRetryTotal = new Counter({
  name: 'withdrawal_saga_retry_total',
  help: 'Automated recovery passes over partially failed withdrawal sagas',
  labelNames: ['plan'],
  registers: [register],
});

export const withdrawalSagaAwaitingRecovery = new Gauge({
  name: 'withdrawal_saga_awaiting_recovery',
  help: 'Withdrawal sagas waiting for an automated recovery pass',
  registers: [register],
});

export const withdrawalSagaManualInterventionRequired = new Gauge({
  name: 'withdrawal_saga_manual_intervention_required',
  help: 'Withdrawal sagas with irreversible partial state awaiting an operator',
  registers: [register],
});

// --- Transfer Orchestration Metrics (Issue #1043) ---

export const transferOrchestrationTotal = new Counter({
  name: 'transfer_orchestration_total',
  help: 'Terminal outcomes of orchestrated vault transfers',
  labelNames: ['operation', 'outcome'],
  registers: [register],
});

export const transferOrchestrationReplayTotal = new Counter({
  name: 'transfer_orchestration_replay_total',
  help: 'Orchestrated transfers served from a stored idempotent result instead of re-submitting',
  labelNames: ['operation', 'replay_of'],
  registers: [register],
});

export const transferOrchestrationFailureTotal = new Counter({
  name: 'transfer_orchestration_failure_total',
  help: 'Orchestrated transfer submission failures by classification and error code',
  labelNames: ['operation', 'classification', 'code'],
  registers: [register],
});

export const transferOrchestrationDurationMs = new Histogram({
  name: 'transfer_orchestration_duration_ms',
  help: 'Wall-clock duration of an orchestrated transfer submission attempt in milliseconds',
  labelNames: ['operation', 'outcome'],
  buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000],
  registers: [register],
});

export const transferOrchestrationInDoubt = new Gauge({
  name: 'transfer_orchestration_in_doubt',
  help: 'Orchestrated transfers whose on-chain outcome is unknown and awaiting operator reconciliation',
  registers: [register],
});
