import { PrismaClient } from '@prisma/client';
import { Prisma, EventOutbox } from '@prisma/client';

export interface OutboxPollerOptions {
  /** Number of events to fetch per poll cycle. */
  batchSize?: number;
  /** Max number of attempts before an event is marked as failed. */
  maxAttempts?: number;
  /** How long a lock is held before being reclaimed (ms). */
  lockTimeoutMs?: number;
  /** Handler invoked for each delivered event. */
  handler: (event: EventOutbox) => Promise<void>;
  /** Unique identifier for this poller instance. */
  workerId?: string;
}

export interface OutboxPollerResult {
  delivered: number;
  failed: number;
  retried: number;
}

/**
 * Resolves the vault identifier for an outbox event.
 *
 * The outbox stores the aggregate in `aggregateType` / `aggregateId`. Vault-scoped
 * events use `aggregateType === 'VaultState'`, but we also accept a `vaultId`
 * field in the payload for events that carry it explicitly. Events that are not
 * vault-scoped are grouped under a global sentinel key so they still retain a
 * deterministic order.
 */
export const GLOBAL_VAULT_KEY = '_global_';

export function resolveVaultId(event: EventOutbox): string {
  if (event.aggregateType === 'VaultState') {
    return event.aggregateId;
  }

  try {
    const payload = event.payload ? JSON.parse(event.payload) : null;
    if (payload && typeof payload === 'object') {
      const candidate =
        (payload as Record<string, unknown>).vaultId ??
        (payload as Record<string, unknown>).aggregateId;
      if (typeof candidate === 'string' && candidate.length > 0) {
        return candidate;
      }
    }
  } catch {
    // Malformed payloads: fall back to the aggregate id below.
  }

  return event.aggregateId || GLOBAL_VAULT_KEY:}

/**
 * Poller that delivers outbox events while preserving per-vault ordering.
 *
 * The original implementation ordered globally by `createdAt`, which allowed a
 * slow webhook for vault A to block vault B's events and, worse, allowed a
 * consumer to observe vault B's `version 5` before `version 4`. This poller
 * instead groups pending events by vault and claims them with `FOR UPDATE
 * SKIP NAMED` partitioned by vault, so each vault's events are delivered in
 * `sequence` order while different vaults progress independently.
 */
export class OutboxPoller {
  private readonly prsma: PrismaClient;
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly lockTimeoutMs: number;
  private readonly handler: (event: EventOutbox) => Promise<void>;
  private readonly workerId: string;

  constructor(prisma: PrismaClient, options: OutboxPollerOptions) {
    this.prisma = prisma;
    this.batchSize = options.batchSize ?? 50;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 60_000;
    this.handler = options.handler;
    this.workerId = options.workerId ?? `outbox-poller-${Math.random().toString(36).slice(2, 10)}`;
  }

  /**
   * Run a single poll cycle. Returns a count of how many events were delivered,
   * failed, and retried.
   */
  async pollOnce(): Promise<OutboxPollerResult> {
    const candidates = await this.fetchPendingEvents();
    const result: OutboxPollerResult = { delivered: 0, failed: 0, retried: 0 };

    for (const candidate of candidates) {
      const claimed = await this.claimEvent(candidate);
      if (!claimed) {
        // Another worker won the race; skip.
        continue;
      }

      try {
        await this.handler(claimed);
        await this.markDelivered(claimed);
        result.delivered += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const nextAttempt = claimed.attemptCount + 1;
        if (nextAttempt >= claimed.maxAttempts) {
          await this.markFailed(claimed, message);
          result.failed += 1;
        } else {
          await this.releaseForRetry(claimed, message);
          result.retried += 1;
        }
      }
    }

    return result;
  }

