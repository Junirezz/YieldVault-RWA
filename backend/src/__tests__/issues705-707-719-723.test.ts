import { describe, it, expect, beforeEach } from '@jest/globals';

// Issue #705: Request context propagation
import {
  requestIdStorage,
  createRequestId,
  normalizeRequestId,
  getActiveRequestId,
  getActiveCorrelationId,
  captureRequestContext,
  runWithRequestContext,
  wrapWithContext,
  serializeContext,
  runWithSerializedContext,
} from '../requestContext';

// Issue #707: Write-ahead audit log
import { writeAheadAuditLog } from '../writeAheadAuditLog';

// Issue #719: Health probe decomposition
import { healthProbeService } from '../healthProbe';

// Issue #723: Scoped admin tokens
import { scopedAdminTokenStore } from '../scopedAdminTokens';

// ─── Issue #705: Deterministic request ID propagation ───────────────────────

describe('Issue #705: Request ID propagation across async job pipeline', () => {
  it('captures and restores request context across async boundaries', () => {
    const requestId = createRequestId();
    const correlationId = createRequestId();

    requestIdStorage.run({ requestId, correlationId }, () => {
      const captured = captureRequestContext();
      expect(captured).not.toBeNull();
      expect(captured!.requestId).toBe(requestId);
      expect(captured!.correlationId).toBe(correlationId);
    });
  });

  it('propagates context via runWithRequestContext', () => {
    const ctx = { requestId: 'req-123', correlationId: 'cor-456' };

    runWithRequestContext(ctx, () => {
      expect(getActiveRequestId()).toBe('req-123');
      expect(getActiveCorrelationId()).toBe('cor-456');
    });
  });

  it('wraps async functions with captured context', () => {
    const requestId = 'wrap-test-id';

    requestIdStorage.run({ requestId }, () => {
      const wrapped = wrapWithContext(() => {
        return getActiveRequestId();
      });

      // Call outside the original context
      requestIdStorage.run({ requestId: 'different' }, () => {
        const result = wrapped();
        expect(result).toBe(requestId);
      });
    });
  });

  it('serializes and deserializes context for queue payloads', () => {
    const ctx = {
      requestId: 'serial-1',
      correlationId: 'cor-serial-1',
      originService: 'api',
      parentJobId: 'job-42',
    };

    runWithRequestContext(ctx, () => {
      const serialized = serializeContext();
      expect(serialized).toEqual({
        requestId: 'serial-1',
        correlationId: 'cor-serial-1',
        originService: 'api',
        parentJobId: 'job-42',
      });

      // Restore from serialized
      runWithSerializedContext(serialized, () => {
        expect(getActiveRequestId()).toBe('serial-1');
        expect(getActiveCorrelationId()).toBe('cor-serial-1');
      });
    });
  });

  it('creates fallback context when deserializing null', () => {
    runWithSerializedContext(null, () => {
      const id = getActiveRequestId();
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
    });
  });

  it('returns null for captureRequestContext outside a context', () => {
    const captured = captureRequestContext();
    expect(captured).toBeNull();
  });

  it('normalizeRequestId rejects invalid formats', () => {
    expect(normalizeRequestId('')).toBeNull();
    expect(normalizeRequestId(null)).toBeNull();
    expect(normalizeRequestId(123)).toBeNull();
    expect(normalizeRequestId('a'.repeat(129))).toBeNull();
    expect(normalizeRequestId('has spaces')).toBeNull();
    expect(normalizeRequestId('valid-id:123')).toBe('valid-id:123');
  });
});

// ─── Issue #707: Write-ahead audit log ──────────────────────────────────────

