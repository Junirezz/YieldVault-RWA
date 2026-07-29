/**
 * Atomic soft-delete/restore operations and immutable audit history for
 * critical control-plane entities (Issue #1047).
 */

import { prisma } from './prisma';

export type CriticalEntityType = 'tenant' | 'api_key';
export type CriticalEntityLifecycleAction = 'soft_delete' | 'restore';
export type CriticalEntityLifecycleStatus =
  | 'changed'
  | 'not_found'
  | 'already_deleted'
  | 'not_deleted'
  | 'parent_deleted';

export interface CriticalEntityActorContext {
  actor: string;
  reason: string;
}

export interface CriticalEntityLifecycleResult {
  entityType: CriticalEntityType;
  entityId: string;
  status: CriticalEntityLifecycleStatus;
  affectedApiKeys?: number;
}

export interface CriticalEntityAuditRecord {
  id: string;
  entityType: CriticalEntityType;
  entityId: string;
  action: CriticalEntityLifecycleAction;
  actor: string;
  reason: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CriticalEntityAuditFilters {
  entityType?: CriticalEntityType;
  entityId?: string;
  action?: CriticalEntityLifecycleAction;
  limit?: number;
}

function normalizeContext(context: CriticalEntityActorContext): CriticalEntityActorContext {
  const actor = context.actor.trim();
  const reason = context.reason.trim();
  if (!actor || actor.length > 200) {
    throw new Error('actor is required and must be at most 200 characters');
  }
  if (!reason || reason.length > 500) {
    throw new Error('reason is required and must be at most 500 characters');
  }
  return { actor, reason };
}

function auditData(
  entityType: CriticalEntityType,
  entityId: string,
  action: CriticalEntityLifecycleAction,
  context: CriticalEntityActorContext,
  metadata: Record<string, unknown> = {}
) {
  return {
    entityType,
    entityId,
    action,
    actor: context.actor,
    reason: context.reason,
    metadata: JSON.stringify(metadata),
  };
}

/**
 * Soft-deletes a tenant and atomically disables every active API key owned by
 * it. Conditional updates make concurrent retries idempotent.
 */
export async function softDeleteTenant(
  tenantId: string,
  rawContext: CriticalEntityActorContext
): Promise<CriticalEntityLifecycleResult> {
  const context = normalizeContext(rawContext);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const tenantUpdate = await tx.tenant.updateMany({
      where: { id: tenantId, deletedAt: null },
      data: {
        deletedAt: now,
        deletedBy: context.actor,
        deletionReason: context.reason,
      },
    });

    if (tenantUpdate.count === 0) {
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { deletedAt: true },
      });
      return {
        entityType: 'tenant' as const,
        entityId: tenantId,
        status: tenant ? ('already_deleted' as const) : ('not_found' as const),
      };
    }

    const apiKeyUpdate = await tx.apiKey.updateMany({
      where: { tenantId, deletedAt: null },
      data: {
        isActive: false,
        deletedAt: now,
        deletedBy: context.actor,
        deletionReason: `Tenant deleted: ${context.reason}`,
      },
    });

    await tx.criticalEntityAuditEvent.create({
      data: auditData('tenant', tenantId, 'soft_delete', context, {
        affectedApiKeys: apiKeyUpdate.count,
      }),
    });

    return {
      entityType: 'tenant' as const,
      entityId: tenantId,
      status: 'changed' as const,
      affectedApiKeys: apiKeyUpdate.count,
    };
  });
}

/**
 * Restores a tenant. API keys remain disabled and require individual,
 * explicitly audited restoration.
 */
export async function restoreTenant(
  tenantId: string,
  rawContext: CriticalEntityActorContext
): Promise<CriticalEntityLifecycleResult> {
  const context = normalizeContext(rawContext);

  return prisma.$transaction(async (tx) => {
    const tenantUpdate = await tx.tenant.updateMany({
      where: { id: tenantId, deletedAt: { not: null } },
      data: {
        deletedAt: null,
        deletedBy: null,
        deletionReason: null,
      },
    });

    if (tenantUpdate.count === 0) {
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { deletedAt: true },
      });
      return {
        entityType: 'tenant' as const,
        entityId: tenantId,
        status: tenant ? ('not_deleted' as const) : ('not_found' as const),
      };
    }

    await tx.criticalEntityAuditEvent.create({
      data: auditData('tenant', tenantId, 'restore', context, {
        apiKeysRemainDisabled: true,
      }),
    });

    return {
      entityType: 'tenant' as const,
      entityId: tenantId,
      status: 'changed' as const,
    };
  });
}

