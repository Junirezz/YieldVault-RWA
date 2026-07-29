const mockTx = {
  tenant: {
    updateMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  apiKey: {
    updateMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  criticalEntityAuditEvent: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
};

const mockPrisma = {
  $transaction: jest.fn(async (callback: (tx: typeof mockTx) => unknown) => callback(mockTx)),
  criticalEntityAuditEvent: {
    findMany: jest.fn(),
  },
};

jest.mock('../prisma', () => ({ prisma: mockPrisma }));

import {
  listCriticalEntityAuditTrail,
  restoreApiKey,
  restoreTenant,
  softDeleteApiKey,
  softDeleteTenant,
} from '../criticalEntityLifecycle';
import { assertCriticalEntityMutationAllowed } from '../criticalEntityPolicy';
import { createApiKey, rotateApiKey } from '../services/apiKeyService';

describe('critical entity lifecycle (Issue #1047)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTx.criticalEntityAuditEvent.create.mockResolvedValue({ id: 'audit-1' });
  });

  it('soft-deletes a tenant, disables its keys, and writes one atomic audit event', async () => {
    mockTx.tenant.updateMany.mockResolvedValue({ count: 1 });
    mockTx.apiKey.updateMany.mockResolvedValue({ count: 3 });

    const result = await softDeleteTenant('tenant-1', {
      actor: 'admin@example.com',
      reason: 'Customer account closed',
    });

    expect(result).toEqual({
      entityType: 'tenant',
      entityId: 'tenant-1',
      status: 'changed',
      affectedApiKeys: 3,
    });
    expect(mockTx.tenant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'tenant-1', deletedAt: null } })
    );
    expect(mockTx.apiKey.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-1', deletedAt: null },
        data: expect.objectContaining({ isActive: false }),
      })
    );
    expect(mockTx.criticalEntityAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: 'tenant',
        entityId: 'tenant-1',
        action: 'soft_delete',
        actor: 'admin@example.com',
        metadata: '{"affectedApiKeys":3}',
      }),
    });
  });

  it('makes concurrent tenant deletion retries idempotent without duplicate audits', async () => {
    mockTx.tenant.updateMany.mockResolvedValue({ count: 0 });
    mockTx.tenant.findUnique.mockResolvedValue({ deletedAt: new Date() });

    await expect(
      softDeleteTenant('tenant-1', { actor: 'admin', reason: 'duplicate request' })
    ).resolves.toMatchObject({ status: 'already_deleted' });

    expect(mockTx.apiKey.updateMany).not.toHaveBeenCalled();
    expect(mockTx.criticalEntityAuditEvent.create).not.toHaveBeenCalled();
  });

  it('restores a tenant without automatically restoring credentials', async () => {
    mockTx.tenant.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      restoreTenant('tenant-1', { actor: 'security-admin', reason: 'Closure reversed' })
    ).resolves.toMatchObject({ status: 'changed' });

    expect(mockTx.apiKey.updateMany).not.toHaveBeenCalled();
    expect(mockTx.criticalEntityAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'restore',
        metadata: '{"apiKeysRemainDisabled":true}',
      }),
    });
  });

  it('soft-deletes an API key without retaining its secret hash in the audit event', async () => {
    mockTx.apiKey.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      softDeleteApiKey('key-1', { actor: 'security-admin', reason: 'Credential compromised' })
    ).resolves.toMatchObject({ status: 'changed' });

    const auditData = mockTx.criticalEntityAuditEvent.create.mock.calls[0][0].data;
    expect(JSON.stringify(auditData)).not.toContain('hashedKey');
    expect(auditData).toMatchObject({
      entityType: 'api_key',
      entityId: 'key-1',
      action: 'soft_delete',
    });
  });

  it('does not restore an API key while its tenant is deleted', async () => {
    mockTx.apiKey.findUnique.mockResolvedValue({
      deletedAt: new Date(),
      tenant: { deletedAt: new Date() },
    });

    await expect(
      restoreApiKey('key-1', { actor: 'security-admin', reason: 'Requested restore' })
    ).resolves.toMatchObject({ status: 'parent_deleted' });

    expect(mockTx.apiKey.updateMany).not.toHaveBeenCalled();
    expect(mockTx.criticalEntityAuditEvent.create).not.toHaveBeenCalled();
  });

  it('uses a conditional update when restoring an API key to close tenant deletion races', async () => {
    mockTx.apiKey.findUnique.mockResolvedValue({
      deletedAt: new Date(),
      tenant: { deletedAt: null },
    });
    mockTx.apiKey.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      restoreApiKey('key-1', { actor: 'security-admin', reason: 'Credential approved' })
    ).resolves.toMatchObject({ status: 'changed' });

    expect(mockTx.apiKey.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'key-1',
          deletedAt: { not: null },
          tenant: { deletedAt: null },
        },
        data: expect.objectContaining({ isActive: true, deletedAt: null }),
      })
    );
  });

  it('treats a concurrent API key restore as an idempotent no-op', async () => {
    mockTx.apiKey.findUnique
      .mockResolvedValueOnce({
        deletedAt: new Date(),
        tenant: { deletedAt: null },
      })
      .mockResolvedValueOnce({
        deletedAt: null,
        tenant: { deletedAt: null },
      });
    mockTx.apiKey.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      restoreApiKey('key-1', { actor: 'security-admin', reason: 'Credential approved' })
    ).resolves.toMatchObject({ status: 'not_deleted' });
    expect(mockTx.criticalEntityAuditEvent.create).not.toHaveBeenCalled();
  });

  it('requires attributable actors and reasons', async () => {
    await expect(softDeleteApiKey('key-1', { actor: ' ', reason: 'reason' })).rejects.toThrow(
      'actor is required'
    );
    await expect(softDeleteApiKey('key-1', { actor: 'admin', reason: ' ' })).rejects.toThrow(
      'reason is required'
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns bounded, parsed immutable audit history', async () => {
    mockPrisma.criticalEntityAuditEvent.findMany.mockResolvedValue([
      {
        id: 'audit-1',
        entityType: 'tenant',
        entityId: 'tenant-1',
        action: 'soft_delete',
        actor: 'admin',
        reason: 'closed',
        metadata: '{"affectedApiKeys":2}',
        createdAt: new Date('2026-07-29T12:00:00.000Z'),
      },
    ]);

    await expect(
      listCriticalEntityAuditTrail({ entityType: 'tenant', entityId: 'tenant-1', limit: 9999 })
    ).resolves.toEqual([
      expect.objectContaining({
        metadata: { affectedApiKeys: 2 },
        createdAt: '2026-07-29T12:00:00.000Z',
      }),
    ]);
    expect(mockPrisma.criticalEntityAuditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 500 })
    );
  });
});

