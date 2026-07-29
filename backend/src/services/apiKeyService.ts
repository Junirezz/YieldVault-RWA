import { prisma } from '../prisma';
import crypto from 'crypto';
import type { ApiKeyRole } from '../middleware/apiKeyAuth';
import {
  restoreApiKey as restoreCriticalApiKey,
  softDeleteApiKey,
} from '../criticalEntityLifecycle';
import type { CriticalEntityActorContext } from '../criticalEntityLifecycle';

export interface ApiKeyRecord {
  id: string;
  tenantId: string;
  hashedKey: string;
  role: ApiKeyRole;
  scopes: string[];
  createdAt: Date;
  expiresAt?: Date | null;
  isActive: boolean;
  deletedAt?: Date | null;
  deletedBy?: string | null;
  deletionReason?: string | null;
}

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function serializeScopes(scopes: string[]): string {
  return JSON.stringify(scopes);
}

function deserializeScopes(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toApiKeyRecord(r: {
  id: string;
  tenantId: string;
  hashedKey: string;
  role: string;
  scopes: unknown;
  createdAt: Date;
  expiresAt: Date | null;
  isActive: boolean;
  deletedAt: Date | null;
  deletedBy: string | null;
  deletionReason: string | null;
}): ApiKeyRecord {
  return {
    id: r.id,
    tenantId: r.tenantId,
    hashedKey: r.hashedKey,
    role: r.role as ApiKeyRole,
    scopes: deserializeScopes(r.scopes),
    createdAt: r.createdAt,
    expiresAt: r.expiresAt ?? undefined,
    isActive: r.isActive,
    deletedAt: r.deletedAt ?? undefined,
    deletedBy: r.deletedBy ?? undefined,
    deletionReason: r.deletionReason ?? undefined,
  };
}

export async function createApiKey(
  tenantId: string,
  role: ApiKeyRole = 'admin',
  scopes: string[] = [],
  expiresInDays?: number
): Promise<{ plainKey: string; record: ApiKeyRecord }> {
  const plainKey = crypto.randomBytes(32).toString('hex');
  const hashedKey = hashApiKey(plainKey);
  const now = new Date();
  const expiresAt = expiresInDays
    ? new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const record = await prisma.$transaction(async (tx) => {
    const activeTenant = await tx.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!activeTenant) {
      throw new Error('Cannot create an API key for a missing or deleted tenant');
    }

    return tx.apiKey.create({
      data: {
        tenantId,
        hashedKey,
        role,
        scopes: serializeScopes(scopes),
        createdAt: now,
        expiresAt,
        isActive: true,
      },
    });
  });

  return { plainKey, record: toApiKeyRecord(record) };
}

export async function getApiKeyByHashed(hashed: string): Promise<ApiKeyRecord | null> {
  const record = await prisma.apiKey.findUnique({
    where: { hashedKey: hashed },
    include: { tenant: { select: { deletedAt: true } } },
  });
  if (!record) return null;
  if (!record.isActive || record.deletedAt || record.tenant.deletedAt) return null;
  if (record.expiresAt && record.expiresAt < new Date()) return null;
  return toApiKeyRecord(record);
}

export async function revokeApiKey(
  id: string,
  context: CriticalEntityActorContext = {
    actor: 'system',
    reason: 'API key revoked',
  }
): Promise<boolean> {
  const result = await softDeleteApiKey(id, context);
  return result.status === 'changed';
}

export async function restoreApiKey(
  id: string,
  context: CriticalEntityActorContext
): Promise<boolean> {
  const result = await restoreCriticalApiKey(id, context);
  return result.status === 'changed';
}

export async function rotateApiKey(
  id: string,
  newPlainKey: string,
  newScopes?: string[]
): Promise<ApiKeyRecord | null> {
  const hashedKey = hashApiKey(newPlainKey);
  const updateData: Record<string, unknown> = {
    hashedKey,
  };
  if (newScopes) updateData.scopes = serializeScopes(newScopes);
  const record = await prisma.$transaction(async (tx) => {
    const updated = await tx.apiKey.updateMany({
      where: {
        id,
        deletedAt: null,
        tenant: { deletedAt: null },
      },
      data: updateData,
    });
    if (updated.count === 0) return null;
    return tx.apiKey.findUnique({ where: { id } });
  });
  return record ? toApiKeyRecord(record) : null;
}

export async function listApiKeys(
  tenantId: string,
  options: { includeDeleted?: boolean } = {}
): Promise<ApiKeyRecord[]> {
  const records = await prisma.apiKey.findMany({
    where: {
      tenantId,
      ...(options.includeDeleted ? {} : { deletedAt: null }),
    },
  });
  return records.map((r) => toApiKeyRecord(r));
}
