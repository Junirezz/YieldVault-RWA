import crypto from 'crypto';
import { prisma } from './prisma';

export type JobName = 'priceRefresh' | 'positionReconciliation' | 'reportGeneration' | 'databaseBackup' | 'apySnapshot';

export type DeadLetterStatus = 'dead-letter' | 'processing' | 'resolved' | 'requeued' | 'discarded';

export interface JobPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  backoffMultiplier: number;
  deadLetterThreshold: number;
}

export interface DeadLetterRecord {
  id?: string;
  jobName: JobName;
  attempts: number;
  error: string;
  payload: unknown;
  failedAt: string;
  status?: DeadLetterStatus;
  retriedAt?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  notes?: string;
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

export type JobHandler<T = unknown> = (payload: any) => Promise<T>;

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
  databaseBackup: {
    maxAttempts: 3,
    baseDelayMs: 10000,
    backoffMultiplier: 2,
    deadLetterThreshold: 2,
  },
  apySnapshot: {
    maxAttempts: 3,
    baseDelayMs: 1000,
    backoffMultiplier: 2,
    deadLetterThreshold: 3,
  },
};

class JobGovernanceStore {
  private readonly deadLetters: DeadLetterRecord[] = [];

  private readonly failureCounts = new Map<JobName, number>();

  private readonly runtime = new Map<JobName, JobRuntimeMetric>();

