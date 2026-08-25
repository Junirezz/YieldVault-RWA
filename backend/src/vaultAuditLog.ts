/**
 * @file vaultAuditLog.ts
 * Structured audit logging for vault lifecycle operations (Issue #888).
 *
 * Every deposit / withdrawal moves through a small state machine:
 *
 *   initiated → submitted → confirmed
 *                        ↘ failed
 *
 * This module records a structured audit entry at each transition. Entries are:
 *   - emitted as a single-line JSON log via the shared structured logger, so
 *     they flow into the existing log pipeline / SIEM; and
 *   - retained in a bounded in-memory ring buffer so operators can query recent
 *     vault activity (e.g. from an admin endpoint) without a log backend.
 *
 * The module is deliberately free of Express/Prisma coupling so it can be unit
 * tested in isolation and called from anywhere in the vault operation flow.
 */

import crypto from 'crypto';
import { logger } from './middleware/structuredLogging';
import { redactSensitiveAttributes } from './redaction';

/** Vault operations that emit lifecycle audit entries. */
export type VaultOperation = 'deposit' | 'withdrawal' | 'policy_change' | 'admin_action';

/** Lifecycle phase of a vault operation. */
export type VaultLifecyclePhase = 'initiated' | 'submitted' | 'confirmed' | 'failed';

/** Terminal outcome classification for a phase. */
export type VaultAuditOutcome = 'pending' | 'success' | 'failure';

export interface VaultAuditEntry {
  /** Unique id for this audit entry. */
  id: string;
  /** ISO-8601 timestamp the entry was recorded. */
  timestamp: string;
  /** Fully-qualified action, e.g. `vault.deposit.submitted`. */
  action: string;
  /** The vault operation. */
  operation: VaultOperation;
  /** Lifecycle phase. */
  phase: VaultLifecyclePhase;
  /** Outcome classification for the phase. */
  outcome: VaultAuditOutcome;
  /** Wallet address performing the operation (the actor). */
  actor: string;
  /** Operation amount as a string (never coerced to float). */
  amount?: string;
  /** Asset code for the operation. */
  asset?: string;
  /** On-chain transaction hash once known. */
  txHash?: string;
  /** Correlation id propagated from the inbound request. */
  correlationId?: string;
  /** Trace id from the active OTel span, when available. */
  traceId?: string;
  /** Machine-readable error code for failed phases. */
  errorCode?: string;
  /** Human-readable error message for failed phases. */
  errorMessage?: string;
  /** Additional, redaction-filtered context. */
  metadata?: Record<string, unknown>;
}

export interface RecordVaultLifecycleInput {
  operation: VaultOperation;
  phase: VaultLifecyclePhase;
  actor: string;
  amount?: string | number;
  asset?: string;
  txHash?: string;
  correlationId?: string;
  traceId?: string;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

interface VaultAuditFilters {
  operation?: VaultOperation;
  phase?: VaultLifecyclePhase;
  outcome?: VaultAuditOutcome;
  actor?: string;
  txHash?: string;
  limit?: number;
}

const entries: VaultAuditEntry[] = [];
const RETENTION_LIMIT = Math.max(
  1,
  parseInt(process.env.VAULT_AUDIT_LOG_RETENTION || '1000', 10) || 1000,
);

/** Map a lifecycle phase to its outcome classification. */
function phaseOutcome(phase: VaultLifecyclePhase): VaultAuditOutcome {
  if (phase === 'confirmed') return 'success';
  if (phase === 'failed') return 'failure';
  return 'pending';
}

/**
 * Record a structured audit entry for one vault lifecycle transition.
 *
 * The entry is both persisted to the in-memory ring buffer and emitted as a
 * structured log line. `failed` phases log at `warn`, everything else at
 * `info`. Returns the persisted entry so callers can assert / correlate.
 */
export function recordVaultLifecycleEvent(
  input: RecordVaultLifecycleInput,
): VaultAuditEntry {
  const outcome = phaseOutcome(input.phase);
  const entry: VaultAuditEntry = {
    id: `vaudit_${crypto.randomBytes(8).toString('hex')}`,
    timestamp: new Date().toISOString(),
    action: `vault.${input.operation}.${input.phase}`,
    operation: input.operation,
    phase: input.phase,
    outcome,
    actor: input.actor,
    amount: input.amount === undefined ? undefined : String(input.amount),
    asset: input.asset,
    txHash: input.txHash,
    correlationId: input.correlationId,
    traceId: input.traceId,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    metadata: input.metadata ? redactSensitiveAttributes(input.metadata) : undefined,
  };

  entries.unshift(entry);
  if (entries.length > RETENTION_LIMIT) {
    entries.length = RETENTION_LIMIT;
  }

  logger.log(input.phase === 'failed' ? 'warn' : 'info', entry.action, {
    audit: 'vault-lifecycle',
    auditId: entry.id,
    operation: entry.operation,
    phase: entry.phase,
    outcome: entry.outcome,
    actor: entry.actor,
    amount: entry.amount,
    asset: entry.asset,
    txHash: entry.txHash,
    correlationId: entry.correlationId,
    traceId: entry.traceId,
    errorCode: entry.errorCode,
  });

  return entry;
}

/**
 * Query the retained vault audit entries (most-recent first) with optional
 * filtering. `limit` is clamped to `[1, RETENTION_LIMIT]`.
 */
export function getVaultAuditLogs(filters: VaultAuditFilters = {}): VaultAuditEntry[] {
  const filtered = entries.filter((entry) => {
    if (filters.operation && entry.operation !== filters.operation) return false;
    if (filters.phase && entry.phase !== filters.phase) return false;
    if (filters.outcome && entry.outcome !== filters.outcome) return false;
    if (filters.actor && !entry.actor.includes(filters.actor)) return false;
    if (filters.txHash && entry.txHash !== filters.txHash) return false;
    return true;
  });

  const limit = Math.max(1, Math.min(filters.limit ?? 100, RETENTION_LIMIT));
  return filtered.slice(0, limit);
}

/** Aggregate counters useful for dashboards / health surfaces. */
export function getVaultAuditMetrics() {
  const byPhase: Record<VaultLifecyclePhase, number> = {
    initiated: 0,
    submitted: 0,
    confirmed: 0,
    failed: 0,
  };
  for (const entry of entries) {
    byPhase[entry.phase] += 1;
  }
  return {
    totalEntries: entries.length,
    retentionLimit: RETENTION_LIMIT,
    latestTimestamp: entries[0]?.timestamp ?? null,
    byPhase,
  };
}

/** Reset the in-memory buffer (test helper). */
export function resetVaultAuditLogs(): void {
  entries.length = 0;
}
