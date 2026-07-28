/**
 * @file withdrawalRecovery.ts
 * Partial-failure recovery for multi-step withdrawals (Issue #954).
 *
 * A withdrawal is not a single write: it submits an on-chain transaction, then
 * persists a transaction row, then re-prices the vault, then notifies. Any of
 * those steps can fail independently, and one of them — the on-chain submission
 * — cannot be undone. Before this module a mid-flight failure left the system in
 * an inconsistent state (funds moved on chain, ledger untouched) and returned a
 * bare 500 with no record of what had already happened.
 *
 * This module adds a journalled saga coordinator:
 *
 *   1. **Write-ahead journal.** Every step is journalled as `pending` *before*
 *      the first side effect runs, and each transition is written as it happens.
 *      A crash therefore always leaves evidence of how far the withdrawal got.
 *   2. **Resume-forward.** Re-running a saga skips steps already marked
 *      `completed`, so recovery never repeats a side effect. The on-chain step
 *      is pinned to a single attempt so a submission is never blindly repeated.
 *   3. **Compensation.** When no irreversible step has completed yet, completed
 *      steps are compensated in reverse order and the withdrawal is unwound
 *      cleanly.
 *   4. **Manual-intervention queue.** When irreversible progress exists and the
 *      remaining steps cannot be completed, the saga is parked as
 *      `needs_manual_intervention`, alerted on, and exposed to operators via
 *      admin endpoints instead of being silently dropped.
 *   5. **Background sweeper.** Sagas awaiting retry — and sagas left
 *      `in_progress` by a crashed process — are resumed with capped exponential
 *      backoff.
 *
 * Durability note: the journal lives in a bounded in-process ring buffer, the
 * same trade-off the write-ahead audit log and dead-letter queue make. A
 * `WithdrawalJournalSink` hook is provided so deployments can mirror every
 * transition to durable storage (Postgres/Redis) without touching this module.
 */

import crypto from 'crypto';
import { logger } from './middleware/structuredLogging';
import {
  withdrawalSagaTotal,
  withdrawalSagaStepFailureTotal,
  withdrawalSagaCompensationTotal,
  withdrawalSagaRetryTotal,
  withdrawalSagaAwaitingRecovery,
  withdrawalSagaManualInterventionRequired,
} from './metrics';

// ─── Types ────────────────────────────────────────────────────────────────────

/** How a step failure should be handled. */
export type WithdrawalFailureClass = 'retryable' | 'terminal';

/** Journal state of a single step. */
export type WithdrawalStepStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  /** Optional step failed; the saga carried on without it. */
  | 'skipped'
  | 'compensated'
  | 'compensation_failed';

/** Journal state of a whole withdrawal saga. */
export type WithdrawalSagaStatus =
  /** Steps are executing right now. */
  | 'in_progress'
  /** Every required step completed. */
  | 'completed'
  /** A retryable step failed; the sweeper will resume it. */
  | 'awaiting_retry'
  /** Completed steps were successfully undone; no residue remains. */
  | 'compensated'
  /** Irreversible progress exists that automation cannot finish or undo. */
  | 'needs_manual_intervention'
  /** Terminal failure with no side effects left behind. */
  | 'failed';

export interface WithdrawalSagaError {
  message: string;
  code?: string;
  classification: WithdrawalFailureClass;
  step: string;
  at: string;
}

export interface WithdrawalStepJournalEntry {
  name: string;
  status: WithdrawalStepStatus;
  attempts: number;
  maxAttempts: number;
  /** Effects of this step cannot be undone once it completes. */
  irreversible: boolean;
  /** Failures of this step do not fail the saga. */
  optional: boolean;
  /** Whether the step declares a compensating action. */
  compensatable: boolean;
  startedAt: string | null;
  completedAt: string | null;
  compensatedAt: string | null;
  lastError: WithdrawalSagaError | null;
}

