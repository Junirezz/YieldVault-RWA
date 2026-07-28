// src/__tests__/withdrawalRecovery.test.ts
/**
 * Partial-failure recovery for multi-step withdrawals (Issue #954).
 *
 * Each test drives a synthetic plan so the failure can be placed at an exact
 * step boundary, which is the only way to assert that recovery never repeats an
 * irreversible side effect.
 */
// The production plan lives in vaultEndpoints, whose middleware chain pulls in
// the wallet nonce service. It is not exercised by these tests.
jest.mock('../walletNonce', () => ({
  walletNonceService: { issue: jest.fn(), consume: jest.fn() },
  NonceExpiredError: class NonceExpiredError extends Error {},
  NonceReplayError: class NonceReplayError extends Error {},
  NonceNotFoundError: class NonceNotFoundError extends Error {},
  NonceActionMismatchError: class NonceActionMismatchError extends Error {},
  NonceWalletMismatchError: class NonceWalletMismatchError extends Error {},
}));

import {
  WithdrawalRecoveryCoordinator,
  registerWithdrawalPlan,
  getWithdrawalPlan,
  classifyWithdrawalFailure,
  UnknownWithdrawalPlanError,
  type WithdrawalRecoveryConfig,
  type WithdrawalStepDefinition,
  type WithdrawalSagaRecord,
} from '../withdrawalRecovery';

const FAST_CONFIG: WithdrawalRecoveryConfig = {
  defaultMaxAttempts: 3,
  maxRecoveryAttempts: 5,
  baseBackoffMs: 10,
  maxBackoffMs: 40,
  staleAfterMs: 1_000,
  maxPerSweep: 25,
  retention: 100,
};

const WALLET = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';

/** Error that classifies as retryable (transient infrastructure failure). */
function transientError(message = 'connection reset by peer'): Error & { code: string } {
  return Object.assign(new Error(message), { code: 'ECONNRESET' });
}

/** Error that classifies as terminal (client / validation failure). */
function terminalError(message = 'amount exceeds available balance'): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 422 });
}

function beginInput(overrides: Partial<{ withdrawalId: string }> = {}) {
  return {
    withdrawalId: overrides.withdrawalId ?? 'wd-1',
    walletAddress: WALLET,
    amount: '250.000000',
    asset: 'USDC',
    correlationId: 'corr-1',
    idempotencyKey: overrides.withdrawalId ?? 'wd-1',
  };
}

function stepStatuses(saga: WithdrawalSagaRecord): Record<string, string> {
  return saga.steps.reduce<Record<string, string>>((acc, step) => {
    acc[step.name] = step.status;
    return acc;
  }, {});
}