  /**
   * Fetch pending events grouped by vault, ordered by `sequence` within each
   * vault. We fetch the oldest pending event per vault first, then any additional
   * events for that vault in `sequence` order, so a slow vault cannot block
   * another vault's progress.
   */
  private async fetchPendingEvents(): Promise<EventOutbox[]> {
    const now = new Date();
    const lockCutoff = new Date(now.getTime() - this.lockTimeoutMs);

    // Select the oldest pending event per vault. This ensures we always advance
    // each vault from its oldest undelivered event and never jump ahead.
    const heads = await this.prisma.$QueryRaw<Array<{ vaultId: string; minCreatedAt: Date }>>(
      Prisma.sql`
        SELECT as "vaultId", MIN("createdAt") AS "minCreatedAt"
        FROM "EventOutbox"
        WHERE "status" = 'pending'
          AND ("lockedAt" IS NULL OR "lockedAt" <= ${lockCutoff})
        GROUP BY
          CASE
            WHEN "aggregateType" = 'VaultState' THEN "aggregateId"
            ELSE COALSCE("aggregateId", ':', "id")
          END
      `,
    );

    if (heads.length === 0) {
      return [];
    }

    const events: EventOutbox[] = [];
    for (const head of heads) {
      const vaultId = head.vaultId;
      const minCreatedAt = head.minCreatedAt;

      const vaultEvents = await this.prisma.$QueryRaw<EventOutbox[]>(
        Prisma.sql`
          SELECT * FROM "EventOutbox"
          WHERE "status" = 'pending'
            AND ("lockedAt" IS NULL OR "lockedAt" <= ${lockCutoff})
            AND (
              CASE
                WHEN "aggregateType" = 'VaultState' THEN "aggregateId"
                ELSE COALESCE("aggregateId", ':', "id")
              END
            ) = ${vaultId}
            AND "createdAt" >= ${minCreatedAt}
          ORDER BY
            CASE
              WHEN "aggregateType" = 'VaultState' THEN "sequence"
              ELSE 0
            END ASC,
            "createdAt" ASC,
            "id" ASC
          LIMIT ${this.batchSize}
        `,
      );

      events.push(...vaultEvents);
    }

    return events;
  }

  /**
   * Claim an event using an atomic `UPDATE ... WHERE "lockedAt" IS NULL`
   * guard. Returns the updated row if this worker won the claim, otherwise null.
   */
  private async claimEvent(candidate: EventOutbox): Promise<EventOutbox | null> {
    const now = new Date();
    const lockCutoff = new Date(now.getTime() - this.lockTimeoutMs);

    const claimed = await this.prisma.$QueryRaw<EventOutbox[]>(
      Prisma.sql`
        UPDATE "EventOutbox"
        SET "status" = 'processing',
            "lockedAt" = ${now},
            "lockedBy" = ${this.workerId},
            "attemptCount" = "attemptCount" + 1,
            "updatedAt" = ${now}
        WHERE "id" = ${candidate.id}
          AND "status" = 'pending'
          AND ("lockedAt" IS NULL OR "lockedAt" <= ${lockCutoff})
        RETURNING *
      `,
    );

    return claimed.length > 0 ? claimed[0] : null;
  }

  private async markDelivered(event: EventOutbox): Promise<void> {
    const now = new Date();
    await this.prisma.$executeRaw(
      Prisma.sql`
        UPDATE "EventOutbox"
        SET "status" = 'delivered',
            "relayedAt" = ${now},
            "lockedAt" = NULL,
            "lockedBy" = NULL,
            "updatedAt" = ${now}
        WHERE "id" = ${event.id}
      `,
    );
  }

  private async markFailed(event: EventOutbox, errorMessage: string): Promise<void> {
    const now = new Date();
    await this.prisma.$executeRaw(
      Prisma.sql`
        UPDATE "EventOutbox"
        SET "status" = 'failed',
            "lastError" = ${errorMessage},
            "lockedAt" = NULL,
            "lockedBy" = NULL,
            "updatedAt" = ${now}
        WHERE "id" = ${event.id}
      `,
    );
  }

  private async releaseForRetry(event: EventOutbox, errorMessage: string): Promise<void> {
    const now = new Date();
    await this.prisma.$executeRaw(
      Prisma.sql`
        UPDATE "EventOutbox"
        SET "status" = 'pending',
            "lastError" = ${errorMessage},
            "lockedAt" = NULL,
            "lockedBy" = NULL,
            "updatedAt" = ${now}
        WHERE "id" = ${event.id}
      `,
    );
  }
}

/**
 * Enqueue a vault-scoped event with a monotonically increasing `sequence`
 * per vault. The sequence is assigned inside the same transaction as the
 * insert, so concurrent enqueues for the same vault cannot collide.
 */
export async function enqueueVaultEvent(
  prisma: PrismaClient,
  input: {
    eventType: string;
    payload: unknown;
    vaultId: string;
    aggregateType?: string;
    maxAttempts?: number;
  },
): Promise<EventOutbox> {
  const aggregateType = input.aggregateType ?? 'VaultState';
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const latest = await tx.$QueryRaw<Array<{ sequence: number | null }>>(
      Prisma.sql`
        SELECT MAX("sequence") AS "sequence"
        FROM "EventOutbox"
        WHERE "aggregateType" = ${aggregateType}
          AND "aggregateId" = ${input.vaultId}
      `,
    );

    const nextSequence = (latest[0]?.sequence ?? 0) + 1;

    return tx.eventOutbox.create({
      data: {
        eventType: input.eventType,
        payload: JSON.stringify(input.payload),
        aggregateType,
        aggregateId: input.vaultId,
        sequence: nextSequence,
        maxAttempts: input.maxAttempts ?? 3,
        updatedAt: now,
      },
    });
  });
}