export interface WithdrawalSagaRecord {
  id: string;
  /** Name of the registered plan this saga executes. */
  plan: string;
  /** Caller-supplied identity of the withdrawal (idempotency key when present). */
  withdrawalId: string;
  walletAddress: string;
  amount: string;
  asset: string;
  correlationId: string | null;
  idempotencyKey: string | null;
  status: WithdrawalSagaStatus;
  steps: WithdrawalStepJournalEntry[];
  /** Values produced by steps (txHash, row ids, …). Journalled so resume works. */
  state: Record<string, unknown>;
  /** Number of times the saga has been resumed after an initial attempt. */
  recoveryAttempts: number;
  /** ISO timestamp the sweeper may next resume this saga. */
  nextAttemptAt: string | null;
  requiresManualIntervention: boolean;
  manualResolution: {
    actor: string;
    note: string;
    outcome: WithdrawalSagaStatus;
    resolvedAt: string;
  } | null;
  lastError: WithdrawalSagaError | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** Context handed to a step's execute / compensate function. */
export interface WithdrawalStepContext {
  /** The journalled saga. Steps must treat it as read-only. */
  saga: WithdrawalSagaRecord;
  /** Shared, journalled state bag (same object as `saga.state`). */
  state: Record<string, unknown>;
  /** 1-based attempt number for this step. */
  attempt: number;
}

export interface WithdrawalStepDefinition {
  name: string;
  /**
   * Effects cannot be undone once the step completes (e.g. an on-chain
   * submission). Irreversible steps default to a single attempt so recovery
   * never repeats them.
   */
  irreversible?: boolean;
  /** Failures are logged but do not fail the saga (best-effort notifications). */
  optional?: boolean;
  /** Maximum execute attempts across all recovery passes. */
  maxAttempts?: number;
  execute: (ctx: WithdrawalStepContext) => Promise<Record<string, unknown> | void>;
  /** Undo the step's effects. Required for a step to be compensatable. */
  compensate?: (ctx: WithdrawalStepContext) => Promise<void>;
}

export interface BeginWithdrawalSagaInput {
  withdrawalId: string;
  walletAddress: string;
  amount: string;
  asset: string;
  correlationId?: string | null;
  idempotencyKey?: string | null;
  /** Seed values available to every step (never overwritten by the engine). */
  state?: Record<string, unknown>;
}

export interface WithdrawalSagaOutcome {
  saga: WithdrawalSagaRecord;
  status: WithdrawalSagaStatus;
  /** Every required step completed. */
  completed: boolean;
  /**
   * Irreversible progress exists while the saga is not complete — the on-chain
   * withdrawal happened but the ledger is not fully caught up yet.
   */
  partial: boolean;
  /** True while automated recovery is still scheduled. */
  recovering: boolean;
  /** The original error, so callers can map it to an HTTP status. */
  error?: unknown;
}

/** Optional mirror of every journal transition to durable storage. */
export type WithdrawalJournalSink = (saga: WithdrawalSagaRecord) => void | Promise<void>;

export interface WithdrawalRecoveryConfig {
  /** Default max attempts for reversible steps. */
  defaultMaxAttempts: number;
  /** Cap on automated resume passes per saga. */
  maxRecoveryAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  /** An `in_progress` saga untouched for this long is treated as crashed. */
  staleAfterMs: number;
  /** Max sagas resumed per sweep. */
  maxPerSweep: number;
  /** Bounded journal retention. */
  retention: number;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

/**
 * Raised when a withdrawal left irreversible on-chain effects behind that the
 * coordinator could neither finish nor undo automatically.
 */
export class WithdrawalPartialFailureError extends Error {
  constructor(
    readonly sagaId: string,
    readonly sagaStatus: WithdrawalSagaStatus,
    message = 'Withdrawal partially completed and requires recovery',
  ) {
    super(message);
    this.name = 'WithdrawalPartialFailureError';
  }
}

/** Raised when a plan name has not been registered. */
export class UnknownWithdrawalPlanError extends Error {
  constructor(plan: string) {
    super(`Unknown withdrawal plan: ${plan}`);
    this.name = 'UnknownWithdrawalPlanError';
  }
}

// ─── Plan registry ────────────────────────────────────────────────────────────

const plans = new Map<string, WithdrawalStepDefinition[]>();

/**
 * Register (or replace) the ordered step list for a plan. Registration is
 * required before a saga can be run *or resumed*, because recovery re-resolves
 * the step implementations by plan name.
 */
export function registerWithdrawalPlan(
  plan: string,
  steps: WithdrawalStepDefinition[],
): void {
  if (steps.length === 0) {
    throw new Error(`Withdrawal plan "${plan}" must declare at least one step`);
  }
  const names = new Set(steps.map((s) => s.name));
  if (names.size !== steps.length) {
    throw new Error(`Withdrawal plan "${plan}" has duplicate step names`);
  }
  plans.set(plan, steps);
}

export function getWithdrawalPlan(plan: string): WithdrawalStepDefinition[] {
  const steps = plans.get(plan);
  if (!steps) throw new UnknownWithdrawalPlanError(plan);
  return steps;
}

/** Test helper: drop all registered plans. */
export function clearWithdrawalPlans(): void {
  plans.clear();
}

// ─── Failure classification ───────────────────────────────────────────────────

const RETRYABLE_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EAI_AGAIN',
  'EPIPE',
  'ENOTFOUND',
  'EHOSTUNREACH',
  // Prisma: connection / pool / transaction-contention errors.
  'P1000',
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  'P2024',
  'P2034',
  'SOROBAN_CIRCUIT_OPEN',
]);