  private readonly handlers = new Map<JobName, JobHandler>();

  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const persistedRecords = await prisma.jobDeadLetter.findMany({
        where: {
          status: { in: ['dead-letter', 'processing'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 1000, // Load recent records
      });

      for (const dbRecord of persistedRecords) {
        const record: DeadLetterRecord = {
          id: dbRecord.id,
          jobName: dbRecord.jobName as JobName,
          attempts: dbRecord.attempts,
          error: dbRecord.error,
          payload: dbRecord.payload ? JSON.parse(dbRecord.payload) : null,
          failedAt: dbRecord.failedAt.toISOString(),
          status: dbRecord.status as any,
          retriedAt: dbRecord.retriedAt?.toISOString(),
          resolvedAt: dbRecord.resolvedAt?.toISOString(),
          resolvedBy: dbRecord.resolvedBy ?? undefined,
          notes: dbRecord.notes ?? undefined,
        };

        this.deadLetters.push(record);
      }

      this.initialized = true;
      console.log(`Loaded ${persistedRecords.length} dead-letter records from database`);
    } catch (error) {
      console.error('Failed to initialize dead-letter records from database:', error);
      this.initialized = true; // Mark as initialized anyway to avoid retries
    }
  }

  registerHandler(jobName: JobName, handler: JobHandler): void {
    this.handlers.set(jobName, handler);
    this.ensureRuntimeMetric(jobName);
  }

  getHandler(jobName: JobName): JobHandler | undefined {
    return this.handlers.get(jobName);
  }

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

  recordDeadLetter(record: DeadLetterRecord): DeadLetterRecord {
    const fullRecord: DeadLetterRecord = {
      id: record.id ?? `dlq_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      status: record.status ?? 'dead-letter',
      ...record,
    };

    this.deadLetters.unshift(fullRecord);
    const failures = (this.failureCounts.get(fullRecord.jobName) || 0) + 1;
    this.failureCounts.set(fullRecord.jobName, failures);

    if (failures >= JOB_POLICIES[fullRecord.jobName].deadLetterThreshold) {
      console.warn(`Recurring failures detected for ${fullRecord.jobName}: ${failures}`);
    }

    // Persist to database asynchronously (fire-and-forget)
    void this.persistDeadLetterToDb(fullRecord);

    return fullRecord;
  }

  private async persistDeadLetterToDb(record: DeadLetterRecord): Promise<void> {
    try {
      await prisma.jobDeadLetter.create({
        data: {
          id: record.id,
          jobName: record.jobName,
          attempts: record.attempts,
          error: record.error,
          payload: record.payload ? JSON.stringify(record.payload) : null,
          failedAt: new Date(record.failedAt),
          status: record.status ?? 'dead-letter',
          retriedAt: record.retriedAt ? new Date(record.retriedAt) : null,
          resolvedAt: record.resolvedAt ? new Date(record.resolvedAt) : null,
          resolvedBy: record.resolvedBy,
          notes: record.notes,
        },
      });
    } catch (error) {
      console.error('Failed to persist dead-letter record to database:', error);
      // Continue operation even if persistence fails
    }
  }

  listDeadLetters(filters: {
    jobName?: JobName;
    status?: DeadLetterStatus | string;
    limit?: number;
    offset?: number;
  } = {}): { records: DeadLetterRecord[]; total: number } {
    let filtered = [...this.deadLetters];

    if (filters.jobName) {
      filtered = filtered.filter((item) => item.jobName === filters.jobName);
    }

    if (filters.status) {
      filtered = filtered.filter((item) => (item.status ?? 'dead-letter') === filters.status);
    }

    const total = filtered.length;
    const offset = Math.max(0, filters.offset ?? 0);
    const limit = Math.max(1, Math.min(filters.limit ?? 50, 500));
    const records = filtered.slice(offset, offset + limit);

    return { records, total };
  }

  getDeadLetterRecord(id: string): DeadLetterRecord | null {
    return this.deadLetters.find((item) => item.id === id) ?? null;
  }

  async retryDeadLetter(
    id: string,
    customTask?: () => Promise<unknown>
  ): Promise<{ success: boolean; result?: unknown; error?: string; record: DeadLetterRecord | null }> {
    const record = this.deadLetters.find((item) => item.id === id);
    if (!record) {
      return { success: false, error: 'Dead-letter record not found', record: null };
    }

    const handler = customTask || (this.handlers.get(record.jobName) ? () => this.handlers.get(record.jobName)!(record.payload) : null);

    if (!handler) {
      return {
        success: false,
        error: `No registered handler or custom task for job type '${record.jobName}'`,
        record,
      };
    }

    record.status = 'processing';
    const now = new Date().toISOString();
    record.retriedAt = now;

    try {
      const result = await runJobWithRetry(record.jobName, handler, { payload: record.payload });
      record.status = 'requeued';
      record.notes = `Successfully retried at ${now}`;
      
      // Update database
      void this.updateDeadLetterInDb(id, record);
      
      return { success: true, result, record };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      record.status = 'dead-letter';
      record.error = errorMsg;
      record.notes = `Retry attempt failed at ${now}: ${errorMsg}`;
      
      // Update database
      void this.updateDeadLetterInDb(id, record);
      
      return { success: false, error: errorMsg, record };
    }
  }

  private async updateDeadLetterInDb(id: string, record: DeadLetterRecord): Promise<void> {
    try {
      await prisma.jobDeadLetter.update({
        where: { id },
        data: {
          status: record.status,
          retriedAt: record.retriedAt ? new Date(record.retriedAt) : null,
          resolvedAt: record.resolvedAt ? new Date(record.resolvedAt) : null,
          resolvedBy: record.resolvedBy,
          notes: record.notes,
          error: record.error,
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      console.error('Failed to update dead-letter record in database:', error);
    }
  }

  resolveDeadLetter(id: string, actor = 'admin', notes?: string): DeadLetterRecord | null {
    const record = this.deadLetters.find((item) => item.id === id);
    if (!record) {
      return null;
    }

    const now = new Date().toISOString();
    record.status = 'resolved';
    record.resolvedAt = now;
    record.resolvedBy = actor;
    if (notes) {
      record.notes = notes;
    }

    // Update database
    void this.updateDeadLetterInDb(id, record);

    return record;
  }

  discardDeadLetter(id: string, _actor = 'admin'): DeadLetterRecord | null {
    const index = this.deadLetters.findIndex((item) => item.id === id);
    if (index === -1) {
      return null;
    }

    const [record] = this.deadLetters.splice(index, 1);
    record.status = 'discarded';
    
    // Update database
    void this.updateDeadLetterInDb(id, record);

    return record;
  }

  async bulkRetryDeadLetters(
    ids: string[]
  ): Promise<{ retried: number; failed: number; results: Array<{ id: string; success: boolean; error?: string }> }> {
    const results: Array<{ id: string; success: boolean; error?: string }> = [];
    let retried = 0;
    let failed = 0;

    for (const id of ids) {
      const outcome = await this.retryDeadLetter(id);
      if (outcome.success) {
        retried += 1;
        results.push({ id, success: true });
      } else {
        failed += 1;
        results.push({ id, success: false, error: outcome.error });
      }
    }

    return { retried, failed, results };
  }

  bulkDiscardDeadLetters(ids: string[]): { discarded: number; ids: string[] } {
    const discardedIds: string[] = [];
    for (const id of ids) {
      const result = this.discardDeadLetter(id);
      if (result) {
        discardedIds.push(id);
      }
    }
    return { discarded: discardedIds.length, ids: discardedIds };
  }

  async processDeadLetterQueue(batchSize = 10): Promise<{ processed: number; succeeded: number; failed: number }> {
    const pending = this.deadLetters.filter(
      (item) => item.status === 'dead-letter' && this.handlers.has(item.jobName)
    ).slice(0, batchSize);

    let succeeded = 0;
    let failed = 0;

    for (const item of pending) {
      if (!item.id) continue;
      const outcome = await this.retryDeadLetter(item.id);
      if (outcome.success) {
        succeeded += 1;
      } else {
        failed += 1;
      }
    }

    return { processed: pending.length, succeeded, failed };
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

  registerJob(jobName: JobName): void {
    this.ensureRuntimeMetric(jobName);
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

export function registerJobHandler(jobName: JobName, handler: JobHandler): void {
  jobGovernanceStore.registerHandler(jobName, handler);
}

export function listDeadLetters(filters?: {
  jobName?: JobName;
  status?: DeadLetterStatus | string;
  limit?: number;
  offset?: number;
}) {
  return jobGovernanceStore.listDeadLetters(filters);
}

export function getDeadLetterRecord(id: string) {
  return jobGovernanceStore.getDeadLetterRecord(id);
}

export async function retryDeadLetter(id: string, customTask?: () => Promise<unknown>) {
  return jobGovernanceStore.retryDeadLetter(id, customTask);
}

export function resolveDeadLetter(id: string, actor?: string, notes?: string) {
  return jobGovernanceStore.resolveDeadLetter(id, actor, notes);
}

export function discardDeadLetter(id: string, actor?: string) {
  return jobGovernanceStore.discardDeadLetter(id, actor);
}

export async function bulkRetryDeadLetters(ids: string[]) {
  return jobGovernanceStore.bulkRetryDeadLetters(ids);
}

export function bulkDiscardDeadLetters(ids: string[]) {
  return jobGovernanceStore.bulkDiscardDeadLetters(ids);
}

export async function processDeadLetterQueue(batchSize?: number) {
  return jobGovernanceStore.processDeadLetterQueue(batchSize);
}

export function getJobMetrics() {
  return jobGovernanceStore.getMetrics();
}

export function registerJob(jobName: JobName): void {
  jobGovernanceStore.registerJob(jobName);
}

export function getJobHealthStatus(): 'up' | 'degraded' {
  return jobGovernanceStore.hasRecurringFailures() ? 'degraded' : 'up';
}

export function resetJobGovernance(): void {
  jobGovernanceStore.clear();
}

export async function initializeJobGovernance(): Promise<void> {
  await jobGovernanceStore.initialize();
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
