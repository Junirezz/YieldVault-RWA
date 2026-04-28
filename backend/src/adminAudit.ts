import type { Request } from 'express';
import { prisma } from './prisma';
import { resetAuditLogs } from './auditLog';

type AuditStorageMode = 'memory' | 'prisma' | 'hybrid';

export interface AdminAuditLogRecord {
  id: string;
  action: string;
  method: string;
  path: string;
  statusCode: number;
  actor: string;
  apiKeyHash: string;
  ipAddress: string;
  userAgent: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AuditLogFilters {
  action?: string;
  actor?: string;
  statusCode?: number;
  limit: number;
}

const inMemoryLogs: AdminAuditLogRecord[] = [];

function normalizeStorageMode(raw: string | undefined): AuditStorageMode {
  if (raw === 'prisma' || raw === 'memory' || raw === 'hybrid') {
    return raw;
  }
  return 'hybrid';
}

export async function recordAdminAuditLog(
  req: Request,
  action: string,
  statusCode: number,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const storageMode = normalizeStorageMode(process.env.ADMIN_AUDIT_LOG_STORAGE);
  const entry: AdminAuditLogRecord = {
    id: createLogId(),
    action,
    method: req.method,
    path: req.path,
    statusCode,
    actor: resolveActor(req),
    apiKeyHash: req.authApiKeyHash || 'unknown',
    ipAddress: req.ip || 'unknown',
    userAgent: req.get('user-agent') || 'unknown',
    metadata,
    createdAt: new Date().toISOString(),
  };

  if (storageMode === 'memory') {
    addInMemory(entry);
    return;
  }

  try {
    await prisma.adminAuditLog.create({
      data: {
        id: entry.id,
        action: entry.action,
        method: entry.method,
        path: entry.path,
        statusCode: entry.statusCode,
        actor: entry.actor,
        apiKeyHash: entry.apiKeyHash,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        metadata: JSON.stringify(entry.metadata),
      },
    });
  } catch {
    if (storageMode === 'prisma') {
      throw new Error('Failed to persist admin audit log to Prisma storage');
    }

    addInMemory(entry);
  }
}

export async function listAdminAuditLogs(filters: AuditLogFilters): Promise<AdminAuditLogRecord[]> {
  const storageMode = normalizeStorageMode(process.env.ADMIN_AUDIT_LOG_STORAGE);
  if (storageMode === 'memory') {
    return listFromMemory(filters);
  }

  try {
    const rows = await prisma.adminAuditLog.findMany({
      where: {
        ...(filters.action ? { action: filters.action } : {}),
        ...(filters.actor ? { actor: filters.actor } : {}),
        ...(typeof filters.statusCode === 'number' ? { statusCode: filters.statusCode } : {}),
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: filters.limit,
    });

    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      method: row.method,
      path: row.path,
      statusCode: row.statusCode,
      actor: row.actor,
      apiKeyHash: row.apiKeyHash,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      metadata: safeParseMetadata(row.metadata),
      createdAt: row.createdAt.toISOString(),
    }));
  } catch {
    if (storageMode === 'prisma') {
      throw new Error('Failed to read admin audit logs from Prisma storage');
    }
    return listFromMemory(filters);
  }
}

function addInMemory(entry: AdminAuditLogRecord): void {
  inMemoryLogs.unshift(entry);
  if (inMemoryLogs.length > 1000) {
    inMemoryLogs.length = 1000;
  }
}

function listFromMemory(filters: AuditLogFilters): AdminAuditLogRecord[] {
  return inMemoryLogs
    .filter((row) => {
      if (filters.action && row.action !== filters.action) {
        return false;
      }
      if (filters.actor && row.actor !== filters.actor) {
        return false;
      }
      if (typeof filters.statusCode === 'number' && row.statusCode !== filters.statusCode) {
        return false;
      }
      return true;
    })
    .slice(0, filters.limit);
}

function createLogId(): string {
  return `audit_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function resolveActor(req: Request): string {
  return (
    req.get('x-admin-id') ||
    req.get('x-admin-email') ||
    req.get('x-wallet-address') ||
    'unknown'
  );
}

function safeParseMetadata(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export function clearAdminAuditLogsForTests(): void {
  inMemoryLogs.length = 0;
  resetAuditLogs();
}