const TERMINAL_CODE_PATTERN = /^(VALIDATION|INVALID|UNPROCESSABLE|INSUFFICIENT|UNAUTHOR|FORBIDDEN|NOT_FOUND|CONFLICT)/i;

const RETRYABLE_MESSAGE_PATTERN =
  /timed? ?out|temporarily unavailable|connection|socket hang up|deadlock|serializ|econn|unavailable|too many requests|rate limit|circuit/i;

/**
 * Classify a step failure as retryable or terminal.
 *
 * Explicit signals win: `error.retryable`, then an error code, then an HTTP-ish
 * status code, then the message. Unknown failures default to **retryable**,
 * which is safe because attempts are capped per step, irreversible steps are
 * pinned to a single attempt, and an exhausted saga still lands in the
 * manual-intervention queue rather than disappearing.
 */
export function classifyWithdrawalFailure(err: unknown): WithdrawalFailureClass {
  if (!err || typeof err !== 'object') return 'retryable';
  const e = err as {
    retryable?: unknown;
    code?: unknown;
    statusCode?: unknown;
    status?: unknown;
    name?: unknown;
    message?: unknown;
  };

  if (typeof e.retryable === 'boolean') return e.retryable ? 'retryable' : 'terminal';

  const code = typeof e.code === 'string' ? e.code : undefined;
  if (code) {
    if (RETRYABLE_CODES.has(code)) return 'retryable';
    if (TERMINAL_CODE_PATTERN.test(code)) return 'terminal';
  }

  const status = typeof e.statusCode === 'number'
    ? e.statusCode
    : typeof e.status === 'number'
      ? e.status
      : undefined;
  if (typeof status === 'number') {
    if (status === 429 || status >= 500) return 'retryable';
    if (status >= 400) return 'terminal';
  }

  const message = typeof e.message === 'string' ? e.message : '';
  if (RETRYABLE_MESSAGE_PATTERN.test(message)) return 'retryable';

  return 'retryable';
}

// ─── Coordinator ──────────────────────────────────────────────────────────────

function parseIntEnv(raw: string | undefined, fallback: number, min = 1): number {
  const parsed = parseInt(raw ?? '', 10);
  if (Number.isNaN(parsed) || parsed < min) return fallback;
  return parsed;
}

const DEFAULT_CONFIG: WithdrawalRecoveryConfig = {
  defaultMaxAttempts: parseIntEnv(process.env.WITHDRAWAL_RECOVERY_MAX_STEP_ATTEMPTS, 3),
  maxRecoveryAttempts: parseIntEnv(process.env.WITHDRAWAL_RECOVERY_MAX_ATTEMPTS, 5),
  baseBackoffMs: parseIntEnv(process.env.WITHDRAWAL_RECOVERY_BASE_BACKOFF_MS, 2000),
  maxBackoffMs: parseIntEnv(process.env.WITHDRAWAL_RECOVERY_MAX_BACKOFF_MS, 60_000),
  staleAfterMs: parseIntEnv(process.env.WITHDRAWAL_RECOVERY_STALE_MS, 120_000),
  maxPerSweep: parseIntEnv(process.env.WITHDRAWAL_RECOVERY_MAX_PER_SWEEP, 25),
  retention: parseIntEnv(process.env.WITHDRAWAL_RECOVERY_RETENTION, 1000),
};

/** Statuses from which the coordinator may still make progress. */
const RESUMABLE_STATUSES: ReadonlySet<WithdrawalSagaStatus> = new Set<WithdrawalSagaStatus>([
  'in_progress',
  'awaiting_retry',
]);

export interface WithdrawalSagaFilters {
  status?: WithdrawalSagaStatus;
  walletAddress?: string;
  withdrawalId?: string;
  requiresManualIntervention?: boolean;
  limit?: number;
}

export class WithdrawalRecoveryCoordinator {
  private sagas: WithdrawalSagaRecord[] = [];
  private sink: WithdrawalJournalSink | null = null;
  private sweeper: NodeJS.Timeout | null = null;
  /** Saga ids with a pass currently executing, to prevent overlapping passes. */
  private readonly inFlight = new Set<string>();
  private sweeping = false;
  private compensations = 0;
  private compensationFailures = 0;
  private retries = 0;
  private manualInterventions = 0;

