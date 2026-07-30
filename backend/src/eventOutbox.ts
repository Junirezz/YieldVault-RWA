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
 */

import crypto from 'crypto';
import { prisma } from './prisma';
import { logger } from './middleware/structuredLogging';
import {
  emitTransactionEvent,
  type TransactionEventType,
  type TransactionEventPayload,
} from './webhookDelivery';

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
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
  createdAt: string;
  updatedAt: string;
  relayedAt: string | null;
}

export interface OutboxWriteInput {
  eventType: TransactionEventType;
  payload: TransactionEventPayload;
  aggregateType: OutboxAggregateType;
  aggregateId: string;
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

function getLockTimeoutMs(): number {
  const parsed = parseInt(process.env.OUTBOX_LOCK_TIMEOUT_MS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60000;
}

function getMaxAttempts(): number {
  const parsed = parseInt(process.env.OUTBOX_MAX_ATTEMPTS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

function getRetentionMs(): number {
  const parsed = parseInt(process.env.OUTBOX_RETENTION_MS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 7 * 24 * 60 * 60 * 1000; // 7 days
}

/** Unique instance identifier for distributed locking. */
function getInstanceId(): string {
  return process.env.OUTBOX_INSTANCE_ID || `instance-${crypto.randomUUID().slice(0, 8)}`;
}

// ─── Service ─────────────────────────────────────────────────────────────────

class EventOutboxService {
  private isRunning = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private instanceId: string;

  constructor() {
    this.instanceId = getInstanceId();
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Writes an event to the outbox table.
   * This should be called within the same transaction boundary as the business
   * operation (e.g., inside a Prisma $transaction) to ensure atomic persistence.
   *
   * Returns the created outbox record.
   */
  async writeEvent(input: OutboxWriteInput): Promise<EventOutboxRecord> {
    const now = new Date();
    const record = await prisma.eventOutbox.create({
      data: {
        id: `obx-${crypto.randomUUID()}`,
        eventType: input.eventType,
        payload: JSON.stringify(input.payload),
        status: 'pending',
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
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
   * Uses instance-level locking to prevent duplicate processing in multi-pod deployments.
   * Can be called on a schedule or manually.
   */
  async processOutbox(batchSize?: number): Promise<OutboxRelayResult> {
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
      // 1. Find eligible entries: pending or failed entries whose lock is expired
      const candidates = await prisma.eventOutbox.findMany({
        where: {
          status: { in: ['pending', 'failed'] },
          OR: [
            { lockedAt: null },
            { lockedAt: { lt: lockExpiry } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });

      if (candidates.length === 0) {
        return result;
      }

      // 2. Lock the claimed entries by updating lockedAt/lockedBy in bulk
      const candidateIds = candidates.map((e) => e.id);
      await prisma.eventOutbox.updateMany({
        where: {
          id: { in: candidateIds },
          OR: [
            { lockedAt: null },
            { lockedAt: { lt: lockExpiry } },
          ],
        },
        data: {
          lockedAt: now,
          lockedBy: this.instanceId,
        },
      });

      // 3. Re-fetch the entries we successfully locked (some may have been
      //    concurrently claimed by another instance)
      const entries = await prisma.eventOutbox.findMany({
        where: {
          id: { in: candidateIds },
          lockedBy: this.instanceId,
          lockedAt: now,
        },
        orderBy: { createdAt: 'asc' },
      });

      if (entries.length === 0) {
        return result;
      }

      // 4. Relay each entry
      for (const entry of entries) {
        try {
          const payload = JSON.parse(entry.payload) as TransactionEventPayload;
          // emitTransactionEvent schedules webhook deliveries asynchronously.
          // We await it here so relayed/retry decisions happen after the event
          // is queued for delivery, not before. Note that actual HTTP delivery
          // happens in the background via setTimeout — if the process crashes
          // after marking relayed but before delivery completes, the webhook
          // delivery's own retry mechanism still applies.
          const deliveredCount = await emitTransactionEvent(
            entry.eventType as TransactionEventType,
            payload,
          );

          await prisma.eventOutbox.update({
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

          result.relayed++;
          logger.log('info', 'Outbox event relayed', {
            outboxId: entry.id,
            eventType: entry.eventType,
            aggregateType: entry.aggregateType,
            aggregateId: entry.aggregateId,
            deliveredCount,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const nextAttempt = entry.attemptCount + 1;

          if (nextAttempt >= entry.maxAttempts) {
            // Exhausted retries — move to dead_letter
            await prisma.eventOutbox.update({
              where: { id: entry.id },
              data: {
                status: 'dead_letter',
                attemptCount: nextAttempt,
                lastError: errorMessage,
                lockedAt: null,
                lockedBy: null,
              },
            });
            result.deadLettered++;
            result.errors.push(`[${entry.id}] Dead-letter: ${errorMessage}`);

            logger.log('warn', 'Outbox event moved to dead-letter after exhausting retries', {
              outboxId: entry.id,
              eventType: entry.eventType,
              attempts: nextAttempt,
              maxAttempts: entry.maxAttempts,
              error: errorMessage,
            });
          } else {
            // Mark as failed for retry
            await prisma.eventOutbox.update({
              where: { id: entry.id },
              data: {
                status: 'failed',
                attemptCount: nextAttempt,
                lastError: errorMessage,
                lockedAt: null,
                lockedBy: null,
              },
            });
            result.failed++;
            result.errors.push(`[${entry.id}] Failed (${nextAttempt}/${entry.maxAttempts}): ${errorMessage}`);

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
   * Retries a specific dead-lettered event by resetting its status to pending.
   */
  async retryDeadLetter(outboxId: string): Promise<EventOutboxRecord | null> {
    const entry = await prisma.eventOutbox.findUnique({ where: { id: outboxId } });
    if (!entry || entry.status !== 'dead_letter') {
      return null;
    }

    const updated = await prisma.eventOutbox.update({
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

    const result = await prisma.eventOutbox.deleteMany({
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
   * Used to recover any events that were written but not relayed before a crash.
   */
  async replayOnStartup(): Promise<OutboxRelayResult> {
    const pendingCount = await prisma.eventOutbox.count({
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
   * Starts the background outbox processor.
   * Polls for pending events on a configured interval and relays them.
   */
  start(): void {
    if (this.isRunning) {
      logger.log('warn', 'Outbox processor is already running');
      return;
    }

    this.isRunning = true;
    const intervalMs = getPollIntervalMs();

    logger.log('info', 'Starting outbox processor', {
      pollIntervalMs: intervalMs,
      batchSize: getBatchSize(),
      instanceId: this.instanceId,
    });

    // Process immediately on start, then poll on interval
    this.processOutbox().catch((err) => {
      logger.log('error', 'Outbox processor initial run failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    this.pollTimer = setInterval(() => {
      this.processOutbox().catch((err) => {
        logger.log('error', 'Outbox processor poll cycle failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, intervalMs);

    // Unref so the timer doesn't keep the process alive
    if (this.pollTimer && typeof this.pollTimer === 'object' && 'unref' in this.pollTimer) {
      this.pollTimer.unref();
    }

    // Start periodic cleanup of old processed entries (every hour)
    this.startCleanupTimer();
  }

  /**
   * Stops the background outbox processor.
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    logger.log('info', 'Outbox processor stopped');
  }

  /**
   * Returns whether the processor is currently running.
   */
  get isActive(): boolean {
    return this.isRunning;
  }

  // ─── Metrics & Health ──────────────────────────────────────────────────────

  /**
   * Returns a snapshot of outbox metrics for monitoring/administration.
   */
  async getMetrics(): Promise<OutboxMetrics> {
    const [pending, relayed, failed, deadLettered, locked, total] = await Promise.all([
      prisma.eventOutbox.count({ where: { status: 'pending' } }),
      prisma.eventOutbox.count({ where: { status: 'relayed' } }),
      prisma.eventOutbox.count({ where: { status: 'failed' } }),
      prisma.eventOutbox.count({ where: { status: 'dead_letter' } }),
      prisma.eventOutbox.count({
        where: {
          status: { in: ['pending', 'failed'] },
          lockedAt: { not: null },
        },
      }),
      prisma.eventOutbox.count(),
    ]);

    return { pending, relayed, failed, deadLettered, locked, total };
  }

  /**
   * Lists outbox entries with optional filters.
   */
  async listEntries(filters: {
    status?: OutboxEventStatus | OutboxEventStatus[];
    aggregateType?: OutboxAggregateType;
    aggregateId?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<EventOutboxRecord[]> {
    const where: Record<string, unknown> = {};

    if (filters.status) {
      where.status = Array.isArray(filters.status)
        ? { in: filters.status }
        : filters.status;
    }
    if (filters.aggregateType) {
      where.aggregateType = filters.aggregateType;
    }
    if (filters.aggregateId) {
      where.aggregateId = filters.aggregateId;
    }

    const rows = await prisma.eventOutbox.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filters.limit ?? 100,
      skip: filters.offset ?? 0,
    });

    return rows.map((row) => this.toRecord(row));
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

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

    // Unref so the timer doesn't keep the process alive
    if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  private toRecord(row: {
    id: string;
    eventType: string;
    payload: string;
    status: string;
    aggregateType: string;
    aggregateId: string;
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
      attemptCount: row.attemptCount,
      maxAttempts: row.maxAttempts,
      lastError: row.lastError,
      lockedAt: row.lockedAt?.toISOString() ?? null,
      lockedBy: row.lockedBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      relayedAt: row.relayedAt?.toISOString() ?? null,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const eventOutboxService = new EventOutboxService();
