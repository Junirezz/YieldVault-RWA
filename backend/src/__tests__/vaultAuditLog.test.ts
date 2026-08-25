/**
 * Unit tests for the vault lifecycle audit log (Issue #888).
 *
 * Imports only the audit module, so it runs independently of the Express app.
 */
import {
  recordVaultLifecycleEvent,
  getVaultAuditLogs,
  getVaultAuditMetrics,
  resetVaultAuditLogs,
} from '../vaultAuditLog';

describe('vaultAuditLog', () => {
  beforeEach(() => {
    resetVaultAuditLogs();
    // Keep test output clean; the module logs each entry.
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('records a structured entry with derived action and outcome', () => {
    const entry = recordVaultLifecycleEvent({
      operation: 'deposit',
      phase: 'initiated',
      actor: 'GWALLET',
      amount: 100,
      asset: 'USDC',
      correlationId: 'corr-1',
    });

    expect(entry.action).toBe('vault.deposit.initiated');
    expect(entry.outcome).toBe('pending');
    expect(entry.amount).toBe('100');
    expect(entry.asset).toBe('USDC');
    expect(entry.id).toMatch(/^vaudit_/);
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('records policy changes and admin actions correctly', () => {
    const policyEntry = recordVaultLifecycleEvent({
      operation: 'policy_change',
      phase: 'confirmed',
      actor: 'GADMIN',
      correlationId: 'corr-2',
    });
    
    expect(policyEntry.action).toBe('vault.policy_change.confirmed');
    expect(policyEntry.outcome).toBe('success');

    const adminEntry = recordVaultLifecycleEvent({
      operation: 'admin_action',
      phase: 'confirmed',
      actor: 'GADMIN',
    });

    expect(adminEntry.action).toBe('vault.admin_action.confirmed');
    expect(adminEntry.outcome).toBe('success');
  });

  it('classifies confirmed as success and failed as failure', () => {
    const confirmed = recordVaultLifecycleEvent({
      operation: 'withdrawal',
      phase: 'confirmed',
      actor: 'GWALLET',
      txHash: 'abc123',
    });
    const failed = recordVaultLifecycleEvent({
      operation: 'withdrawal',
      phase: 'failed',
      actor: 'GWALLET',
      errorCode: 'SOROBAN_CIRCUIT_OPEN',
      errorMessage: 'circuit open',
    });

    expect(confirmed.outcome).toBe('success');
    expect(confirmed.action).toBe('vault.withdrawal.confirmed');
    expect(failed.outcome).toBe('failure');
    expect(failed.errorCode).toBe('SOROBAN_CIRCUIT_OPEN');
  });

  it('redacts sensitive metadata fields', () => {
    const entry = recordVaultLifecycleEvent({
      operation: 'deposit',
      phase: 'initiated',
      actor: 'GWALLET',
      metadata: { authorization: 'Bearer super-secret', idempotent: true },
    });

    expect(entry.metadata?.idempotent).toBe(true);
    expect(entry.metadata?.authorization).not.toBe('Bearer super-secret');
  });

  it('returns most-recent-first and supports filtering', () => {
    recordVaultLifecycleEvent({ operation: 'deposit', phase: 'initiated', actor: 'A' });
    recordVaultLifecycleEvent({ operation: 'withdrawal', phase: 'initiated', actor: 'B' });
    recordVaultLifecycleEvent({ operation: 'deposit', phase: 'confirmed', actor: 'A' });

    const all = getVaultAuditLogs();
    expect(all).toHaveLength(3);
    expect(all[0].phase).toBe('confirmed'); // newest first

    const deposits = getVaultAuditLogs({ operation: 'deposit' });
    expect(deposits).toHaveLength(2);
    expect(deposits.every((e) => e.operation === 'deposit')).toBe(true);

    const failures = getVaultAuditLogs({ outcome: 'failure' });
    expect(failures).toHaveLength(0);

    const actorB = getVaultAuditLogs({ actor: 'B' });
    expect(actorB).toHaveLength(1);
  });

  it('clamps the query limit', () => {
    for (let i = 0; i < 5; i += 1) {
      recordVaultLifecycleEvent({ operation: 'deposit', phase: 'initiated', actor: 'A' });
    }
    expect(getVaultAuditLogs({ limit: 2 })).toHaveLength(2);
    expect(getVaultAuditLogs({ limit: 0 })).toHaveLength(1);
  });

  it('aggregates metrics by phase', () => {
    recordVaultLifecycleEvent({ operation: 'deposit', phase: 'initiated', actor: 'A' });
    recordVaultLifecycleEvent({ operation: 'deposit', phase: 'submitted', actor: 'A' });
    recordVaultLifecycleEvent({ operation: 'deposit', phase: 'confirmed', actor: 'A' });

    const metrics = getVaultAuditMetrics();
    expect(metrics.totalEntries).toBe(3);
    expect(metrics.byPhase.initiated).toBe(1);
    expect(metrics.byPhase.submitted).toBe(1);
    expect(metrics.byPhase.confirmed).toBe(1);
    expect(metrics.byPhase.failed).toBe(0);
    expect(metrics.latestTimestamp).not.toBeNull();
  });
});