  constructor(readonly config: WithdrawalRecoveryConfig = DEFAULT_CONFIG) {}

  /** Mirror every journal transition to durable storage (best effort). */
  setJournalSink(sink: WithdrawalJournalSink | null): void {
    this.sink = sink;
  }

  // ─── Journal ──────────────────────────────────────────────────────────────

  /**
   * Journal a new saga with every step recorded as `pending` before any side
   * effect runs. If a resumable saga already exists for the same
   * `withdrawalId`, that saga is returned instead so a client retry can never
   * start a second on-chain submission.
   */
  begin(plan: string, input: BeginWithdrawalSagaInput): WithdrawalSagaRecord {
    const steps = getWithdrawalPlan(plan);

    const existing = this.findRecoverable(input.withdrawalId);
    if (existing) return existing;

    const now = new Date().toISOString();
    const saga: WithdrawalSagaRecord = {
      id: `wsaga_${crypto.randomBytes(8).toString('hex')}`,
      plan,
      withdrawalId: input.withdrawalId,
      walletAddress: input.walletAddress,
      amount: input.amount,
      asset: input.asset,
      correlationId: input.correlationId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      status: 'in_progress',
      steps: steps.map((def) => ({
        name: def.name,
        status: 'pending' as WithdrawalStepStatus,
        attempts: 0,
        maxAttempts: this.stepMaxAttempts(def),
        irreversible: def.irreversible === true,
        optional: def.optional === true,
        compensatable: def.irreversible !== true && typeof def.compensate === 'function',
        startedAt: null,
        completedAt: null,
        compensatedAt: null,
        lastError: null,
      })),
      state: { ...(input.state ?? {}) },
      recoveryAttempts: 0,
      nextAttemptAt: null,
      requiresManualIntervention: false,
      manualResolution: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };

    this.sagas.unshift(saga);
    this.trim();
    this.touch(saga);

    logger.log('info', 'Withdrawal saga journalled', {
      sagaId: saga.id,
      withdrawalId: saga.withdrawalId,
      walletAddress: saga.walletAddress,
      amount: saga.amount,
      asset: saga.asset,
      steps: saga.steps.map((s) => s.name),
    });

    return saga;
  }

  /** Journal a withdrawal and run it to completion, compensation, or parking. */
  async run(plan: string, input: BeginWithdrawalSagaInput): Promise<WithdrawalSagaOutcome> {
    const saga = this.begin(plan, input);

    if (saga.status === 'completed') return this.outcome(saga);
    if (!RESUMABLE_STATUSES.has(saga.status)) {
      // Parked for an operator (or already terminal) — never auto-advance it
      // from an inbound request.
      return this.outcome(saga);
    }

    return this.execute(saga);
  }

  /**
   * Resume a journalled saga. Completed steps are skipped, so no side effect is
   * ever repeated. Safe to call from the sweeper or an admin endpoint.
   */
  async resume(sagaId: string, opts: { force?: boolean } = {}): Promise<WithdrawalSagaOutcome | null> {
    const saga = this.get(sagaId);
    if (!saga) return null;

    if (saga.status === 'completed' || saga.status === 'compensated') {
      return this.outcome(saga);
    }
    if (!RESUMABLE_STATUSES.has(saga.status) && !opts.force) {
      return this.outcome(saga);
    }
    // Another pass is mid-flight (interval sweep racing an admin resume, say):
    // let it finish rather than running a step twice.
    if (this.inFlight.has(saga.id)) return this.outcome(saga);

    saga.recoveryAttempts += 1;
    saga.requiresManualIntervention = false;
    saga.nextAttemptAt = null;
    this.retries += 1;
    withdrawalSagaRetryTotal.inc({ plan: saga.plan });

    logger.log('info', 'Resuming withdrawal saga', {
      sagaId: saga.id,
      withdrawalId: saga.withdrawalId,
      recoveryAttempts: saga.recoveryAttempts,
      forced: opts.force === true,
    });

    return this.execute(saga);
  }

  // ─── Execution ────────────────────────────────────────────────────────────

  /** Guards a saga against two overlapping passes over the same journal. */
  private async execute(saga: WithdrawalSagaRecord): Promise<WithdrawalSagaOutcome> {
    if (this.inFlight.has(saga.id)) return this.outcome(saga);
    this.inFlight.add(saga.id);
    try {
      return await this.runSteps(saga);
    } finally {
      this.inFlight.delete(saga.id);
    }
  }

