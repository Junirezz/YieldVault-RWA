import type { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  method: string;
  path: string;
  action: string;
  statusCode: number;
  durationMs: number;
  ip: string;
  correlationId?: string;
}

interface AuditLogFilters {
  actor?: string;
  action?: string;
  path?: string;
  statusCode?: number;
  limit?: number;
}

const entries: AuditLogEntry[] = [];
const entryLimit = parseInt(process.env.AUDIT_LOG_RETENTION || '500', 10);

export function createAdminAuditMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startedAt = Date.now();

    res.on('finish', () => {
      const actor = resolveActor(req);
      const now = new Date().toISOString();
      const entry: AuditLogEntry = {
        id: `audit_${crypto.randomBytes(8).toString('hex')}`,
        timestamp: now,
        actor,
        method: req.method,
        path: req.originalUrl || req.path,
        action: buildAction(req.method, req.path),
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        ip: req.ip || 'unknown',
        correlationId: req.header('x-correlation-id') || undefined,
      };

      entries.unshift(entry);
      if (entries.length > entryLimit) {
        entries.length = entryLimit;
      }
    });

    next();
  };
}

export function getAuditLogs(filters: AuditLogFilters = {}): AuditLogEntry[] {
  const statusFilter =
    typeof filters.statusCode === 'number' && Number.isFinite(filters.statusCode)
      ? filters.statusCode
      : undefined;

  const filtered = entries.filter((entry) => {
    if (filters.actor && !entry.actor.includes(filters.actor)) {
      return false;
    }

    if (filters.action && !entry.action.includes(filters.action)) {
      return false;
    }

    if (filters.path && !entry.path.includes(filters.path)) {
      return false;
    }

    if (statusFilter !== undefined && entry.statusCode !== statusFilter) {
      return false;
    }

    return true;
  });

  const normalizedLimit = Math.max(1, Math.min(filters.limit ?? 100, 500));
  return filtered.slice(0, normalizedLimit);
}

export function getAuditLogMetrics() {
  return {
    totalEntries: entries.length,
    retentionLimit: entryLimit,
    latestTimestamp: entries[0]?.timestamp || null,
  };
}

export function resetAuditLogs() {
  entries.length = 0;
}

function buildAction(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function resolveActor(req: Request): string {
  const authHeader = req.header('authorization');

  if (!authHeader) {
    return 'anonymous';
  }

  const apiKeyMatch = authHeader.match(/^ApiKey\s+(.+)$/i);
  if (apiKeyMatch) {
    const hash = crypto.createHash('sha256').update(apiKeyMatch[1]).digest('hex');
    return `apiKey:${hash.slice(0, 12)}`;
  }

  return 'authenticated';
}
