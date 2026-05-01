export type JobName = 'priceRefresh' | 'positionReconciliation' | 'reportGeneration';

export interface JobPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  backoffMultiplier: number;
  deadLetterThreshold: number;
}

export interface DeadLetterRecord {
  jobName: JobName;
  attempts: number;
  error: string;
  payload: unknown;
  failedAt: string;
}

export interface JobRuntimeMetric {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  inFlight: number;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastDurationMs: number | null;
  averageDurationMs: number;
}

export const JOB_POLICIES: Record<JobName, JobPolicy> = {
  priceRefresh: {
    maxAttempts: 3,
    baseDelayMs: 1000,
    backoffMultiplier: 2,
    deadLetterThreshold: 3,
  },
  positionReconciliation: {
    maxAttempts: 4,
    baseDelayMs: 2000,
    backoffMultiplier: 2,
    deadLetterThreshold: 2,
  },
  reportGeneration: {
    maxAttempts: 5,
    baseDelayMs: 5000,
    backoffMultiplier: 2,
    deadLetterThreshold: 2,
  },
};

class JobGovernanceStore {
  private readonly deadLetters: DeadLetterRecord[] = [];

  private readonly failureCounts = new Map<JobName, number>();

  private readonly runtime = new Map<JobName, JobRuntimeMetric>();

  markStarted(jobName: JobName): void {
    const metrics = this.ensureRuntimeMetric(jobName);
    metrics.totalRuns += 1;
    metrics.inFlight += 1;
    metrics.lastRunAt = new Date().toISOString();
  }

  markCompleted(jobName: JobName, durationMs: number, success: boolean): void {
    const metrics = this.ensureRuntimeMetric(jobName);
    metrics.inFlight = Math.max(0, metrics.inFlight - 1);
    metrics.lastDurationMs = durationMs;
    const completedRuns = metrics.successfulRuns + metrics.failedRuns;
    metrics.averageDurationMs =
      completedRuns === 0
        ? durationMs
        : Math.round(
            (metrics.averageDurationMs * completedRuns + durationMs) /
              (completedRuns + 1),
          );

    if (success) {
      metrics.successfulRuns += 1;
      metrics.lastSuccessAt = new Date().toISOString();
      return;
    }

    metrics.failedRuns += 1;
    metrics.lastFailureAt = new Date().toISOString();
  }

  recordDeadLetter(record: DeadLetterRecord): void {
    this.deadLetters.unshift(record);
    const failures = (this.failureCounts.get(record.jobName) || 0) + 1;
    this.failureCounts.set(record.jobName, failures);

    if (failures >= JOB_POLICIES[record.jobName].deadLetterThreshold) {
      console.warn(`Recurring failures detected for ${record.jobName}: ${failures}`);
    }
  }

  clear(): void {
    this.deadLetters.length = 0;
    this.failureCounts.clear();
    this.runtime.clear();
  }

  getMetrics() {
    const recurringFailures = Object.fromEntries(
      Array.from(this.failureCounts.entries()).filter(
        ([jobName, failures]) => failures >= JOB_POLICIES[jobName].deadLetterThreshold
      )
    ) as Partial<Record<JobName, number>>;

    return {
      totalDeadLetters: this.deadLetters.length,
      failureCounts: Object.fromEntries(this.failureCounts),
      recurringFailures,
      deadLetters: [...this.deadLetters],
      policies: JOB_POLICIES,
      runtime: Object.fromEntries(this.runtime),
    };
  }

  hasRecurringFailures(): boolean {
    return Object.keys(this.getMetrics().recurringFailures).length > 0;
  }

  private ensureRuntimeMetric(jobName: JobName): JobRuntimeMetric {
    const existing = this.runtime.get(jobName);
    if (existing) {
      return existing;
    }

    const created: JobRuntimeMetric = {
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      inFlight: 0,
      lastRunAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastDurationMs: null,
      averageDurationMs: 0,
    };

    this.runtime.set(jobName, created);
    return created;
  }
}

export const jobGovernanceStore = new JobGovernanceStore();

export async function runJobWithRetry<T>(
  jobName: JobName,
  task: () => Promise<T>,
  options: { payload?: unknown; sleep?: (delayMs: number) => Promise<void> } = {}
): Promise<T> {
  const startedAt = Date.now();
  jobGovernanceStore.markStarted(jobName);
  const policy = JOB_POLICIES[jobName];
  const sleep = options.sleep || defaultSleep;
  let lastError: unknown;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      const result = await task();
      jobGovernanceStore.markCompleted(jobName, Date.now() - startedAt, true);
      return result;
    } catch (error) {
      lastError = error;

      if (attempt < policy.maxAttempts) {
        await sleep(calculateBackoffDelay(policy, attempt));
      }
    }
  }

  const normalizedError = normalizeError(lastError);
  jobGovernanceStore.recordDeadLetter({
    jobName,
    attempts: policy.maxAttempts,
    error: normalizedError,
    payload: options.payload ?? null,
    failedAt: new Date().toISOString(),
  });
  jobGovernanceStore.markCompleted(jobName, Date.now() - startedAt, false);

  throw new Error(normalizedError);
}

export function getJobMetrics() {
  return jobGovernanceStore.getMetrics();
}

export function getJobHealthStatus(): 'up' | 'degraded' {
  return jobGovernanceStore.hasRecurringFailures() ? 'degraded' : 'up';
}

export function resetJobGovernance(): void {
  jobGovernanceStore.clear();
}

function calculateBackoffDelay(policy: JobPolicy, attempt: number): number {
  return Math.round(policy.baseDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1));
}

async function defaultSleep(delayMs: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown job failure';
}