  private async runSteps(saga: WithdrawalSagaRecord): Promise<WithdrawalSagaOutcome> {
    const steps = getWithdrawalPlan(saga.plan);
    this.setStatus(saga, 'in_progress');

    for (const def of steps) {
      const entry = this.entryFor(saga, def);

      // Resume-forward: never repeat a completed or intentionally skipped step.
      if (entry.status === 'completed' || entry.status === 'skipped') continue;

      if (entry.attempts >= entry.maxAttempts) {
        return this.handleStepFailure(
          saga,
          entry,
          new Error(`Step "${def.name}" exhausted its ${entry.maxAttempts} attempt(s)`),
          'terminal',
        );
      }

      const attempt = entry.attempts + 1;
      entry.attempts = attempt;
      entry.status = 'in_progress';
      entry.startedAt = entry.startedAt ?? new Date().toISOString();
      this.touch(saga);

      try {
        const patch = await def.execute({ saga, state: saga.state, attempt });
        if (patch && typeof patch === 'object') Object.assign(saga.state, patch);
        entry.status = 'completed';
        entry.completedAt = new Date().toISOString();
        entry.lastError = null;
        this.touch(saga);
      } catch (err) {
        const classification = classifyWithdrawalFailure(err);
        const sagaError = this.toSagaError(err, def.name, classification);
        entry.lastError = sagaError;
        saga.lastError = sagaError;
        withdrawalSagaStepFailureTotal.inc({ step: def.name, classification });

        if (def.optional) {
          entry.status = 'skipped';
          this.touch(saga);
          logger.log('warn', 'Optional withdrawal step failed; continuing', {
            sagaId: saga.id,
            step: def.name,
            error: sagaError.message,
          });
          continue;
        }

        entry.status = 'failed';
        return this.handleStepFailure(saga, entry, err, classification);
      }
    }

    return this.markCompleted(saga);
  }

  private async handleStepFailure(
    saga: WithdrawalSagaRecord,
    entry: WithdrawalStepJournalEntry,
    err: unknown,
    classification: WithdrawalFailureClass,
  ): Promise<WithdrawalSagaOutcome> {
    const attemptsRemaining = entry.attempts < entry.maxAttempts;
    const recoveryBudgetLeft = saga.recoveryAttempts < this.config.maxRecoveryAttempts;

    if (classification === 'retryable' && attemptsRemaining && recoveryBudgetLeft) {
      this.setStatus(saga, 'awaiting_retry');
      saga.nextAttemptAt = new Date(Date.now() + this.backoffMs(entry.attempts)).toISOString();
      this.touch(saga);

      logger.log('warn', 'Withdrawal step failed; scheduled for recovery', {
        sagaId: saga.id,
        withdrawalId: saga.withdrawalId,
        step: entry.name,
        attempt: entry.attempts,
        maxAttempts: entry.maxAttempts,
        nextAttemptAt: saga.nextAttemptAt,
        irreversibleProgress: this.hasUnrecoverableProgress(saga),
        error: saga.lastError?.message,
      });

      return this.outcome(saga, err);
    }

    if (this.hasUnrecoverableProgress(saga)) {
      this.markManualIntervention(
        saga,
        `step "${entry.name}" failed after irreversible progress`,
      );
      return this.outcome(saga, err);
    }

    if (!saga.steps.some((s) => s.status === 'completed')) {
      // Failed before doing anything durable — nothing to undo.
      this.markFailed(saga);
      return this.outcome(saga, err);
    }

    await this.compensate(saga);
    return this.outcome(saga, err);
  }

  /**
   * Undo completed, compensatable steps in reverse order. Only called when no
   * irreversible step has completed, so a clean unwind is possible.
   */
  private async compensate(saga: WithdrawalSagaRecord): Promise<void> {
    const steps = getWithdrawalPlan(saga.plan);
    let failed = false;

    for (let i = steps.length - 1; i >= 0; i -= 1) {
      const def = steps[i];
      const entry = this.entryFor(saga, def);
      if (entry.status !== 'completed') continue;
      if (!def.compensate) continue;

      try {
        await def.compensate({ saga, state: saga.state, attempt: entry.attempts });
        entry.status = 'compensated';
        entry.compensatedAt = new Date().toISOString();
        this.compensations += 1;
        withdrawalSagaCompensationTotal.inc({ step: def.name, result: 'success' });
        this.touch(saga);
      } catch (err) {
        failed = true;
        entry.status = 'compensation_failed';
        entry.lastError = this.toSagaError(err, def.name, 'terminal');
        this.compensationFailures += 1;
        withdrawalSagaCompensationTotal.inc({ step: def.name, result: 'failure' });
        logger.log('error', 'Withdrawal compensation failed', {
          sagaId: saga.id,
          withdrawalId: saga.withdrawalId,
          step: def.name,
          error: entry.lastError.message,
        });
        this.touch(saga);
      }
    }

    if (failed) {
      this.markManualIntervention(saga, 'compensation failed');
      return;
    }

    this.setStatus(saga, 'compensated');
    saga.completedAt = new Date().toISOString();
    saga.nextAttemptAt = null;
    withdrawalSagaTotal.inc({ plan: saga.plan, outcome: 'compensated' });
    this.touch(saga);

    logger.log('warn', 'Withdrawal rolled back cleanly', {
      sagaId: saga.id,
      withdrawalId: saga.withdrawalId,
      walletAddress: saga.walletAddress,
      error: saga.lastError?.message,
    });
  }

