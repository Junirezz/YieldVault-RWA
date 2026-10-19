/**
 * @file eventOutbox.ts
 * Outbox pattern implementation for reliable event publishing.
 *
 * The outbox pattern ensures reliable, at-least-once event delivery by:
 * 1. Writing events to an outbox table as part of the same DB transaction as
 *    the business operation (atomic persistence).
 * 2. A background relay processor reads pending events from the outbox and
 *    delivers them to downstream consumers (webhooks).
 * 3. After successful delivery, the event is marked as "relayed".
 * 4. Failed events are retried up to maxAttempts, then moved to dead_letter.
 *
 * This guarantees that events are NEVER lost when the publishing process
 * crashes between persisting business state and dispatching the event.
 *
 * Lease & fencing (issue #1557)
 * -----------------------------
 * `lockedAt`/`lockedBy` form a *lease*, not a permanent claim. A relay worker
 * claims rows by writing `lockedAt = now` and `lockedBy = instanceId`; the
 * lease expires `OUTBOX_LOCK_TIMEOUT_MS` (default 60s) later. A crashed worker
 * therefore cannot strand a row forever:
 *
 *   - `reapStuckRelays()` clears leases older than the timeout (and runs at the
 *     start of every relay cycle as well as on its own timer).
 *   - Completion writes are conditional on the exact `(lockedBy, lockedAt)`
 *     pair observed when the row was claimed. If another worker re-claimed the
 *     row in the meantime, the update matches zero rows and the stale worker
 *     skips the write. The claim timestamp is the fencing token: it changes on
 *     every re-claim, so a stale worker cannot overwrite a newer attempt.
 */

import crypto from 'crypto';
import { prisma } from './prisma';
import { logger } from './middleware/structuredLogging';
import {
  emitTransactionEvent,
  type TransactionEventType,
  type TransactionEventPayload,
} from './webhookDelivery';

// ─── Prisma Access ───────────────────────────────────────────────────────────

/**
 * Lazily resolves the Prisma client. Importing `prisma` at module load time is
 * fragile: depending on the runtime path (tests, hot-reload, partially
 * initialized client) the binding can be undefined, causing confusing
 * `Cannot read properties of undefined` errors deep inside fire-and-forget
 * writes. Resolving at call time makes the failure mode explicit.
 */
function getPrismaClient() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { prisma } = require('./prisma') as typeof import('./prisma');
  return prisma;
}

function getEventOutboxDelegate() {
  const prisma = getPrismaClient();
  const delegate = prisma?.eventOutbox;
function getPrisma() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { prisma } = require('./prisma') as typeof import('./prisma');
  if (!prisma) {
    throw new Error(
      'Prisma client is not initialized. Ensure `prisma generate` has run and the client is instantiated before use.',
    );
  }
  return prisma;
}

/**
 * Resolves the `eventOutbox` delegate and fails with a clear message when the
 * generated client is stale or a mocked client is missing the model.
 */
