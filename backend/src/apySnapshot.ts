/**
 * @file apySnapshot.ts
 * Nightly APY snapshot job for historical charting (Issue #374).
 *
 * Schedules a job that fires within 5 minutes of midnight UTC every day,
 * writes the current APY to the snapshot store, and exposes a query helper
 * for the history endpoint.
 *
 * The snapshot store is backed by the DatabaseManager (mocked in dev).
 * In a real application, the UPSERT query would target a `apy_snapshots`
 * Postgres table. The job can be disabled by setting APY_SNAPSHOT_ENABLED=false.
 *
 * Environment variables:
 *   APY_SNAPSHOT_INTERVAL_MS - interval in milliseconds between snapshot runs
 *                              (default: 3600000 = 1 hour)
 *
 * Retention: snapshots older than 90 days are pruned during each run.
 */

import { db } from './database';
import { logger } from './middleware/structuredLogging';
import { invalidateCache } from './middleware/cache';
import { runJobWithRetry, registerJob, registerJobHandler } from './jobGovernance';

registerJobHandler('apySnapshot', () => runApySnapshotJob());

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ApySnapshot {
  date: string; // YYYY-MM-DD (UTC)
  apy: number;  // percentage, e.g. 8.45
}

// ─── In-Memory Store (mirrors what the DB would hold) ────────────────────────

/** Map of YYYY-MM-DD → APY value. Used as DB-layer cache in the mock. */
const snapshotStore = new Map<string, number>();

const RETENTION_DAYS = 90;
const DEFAULT_SNAPSHOT_INTERVAL_MS = 3_600_000;