describe('withdrawal partial-failure recovery', () => {
  let coordinator: WithdrawalRecoveryCoordinator;
  let planCounter = 0;

  beforeEach(() => {
    coordinator = new WithdrawalRecoveryCoordinator(FAST_CONFIG);
    planCounter += 1;
  });

  afterEach(() => {
    coordinator.reset();
  });

  /** Register a uniquely named plan so tests never share step closures. */
  function plan(steps: WithdrawalStepDefinition[]): string {
    const name = `test.plan.${planCounter}.${Math.random().toString(36).slice(2, 8)}`;
    registerWithdrawalPlan(name, steps);
    return name;
  }

  describe('journalling', () => {
    it('journals every step as pending before running any side effect', () => {
      const executed: string[] = [];
      const name = plan([
        { name: 'chain_submit', irreversible: true, execute: async () => { executed.push('chain_submit'); } },
        { name: 'persist', execute: async () => { executed.push('persist'); }, compensate: async () => undefined },
      ]);

      const saga = coordinator.begin(name, beginInput());

      expect(executed).toEqual([]);
      expect(saga.status).toBe('in_progress');
      expect(stepStatuses(saga)).toEqual({ chain_submit: 'pending', persist: 'pending' });
      expect(saga.steps[0].maxAttempts).toBe(1); // irreversible steps are never repeated
      expect(saga.steps[0].compensatable).toBe(false);
      expect(saga.steps[1].compensatable).toBe(true);
      expect(saga.steps[1].maxAttempts).toBe(FAST_CONFIG.defaultMaxAttempts);
    });

    it('records step results in the journalled state bag', async () => {
      const name = plan([
        { name: 'chain_submit', irreversible: true, execute: async () => ({ txHash: 'tx-abc' }) },
        {
          name: 'persist',
          execute: async ({ state }) => ({ rowId: `row-for-${state.txHash}` }),
          compensate: async () => undefined,
        },
      ]);

      const outcome = await coordinator.run(name, beginInput());

      expect(outcome.completed).toBe(true);
      expect(outcome.status).toBe('completed');
      expect(outcome.saga.state).toMatchObject({ txHash: 'tx-abc', rowId: 'row-for-tx-abc' });
      expect(outcome.saga.completedAt).not.toBeNull();
    });

    it('rejects unknown plans', async () => {
      await expect(coordinator.run('nope', beginInput())).rejects.toBeInstanceOf(
        UnknownWithdrawalPlanError,
      );
    });
  });

  describe('resume-forward after a partial failure', () => {
    it('does not re-submit on chain when a later step fails', async () => {
      const submits: number[] = [];
      let persistAttempts = 0;
      const name = plan([
        {
          name: 'chain_submit',
          irreversible: true,
          execute: async () => {
            submits.push(Date.now());
            return { txHash: 'tx-once' };
          },
        },
        {
          name: 'persist',
          execute: async () => {
            persistAttempts += 1;
            if (persistAttempts === 1) throw transientError();
            return { rowId: 'row-1' };
          },
          compensate: async () => undefined,
        },
        { name: 'reprice', execute: async () => undefined, compensate: async () => undefined },
      ]);

      const first = await coordinator.run(name, beginInput());

      // The withdrawal is on chain but the ledger is behind: recovery pending.
      expect(first.completed).toBe(false);
      expect(first.partial).toBe(true);
      expect(first.recovering).toBe(true);
      expect(first.status).toBe('awaiting_retry');
      expect(first.saga.nextAttemptAt).not.toBeNull();
      expect(stepStatuses(first.saga)).toEqual({
        chain_submit: 'completed',
        persist: 'failed',
        reprice: 'pending',
      });

      const resumed = await coordinator.resume(first.saga.id);

      expect(resumed?.completed).toBe(true);
      expect(resumed?.status).toBe('completed');
      expect(submits).toHaveLength(1); // never submitted twice
      expect(persistAttempts).toBe(2);
      expect(stepStatuses(resumed!.saga)).toEqual({
        chain_submit: 'completed',
        persist: 'completed',
        reprice: 'completed',
      });
      expect(resumed?.saga.recoveryAttempts).toBe(1);
    });

    it('escalates to manual intervention once the failing step exhausts its attempts', async () => {
      const name = plan([
        { name: 'chain_submit', irreversible: true, execute: async () => ({ txHash: 'tx-stuck' }) },
        {
          name: 'persist',
          maxAttempts: 2,
          execute: async () => {
            throw transientError('database is unavailable');
          },
          compensate: async () => undefined,
        },
      ]);

      const first = await coordinator.run(name, beginInput());
      expect(first.status).toBe('awaiting_retry');

      const second = await coordinator.resume(first.saga.id);

      expect(second?.status).toBe('needs_manual_intervention');
      expect(second?.partial).toBe(true);
      expect(second?.recovering).toBe(false);
      expect(second?.saga.requiresManualIntervention).toBe(true);
      expect(second?.saga.lastError).toMatchObject({
        step: 'persist',
        classification: 'retryable',
        code: 'ECONNRESET',
      });
      expect(coordinator.getMetrics().byStatus.needs_manual_intervention).toBe(1);
      expect(coordinator.listPendingRecovery().map((s) => s.id)).toEqual([first.saga.id]);
    });

    it('escalates immediately on a terminal failure after irreversible progress', async () => {
      const name = plan([
        { name: 'chain_submit', irreversible: true, execute: async () => ({ txHash: 'tx-t' }) },
        {
          name: 'persist',
          execute: async () => {
            throw terminalError('row violates a check constraint');
          },
          compensate: async () => undefined,
        },
      ]);

      const outcome = await coordinator.run(name, beginInput());

      expect(outcome.status).toBe('needs_manual_intervention');
      expect(outcome.partial).toBe(true);
      expect(outcome.saga.steps[1].attempts).toBe(1); // no retries for a terminal failure
    });

    it('treats a completed step with no compensator as irreversible progress', async () => {
      const name = plan([
        // Reversible by nature but declares no compensating action.
        { name: 'reserve', execute: async () => ({ reserved: true }) },
        {
          name: 'persist',
          execute: async () => {
            throw terminalError();
          },
          compensate: async () => undefined,
        },
      ]);

      const outcome = await coordinator.run(name, beginInput());

      expect(outcome.status).toBe('needs_manual_intervention');
      expect(outcome.partial).toBe(true);
    });
  });

  describe('compensation', () => {
    it('undoes completed steps in reverse order when nothing irreversible ran', async () => {
      const order: string[] = [];
      const name = plan([
        {
          name: 'reserve',
          execute: async () => {
            order.push('exec:reserve');
          },
          compensate: async () => {
            order.push('undo:reserve');
          },
        },
        {
          name: 'persist',
          execute: async () => {
            order.push('exec:persist');
          },
          compensate: async () => {
            order.push('undo:persist');
          },
        },
        {
          name: 'reprice',
          execute: async () => {
            throw terminalError('share price out of bounds');
          },
          compensate: async () => {
            order.push('undo:reprice');
          },
        },
      ]);

      const outcome = await coordinator.run(name, beginInput());

      expect(outcome.status).toBe('compensated');
      expect(outcome.completed).toBe(false);
      expect(outcome.partial).toBe(false); // no residue left behind
      expect(order).toEqual(['exec:reserve', 'exec:persist', 'undo:persist', 'undo:reserve']);
      expect(stepStatuses(outcome.saga)).toEqual({
        reserve: 'compensated',
        persist: 'compensated',
        reprice: 'failed',
      });
      expect(coordinator.getMetrics().compensations).toBe(2);
    });

    it('escalates when a compensating action itself fails', async () => {
      const name = plan([
        {
          name: 'persist',
          execute: async () => undefined,
          compensate: async () => {
            throw new Error('reversal write failed');
          },
        },
        {
          name: 'reprice',
          execute: async () => {
            throw terminalError();
          },
          compensate: async () => undefined,
        },
      ]);

      const outcome = await coordinator.run(name, beginInput());

      expect(outcome.status).toBe('needs_manual_intervention');
      expect(outcome.saga.requiresManualIntervention).toBe(true);
      expect(stepStatuses(outcome.saga).persist).toBe('compensation_failed');
      expect(coordinator.getMetrics().compensationFailures).toBe(1);
    });

    it('fails cleanly with nothing to undo when the first step fails', async () => {
      const submitError = terminalError('simulation rejected the transaction');
      const name = plan([
        {
          name: 'chain_submit',
          irreversible: true,
          execute: async () => {
            throw submitError;
          },
        },
        { name: 'persist', execute: async () => undefined, compensate: async () => undefined },
      ]);

      const outcome = await coordinator.run(name, beginInput());

      expect(outcome.status).toBe('failed');
      expect(outcome.partial).toBe(false);
      // The caller re-throws this so the existing HTTP error mapping applies.
      expect(outcome.error).toBe(submitError);
      expect(stepStatuses(outcome.saga).persist).toBe('pending');
    });
  });

  describe('optional steps', () => {
    it('skips a failing optional step and still completes the saga', async () => {
      const name = plan([
        { name: 'chain_submit', irreversible: true, execute: async () => ({ txHash: 'tx-opt' }) },
        {
          name: 'notify',
          optional: true,
          execute: async () => {
            throw new Error('webhook endpoint unreachable');
          },
        },
      ]);

      const outcome = await coordinator.run(name, beginInput());

      expect(outcome.status).toBe('completed');
      expect(stepStatuses(outcome.saga)).toEqual({ chain_submit: 'completed', notify: 'skipped' });
      expect(outcome.saga.steps[1].lastError?.message).toBe('webhook endpoint unreachable');
    });
  });

  describe('duplicate suppression', () => {
    it('resumes the existing saga instead of submitting a second time', async () => {
      let submits = 0;
      let persistFailures = 0;
      const name = plan([
        {
          name: 'chain_submit',
          irreversible: true,
          execute: async () => {
            submits += 1;
            return { txHash: 'tx-dup' };
          },
        },
        {
          name: 'persist',
          execute: async () => {
            persistFailures += 1;
            if (persistFailures < 2) throw transientError();
          },
          compensate: async () => undefined,
        },
      ]);

      const first = await coordinator.run(name, beginInput({ withdrawalId: 'wd-dup' }));
      expect(first.status).toBe('awaiting_retry');

      // Client retries with the same Idempotency-Key while recovery is pending.
      const retry = await coordinator.run(name, beginInput({ withdrawalId: 'wd-dup' }));

      expect(retry.saga.id).toBe(first.saga.id);
      expect(retry.status).toBe('completed');
      expect(submits).toBe(1);
      expect(coordinator.list({ withdrawalId: 'wd-dup' })).toHaveLength(1);
    });

    it('never auto-advances a saga parked for an operator', async () => {
      let persistAttempts = 0;
      const name = plan([
        { name: 'chain_submit', irreversible: true, maxAttempts: 1, execute: async () => ({ txHash: 'tx-park' }) },
        {
          name: 'persist',
          maxAttempts: 1,
          execute: async () => {
            persistAttempts += 1;
            throw terminalError();
          },
          compensate: async () => undefined,
        },
      ]);

      const first = await coordinator.run(name, beginInput({ withdrawalId: 'wd-park' }));
      expect(first.status).toBe('needs_manual_intervention');

      const retry = await coordinator.run(name, beginInput({ withdrawalId: 'wd-park' }));

      expect(retry.saga.id).toBe(first.saga.id);
      expect(retry.status).toBe('needs_manual_intervention');
      expect(persistAttempts).toBe(1); // untouched until an operator acts
    });
  });

  describe('sweeper', () => {
    it('resumes sagas whose backoff has elapsed and leaves the rest alone', async () => {
      let attempts = 0;
      const name = plan([
        { name: 'chain_submit', irreversible: true, execute: async () => ({ txHash: 'tx-sweep' }) },
        {
          name: 'persist',
          execute: async () => {
            attempts += 1;
            if (attempts === 1) throw transientError();
          },
          compensate: async () => undefined,
        },
      ]);

      const first = await coordinator.run(name, beginInput());
      expect(first.status).toBe('awaiting_retry');

      // Too early: the backoff has not elapsed.
      const early = await coordinator.sweep(Date.parse(first.saga.nextAttemptAt!) - 1);
      expect(early.resumed).toEqual([]);
      expect(coordinator.get(first.saga.id)?.status).toBe('awaiting_retry');

      const due = await coordinator.sweep(Date.parse(first.saga.nextAttemptAt!) + 1);
      expect(due.resumed).toEqual([first.saga.id]);
      expect(coordinator.get(first.saga.id)?.status).toBe('completed');
    });

    it('backs off exponentially between recovery passes, capped by config', async () => {
      const name = plan([
        { name: 'chain_submit', irreversible: true, execute: async () => ({ txHash: 'tx-backoff' }) },
        {
          name: 'persist',
          maxAttempts: 5,
          execute: async () => {
            throw transientError();
          },
          compensate: async () => undefined,
        },
      ]);

      const first = await coordinator.run(name, beginInput());
      const firstDelay = Date.parse(first.saga.nextAttemptAt!) - Date.parse(first.saga.updatedAt);

      await coordinator.resume(first.saga.id);
      const saga = coordinator.get(first.saga.id)!;
      const secondDelay = Date.parse(saga.nextAttemptAt!) - Date.parse(saga.updatedAt);

      expect(firstDelay).toBeGreaterThanOrEqual(FAST_CONFIG.baseBackoffMs - 5);
      expect(secondDelay).toBeGreaterThan(firstDelay);
      expect(secondDelay).toBeLessThanOrEqual(FAST_CONFIG.maxBackoffMs);
    });

    it('recovers a saga abandoned mid-flight by a crashed process', async () => {
      let released = false;
      const gate = new Promise<void>((resolve) => {
        setTimeout(() => {
          released = true;
          resolve();
        }, 5);
      });

      const name = plan([
        { name: 'chain_submit', irreversible: true, execute: async () => ({ txHash: 'tx-crash' }) },
        {
          name: 'persist',
          execute: async () => {
            await gate;
            return { released };
          },
          compensate: async () => undefined,
        },
      ]);

      // Simulate the crash: the journal says in_progress and nothing updated it.
      const saga = coordinator.begin(name, beginInput());
      saga.steps[0].status = 'completed';
      saga.steps[0].completedAt = new Date().toISOString();
      saga.state.txHash = 'tx-crash';
      saga.updatedAt = new Date(Date.now() - FAST_CONFIG.staleAfterMs - 1).toISOString();

      const result = await coordinator.sweep();

      expect(result.stale).toEqual([saga.id]);
      expect(coordinator.get(saga.id)?.status).toBe('completed');
      expect(coordinator.get(saga.id)?.state.released).toBe(true);
    });

    it('stops resuming once the recovery budget is spent', async () => {
      const config: WithdrawalRecoveryConfig = { ...FAST_CONFIG, maxRecoveryAttempts: 1 };
      const bounded = new WithdrawalRecoveryCoordinator(config);
      const name = plan([
        { name: 'chain_submit', irreversible: true, execute: async () => ({ txHash: 'tx-budget' }) },
        {
          name: 'persist',
          maxAttempts: 10,
          execute: async () => {
            throw transientError();
          },
          compensate: async () => undefined,
        },
      ]);

      const first = await bounded.run(name, beginInput());
      expect(first.status).toBe('awaiting_retry');

      const second = await bounded.resume(first.saga.id);
      expect(second?.status).toBe('needs_manual_intervention');
      expect(second?.saga.steps[1].attempts).toBe(2);

      bounded.reset();
    });
  });

  describe('operator actions', () => {
    it('closes out a parked saga and records who resolved it', async () => {
      const name = plan([
        { name: 'chain_submit', irreversible: true, execute: async () => ({ txHash: 'tx-manual' }) },
        {
          name: 'persist',
          maxAttempts: 1,
          execute: async () => {
            throw terminalError();
          },
          compensate: async () => undefined,
        },
      ]);

      const outcome = await coordinator.run(name, beginInput());
      expect(outcome.status).toBe('needs_manual_intervention');

      const resolved = coordinator.resolveManually(
        outcome.saga.id,
        'GADMIN',
        'ledger row inserted by hand, verified against tx-manual',
      );

      expect(resolved?.status).toBe('completed');
      expect(resolved?.requiresManualIntervention).toBe(false);
      expect(resolved?.manualResolution).toMatchObject({
        actor: 'GADMIN',
        outcome: 'completed',
      });
      expect(coordinator.listPendingRecovery()).toHaveLength(0);
      expect(coordinator.resolveManually('missing', 'GADMIN', 'note')).toBeNull();
    });

    it('force-resumes a parked saga on operator request', async () => {
      let fail = true;
      const name = plan([
        { name: 'chain_submit', irreversible: true, execute: async () => ({ txHash: 'tx-force' }) },
        {
          name: 'persist',
          maxAttempts: 5,
          execute: async () => {
            if (fail) throw terminalError();
          },
          compensate: async () => undefined,
        },
      ]);

      const parked = await coordinator.run(name, beginInput());
      expect(parked.status).toBe('needs_manual_intervention');

      // Without force, a parked saga is left alone.
      expect((await coordinator.resume(parked.saga.id))?.status).toBe('needs_manual_intervention');

      fail = false;
      const forced = await coordinator.resume(parked.saga.id, { force: true });
      expect(forced?.status).toBe('completed');
    });

    it('returns null when resuming an unknown saga', async () => {
      expect(await coordinator.resume('wsaga_missing')).toBeNull();
    });
  });

  describe('overlapping passes', () => {
    it('runs a step once when a sweep and an operator resume race', async () => {
      let releaseStep: () => void = () => undefined;
      let persistRuns = 0;
      const name = plan([
        { name: 'chain_submit', irreversible: true, execute: async () => ({ txHash: 'tx-race' }) },
        {
          name: 'persist',
          execute: async () => {
            persistRuns += 1;
            await new Promise<void>((resolve) => {
              releaseStep = resolve;
            });
          },
          compensate: async () => undefined,
        },
      ]);

      const saga = coordinator.begin(name, beginInput());
      saga.steps[0].status = 'completed';
      saga.state.txHash = 'tx-race';
      saga.status = 'awaiting_retry';

      const firstPass = coordinator.resume(saga.id);
      // Let the first pass reach the blocking step before racing it.
      await Promise.resolve();

      const secondPass = await coordinator.resume(saga.id);
      expect(secondPass?.status).toBe('in_progress'); // no second execution

      releaseStep();
      const settled = await firstPass;

      expect(settled?.status).toBe('completed');
      expect(persistRuns).toBe(1);
      expect(settled?.saga.recoveryAttempts).toBe(1);
    });
  });

  describe('observability', () => {
    it('mirrors every transition to the journal sink', async () => {
      const seen: string[] = [];
      coordinator.setJournalSink((saga) => {
        seen.push(`${saga.status}:${saga.steps.map((s) => s.status).join(',')}`);
      });

      const name = plan([
        { name: 'chain_submit', irreversible: true, execute: async () => ({ txHash: 'tx-sink' }) },
      ]);
      await coordinator.run(name, beginInput());

      expect(seen[0]).toBe('in_progress:pending');
      expect(seen[seen.length - 1]).toBe('completed:completed');
    });

    it('survives a throwing journal sink', async () => {
      coordinator.setJournalSink(() => {
        throw new Error('sink offline');
      });
      const name = plan([{ name: 'chain_submit', irreversible: true, execute: async () => undefined }]);

      await expect(coordinator.run(name, beginInput())).resolves.toMatchObject({
        completed: true,
      });
    });

    it('reports aggregate recovery metrics', async () => {
      const ok = plan([{ name: 'only', execute: async () => undefined, compensate: async () => undefined }]);
      const bad = plan([
        { name: 'chain_submit', irreversible: true, execute: async () => ({ txHash: 'x' }) },
        {
          name: 'persist',
          maxAttempts: 1,
          execute: async () => {
            throw terminalError();
          },
          compensate: async () => undefined,
        },
      ]);

      await coordinator.run(ok, beginInput({ withdrawalId: 'wd-ok' }));
      await coordinator.run(bad, beginInput({ withdrawalId: 'wd-bad' }));

      const metrics = coordinator.getMetrics();
      expect(metrics.total).toBe(2);
      expect(metrics.byStatus.completed).toBe(1);
      expect(metrics.byStatus.needs_manual_intervention).toBe(1);
      expect(metrics.requiresManualIntervention).toBe(1);
      expect(metrics.manualInterventions).toBe(1);
      expect(metrics.sweeperRunning).toBe(false);
    });

    it('filters the saga journal for operator queries', async () => {
      const name = plan([{ name: 'only', execute: async () => undefined, compensate: async () => undefined }]);
      await coordinator.run(name, beginInput({ withdrawalId: 'wd-a' }));
      await coordinator.run(name, beginInput({ withdrawalId: 'wd-b' }));

      expect(coordinator.list({ status: 'completed' })).toHaveLength(2);
      expect(coordinator.list({ withdrawalId: 'wd-a' })).toHaveLength(1);
      expect(coordinator.list({ walletAddress: WALLET.toLowerCase() })).toHaveLength(2);
      expect(coordinator.list({ walletAddress: 'GSOMEONEELSE' })).toHaveLength(0);
      expect(coordinator.list({ requiresManualIntervention: true })).toHaveLength(0);
      expect(coordinator.getByWithdrawalId('wd-b')?.withdrawalId).toBe('wd-b');
      expect(coordinator.getByWithdrawalId('wd-zzz')).toBeNull();
    });
  });

  describe('plan registration', () => {
    it('rejects empty and duplicate-step plans', () => {
      expect(() => registerWithdrawalPlan('bad.empty', [])).toThrow(/at least one step/);
      expect(() =>
        registerWithdrawalPlan('bad.dupes', [
          { name: 'a', execute: async () => undefined },
          { name: 'a', execute: async () => undefined },
        ]),
      ).toThrow(/duplicate step names/);
    });

    it('runs a step added to the plan after a saga was journalled', async () => {
      const name = `test.plan.grow.${planCounter}`;
      registerWithdrawalPlan(name, [
        { name: 'chain_submit', irreversible: true, execute: async () => ({ txHash: 'tx-grow' }) },
      ]);

      const saga = coordinator.begin(name, beginInput());
      expect(saga.steps).toHaveLength(1);

      let ranNewStep = false;
      registerWithdrawalPlan(name, [
        { name: 'chain_submit', irreversible: true, execute: async () => ({ txHash: 'tx-grow' }) },
        {
          name: 'persist',
          execute: async () => {
            ranNewStep = true;
          },
          compensate: async () => undefined,
        },
      ]);

      const outcome = await coordinator.resume(saga.id);

      expect(ranNewStep).toBe(true);
      expect(outcome?.status).toBe('completed');
      expect(outcome?.saga.steps.map((s) => s.name)).toEqual(['chain_submit', 'persist']);
    });
  });
});