function getEventOutboxDelegate() {
  const delegate = getPrisma()?.eventOutbox;
  if (!delegate) {
    throw new Error(
      'Prisma client is not initialized or missing the `eventOutbox` delegate. ' +
        'Ensure `prisma generate` has run and the client is instantiated before use.',
    );
  }
  return delegate;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type OutboxEventStatus = 'pending' | 'relayed' | 'failed' | 'dead_letter';

export type OutboxAggregateType = 'transaction' | 'vault';

export interface EventOutboxRecord {
  id: string;
  eventType: TransactionEventType;
  payload: TransactionEventPayload;
  status: OutboxEventStatus;
  aggregateType: OutboxAggregateType;
  aggregateId: string;
  vaultId: string | null;
  sequence: number;
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
  /**
   * Fencing token for the current lease (`${lockedBy}:${lockedAt epoch ms}`).
   * `null` when the row is not leased. Changes on every re-claim, so consumers
   * can detect a stale worker attempting to finish an old lease.
   */
  leaseToken: string | null;
  createdAt: string;
  updatedAt: string;
  relayedAt: string | null;
}

export interface OutboxWriteInput {
  eventType: TransactionEventType;
  payload: TransactionEventPayload;
  aggregateType: OutboxAggregateType;
  aggregateId: string;
  vaultId?: string;
  maxAttempts?: number;
}

export interface OutboxRelayResult {
  relayed: number;
  failed: number;
  deadLettered: number;
  errors: string[];
}

export interface OutboxMetrics {
  pending: number;
  relayed: number;
  failed: number;
  deadLettered: number;
  locked: number;
  total: number;
  oldestPendingAgeSeconds: number;
}

// ─── Configuration ───────────────────────────────────────────────────────────

function getPollIntervalMs(): number {
  const parsed = parseInt(process.env.OUTBOX_POLL_INTERVAL_MS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2000;
}

function getBatchSize(): number {
  const parsed = parseInt(process.env.OUTBOX_BATCH_SIZE || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
}

/**
 * Lease duration for a claimed row. Exposed so operators/tests can shorten it
 * and so the reaper and claim logic always agree on the boundary.
 */
export function getOutboxLeaseMs(): number {
  const parsed = parseInt(process.env.OUTBOX_LOCK_TIMEOUT_MS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60000;
}

/** Backwards-compatible alias for the lease duration. */
function getLockTimeoutMs(): number {
  return getOutboxLeaseMs();
}

function getMaxAttempts(): number {
  const parsed = parseInt(process.env.OUTBOX_MAX_ATTEMPTS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

function getRetentionMs(): number {
  const parsed = parseInt(process.env.OUTBOX_RETENTION_MS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 7 * 24 * 60 * 60 * 1000; // 7 days
}

function getReaperIntervalMs(): number {
  const parsed = parseInt(process.env.OUTBOX_REAPER_INTERVAL_MS || '', 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  // Reap at least twice per lease window so stuck rows recover promptly.
  return Math.max(1000, Math.floor(getOutboxLeaseMs() / 2));
}

/** Unique instance identifier for distributed locking. */
function getInstanceId(): string {
  return process.env.OUTBOX_INSTANCE_ID || `instance-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Builds the fencing token for a lease. The claim timestamp (millisecond
 * precision) is included so every re-claim produces a different token.
 */
export function buildOutboxLeaseToken(
  lockedBy: string | null | undefined,
  lockedAt: Date | string | null | undefined,
): string | null {
  if (!lockedBy || !lockedAt) return null;
  const millis = lockedAt instanceof Date ? lockedAt.getTime() : Date.parse(String(lockedAt));
  if (!Number.isFinite(millis)) return null;
  return `${lockedBy}:${millis}`;
}

/**
 * Throws if the Prisma client has no `eventOutbox` model delegate (e.g. a stale
 * generated client or a mocked client missing the model). Without this guard
 * the failure surfaces as a `Cannot read properties of undefined` TypeError
 * deep inside fire-and-forget writes, where callers only log it.
 */
export function assertEventOutboxModelAvailable(client?: unknown): void {
  const target = (client ?? getPrismaClient()) as { eventOutbox?: { create?: unknown } } | null | undefined;
  const delegate = target?.eventOutbox;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { prisma } = require('./prisma') as typeof import('./prisma');
  const c = client ?? prisma;
  const delegate = (c as { eventOutbox?: { create?: unknown } } | null | undefined)?.eventOutbox;
  const resolved = client ?? getPrisma();
  const delegate = (resolved as { eventOutbox?: { create?: unknown } } | null | undefined)
    ?.eventOutbox;
  if (!delegate || typeof delegate.create !== 'function') {
    throw new Error(
      'Prisma client is missing the eventOutbox model. Run `prisma generate` and ensure the EventOutbox migration is applied.',
    );
  }
}

// ─── Service ─────────────────────────────────────────────────────────────────

class EventOutboxService {
  private isRunning = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private reaperTimer: NodeJS.Timeout | null = null;
  private instanceId: string;
  private inFlight: Promise<unknown> | null = null;
  private abortCleanup: (() => void) | null = null;
  private signal: AbortSignal | undefined;

  constructor() {
    this.instanceId = getInstanceId();
  }

  /** Instance identifier used as the lease owner. */
  getInstanceId(): string {
    return this.instanceId;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Writes an event to the outbox table.
   * This should be called within the same transaction boundary as the business
   * operation (e.g., inside a Prisma $transaction) to ensure atomic persistence.
   */
  async writeEvent(input: OutboxWriteInput): Promise<EventOutboxRecord> {
    assertEventOutboxModelAvailable();
    const now = new Date();
    const vaultId = input.vaultId ?? input.aggregateId;
    const record = await getEventOutboxDelegate().create({
      data: {
        id: `obx-${crypto.randomUUID()}`,
        eventType: input.eventType,
        payload: JSON.stringify(input.payload),
        status: 'pending',
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        sequence: await this.nextSequenceForVault(vaultId),
        attemptCount: 0,
        maxAttempts: input.maxAttempts ?? getMaxAttempts(),
        createdAt: now,
        updatedAt: now,
      },
    });

    return this.toRecord(record);
  }

  /**
   * Processes pending events from the outbox table.
   *
   * The cycle first reaps expired leases, then claims eligible rows with a
   * conditional update. Completion writes are fenced on the claim timestamp so
   * a worker whose lease expired mid-delivery cannot overwrite the state of the
   * worker that re-claimed the row.
   */
  async processOutbox(batchSize?: number, signal?: AbortSignal): Promise<OutboxRelayResult> {
    const limit = batchSize ?? getBatchSize();
    const now = new Date();
    const lockExpiry = new Date(now.getTime() - getLockTimeoutMs());

    const result: OutboxRelayResult = {
      relayed: 0,
      failed: 0,
      deadLettered: 0,
      errors: [],
    };

    try {
      // 0. Return crashed workers' leases to the pool before selecting work.
      await this.reapStuckRelays(now).catch((err) => {
        logger.log('warn', 'Outbox lease reaper failed during relay cycle', {
          error: err instanceof Error ? err.message : String(err),
        });
      });

      // 1. Find eligible entries: pending or failed entries whose lock is
      //    expired. Order by (vaultId, sequence, createdAt) so per-vault
      //    ordering is preserved and events for different vaults do not block
      //    each other.
      // 1. Find eligible entries: pending or failed entries whose lock is expired.
      //    Order by (vaultId, sequence, createdAt) so per-vault ordering is
      //    preserved and events for different vaults do not block each other.
      //    We select the head-of-line event per vault to enforce strict
      //    per-vault ordering (a vault's next event is only processed after
      //    its predecessor has been relayed or dead-lettered).
      // 1. Find eligible entries: pending or failed entries whose lock is expired
      const candidates = await getEventOutboxDelegate().findMany({
        where: {
          status: { in: ['pending', 'failed'] },
          OR: [{ lockedAt: null }, { lockedAt: { lt: lockExpiry } }],
        },
        orderBy: [
          { aggregateId: 'asc' },
          { sequence: 'asc' },
          { createdAt: 'asc' },
        ],
        orderBy: [{ vaultId: 'asc' }, { sequence: 'asc' }, { createdAt: 'asc' }],
        take: limit,
      });

      if (candidates.length === 0) {
        return result;
      }

      // 1b. Enforce per-vault head-of-line blocking: for each vault, only
      //     process the lowest-sequence eligible event. This guarantees a
      //     consumer tracking vault.version never observes sequence N+1
      //     before sequence N for the same vault.
      const headOfLine = new Map<string, (typeof candidates)[number]>();
      for (const c of candidates) {
        const key = c.aggregateId;
      for (const candidate of candidates) {
        const key = candidate.vaultId ?? candidate.aggregateId;
        const existing = headOfLine.get(key);
        if (!existing || candidate.sequence < existing.sequence) {
          headOfLine.set(key, candidate);
        }
      }
      const orderedCandidates = Array.from(headOfLine.values()).sort((a, b) => {
        const va = a.aggregateId;
        const vb = b.aggregateId;
        if (va !== vb) return va < vb ? -1 : 1;
        return a.sequence - b.sequence;
      });

      // 2. Claim the selected entries. The guard re-checks that nobody else
      //    claimed them between the read and the write.
      const candidateIds = orderedCandidates.map((entry) => entry.id);
      // 2. Lock the claimed entries by updating lockedAt/lockedBy in bulk
      const candidateIds = orderedCandidates.map((e) => e.id);
      await getEventOutboxDelegate().updateMany({
        where: {
          id: { in: candidateIds },
          status: { in: ['pending', 'failed'] },
          OR: [{ lockedAt: null }, { lockedAt: { lt: lockExpiry } }],
        },
        data: {
          lockedAt: now,
          lockedBy: this.instanceId,
        },
      });

      // 3. Re-fetch only the rows this instance actually claimed. `lockedAt`
      //    is the fencing token: a row claimed by another instance is skipped.
      const entries = await getEventOutboxDelegate().findMany({
        where: {
          id: { in: candidateIds },
          lockedBy: this.instanceId,
          lockedAt: now,
        },
        orderBy: [
          { aggregateId: 'asc' },
          { sequence: 'asc' },
          { createdAt: 'asc' },
        ],
        orderBy: [{ vaultId: 'asc' }, { sequence: 'asc' }, { createdAt: 'asc' }],
      });

      if (entries.length === 0) {
        return result;
      }

      // 4. Relay each entry.
      for (const entry of entries) {
        if (signal?.aborted) break;
        const claimToken = this.leaseTokenFor(entry.lockedBy, entry.lockedAt);
        try {
          const payload = JSON.parse(entry.payload) as TransactionEventPayload;
          // emitTransactionEvent schedules webhook deliveries asynchronously.
          // Awaiting it ensures relayed/retry decisions happen after the event
          // is queued for delivery, not before.
          const deliveredCount = await emitTransactionEvent(
            entry.eventType as TransactionEventType,
            payload,
          );

          // Do not write the mark-as-sent update after abort; the event will be
          // re-relayed after restart (at-least-once delivery).
          if (signal?.aborted) break;

          const fenced = await this.fencedUpdate(entry.id, claimToken, {
            status: 'relayed',
            attemptCount: { increment: 1 },
            relayedAt: new Date(),
            lockedAt: null,
            lockedBy: null,
            lastError: null,
          await getEventOutboxDelegate().update({
            where: { id: entry.id },
            data: {
              status: 'relayed',
              attemptCount: { increment: 1 },
              relayedAt: new Date(),
              lockedAt: null,
              lockedBy: null,
              lastError: null,
            },
          });

          if (!fenced) {
            logger.log('warn', 'Outbox relay result discarded: lease was re-claimed (fencing)', {
              outboxId: entry.id,
              eventType: entry.eventType,
              staleLeaseToken: claimToken,
            });
            continue;
          }

          result.relayed++;
          logger.log('info', 'Outbox event relayed', {
            outboxId: entry.id,
            eventType: entry.eventType,
            aggregateType: entry.aggregateType,
            aggregateId: entry.aggregateId,
            sequence: entry.sequence,
            deliveredCount,
            leaseToken: claimToken,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const nextAttempt = entry.attemptCount + 1;

          if (signal?.aborted) break;

          if (nextAttempt >= entry.maxAttempts) {
            const fenced = await this.fencedUpdate(entry.id, claimToken, {
              status: 'dead_letter',
              attemptCount: nextAttempt,
              lastError: errorMessage,
              lockedAt: null,
              lockedBy: null,
            });

            if (!fenced) continue;

            result.deadLettered++;
            result.errors.push(`[${entry.id}] Dead-letter: ${errorMessage}`);

            logger.log('warn', 'Outbox event moved to dead-letter after exhausting retries', {
              outboxId: entry.id,
              eventType: entry.eventType,
              attempts: nextAttempt,
              maxAttempts: entry.maxAttempts,
              error: errorMessage,
            });
            void this.sendDeadLetterAlert(entry.id, entry.eventType, nextAttempt, errorMessage);
          } else {
            const fenced = await this.fencedUpdate(entry.id, claimToken, {
              status: 'failed',
              attemptCount: nextAttempt,
              lastError: errorMessage,
              lockedAt: null,
              lockedBy: null,
            });

            if (!fenced) continue;

            result.failed++;
            result.errors.push(
              `[${entry.id}] Failed (${nextAttempt}/${entry.maxAttempts}): ${errorMessage}`,
            );

            logger.log('warn', 'Outbox event relay failed, will retry', {
              outboxId: entry.id,
              eventType: entry.eventType,
              attempt: nextAttempt,
              maxAttempts: entry.maxAttempts,
              error: errorMessage,
            });
          }
        }
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.log('error', 'Outbox processor error', {
        error: errorMessage,
      });
      result.errors.push(`Processor error: ${errorMessage}`);
      return result;
    }
  }

  /**
   * Releases leases held past their expiry, returning stranded rows to the
   * pending/failed pool. Safe to run concurrently: the `lockedAt < cutoff`
   * guard means only genuinely expired leases are touched.
   *
   * @returns number of rows whose lease was released.
   */
  async reapStuckRelays(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - getOutboxLeaseMs());

    const stuck = await getEventOutboxDelegate().findMany({
      where: {
        status: { in: ['pending', 'failed'] },
        lockedAt: { lt: cutoff },
      },
      select: { id: true, eventType: true, lockedBy: true, lockedAt: true },
    });

    if (stuck.length === 0) return 0;

    const result = await getEventOutboxDelegate().updateMany({
      where: {
        id: { in: stuck.map((row) => row.id) },
        status: { in: ['pending', 'failed'] },
        lockedAt: { lt: cutoff },
      },
      data: {
        lockedAt: null,
        lockedBy: null,
      },
    });

    if (result.count > 0) {
      logger.log('warn', 'Reaped stuck outbox relay leases', {
        action: 'outbox_lease_reaper',
        reclaimed: result.count,
        candidates: stuck.length,
        leaseMs: getOutboxLeaseMs(),
        releasedLeases: stuck.map((row) => ({
          outboxId: row.id,
          eventType: row.eventType,
          lockedBy: row.lockedBy,
          leaseToken: this.leaseTokenFor(row.lockedBy, row.lockedAt),
        })),
      });
    }

    return result.count;
  }

  /**
   * Applies an update only if this worker still owns the exact lease it
   * claimed. Returns `false` when the lease was stolen/reclaimed (fencing).
   */
  private async fencedUpdate(
    id: string,
    claimToken: string | null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any,
  ): Promise<boolean> {
    if (!claimToken) return false;

    // Encode both halves of the token in the guard. Extract the timestamp from
    // the token so Prisma can compare the DateTime column.
    const separator = claimToken.lastIndexOf(':');
    const lockedBy = claimToken.slice(0, separator);
    const lockedAtMs = Number(claimToken.slice(separator + 1));
    if (!lockedBy || !Number.isFinite(lockedAtMs)) return false;

    const result = await getEventOutboxDelegate().updateMany({
      where: {
        id,
        lockedBy,
        lockedAt: new Date(lockedAtMs),
      },
      data,
    });

    return result.count === 1;
  }

  private async sendDeadLetterAlert(
    outboxId: string,
    eventType: string,
    attempts: number,
    error: string,
  ): Promise<void> {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL || process.env.ALERT_WEBHOOK_URL;
    if (!webhookUrl) return;

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          text: `:rotating_light: *YieldVault Outbox Dead-Lettered*\nEvent \`${eventType}\` (ID: ${outboxId}) failed after ${attempts} attempts.\nLatest error: \`${error}\``,
        }),
      });
    } catch (err) {
      logger.log('error', 'Failed to send outbox dead-letter alert', {
        error: err instanceof Error ? err.message : String(err),
        outboxId,
        eventType,
      });
    }
  }

  /**
   * Retries a specific dead-lettered event by resetting its status to pending.
   */
  async retryDeadLetter(outboxId: string): Promise<EventOutboxRecord | null> {
    const entry = await getEventOutboxDelegate().findUnique({ where: { id: outboxId } });
    if (!entry || entry.status !== 'dead_letter') {
      return null;
    }

    const updated = await getEventOutboxDelegate().update({
      where: { id: outboxId },
      data: {
        status: 'pending',
        attemptCount: 0,
        lastError: null,
        lockedAt: null,
        lockedBy: null,
      },
    });

    logger.log('info', 'Outbox dead-letter entry reset to pending for retry', {
      outboxId,
      eventType: entry.eventType,
    });

    return this.toRecord(updated);
  }

  /**
   * Cleans up old relayed and dead-letter entries beyond the retention period.
   */
  async cleanup(maxAgeMs?: number): Promise<number> {
    const cutoff = new Date(Date.now() - (maxAgeMs ?? getRetentionMs()));

    const result = await getEventOutboxDelegate().deleteMany({
      where: {
        createdAt: { lt: cutoff },
        status: { in: ['relayed', 'dead_letter'] },
      },
    });

    if (result.count > 0) {
      logger.log('info', 'Outbox cleanup completed', {
        removedCount: result.count,
        cutoffAgeMs: maxAgeMs ?? getRetentionMs(),
      });
    }

    return result.count;
  }

  /**
   * Replays pending events from the outbox on startup.
   * Used to recover events that were written but not relayed before a crash.
   */
  async replayOnStartup(): Promise<OutboxRelayResult> {
    assertEventOutboxModelAvailable();
    const pendingCount = await getEventOutboxDelegate().count({
      where: { status: { in: ['pending', 'failed'] } },
    });

    if (pendingCount === 0) {
      logger.log('info', 'No pending outbox events to replay on startup');
      return { relayed: 0, failed: 0, deadLettered: 0, errors: [] };
    }

    logger.log('info', 'Replaying pending outbox events on startup', {
      pendingCount,
    });

    return this.processOutbox(pendingCount);
  }

  // ─── Background Processing ─────────────────────────────────────────────────

  /**
   * Starts the background outbox processor and its lease reaper.
   */
  start(options: { signal?: AbortSignal } = {}): void {
    if (this.isRunning) {
      logger.log('warn', 'Outbox processor is already running');
      return;
    }

    const { signal } = options;
    if (signal?.aborted) {
      logger.log('warn', 'Outbox processor not started: signal already aborted');
      return;
    }

    // Fail fast at initialization rather than logging on every poll cycle.
    assertEventOutboxModelAvailable();

    this.isRunning = true;
    this.signal = signal;
    const intervalMs = getPollIntervalMs();

    logger.log('info', 'Starting outbox processor', {
      pollIntervalMs: intervalMs,
      batchSize: getBatchSize(),
      leaseMs: getOutboxLeaseMs(),
      instanceId: this.instanceId,
    });

    if (signal) {
      const onAbort = () => {
        void this.stop();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.abortCleanup = () => signal.removeEventListener('abort', onAbort);
    }

    // Process immediately on start, then poll on interval
    this.runCycle('initial run');

    this.pollTimer = setInterval(() => {
      this.runCycle('poll cycle');
    }, intervalMs);

    // Unref so the timer doesn't keep the process alive
    if (this.pollTimer && typeof this.pollTimer === 'object' && 'unref' in this.pollTimer) {
      this.pollTimer.unref();
    }

    this.startCleanupTimer();
    this.startReaperTimer();
  }

  /**
   * Stops the background processor: clears timers and resolves once any
   * in-flight polling cycle has finished.
   */
  async stop(): Promise<void> {
    if (this.isRunning) {
      this.isRunning = false;
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = null;
      }
      if (this.reaperTimer) {
        clearInterval(this.reaperTimer);
        this.reaperTimer = null;
      }
      this.abortCleanup?.();
      this.abortCleanup = null;
      this.signal = undefined;

      logger.log('info', 'Outbox processor stopped');
    }

    if (this.inFlight) {
      await this.inFlight;
    }
  }

  /** Runs one polling cycle unless stopped/aborted or a cycle is already running. */
  private runCycle(label: string): void {
    if (!this.isRunning || this.signal?.aborted || this.inFlight) return;

    const cycle = this.processOutbox(undefined, this.signal)
      .catch((err) => {
        logger.log('error', `Outbox processor ${label} failed`, {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        if (this.inFlight === cycle) this.inFlight = null;
      });
    this.inFlight = cycle;
  }

  /** Returns whether the processor is currently running. */
  get isActive(): boolean {
    return this.isRunning;
  }

  // ─── Metrics & Health ──────────────────────────────────────────────────────

  /** Returns a snapshot of outbox metrics for monitoring/administration. */
  async getMetrics(): Promise<OutboxMetrics> {
    const [pending, relayed, failed, deadLettered, locked, total, oldestPending] = await Promise.all([
      getEventOutboxDelegate().count({ where: { status: 'pending' } }),
      getEventOutboxDelegate().count({ where: { status: 'relayed' } }),
      getEventOutboxDelegate().count({ where: { status: 'failed' } }),
      getEventOutboxDelegate().count({ where: { status: 'dead_letter' } }),
      getEventOutboxDelegate().count({
        where: {
          status: { in: ['pending', 'failed'] },
          lockedAt: { not: null },
        },
      }),
      getEventOutboxDelegate().count(),
      getEventOutboxDelegate().findFirst({
        where: { status: { in: ['pending', 'failed'] } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);

    return {
      pending,
      relayed,
      failed,
      deadLettered,
      locked,
      total,
      oldestPendingAgeSeconds: oldestPending
        ? Math.max(0, (Date.now() - new Date(oldestPending.createdAt).getTime()) / 1000)
        : 0,
    };
  }

  /** Lists outbox entries with optional filters. */
  async listEntries(
    filters: {
      status?: OutboxEventStatus | OutboxEventStatus[];
      aggregateType?: OutboxAggregateType;
      aggregateId?: string;
      vaultId?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<EventOutboxRecord[]> {
    const where: Record<string, unknown> = {};

    if (filters.status) {
      where.status = Array.isArray(filters.status) ? { in: filters.status } : filters.status;
    }
    if (filters.aggregateType) {
      where.aggregateType = filters.aggregateType;
    }
    if (filters.aggregateId) {
      where.aggregateId = filters.aggregateId;
    }
    if (filters.vaultId) {
      where.vaultId = filters.vaultId;
    }

    const rows = await getEventOutboxDelegate().findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filters.limit ?? 100,
      skip: filters.offset ?? 0,
    });

    return rows.map((row) => this.toRecord(row));
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  private leaseTokenFor(
    lockedBy: string | null | undefined,
    lockedAt: Date | string | null | undefined,
  ): string | null {
    return buildOutboxLeaseToken(lockedBy, lockedAt);
  }

  /**
   * Starts a periodic cleanup timer to remove old processed entries.
   * Runs every hour by default, configurable via OUTBOX_CLEANUP_INTERVAL_MS.
   */
  private startCleanupTimer(): void {
    const cleanupIntervalMs = (() => {
      const parsed = parseInt(process.env.OUTBOX_CLEANUP_INTERVAL_MS || '', 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 60 * 60 * 1000; // default 1 hour
    })();

    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch((err) => {
        logger.log('error', 'Outbox cleanup cycle failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, cleanupIntervalMs);

    if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Starts the standalone stuck-lease reaper. Runs every
   * `OUTBOX_REAPER_INTERVAL_MS` (default half the lease duration).
   */
  private startReaperTimer(): void {
    this.reaperTimer = setInterval(() => {
      if (this.signal?.aborted) return;
      this.reapStuckRelays().catch((err) => {
        logger.log('error', 'Outbox lease reaper cycle failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, getReaperIntervalMs());

    if (this.reaperTimer && typeof this.reaperTimer === 'object' && 'unref' in this.reaperTimer) {
      this.reaperTimer.unref();
    }
  }

  private toRecord(row: {
    id: string;
    eventType: string;
    payload: string;
    status: string;
    aggregateType: string;
    aggregateId: string;
    vaultId?: string | null;
    sequence: number;
    attemptCount: number;
    maxAttempts: number;
    lastError: string | null;
    lockedAt: Date | null;
    lockedBy: string | null;
    createdAt: Date;
    updatedAt: Date;
    relayedAt: Date | null;
  }): EventOutboxRecord {
    return {
      id: row.id,
      eventType: row.eventType as TransactionEventType,
      payload: JSON.parse(row.payload) as TransactionEventPayload,
      status: row.status as OutboxEventStatus,
      aggregateType: row.aggregateType as OutboxAggregateType,
      aggregateId: row.aggregateId,
      vaultId: row.vaultId ?? null,
      sequence: row.sequence,
      attemptCount: row.attemptCount,
      maxAttempts: row.maxAttempts,
      lastError: row.lastError,
      lockedAt: row.lockedAt?.toISOString() ?? null,
      lockedBy: row.lockedBy,
      leaseToken: this.leaseTokenFor(row.lockedBy, row.lockedAt),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      relayedAt: row.relayedAt?.toISOString() ?? null,
    };
  }

  /**
   * Computes the next monotonic sequence number for a given vault.
   * Sequences are per-vault and increment by exactly 1.
   */
  private async nextSequenceForVault(vaultId: string): Promise<number> {
    const result = await getPrismaClient().$transaction(async (tx) => {
    const latest = await getEventOutboxDelegate().findFirst({
      where: { aggregateId: vaultId },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    const result = await getPrisma().$transaction(async (tx) => {
      const latest = await tx.eventOutbox.findFirst({
        where: { vaultId },
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      });
      return (latest?.sequence ?? 0) + 1;
    });
    return (latest?.sequence ?? 0) + 1;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const eventOutboxService = new EventOutboxService();