describe('Issue #707: Write-ahead audit log for admin configuration changes', () => {
  beforeEach(async () => {
    await writeAheadAuditLog.clear();
  });

  it('prepares a pending WAL entry with pre-change snapshot', async () => {
    const entry = await writeAheadAuditLog.prepare({
      configType: 'maintenance',
      action: 'toggle',
      actor: 'admin-1',
      preChangeSnapshot: { enabled: false },
    });

    expect(entry.status).toBe('pending');
    expect(entry.preChangeSnapshot).toEqual({ enabled: false });
    expect(entry.postChangeSnapshot).toBeNull();
    expect(entry.configType).toBe('maintenance');
    expect(entry.id).toMatch(/^wal-/);
  });

  it('commits a WAL entry with post-change snapshot', async () => {
    const entry = await writeAheadAuditLog.prepare({
      configType: 'maintenance',
      action: 'toggle',
      actor: 'admin-1',
      preChangeSnapshot: { enabled: false },
    });

    const committed = await writeAheadAuditLog.commit(entry.id, { enabled: true });

    expect(committed).not.toBeNull();
    expect(committed!.status).toBe('committed');
    expect(committed!.postChangeSnapshot).toEqual({ enabled: true });
    expect(committed!.committedAt).not.toBeNull();
  });

  it('rolls back a WAL entry with reason', async () => {
    const entry = await writeAheadAuditLog.prepare({
      configType: 'feature_flags',
      action: 'override',
      actor: 'admin-2',
      preChangeSnapshot: { flag: 'old' },
    });

    const rolledBack = await writeAheadAuditLog.rollback(entry.id, 'validation failed');

    expect(rolledBack).not.toBeNull();
    expect(rolledBack!.status).toBe('rolled_back');
    expect(rolledBack!.metadata).toHaveProperty('rollbackReason', 'validation failed');
  });

  it('cannot commit an already committed entry', async () => {
    const entry = await writeAheadAuditLog.prepare({
      configType: 'test',
      action: 'update',
      actor: 'admin-1',
      preChangeSnapshot: {},
    });

    await writeAheadAuditLog.commit(entry.id, { value: 1 });
    const secondCommit = await writeAheadAuditLog.commit(entry.id, { value: 2 });

    expect(secondCommit).toBeNull();
  });

  it('lists entries with filters', async () => {
    await writeAheadAuditLog.prepare({
      configType: 'maintenance',
      action: 'toggle',
      actor: 'admin-1',
      preChangeSnapshot: {},
    });
    const entry2 = await writeAheadAuditLog.prepare({
      configType: 'feature_flags',
      action: 'override',
      actor: 'admin-2',
      preChangeSnapshot: {},
    });
    await writeAheadAuditLog.commit(entry2.id, {});

    const maintenanceEntries = await writeAheadAuditLog.list({ configType: 'maintenance' });
    expect(maintenanceEntries).toHaveLength(1);

    const committedEntries = await writeAheadAuditLog.list({ status: 'committed' });
    expect(committedEntries).toHaveLength(1);

    const pendingEntries = await writeAheadAuditLog.getPendingEntries();
    expect(pendingEntries).toHaveLength(1);
  });

  it('tracks metrics correctly', async () => {
    const e1 = await writeAheadAuditLog.prepare({
      configType: 'a',
      action: 'x',
      actor: 'admin',
      preChangeSnapshot: {},
    });
    const e2 = await writeAheadAuditLog.prepare({
      configType: 'b',
      action: 'y',
      actor: 'admin',
      preChangeSnapshot: {},
    });
    await writeAheadAuditLog.prepare({
      configType: 'c',
      action: 'z',
      actor: 'admin',
      preChangeSnapshot: {},
    });

    await writeAheadAuditLog.commit(e1.id, {});
    await writeAheadAuditLog.rollback(e2.id, 'err');

    const metrics = await writeAheadAuditLog.getMetrics();
    expect(metrics.total).toBe(3);
    expect(metrics.committed).toBe(1);
    expect(metrics.rolledBack).toBe(1);
    expect(metrics.pending).toBe(1);
    expect(metrics.stalePending).toBe(0);
  });

  it('surfaces stale pending entries in metrics (Issue #856)', async () => {
    const original = process.env.WAL_STALE_PENDING_TTL_MS;
    process.env.WAL_STALE_PENDING_TTL_MS = '0';

    try {
      await writeAheadAuditLog.prepare({
        configType: 'maintenance',
        action: 'toggle',
        actor: 'admin-1',
        preChangeSnapshot: {},
      });

      // With a TTL of 0ms, any pending entry is immediately "stale".
      await new Promise((resolve) => setTimeout(resolve, 5));

      const metrics = await writeAheadAuditLog.getMetrics();
      expect(metrics.pending).toBe(1);
      expect(metrics.stalePending).toBe(1);
    } finally {
      if (original === undefined) {
        delete process.env.WAL_STALE_PENDING_TTL_MS;
      } else {
        process.env.WAL_STALE_PENDING_TTL_MS = original;
      }
    }
  });

  it('a stale pending entry can still be rolled back (Issue #856)', async () => {
    const entry = await writeAheadAuditLog.prepare({
      configType: 'maintenance',
      action: 'toggle',
      actor: 'admin-1',
      preChangeSnapshot: {},
    });

    const rolledBack = await writeAheadAuditLog.rollback(entry.id, 'stale, abandoning');
    expect(rolledBack).not.toBeNull();
    expect(rolledBack!.status).toBe('rolled_back');

    const metrics = await writeAheadAuditLog.getMetrics();
    expect(metrics.pending).toBe(0);
    expect(metrics.rolledBack).toBe(1);
  });

  it('includes actor metadata (ipAddress, userAgent)', async () => {
    const entry = await writeAheadAuditLog.prepare({
      configType: 'test',
      action: 'update',
      actor: 'admin-x',
      ipAddress: '10.0.0.1',
      userAgent: 'TestAgent/1.0',
      preChangeSnapshot: { old: true },
      metadata: { extra: 'data' },
    });

    expect(entry.ipAddress).toBe('10.0.0.1');
    expect(entry.userAgent).toBe('TestAgent/1.0');
    expect(entry.metadata).toEqual({ extra: 'data' });
  });
});