function getSnapshotIntervalMs(): number {
  const raw = process.env.APY_SNAPSHOT_INTERVAL_MS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  if (Number.isNaN(parsed) || parsed <= 0) {
    return DEFAULT_SNAPSHOT_INTERVAL_MS;
  }
  return parsed;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns today's date string in UTC (YYYY-MM-DD). */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Returns a date string N days before `from` (YYYY-MM-DD). */
export function dateMinusDays(from: string, days: number): string {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Adds one day to a YYYY-MM-DD string. */
function datePlusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── Core Logic ──────────────────────────────────────────────────────────────

/**
 * Reads the current APY from the vault contract (mocked).
 * Replace with a real Soroban RPC / contract call in production.
 */
async function fetchCurrentApy(): Promise<number> {
  // Mock: query the DB / RPC for the live APY gauge
  await db.query('SELECT apy FROM vault_metrics_snapshots ORDER BY recorded_at DESC LIMIT 1');
  // Return a realistic mock value between 6% and 12%
  const base = 8.5;
  const jitter = (Math.random() - 0.5) * 0.4;
  return parseFloat((base + jitter).toFixed(4));
}

/**
 * Persists an APY snapshot for the given date.
 * An UPSERT avoids duplicates when the job runs more than once on the same day.
 */
async function persistSnapshot(date: string, apy: number): Promise<void> {
  await db.query(
    `INSERT INTO apy_snapshots (date, apy)
     VALUES ($1, $2)
     ON CONFLICT (date) DO UPDATE SET apy = EXCLUDED.apy`,
    [date, apy],
  );
  snapshotStore.set(date, apy);
}

/**
 * Prunes snapshots older than RETENTION_DAYS from both the DB and in-memory store.
 */
async function pruneOldSnapshots(): Promise<void> {
  const cutoff = dateMinusDays(todayUtc(), RETENTION_DAYS);
  await db.query('DELETE FROM apy_snapshots WHERE date < $1', [cutoff]);

  for (const key of snapshotStore.keys()) {
    if (key < cutoff) snapshotStore.delete(key);
  }
}

/**
 * Runs the full snapshot job:
 * 1. Fetch current APY
 * 2. Persist snapshot for today
 * 3. Prune old snapshots
 */
export async function runApySnapshotJob(): Promise<void> {
  const date = todayUtc();
  logger.log('info', 'APY snapshot job started', { date });

  try {
    const apy = await fetchCurrentApy();
    await persistSnapshot(date, apy);
    await pruneOldSnapshots();

    // R5: invalidate APY cache entries after a successful snapshot
    invalidateCache('GET:/api/v1/vault/apy');

    logger.log('info', 'APY snapshot job completed', { date, apy });
  } catch (err) {
    logger.log('error', 'APY snapshot job failed', {
      date,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ─── Periodic Scheduler ─────────────────────────────────────────────────────

export function startApySnapshotScheduler(): () => void {
  const enabled = process.env.APY_SNAPSHOT_ENABLED !== 'false';
  if (!enabled) {
    logger.log('info', 'APY snapshot scheduler disabled via APY_SNAPSHOT_ENABLED=false');
    return () => {};
  }

  const intervalMs = getSnapshotIntervalMs();
  registerJob('apySnapshot');

  const timer = setInterval(() => {
    void runJobWithRetry('apySnapshot', runApySnapshotJob).catch((error) => {
      logger.log('error', 'APY snapshot scheduler encountered an error', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, intervalMs);

  logger.log('info', 'APY snapshot scheduler started', {
    intervalMs,
    nextRun: new Date(Date.now() + intervalMs).toISOString(),
  });

  return () => {
    clearInterval(timer);
    logger.log('info', 'APY snapshot scheduler stopped');
  };
}

// ─── Backfill ─────────────────────────────────────────────────────────────────

export interface BackfillResult {
  created: number;
  skipped: number;
  dates: string[];
}

/**
 * Backfills APY snapshots for all missing dates in [startDate, endDate] (inclusive).
 * Existing snapshots are not overwritten.
 */
export async function backfillApySnapshots(
  startDate: string,
  endDate: string,
): Promise<BackfillResult> {
  const start = Date.now();
  let created = 0;
  let skipped = 0;
  const createdDates: string[] = [];

  // Fetch existing snapshot dates in range to avoid duplicates
  const { rows } = await db.query<{ date: string }>(
    `SELECT date FROM apy_snapshots WHERE date >= $1 AND date <= $2`,
    [startDate, endDate],
  );
  const existing = new Set(rows.map((r) => r.date));
  for (const date of snapshotStore.keys()) {
    if (date >= startDate && date <= endDate) {
      existing.add(date);
    }
  }

  let cursor = startDate;
  while (cursor <= endDate) {
    if (existing.has(cursor)) {
      skipped += 1;
    } else {
      const apy = await fetchCurrentApy();
      await persistSnapshot(cursor, apy);
      createdDates.push(cursor);
      created += 1;
    }
    cursor = datePlusDays(cursor, 1);
  }

  const durationMs = Date.now() - start;
  logger.log('info', 'APY backfill completed', {
    startDate,
    endDate,
    created,
    skipped,
    durationMs,
  });

  return { created, skipped, dates: createdDates };
}

// ─── History Query ───────────────────────────────────────────────────────────

/**
 * Returns APY history for the last `days` days (default 30, max 365).
 * Missing days are backfilled with the most recent known value (not null).
 * Data is sourced from the in-memory store (populated by the job or seeded below).
 */
export async function getApyHistory(days: number = 30): Promise<ApySnapshot[]> {
  const clampedDays = Math.min(Math.max(1, days), RETENTION_DAYS);
  const today = todayUtc();

  // Attempt to hydrate from DB rows first
  const { rows } = await db.query<{ date: string; apy: number }>(
    `SELECT date, apy FROM apy_snapshots
     WHERE date >= $1 AND date <= $2
     ORDER BY date ASC`,
    [dateMinusDays(today, clampedDays - 1), today],
  );

  // Merge DB rows into local store
  for (const row of rows) {
    snapshotStore.set(row.date, row.apy);
  }

  // Build full date range and fill gaps with the last known value
  const result: ApySnapshot[] = [];
  let lastKnown: number | null = null;
  let cursor = dateMinusDays(today, clampedDays - 1);

  while (cursor <= today) {
    const stored = snapshotStore.get(cursor);
    if (stored !== undefined) {
      lastKnown = stored;
    }
    if (lastKnown !== null) {
      result.push({ date: cursor, apy: lastKnown });
    }
    cursor = datePlusDays(cursor, 1);
  }

  return result;
}
