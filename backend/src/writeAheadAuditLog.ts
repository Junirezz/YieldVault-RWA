import crypto from 'crypto';
import { logger } from './middleware/structuredLogging';
import { getActiveRequestId } from './requestContext';
import { prisma } from './prisma';

export interface WriteAheadEntry {
  id: string;
  configType: string;
  action: string;
  actor: string;
  ipAddress: string | null;
  userAgent: string | null;
  preChangeSnapshot: Record<string, unknown>;
  postChangeSnapshot: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  status: 'pending' | 'committed' | 'rolled_back';
  requestId: string | null;
  createdAt: string;
  committedAt: string | null;
}

export interface WriteAheadInput {
  configType: string;
  action: string;
  actor: string;
  ipAddress?: string;
  userAgent?: string;
  preChangeSnapshot: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface WriteAheadMetrics {
  total: number;
  pending: number;
  committed: number;
  rolledBack: number;
  /**
   * Pending entries older than WAL_STALE_PENDING_TTL_MS (default 15 minutes).
   * Surfaced so operators can spot config changes stuck between prepare and
   * commit/rollback, e.g. after a crash mid-transaction.
   */
  stalePending: number;
}

const DEFAULT_STALE_PENDING_TTL_MS = 15 * 60 * 1000;

function getStalePendingTtlMs(): number {
  const parsed = parseInt(process.env.WAL_STALE_PENDING_TTL_MS || '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_STALE_PENDING_TTL_MS;
}

/**
 * Whether to use the in-memory fallback store instead of Prisma.
 *
 * Mirrors the same convention already used by adminConfigChangeAudit.ts:
 * tests (and any environment without a configured database) run against a
 * fast, dependency-free in-memory store rather than requiring a live
 * Postgres connection, while any real deployment persists durably via
 * Prisma.
 */
function shouldUseInMemoryWalFallback(): boolean {
  const nodeEnv = process.env.NODE_ENV || '';
  const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
  return nodeEnv === 'test' || Boolean(process.env.JEST_WORKER_ID) || !hasDatabaseUrl;
}

function toDateIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

interface WriteAheadRow {
  id: string;
  configType: string;
  action: string;
  actor: string;
  ipAddress: string | null;
  userAgent: string | null;
  preChangeSnapshot: string;
  postChangeSnapshot: string | null;
  metadata: string;
  status: string;
  requestId: string | null;
  createdAt: Date | string;
  committedAt: Date | string | null;
}

function toEntry(row: WriteAheadRow): WriteAheadEntry {
  return {
    id: row.id,
    configType: row.configType,
    action: row.action,
    actor: row.actor,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    preChangeSnapshot: JSON.parse(row.preChangeSnapshot),
    postChangeSnapshot: row.postChangeSnapshot ? JSON.parse(row.postChangeSnapshot) : null,
    metadata: JSON.parse(row.metadata),
    status: row.status as WriteAheadEntry['status'],
    requestId: row.requestId,
    createdAt: toDateIso(row.createdAt) as string,
    committedAt: toDateIso(row.committedAt),
  };
}

class WriteAheadAuditLogStore {
  // In-memory store: the sole backing store in test mode, and also used as
  // a same-process fallback if a Prisma call unexpectedly errors at runtime
  // (e.g. a transient DB outage), so a WAL entry prepared just before an
  // outage can still be found by a subsequent commit/rollback/list call in
  // this same process rather than silently disappearing.
  private entries: WriteAheadEntry[] = [];
  private maxEntries = 10000;

  async prepare(input: WriteAheadInput): Promise<WriteAheadEntry> {
    const entry: WriteAheadEntry = {
      id: `wal-${crypto.randomUUID()}`,
      configType: input.configType,
      action: input.action,
      actor: input.actor,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      preChangeSnapshot: { ...input.preChangeSnapshot },
      postChangeSnapshot: null,
      metadata: { ...(input.metadata ?? {}) },
      status: 'pending',
      requestId: getActiveRequestId() ?? null,
      createdAt: new Date().toISOString(),
      committedAt: null,
    };

    if (!shouldUseInMemoryWalFallback()) {
      try {
        const row = await prisma.writeAheadAuditEntry.create({
          data: {
            id: entry.id,
            configType: entry.configType,
            action: entry.action,
            actor: entry.actor,
            ipAddress: entry.ipAddress,
            userAgent: entry.userAgent,
            preChangeSnapshot: JSON.stringify(entry.preChangeSnapshot),
            metadata: JSON.stringify(entry.metadata),
            status: entry.status,
            requestId: entry.requestId,
          },
        });
        const persisted = toEntry(row as WriteAheadRow);
        this.logEvent('info', 'Write-ahead audit entry prepared', persisted);
        return persisted;
      } catch (error) {
        this.logFallback('prepare', error);
      }
    }

    this.entries.unshift(entry);
    this.trimEntries();
    this.logEvent('info', 'Write-ahead audit entry prepared', entry);
    return entry;
  }

  async commit(walId: string, postChangeSnapshot: Record<string, unknown>): Promise<WriteAheadEntry | null> {
    if (!shouldUseInMemoryWalFallback()) {
      try {
        const existing = await prisma.writeAheadAuditEntry.findUnique({ where: { id: walId } });
        if (!existing || existing.status !== 'pending') return null;

        const row = await prisma.writeAheadAuditEntry.update({
          where: { id: walId },
          data: {
            postChangeSnapshot: JSON.stringify(postChangeSnapshot),
            status: 'committed',
            committedAt: new Date(),
          },
        });
        const committed = toEntry(row as WriteAheadRow);
        logger.log('info', 'Write-ahead audit entry committed', {
          walId: committed.id,
          configType: committed.configType,
          action: committed.action,
        });
        return committed;
      } catch (error) {
        this.logFallback('commit', error);
      }
    }

    const entry = this.entries.find((e) => e.id === walId);
    if (!entry || entry.status !== 'pending') return null;

    entry.postChangeSnapshot = { ...postChangeSnapshot };
    entry.status = 'committed';
    entry.committedAt = new Date().toISOString();

    logger.log('info', 'Write-ahead audit entry committed', {
      walId: entry.id,
      configType: entry.configType,
      action: entry.action,
    });

    return entry;
  }

  async rollback(walId: string, reason?: string): Promise<WriteAheadEntry | null> {
    if (!shouldUseInMemoryWalFallback()) {
      try {
        const existing = await prisma.writeAheadAuditEntry.findUnique({ where: { id: walId } });
        if (!existing || existing.status !== 'pending') return null;

        const metadata = { ...JSON.parse(existing.metadata), rollbackReason: reason ?? 'unknown' };
        const row = await prisma.writeAheadAuditEntry.update({
          where: { id: walId },
          data: {
            status: 'rolled_back',
            metadata: JSON.stringify(metadata),
          },
        });
        const rolledBack = toEntry(row as WriteAheadRow);
        logger.log('warn', 'Write-ahead audit entry rolled back', {
          walId: rolledBack.id,
          configType: rolledBack.configType,
          reason,
        });
        return rolledBack;
      } catch (error) {
        this.logFallback('rollback', error);
      }
    }

    const entry = this.entries.find((e) => e.id === walId);
    if (!entry || entry.status !== 'pending') return null;

    entry.status = 'rolled_back';
    entry.metadata = { ...entry.metadata, rollbackReason: reason ?? 'unknown' };

    logger.log('warn', 'Write-ahead audit entry rolled back', {
      walId: entry.id,
      configType: entry.configType,
      reason,
    });

    return entry;
  }

  async getEntry(walId: string): Promise<WriteAheadEntry | null> {
    if (!shouldUseInMemoryWalFallback()) {
      try {
        const row = await prisma.writeAheadAuditEntry.findUnique({ where: { id: walId } });
        return row ? toEntry(row as WriteAheadRow) : null;
      } catch (error) {
        this.logFallback('getEntry', error);
      }
    }

    return this.entries.find((e) => e.id === walId) ?? null;
  }

  async list(
    opts: {
      configType?: string;
      actor?: string;
      status?: 'pending' | 'committed' | 'rolled_back';
      limit?: number;
    } = {},
  ): Promise<WriteAheadEntry[]> {
    if (!shouldUseInMemoryWalFallback()) {
      try {
        const where: Record<string, unknown> = {};
        if (opts.configType) where.configType = opts.configType;
        if (opts.actor) where.actor = opts.actor;
        if (opts.status) where.status = opts.status;

        const rows = await prisma.writeAheadAuditEntry.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: opts.limit ?? 100,
        });
        return rows.map((row: WriteAheadRow) => toEntry(row));
      } catch (error) {
        this.logFallback('list', error);
      }
    }

    let result = this.entries;

    if (opts.configType) {
      result = result.filter((e) => e.configType === opts.configType);
    }
    if (opts.actor) {
      result = result.filter((e) => e.actor === opts.actor);
    }
    if (opts.status) {
      result = result.filter((e) => e.status === opts.status);
    }

    return result.slice(0, opts.limit ?? 100);
  }