// ─── Issue #719: Health probe decomposition ─────────────────────────────────

describe('Issue #719: Health probe decomposition for dependencies', () => {
  beforeEach(() => {
    healthProbeService.clear();
  });

  it('registers and checks a healthy dependency', async () => {
    healthProbeService.register('database', async () => 'up');

    const state = await healthProbeService.checkDependency('database');

    expect(state.status).toBe('up');
    expect(state.latencyMs).toBeGreaterThanOrEqual(0);
    expect(state.lastCheckedAt).not.toBeNull();
    expect(state.lastError).toBeNull();
    expect(state.consecutiveFailures).toBe(0);
  });

  it('records latency for probe checks', async () => {
    healthProbeService.register('cache', async () => {
      await new Promise((r) => setTimeout(r, 10));
      return 'up';
    });

    const state = await healthProbeService.checkDependency('cache');

    expect(state.latencyMs).toBeGreaterThanOrEqual(5);
  });

  it('tracks consecutive failures and last error', async () => {
    let callCount = 0;
    healthProbeService.register('stellarRpc', async () => {
      callCount++;
      throw new Error('RPC unavailable');
    });

    await healthProbeService.checkDependency('stellarRpc');
    const state = await healthProbeService.checkDependency('stellarRpc');

    expect(state.lastError).toBe('RPC unavailable');
    expect(state.lastErrorAt).not.toBeNull();
    expect(state.consecutiveFailures).toBe(2);
  });

  it('marks dependency as degraded for initial failures', async () => {
    healthProbeService.register('queue', async () => {
      throw new Error('queue error');
    });

    const state = await healthProbeService.checkDependency('queue');
    expect(state.status).toBe('degraded');
    expect(state.consecutiveFailures).toBe(1);
  });

  it('marks dependency as down after 3+ consecutive failures', async () => {
    healthProbeService.register('prisma', async () => {
      throw new Error('connection refused');
    });

    await healthProbeService.checkDependency('prisma');
    await healthProbeService.checkDependency('prisma');
    const state = await healthProbeService.checkDependency('prisma');

    expect(state.status).toBe('down');
    expect(state.consecutiveFailures).toBe(3);
  });

  it('resets consecutive failures when probe returns up', async () => {
    let shouldFail = true;
    healthProbeService.register('database', async () => {
      if (shouldFail) throw new Error('fail');
      return 'up';
    });

    await healthProbeService.checkDependency('database');
    shouldFail = false;
    const state = await healthProbeService.checkDependency('database');

    expect(state.status).toBe('up');
    expect(state.consecutiveFailures).toBe(0);
  });

  it('checks all registered probes at once', async () => {
    healthProbeService.register('database', async () => 'up');
    healthProbeService.register('cache', async () => 'up');
    healthProbeService.register('stellarRpc', async () => 'down');

    const results = await healthProbeService.checkAll();

    expect(results.database.status).toBe('up');
    expect(results.cache.status).toBe('up');
    expect(results.stellarRpc.status).toBe('degraded');
  });

  it('reports overall health status', async () => {
    healthProbeService.register('database', async () => 'up');
    healthProbeService.register('cache', async () => 'up');

    await healthProbeService.checkAll();
    expect(healthProbeService.isHealthy()).toBe(true);
  });

  it('returns down state for unregistered probes', async () => {
    const state = await healthProbeService.checkDependency('queue');
    expect(state.status).toBe('down');
    expect(state.lastError).toBe('Probe not registered');
  });
});