describe('API key lifecycle enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('refuses to create credentials for a missing or deleted tenant', async () => {
    mockTx.tenant.findFirst.mockResolvedValue(null);

    await expect(createApiKey('deleted-tenant')).rejects.toThrow('missing or deleted tenant');
    expect(mockTx.apiKey.create).not.toHaveBeenCalled();
  });

  it('uses a conditional update so rotation loses safely to tenant deletion', async () => {
    mockTx.apiKey.updateMany.mockResolvedValue({ count: 0 });

    await expect(rotateApiKey('key-1', 'replacement-secret')).resolves.toBeNull();
    expect(mockTx.apiKey.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'key-1',
          deletedAt: null,
          tenant: { deletedAt: null },
        },
      })
    );
  });
});

describe('critical entity hard-delete policy', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('blocks generic hard deletes outside tests', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertCriticalEntityMutationAllowed('Tenant', 'delete')).toThrow(
      'Hard delete blocked'
    );
    expect(() => assertCriticalEntityMutationAllowed('ApiKey', 'deleteMany')).toThrow(
      'Hard delete blocked'
    );
    expect(() =>
      assertCriticalEntityMutationAllowed('CriticalEntityAuditEvent', 'updateMany')
    ).toThrow('immutable');
  });

  it('allows non-critical deletes and explicit test cleanup', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertCriticalEntityMutationAllowed('ExportJob', 'deleteMany')).not.toThrow();
    process.env.NODE_ENV = 'test';
    expect(() => assertCriticalEntityMutationAllowed('Tenant', 'deleteMany')).not.toThrow();
  });
});