  async getPendingEntries(): Promise<WriteAheadEntry[]> {
    if (!shouldUseInMemoryWalFallback()) {
      try {
        const rows = await prisma.writeAheadAuditEntry.findMany({
          where: { status: 'pending' },
          orderBy: { createdAt: 'desc' },
        });
        return rows.map((row: WriteAheadRow) => toEntry(row));
      } catch (error) {
        this.logFallback('getPendingEntries', error);
      }
    }

    return this.entries.filter((e) => e.status === 'pending');
  }

  async getMetrics(): Promise<WriteAheadMetrics> {
    const staleBefore = new Date(Date.now() - getStalePendingTtlMs());

    if (!shouldUseInMemoryWalFallback()) {
      try {
        const [total, pending, committed, rolledBack, stalePending] = await Promise.all([
          prisma.writeAheadAuditEntry.count(),
          prisma.writeAheadAuditEntry.count({ where: { status: 'pending' } }),
          prisma.writeAheadAuditEntry.count({ where: { status: 'committed' } }),
          prisma.writeAheadAuditEntry.count({ where: { status: 'rolled_back' } }),
          prisma.writeAheadAuditEntry.count({
            where: { status: 'pending', createdAt: { lt: staleBefore } },
          }),
        ]);
        return { total, pending, committed, rolledBack, stalePending };
      } catch (error) {
        this.logFallback('getMetrics', error);
      }
    }

    const total = this.entries.length;
    const pending = this.entries.filter((e) => e.status === 'pending').length;
    const committed = this.entries.filter((e) => e.status === 'committed').length;
    const rolledBack = this.entries.filter((e) => e.status === 'rolled_back').length;
    const stalePending = this.entries.filter(
      (e) => e.status === 'pending' && new Date(e.createdAt) < staleBefore,
    ).length;

    return { total, pending, committed, rolledBack, stalePending };
  }

  /** Test-only: clears both the in-memory fallback and, outside test mode, the Prisma table. */
  async clear(): Promise<void> {
    this.entries = [];

    if (!shouldUseInMemoryWalFallback()) {
      try {
        await prisma.writeAheadAuditEntry.deleteMany({});
      } catch (error) {
        this.logFallback('clear', error);
      }
    }
  }

  private trimEntries(): void {
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(0, this.maxEntries);
    }
  }

  private logEvent(level: 'info' | 'warn', message: string, entry: WriteAheadEntry): void {
    logger.log(level, message, {
      walId: entry.id,
      configType: entry.configType,
      action: entry.action,
      actor: entry.actor,
    });
  }

  private logFallback(operation: string, error: unknown): void {
    logger.log('warn', 'Falling back to in-memory write-ahead audit store after Prisma error', {
      operation,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export const writeAheadAuditLog = new WriteAheadAuditLogStore();