// ─── Issue #723: Permission-scoped admin tokens ─────────────────────────────

describe('Issue #723: Permission-scoped admin tokens with rotating key identifiers', () => {
  beforeEach(async () => {
    await scopedAdminTokenStore.clear();
  });

  it('creates a scoped token with permissions', async () => {
    const { token, secret } = await scopedAdminTokenStore.create({
      label: 'CI Pipeline',
      permissions: ['read:metrics', 'read:audit'],
      createdBy: 'admin-1',
    });

    expect(token.keyId).toMatch(/^yv_/);
    expect(token.permissions).toEqual(['read:metrics', 'read:audit']);
    expect(token.label).toBe('CI Pipeline');
    expect(token.revoked).toBe(false);
    expect(secret).toBeDefined();
    expect(secret.length).toBe(64);
  });

  it('authenticates a valid token', async () => {
    const { token, secret } = await scopedAdminTokenStore.create({
      label: 'Test Token',
      permissions: ['read:metrics'],
      createdBy: 'admin-1',
    });

    const authenticated = await scopedAdminTokenStore.authenticate(token.keyId, secret);
    expect(authenticated).not.toBeNull();
    expect(authenticated!.keyId).toBe(token.keyId);
  });

  it('rejects authentication with wrong secret', async () => {
    const { token } = await scopedAdminTokenStore.create({
      label: 'Test Token',
      permissions: ['read:metrics'],
      createdBy: 'admin-1',
    });

    const result = await scopedAdminTokenStore.authenticate(token.keyId, 'wrong-secret');
    expect(result).toBeNull();
  });

  it('rejects authentication for revoked tokens', async () => {
    const { token, secret } = await scopedAdminTokenStore.create({
      label: 'Revokable',
      permissions: ['read:metrics'],
      createdBy: 'admin-1',
    });

    await scopedAdminTokenStore.revoke(token.keyId);

    const result = await scopedAdminTokenStore.authenticate(token.keyId, secret);
    expect(result).toBeNull();
  });

  it('rejects authentication for expired tokens', async () => {
    const { token, secret } = await scopedAdminTokenStore.create({
      label: 'Short-lived',
      permissions: ['read:metrics'],
      expiresInSeconds: -1,
      createdBy: 'admin-1',
    });

    const result = await scopedAdminTokenStore.authenticate(token.keyId, secret);
    expect(result).toBeNull();
  });

  it('checks individual permissions', async () => {
    const { token } = await scopedAdminTokenStore.create({
      label: 'Partial',
      permissions: ['read:metrics', 'read:audit'],
      createdBy: 'admin-1',
    });

    expect(scopedAdminTokenStore.hasPermission(token, 'read:metrics')).toBe(true);
    expect(scopedAdminTokenStore.hasPermission(token, 'read:audit')).toBe(true);
    expect(scopedAdminTokenStore.hasPermission(token, 'write:config')).toBe(false);
  });

  it('admin:* permission grants access to all permissions', async () => {
    const { token } = await scopedAdminTokenStore.create({
      label: 'Super',
      permissions: ['admin:*'],
      createdBy: 'admin-1',
    });

    expect(scopedAdminTokenStore.hasPermission(token, 'read:metrics')).toBe(true);
    expect(scopedAdminTokenStore.hasPermission(token, 'write:config')).toBe(true);
    expect(scopedAdminTokenStore.hasPermission(token, 'write:maintenance')).toBe(true);
  });

  it('rotates token secret', async () => {
    const { token, secret: oldSecret } = await scopedAdminTokenStore.create({
      label: 'Rotatable',
      permissions: ['read:metrics'],
      createdBy: 'admin-1',
    });

    const result = await scopedAdminTokenStore.rotate(token.keyId);
    expect(result).not.toBeNull();
    expect(result!.newSecret).not.toBe(oldSecret);
    expect(result!.rotatedAt).toBeDefined();

    // Old secret no longer works
    expect(await scopedAdminTokenStore.authenticate(token.keyId, oldSecret)).toBeNull();
    // New secret works
    expect(await scopedAdminTokenStore.authenticate(token.keyId, result!.newSecret)).not.toBeNull();
  });

  it('cannot rotate revoked token', async () => {
    const { token } = await scopedAdminTokenStore.create({
      label: 'Revoked',
      permissions: ['read:metrics'],
      createdBy: 'admin-1',
    });

    await scopedAdminTokenStore.revoke(token.keyId);
    const result = await scopedAdminTokenStore.rotate(token.keyId);
    expect(result).toBeNull();
  });

  it('lists active tokens excluding revoked by default', async () => {
    await scopedAdminTokenStore.create({
      label: 'Active',
      permissions: ['read:metrics'],
      createdBy: 'admin-1',
    });
    const { token: revoked } = await scopedAdminTokenStore.create({
      label: 'Revoked',
      permissions: ['read:audit'],
      createdBy: 'admin-1',
    });
    await scopedAdminTokenStore.revoke(revoked.keyId);

    const activeOnly = await scopedAdminTokenStore.list();
    expect(activeOnly).toHaveLength(1);

    const all = await scopedAdminTokenStore.list({ includeRevoked: true });
    expect(all).toHaveLength(2);
  });

  it('rejects invalid permissions', async () => {
    await expect(
      scopedAdminTokenStore.create({
        label: 'Invalid',
        permissions: ['invalid:perm' as any],
        createdBy: 'admin-1',
      }),
    ).rejects.toThrow('Invalid permission');
  });

  it('rejects empty permissions array', async () => {
    await expect(
      scopedAdminTokenStore.create({
        label: 'Empty',
        permissions: [],
        createdBy: 'admin-1',
      }),
    ).rejects.toThrow('At least one permission is required');
  });

  it('returns valid permissions list', () => {
    const perms = scopedAdminTokenStore.getValidPermissions();
    expect(perms).toContain('read:audit');
    expect(perms).toContain('write:config');
    expect(perms).toContain('admin:*');
    expect(perms.length).toBeGreaterThan(5);
  });

  it('hasAnyPermission checks multiple permissions', async () => {
    const { token } = await scopedAdminTokenStore.create({
      label: 'Multi',
      permissions: ['read:metrics'],
      createdBy: 'admin-1',
    });

    expect(scopedAdminTokenStore.hasAnyPermission(token, ['read:metrics', 'write:config'])).toBe(true);
    expect(scopedAdminTokenStore.hasAnyPermission(token, ['write:config', 'write:maintenance'])).toBe(false);
  });
});
