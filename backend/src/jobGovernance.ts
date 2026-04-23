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
    };
  }

  hasRecurringFailures(): boolean {
    return Object.keys(this.getMetrics().recurringFailures).length > 0;
  }
}

export const jobGovernanceStore = new JobGovernanceStore();

export async function runJobWithRetry<T>(
  jobName: JobName,
  task: () => Promise<T>,
  options: { payload?: unknown; sleep?: (delayMs: number) => Promise<void> } = {}
): Promise<T> {
  const policy = JOB_POLICIES[jobName];
  const sleep = options.sleep || defaultSleep;
  let lastError: unknown;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      return await task();
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