export async function softDeleteApiKey(
  apiKeyId: string,
  rawContext: CriticalEntityActorContext
): Promise<CriticalEntityLifecycleResult> {
  const context = normalizeContext(rawContext);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const keyUpdate = await tx.apiKey.updateMany({
      where: { id: apiKeyId, deletedAt: null },
      data: {
        isActive: false,
        deletedAt: now,
        deletedBy: context.actor,
        deletionReason: context.reason,
      },
    });

    if (keyUpdate.count === 0) {
      const key = await tx.apiKey.findUnique({
        where: { id: apiKeyId },
        select: { deletedAt: true },
      });
      return {
        entityType: 'api_key' as const,
        entityId: apiKeyId,
        status: key ? ('already_deleted' as const) : ('not_found' as const),
      };
    }

    await tx.criticalEntityAuditEvent.create({
      data: auditData('api_key', apiKeyId, 'soft_delete', context),
    });

    return {
      entityType: 'api_key' as const,
      entityId: apiKeyId,
      status: 'changed' as const,
    };
  });
}

export async function restoreApiKey(
  apiKeyId: string,
  rawContext: CriticalEntityActorContext
): Promise<CriticalEntityLifecycleResult> {
  const context = normalizeContext(rawContext);

  return prisma.$transaction(async (tx) => {
    const key = await tx.apiKey.findUnique({
      where: { id: apiKeyId },
      select: {
        deletedAt: true,
        tenant: { select: { deletedAt: true } },
      },
    });

    if (!key) {
      return { entityType: 'api_key' as const, entityId: apiKeyId, status: 'not_found' as const };
    }
    if (!key.deletedAt) {
      return { entityType: 'api_key' as const, entityId: apiKeyId, status: 'not_deleted' as const };
    }
    if (key.tenant.deletedAt) {
      return {
        entityType: 'api_key' as const,
        entityId: apiKeyId,
        status: 'parent_deleted' as const,
      };
    }

    const keyUpdate = await tx.apiKey.updateMany({
      where: {
        id: apiKeyId,
        deletedAt: { not: null },
        tenant: { deletedAt: null },
      },
      data: {
        isActive: true,
        deletedAt: null,
        deletedBy: null,
        deletionReason: null,
      },
    });

    if (keyUpdate.count === 0) {
      const current = await tx.apiKey.findUnique({
        where: { id: apiKeyId },
        select: {
          deletedAt: true,
          tenant: { select: { deletedAt: true } },
        },
      });
      let status: CriticalEntityLifecycleStatus = 'not_deleted';
      if (!current) {
        status = 'not_found';
      } else if (current.deletedAt && current.tenant.deletedAt) {
        status = 'parent_deleted';
      }
      return {
        entityType: 'api_key' as const,
        entityId: apiKeyId,
        status,
      };
    }

    await tx.criticalEntityAuditEvent.create({
      data: auditData('api_key', apiKeyId, 'restore', context),
    });

    return {
      entityType: 'api_key' as const,
      entityId: apiKeyId,
      status: 'changed' as const,
    };
  });
}

export async function listCriticalEntityAuditTrail(
  filters: CriticalEntityAuditFilters = {}
): Promise<CriticalEntityAuditRecord[]> {
  const limit = Math.max(1, Math.min(filters.limit ?? 100, 500));
  const rows = await prisma.criticalEntityAuditEvent.findMany({
    where: {
      ...(filters.entityType ? { entityType: filters.entityType } : {}),
      ...(filters.entityId ? { entityId: filters.entityId } : {}),
      ...(filters.action ? { action: filters.action } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return rows.map((row) => ({
    id: row.id,
    entityType: row.entityType as CriticalEntityType,
    entityId: row.entityId,
    action: row.action as CriticalEntityLifecycleAction,
    actor: row.actor,
    reason: row.reason,
    metadata: parseMetadata(row.metadata),
    createdAt: row.createdAt.toISOString(),
  }));
}

function parseMetadata(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
