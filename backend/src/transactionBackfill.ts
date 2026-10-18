import { getPrismaClient } from './prismaClient';
import { logger } from './middleware/structuredLogging';

export interface BackfillRequest {
  startLedger: number;
  endLedger: number;
  rpcUrl: string;
  contractId: string;
  batchSize?: number;
  dryRun?: boolean;
}

export interface BackfillProgress {
  totalLedgers: number;
  missingLedgers: number;
  scannedLedgers: number;
  insertedEvents: number;
  duplicateEvents: number;
}

export interface BackfillJob {
  id: string;
  key: string;
  startLedger: number;
  endLedger: number;
  batchSize: number;
  dryRun: boolean;
  status: 'running' | 'completed' | 'failed';
  progress: BackfillProgress;
  createdAt: string;
  updatedAt: string;
  error?: string;
  lastProcessedLedger?: number;
}

interface StellarEvent {
  id: string;
  type: string;
  ledger: number;
  contractId: string;
  txHash: string;
}

const jobs = new Map<string, BackfillJob>();
const jobsByKey = new Map<string, string>();
let hydrationPromise: Promise<void> | null = null;

const DEFAULT_BATCH_SIZE = 50;
export const MAX_BATCH_SIZE = 500;
export const MAX_LEDGER_RANGE = 20000;

function getRetentionDays(): number {
  return parseInt(process.env.BACKFILL_JOB_RETENTION_DAYS || '30', 10);
}

function nowIso(): string {
  return new Date().toISOString();
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function jobKey(input: BackfillRequest): string {
  return `${input.contractId}:${input.startLedger}-${input.endLedger}:${input.dryRun ? 'dry' : 'live'}`;
}

function mapDbJob(row: {
  id: string;
  jobKey: string;
  startLedger: number;
  endLedger: number;
  batchSize: number;
  dryRun: boolean;
  status: string;
  progressJson: string;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastProcessedLedger: number | null;
}): BackfillJob {
  let progress: BackfillProgress = {
    totalLedgers: row.endLedger - row.startLedger + 1,
    missingLedgers: 0,
    scannedLedgers: 0,
    insertedEvents: 0,
    duplicateEvents: 0,
  };

  try {
    progress = JSON.parse(row.progressJson) as BackfillProgress;
  } catch {
    // keep defaults
  }

  return {
    id: row.id,
    key: row.jobKey,
    startLedger: row.startLedger,
    endLedger: row.endLedger,
    batchSize: row.batchSize,
    dryRun: row.dryRun,
    status: row.status as BackfillJob['status'],
    progress,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    error: row.errorMessage ?? undefined,
    lastProcessedLedger: row.lastProcessedLedger ?? undefined,
  };
}

async function ensureJobsHydrated(): Promise<void> {
  if (!hydrationPromise) {
    hydrationPromise = hydrateJobsFromDatabase();
  }
  await hydrationPromise;
}

async function hydrateJobsFromDatabase(): Promise<void> {
  try {
    const rows = await getPrismaClient().transactionBackfillJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    for (const row of rows) {
      const job = mapDbJob(row);
      jobs.set(job.id, job);
      jobsByKey.set(job.key, job.id);
    }
  } catch (error) {
    logger.log('warn', 'Failed to hydrate transaction backfill jobs', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function persistJob(job: BackfillJob, rpcUrl: string, contractId: string): Promise<void> {
  try {
    await getPrismaClient().transactionBackfillJob.upsert({
      where: { id: job.id },
      update: {
        status: job.status,
        progressJson: JSON.stringify(job.progress),
        errorMessage: job.error ?? null,
        lastProcessedLedger: job.lastProcessedLedger ?? null,
        updatedAt: new Date(job.updatedAt),
        completedAt: job.status === 'completed' || job.status === 'failed'
          ? new Date(job.updatedAt)
          : null,
      },
      create: {
        id: job.id,
        jobKey: job.key,
        startLedger: job.startLedger,
        endLedger: job.endLedger,
        batchSize: job.batchSize,
        dryRun: job.dryRun,
        status: job.status,
        rpcUrl,
        contractId,
        progressJson: JSON.stringify(job.progress),
        errorMessage: job.error ?? null,
        lastProcessedLedger: job.lastProcessedLedger ?? null,
        createdAt: new Date(job.createdAt),
        updatedAt: new Date(job.updatedAt),
        completedAt: job.status === 'completed' || job.status === 'failed'
          ? new Date(job.updatedAt)
          : null,
      },
    });
  } catch (error) {
    logger.log('warn', 'Failed to persist transaction backfill job', {
      error: error instanceof Error ? error.message : String(error),
      jobId: job.id,
    });
  }
}

async function fetchEventsForRange(
  rpcUrl: string,
  contractId: string,
  startLedger: number,
  endLedger: number
): Promise<StellarEvent[]> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getEvents',
      params: {
        startLedger,
        filters: [
          {
            type: 'contract',
            contractIds: [contractId],
          },
        ],
        pagination: {
          limit: 1000,
        },
      },
    }),
  });

  const body = await response.json();
  const events = body?.result?.events ?? [];

  return events
    .filter((event: any) => event.ledger >= startLedger && event.ledger <= endLedger)
    .map((event: any) => ({
      id: String(event.id),
      type: String(event.type || 'unknown'),
      ledger: Number(event.ledger || 0),
      contractId: String(event.contractId || contractId),
      txHash: String(event.txHash || ''),
    }));
}