  private markCompleted(saga: WithdrawalSagaRecord): WithdrawalSagaOutcome {
    this.setStatus(saga, 'completed');
    saga.completedAt = new Date().toISOString();
    saga.nextAttemptAt = null;
    saga.requiresManualIntervention = false;
    withdrawalSagaTotal.inc({ plan: saga.plan, outcome: 'completed' });
    this.touch(saga);

    if (saga.recoveryAttempts > 0) {
      logger.log('info', 'Withdrawal recovered after partial failure', {
        sagaId: saga.id,
        withdrawalId: saga.withdrawalId,
        recoveryAttempts: saga.recoveryAttempts,
      });
    }

    return this.outcome(saga);
  }

  private markFailed(saga: WithdrawalSagaRecord): void {
    this.setStatus(saga, 'failed');
    saga.completedAt = new Date().toISOString();
    saga.nextAttemptAt = null;
    withdrawalSagaTotal.inc({ plan: saga.plan, outcome: 'failed' });
    this.touch(saga);

    logger.log('warn', 'Withdrawal failed with no side effects to undo', {
      sagaId: saga.id,
      withdrawalId: saga.withdrawalId,
      failedStep: saga.lastError?.step,
      error: saga.lastError?.message,
    });
  }

  private markManualIntervention(saga: WithdrawalSagaRecord, reason: string): void {
    this.setStatus(saga, 'needs_manual_intervention');
    saga.requiresManualIntervention = true;
    saga.nextAttemptAt = null;
    this.manualInterventions += 1;
    withdrawalSagaTotal.inc({ plan: saga.plan, outcome: 'needs_manual_intervention' });
    this.touch(saga);

    // Alert-worthy: money moved on chain and the ledger is not consistent.
    logger.log('error', 'Withdrawal requires manual intervention', {
      alert: 'withdrawal-partial-failure',
      sagaId: saga.id,
      withdrawalId: saga.withdrawalId,
      walletAddress: saga.walletAddress,
      amount: saga.amount,
      asset: saga.asset,
      reason,
      txHash: typeof saga.state.txHash === 'string' ? saga.state.txHash : undefined,
      steps: saga.steps.map((s) => ({ name: s.name, status: s.status })),
      error: saga.lastError?.message,
    });
  }

  // ─── Sweeper ──────────────────────────────────────────────────────────────

  /**
   * Resume every saga that is due: `awaiting_retry` past its backoff, plus
   * `in_progress` sagas abandoned by a crashed process.
   */
  async sweep(now: number = Date.now()): Promise<{
    resumed: string[];
    stale: string[];
  }> {
    // A slow sweep must not overlap with the next interval tick.
    if (this.sweeping) return { resumed: [], stale: [] };
    this.sweeping = true;

    const stale: string[] = [];
    const resumed: string[] = [];

    try {
      const due = this.sagas
        .filter((saga) => this.isDue(saga, now))
        .slice(0, this.config.maxPerSweep);

      for (const saga of due) {
        if (saga.status === 'in_progress') stale.push(saga.id);
        const before = saga.status;
        await this.resume(saga.id);
        resumed.push(saga.id);
        logger.log('debug', 'Withdrawal saga swept', {
          sagaId: saga.id,
          from: before,
          to: saga.status,
        });
      }
    } finally {
      this.sweeping = false;
    }

    this.syncGauges();
    return { resumed, stale };
  }

  private isDue(saga: WithdrawalSagaRecord, now: number): boolean {
    if (saga.status === 'awaiting_retry') {
      return !saga.nextAttemptAt || Date.parse(saga.nextAttemptAt) <= now;
    }
    if (saga.status === 'in_progress') {
      // Crash recovery: nothing has touched this saga for staleAfterMs.
      return now - Date.parse(saga.updatedAt) >= this.config.staleAfterMs;
    }
    return false;
  }