describe('classifyWithdrawalFailure', () => {
  it.each([
    { label: 'explicit retryable flag', error: Object.assign(new Error('x'), { retryable: true }), expected: 'retryable' },
    { label: 'explicit terminal flag', error: Object.assign(new Error('x'), { retryable: false }), expected: 'terminal' },
    { label: 'socket reset', error: Object.assign(new Error('x'), { code: 'ECONNRESET' }), expected: 'retryable' },
    { label: 'prisma pool timeout', error: Object.assign(new Error('x'), { code: 'P2024' }), expected: 'retryable' },
    { label: 'open circuit', error: Object.assign(new Error('x'), { code: 'SOROBAN_CIRCUIT_OPEN' }), expected: 'retryable' },
    { label: 'validation code', error: Object.assign(new Error('x'), { code: 'VALIDATION_FAILED' }), expected: 'terminal' },
    { label: 'insufficient balance', error: Object.assign(new Error('x'), { code: 'INSUFFICIENT_FUNDS' }), expected: 'terminal' },
    { label: 'http 503', error: Object.assign(new Error('x'), { statusCode: 503 }), expected: 'retryable' },
    { label: 'http 429', error: Object.assign(new Error('x'), { statusCode: 429 }), expected: 'retryable' },
    { label: 'http 422', error: Object.assign(new Error('x'), { statusCode: 422 }), expected: 'terminal' },
    { label: 'timeout message', error: new Error('request timed out after 30s'), expected: 'retryable' },
    { label: 'unknown failure', error: new Error('something odd'), expected: 'retryable' },
    { label: 'non-error value', error: 'boom', expected: 'retryable' },
  ])('classifies $label as $expected', ({ error, expected }) => {
    expect(classifyWithdrawalFailure(error)).toBe(expected);
  });

  it('prefers an explicit flag over an otherwise-terminal status code', () => {
    expect(
      classifyWithdrawalFailure(Object.assign(new Error('x'), { statusCode: 422, retryable: true })),
    ).toBe('retryable');
  });
});

describe('registered vault withdrawal plan', () => {
  it('declares the on-chain submission as a single-attempt irreversible step', async () => {
    // Importing the router registers the production plan.
    await import('../vaultEndpoints');
    const steps = getWithdrawalPlan('vault.withdrawal');

    expect(steps.map((s) => s.name)).toEqual([
      'chain_submit',
      'persist_transaction',
      'vault_state_update',
    ]);
    expect(steps[0].irreversible).toBe(true);
    expect(steps[0].maxAttempts).toBe(1);
    expect(steps[0].compensate).toBeUndefined();
    // Both ledger writes must be undoable for a clean rollback.
    expect(typeof steps[1].compensate).toBe('function');
    expect(typeof steps[2].compensate).toBe('function');
  });
});