async function getMissingLedgers(startLedger: number, endLedger: number): Promise<number[]> {
  const rows = await getPrismaClient().processedEvent.findMany({
    where: {
      ledgerSeq: {
        gte: startLedger,
        lte: endLedger,
      },
    },
    select: { ledgerSeq: true },
  });

  const indexed = new Set(rows.map((row) => row.ledgerSeq));
  const missing: number[] = [];

  for (let ledger = startLedger; ledger <= endLedger; ledger += 1) {
    if (!indexed.has(ledger)) {
      missing.push(ledger);
    }
  }

  return missing;
}

function createJob(input: BackfillRequest, key: string, missingLedgers: number[], batchSize: number): BackfillJob {
  const createdAt = nowIso();
  return {
    id: `bf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    key,
    startLedger: input.startLedger,
    endLedger: input.endLedger,
    batchSize,
    dryRun: Boolean(input.dryRun),
    status: 'running',
    progress: {
      totalLedgers: input.endLedger - input.startLedger + 1,
      missingLedgers: missingLedgers.length,
      scannedLedgers: 0,
      insertedEvents: 0,
      duplicateEvents: 0,
    },
    createdAt,
    updatedAt: createdAt,
  };
}

async function touchJob(job: BackfillJob, rpcUrl: string, contractId: string): Promise<void> {
  job.updatedAt = nowIso();
  jobs.set(job.id, job);
  await persistJob(job, rpcUrl, contractId);
}

async function runBackfillProcessing(
  job: BackfillJob,
  input: BackfillRequest,
  missingLedgers: number[],
  batchSize: number,
): Promise<BackfillJob> {
  try {
    if (!input.dryRun && missingLedgers.length > 0) {
      const resumeAfter = job.lastProcessedLedger ?? 0;
      const ledgersToScan = missingLedgers.filter((ledger) => ledger > resumeAfter);

      for (const ledgerChunk of chunk(ledgersToScan, batchSize)) {
        const startLedger = ledgerChunk[0];
        const endLedger = ledgerChunk[ledgerChunk.length - 1];
        const events = await fetchEventsForRange(
          input.rpcUrl,
          input.contractId,
          startLedger,
          endLedger
        );

        for (const event of events) {
          const existing = await getPrismaClient().processedEvent.findUnique({ where: { id: event.id } });
          if (existing) {
            job.progress.duplicateEvents += 1;
          } else {
            await getPrismaClient().processedEvent.create({
              data: {
                id: event.id,
                ledgerSeq: event.ledger,
                eventType: event.type,
                contractId: event.contractId,
                txHash: event.txHash,
              },
            });
            job.progress.insertedEvents += 1;
          }
        }

        job.progress.scannedLedgers += ledgerChunk.length;
        job.lastProcessedLedger = endLedger;
        await touchJob(job, input.rpcUrl, input.contractId);
      }
    } else {
      job.progress.scannedLedgers = job.progress.missingLedgers;
      await touchJob(job, input.rpcUrl, input.contractId);
    }

    job.status = 'completed';
    await touchJob(job, input.rpcUrl, input.contractId);
    return job;
  } catch (error) {
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : String(error);
    await touchJob(job, input.rpcUrl, input.contractId);

    logger.log('error', 'Transaction backfill failed', {
      jobId: job.id,
      error: job.error,
      startLedger: job.startLedger,
      endLedger: job.endLedger,
    });

    return job;
  }
}

export async function createOrResumeTransactionBackfill(input: BackfillRequest): Promise<BackfillJob> {
  await ensureJobsHydrated();

  if (!Number.isInteger(input.startLedger) || !Number.isInteger(input.endLedger)) {
    throw new Error('startLedger and endLedger must be integers');
  }
  if (input.startLedger <= 0 || input.endLedger <= 0) {
    throw new Error('startLedger and endLedger must be greater than 0');
  }
  if (input.endLedger < input.startLedger) {
    throw new Error('endLedger must be greater than or equal to startLedger');
  }

  const range = input.endLedger - input.startLedger + 1;
  if (range > MAX_LEDGER_RANGE) {
    throw new Error(`ledger range exceeds maximum of ${MAX_LEDGER_RANGE}`);
  }

  const batchSize = Math.min(Math.max(input.batchSize || DEFAULT_BATCH_SIZE, 1), MAX_BATCH_SIZE);
  const key = jobKey(input);

  const previousId = jobsByKey.get(key);
  if (previousId) {
    const existing = jobs.get(previousId);
    if (existing && existing.status === 'running') {
      return existing;
    }
    if (existing && existing.status === 'completed') {
      return existing;
    }
    if (existing && existing.status === 'failed') {
      existing.status = 'running';
      existing.error = undefined;
      await touchJob(existing, input.rpcUrl, input.contractId);
      return runBackfillProcessing(existing, input, await getMissingLedgers(input.startLedger, input.endLedger), batchSize);
    }
  }

  const missingLedgers = await getMissingLedgers(input.startLedger, input.endLedger);
  const job = createJob(input, key, missingLedgers, batchSize);
  jobs.set(job.id, job);
  jobsByKey.set(key, job.id);
  await persistJob(job, input.rpcUrl, input.contractId);

  return runBackfillProcessing(job, input, missingLedgers, batchSize);
}

export async function getTransactionBackfillJob(jobId: string): Promise<BackfillJob | null> {
  await ensureJobsHydrated();
  return jobs.get(jobId) || null;
}

export async function listTransactionBackfillJobs(limit: number = 20): Promise<BackfillJob[]> {
  await ensureJobsHydrated();
  return Array.from(jobs.values())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.max(1, Math.min(limit, 200)));
}

export async function pruneOldBackfillJobs(): Promise<number> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - getRetentionDays());

  try {
    const result = await getPrismaClient().transactionBackfillJob.deleteMany({
      where: {
        createdAt: { lt: cutoff },
        status: { in: ['completed', 'failed'] },
      },
    });
    return result.count;
  } catch (error) {
    logger.log('warn', 'Failed to prune old backfill jobs', {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

export function resetTransactionBackfillJobsForTests(): void {
  jobs.clear();
  jobsByKey.clear();
  hydrationPromise = null;
}