  /** Start the periodic sweeper. Idempotent. */
  startSweeper(intervalMs = parseIntEnv(process.env.WITHDRAWAL_RECOVERY_SWEEP_MS, 15_000)): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => {
      void this.sweep().catch((err) => {
        logger.log('error', 'Withdrawal recovery sweep failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, intervalMs);
    if (typeof this.sweeper.unref === 'function') this.sweeper.unref();
    logger.log('info', 'Withdrawal recovery sweeper started', { intervalMs });
  }

  stopSweeper(): void {
    if (!this.sweeper) return;
    clearInterval(this.sweeper);
    this.sweeper = null;
  }

  // ─── Operator actions ─────────────────────────────────────────────────────

  /**
   * Close out a parked saga after an operator has reconciled it by hand.
   * `outcome` records what the operator did: finished it (`completed`), undid it
   * (`compensated`), or wrote it off (`failed`).
   */
  resolveManually(
    sagaId: string,
    actor: string,
    note: string,
    outcome: Extract<WithdrawalSagaStatus, 'completed' | 'compensated' | 'failed'> = 'completed',
  ): WithdrawalSagaRecord | null {
    const saga = this.get(sagaId);
    if (!saga) return null;

    this.setStatus(saga, outcome);
    saga.requiresManualIntervention = false;
    saga.nextAttemptAt = null;
    saga.completedAt = new Date().toISOString();
    saga.manualResolution = {
      actor,
      note,
      outcome,
      resolvedAt: saga.completedAt,
    };
    this.touch(saga);

    logger.log('info', 'Withdrawal saga manually resolved', {
      sagaId: saga.id,
      withdrawalId: saga.withdrawalId,
      actor,
      outcome,
      note,
    });

    return saga;
  }

  // ─── Queries ──────────────────────────────────────────────────────────────

  get(sagaId: string): WithdrawalSagaRecord | null {
    return this.sagas.find((s) => s.id === sagaId) ?? null;
  }

  /** Most recent saga for a withdrawal id, whatever its status. */
  getByWithdrawalId(withdrawalId: string): WithdrawalSagaRecord | null {
    return this.sagas.find((s) => s.withdrawalId === withdrawalId) ?? null;
  }

  /**
   * Saga for a withdrawal id that the coordinator can still act on, including
   * ones parked for an operator — those must never be duplicated by a retry.
   */
  findRecoverable(withdrawalId: string): WithdrawalSagaRecord | null {
    return (
      this.sagas.find(
        (s) =>
          s.withdrawalId === withdrawalId &&
          (RESUMABLE_STATUSES.has(s.status) || s.status === 'needs_manual_intervention'),
      ) ?? null
    );
  }

  list(filters: WithdrawalSagaFilters = {}): WithdrawalSagaRecord[] {
    const limit = Math.max(1, Math.min(filters.limit ?? 50, this.config.retention));
    return this.sagas
      .filter((saga) => {
        if (filters.status && saga.status !== filters.status) return false;
        if (filters.withdrawalId && saga.withdrawalId !== filters.withdrawalId) return false;
        if (
          filters.walletAddress &&
          saga.walletAddress.toUpperCase() !== filters.walletAddress.toUpperCase()
        ) {
          return false;
        }
        if (
          filters.requiresManualIntervention !== undefined &&
          saga.requiresManualIntervention !== filters.requiresManualIntervention
        ) {
          return false;
        }
        return true;
      })
      .slice(0, limit);
  }

  /** Sagas parked for an operator, newest first. */
  listPendingRecovery(): WithdrawalSagaRecord[] {
    return this.sagas.filter(
      (s) => s.status === 'needs_manual_intervention' || s.status === 'awaiting_retry',
    );
  }

  getMetrics() {
    const byStatus = this.sagas.reduce<Record<string, number>>((acc, saga) => {
      acc[saga.status] = (acc[saga.status] ?? 0) + 1;
      return acc;
    }, {});

    return {
      total: this.sagas.length,
      retention: this.config.retention,
      byStatus: {
        in_progress: byStatus.in_progress ?? 0,
        completed: byStatus.completed ?? 0,
        awaiting_retry: byStatus.awaiting_retry ?? 0,
        compensated: byStatus.compensated ?? 0,
        needs_manual_intervention: byStatus.needs_manual_intervention ?? 0,
        failed: byStatus.failed ?? 0,
      },
      requiresManualIntervention: this.sagas.filter((s) => s.requiresManualIntervention).length,
      compensations: this.compensations,
      compensationFailures: this.compensationFailures,
      recoveryAttempts: this.retries,
      manualInterventions: this.manualInterventions,
      sweeperRunning: this.sweeper !== null,
    };
  }

  /** Test helper: drop all journalled sagas and counters. */
  reset(): void {
    this.stopSweeper();
    this.sagas = [];
    this.inFlight.clear();
    this.sweeping = false;
    this.compensations = 0;
    this.compensationFailures = 0;
    this.retries = 0;
    this.manualInterventions = 0;
    this.syncGauges();
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private stepMaxAttempts(def: WithdrawalStepDefinition): number {
    if (typeof def.maxAttempts === 'number' && def.maxAttempts > 0) return def.maxAttempts;
    // An irreversible step is never repeated: a second on-chain submission
    // could move funds twice.
    if (def.irreversible) return 1;
    return this.config.defaultMaxAttempts;
  }

  private entryFor(
    saga: WithdrawalSagaRecord,
    def: WithdrawalStepDefinition,
  ): WithdrawalStepJournalEntry {
    let entry = saga.steps.find((s) => s.name === def.name);
    if (!entry) {
      // Plan gained a step after this saga was journalled — append it as pending
      // so recovery still runs it.
      entry = {
        name: def.name,
        status: 'pending',
        attempts: 0,
        maxAttempts: this.stepMaxAttempts(def),
        irreversible: def.irreversible === true,
        optional: def.optional === true,
        compensatable: def.irreversible !== true && typeof def.compensate === 'function',
        startedAt: null,
        completedAt: null,
        compensatedAt: null,
        lastError: null,
      };
      saga.steps.push(entry);
    }
    return entry;
  }

  /**
   * True when a completed step's effects cannot be undone — either it is
   * explicitly irreversible (on-chain submission) or it declares no
   * compensating action.
   */
  private hasUnrecoverableProgress(saga: WithdrawalSagaRecord): boolean {
    return saga.steps.some((s) => s.status === 'completed' && !s.compensatable);
  }

  private backoffMs(attempt: number): number {
    const exponential = this.config.baseBackoffMs * 2 ** Math.max(0, attempt - 1);
    return Math.min(this.config.maxBackoffMs, exponential);
  }

  private setStatus(saga: WithdrawalSagaRecord, status: WithdrawalSagaStatus): void {
    saga.status = status;
    this.syncGauges();
  }

  private outcome(saga: WithdrawalSagaRecord, error?: unknown): WithdrawalSagaOutcome {
    const completed = saga.status === 'completed';
    return {
      saga,
      status: saga.status,
      completed,
      partial: !completed && this.hasUnrecoverableProgress(saga),
      recovering: saga.status === 'awaiting_retry',
      error,
    };
  }

  private toSagaError(
    err: unknown,
    step: string,
    classification: WithdrawalFailureClass,
  ): WithdrawalSagaError {
    const code = (err as { code?: unknown } | null)?.code;
    return {
      message: err instanceof Error ? err.message : String(err),
      code: typeof code === 'string' ? code : undefined,
      classification,
      step,
      at: new Date().toISOString(),
    };
  }

  private touch(saga: WithdrawalSagaRecord): void {
    saga.updatedAt = new Date().toISOString();
    if (!this.sink) return;
    try {
      const maybePromise = this.sink(saga);
      if (maybePromise && typeof (maybePromise as Promise<void>).catch === 'function') {
        void (maybePromise as Promise<void>).catch((err) => {
          logger.log('warn', 'Withdrawal journal sink failed', {
            sagaId: saga.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    } catch (err) {
      logger.log('warn', 'Withdrawal journal sink threw', {
        sagaId: saga.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private syncGauges(): void {
    withdrawalSagaAwaitingRecovery.set(
      this.sagas.filter((s) => s.status === 'awaiting_retry').length,
    );
    withdrawalSagaManualInterventionRequired.set(
      this.sagas.filter((s) => s.status === 'needs_manual_intervention').length,
    );
  }

  private trim(): void {
    if (this.sagas.length <= this.config.retention) return;
    // Never evict a saga an operator still has to act on.
    const keep: WithdrawalSagaRecord[] = [];
    const evictable: WithdrawalSagaRecord[] = [];
    for (const saga of this.sagas) {
      if (saga.requiresManualIntervention || RESUMABLE_STATUSES.has(saga.status)) keep.push(saga);
      else evictable.push(saga);
    }
    const room = Math.max(0, this.config.retention - keep.length);
    this.sagas = [...keep, ...evictable.slice(0, room)].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
  }
}

export const withdrawalRecoveryCoordinator = new WithdrawalRecoveryCoordinator();
