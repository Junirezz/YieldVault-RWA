// src/__tests__/withdrawalRecoveryEndpoint.test.ts
/**
 * End-to-end behaviour of POST /vault/withdrawals when a ledger write fails
 * after the on-chain submission (Issue #954).
 *
 * The vault router is mounted on a local Express app rather than importing
 * src/index.ts, and Prisma is mocked, so the failure can be injected at an exact
 * step boundary.
 */

const upsertTransaction = jest.fn();
const updateTransaction = jest.fn();
const vaultStateTransaction = jest.fn();

jest.mock('../prismaClient', () => ({
  getPrismaClient: () => ({
    transaction: {
      upsert: (...args: unknown[]) => upsertTransaction(...args),
      update: (...args: unknown[]) => updateTransaction(...args),
      create: jest.fn().mockResolvedValue({ id: 'row-deposit' }),
    },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => vaultStateTransaction(fn),
  }),
  disconnectPrismaClient: jest.fn().mockResolvedValue(undefined),
}));

// The signed-action middleware pulls in the wallet nonce service, which is not
// exercised here (signature enforcement is off in tests).
jest.mock('../walletNonce', () => ({
  walletNonceService: {
    issue: jest.fn(),
    consume: jest.fn(),
  },
  NonceExpiredError: class NonceExpiredError extends Error {},
  NonceReplayError: class NonceReplayError extends Error {},
  NonceNotFoundError: class NonceNotFoundError extends Error {},
  NonceActionMismatchError: class NonceActionMismatchError extends Error {},
  NonceWalletMismatchError: class NonceWalletMismatchError extends Error {},
}));

jest.mock('../prisma', () => ({
  prisma: {
    transaction: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'row-1' }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    },
    $disconnect: jest.fn().mockResolvedValue(undefined),
  },
  getPrismaRuntimeConfig: () => ({}),
}));

import express from 'express';
import request from 'supertest';
import vaultRouter from '../vaultEndpoints';
import { withdrawalRecoveryCoordinator } from '../withdrawalRecovery';
import { idempotencyStore } from '../idempotency';
import { clearWithdrawalLimitStateForTests } from '../middleware/withdrawalDailyLimit';

/* eslint-disable @typescript-eslint/no-var-requires */
const sorobanMock = require('./mocks/sorobanClient.js');

const WALLET = `G${'B'.repeat(55)}`;

const app = express();
app.use(express.json());
app.use('/api/v1/vault', vaultRouter);

/** Transient DB failure: retryable, so the coordinator schedules recovery. */
function dbOutage(): Error & { code: string } {
  return Object.assign(new Error('connection refused by database'), { code: 'ECONNREFUSED' });
}

async function postWithdrawal(idempotencyKey: string) {
  return request(app)
    .post('/api/v1/vault/withdrawals')
    .set('Idempotency-Key', idempotencyKey)
    .send({ amount: 50, asset: 'USDC', walletAddress: WALLET });
}

describe('withdrawal endpoint partial-failure recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    withdrawalRecoveryCoordinator.reset();
    idempotencyStore.clear();
    clearWithdrawalLimitStateForTests();
    process.env.ALLOWLIST_ENABLED = 'false';
    delete process.env.WITHDRAWAL_DAILY_LIMIT_USDC;

    sorobanMock.submitVaultOperation.mockResolvedValue('mock-soroban-tx-hash-abcd1234');
    vaultStateTransaction.mockResolvedValue(undefined);
    upsertTransaction.mockResolvedValue({ id: 'row-withdrawal' });
  });

  afterAll(() => {
    withdrawalRecoveryCoordinator.reset();
  });

  it('acknowledges with 202 and a recovery handle when the ledger write fails', async () => {
    upsertTransaction.mockRejectedValueOnce(dbOutage());

    const response = await postWithdrawal('idem-partial-1');

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      type: 'withdrawal',
      status: 'recovering',
      // The on-chain leg succeeded, so the client is told the hash rather than
      // being told (falsely) that nothing happened.
      transactionHash: 'mock-soroban-tx-hash-abcd1234',
    });
    expect(response.body.recovery).toMatchObject({
      status: 'awaiting_retry',
      automatedRetryScheduled: true,
      failedStep: 'persist_transaction',
    });
    expect(response.body.recovery.steps).toEqual([
      { name: 'chain_submit', status: 'completed' },
      { name: 'persist_transaction', status: 'failed' },
      { name: 'vault_state_update', status: 'pending' },
    ]);
    expect(vaultStateTransaction).not.toHaveBeenCalled();
  });

  it('completes the withdrawal on the next recovery pass without re-submitting on chain', async () => {
    upsertTransaction.mockRejectedValueOnce(dbOutage());

    const accepted = await postWithdrawal('idem-partial-2');
    const sagaId = accepted.body.recovery.sagaId;
    expect(sorobanMock.submitVaultOperation).toHaveBeenCalledTimes(1);

    const resumed = await withdrawalRecoveryCoordinator.resume(sagaId);

    expect(resumed?.status).toBe('completed');
    expect(resumed?.completed).toBe(true);
    expect(resumed?.partial).toBe(false);
    expect(resumed?.saga.steps.map((s) => s.status)).toEqual([
      'completed',
      'completed',
      'completed',
    ]);

    // The irreversible step ran exactly once across both passes.
    expect(sorobanMock.submitVaultOperation).toHaveBeenCalledTimes(1);
    expect(resumed?.saga.steps[0].attempts).toBe(1);
    expect(upsertTransaction).toHaveBeenCalledTimes(2);
    expect(vaultStateTransaction).toHaveBeenCalledTimes(1);
  });

  it('upserts the same deterministic row id on every attempt', async () => {
    upsertTransaction.mockRejectedValueOnce(dbOutage());

    const accepted = await postWithdrawal('idem-deterministic-1');
    await withdrawalRecoveryCoordinator.resume(accepted.body.recovery.sagaId);

    const [firstCall, secondCall] = upsertTransaction.mock.calls;
    expect(firstCall[0].where.id).toMatch(/^wd_[0-9a-f]{28}$/);
    expect(secondCall[0].where.id).toBe(firstCall[0].where.id);
    expect(firstCall[0].create).toMatchObject({
      user: WALLET,
      type: 'withdrawal',
      status: 'completed',
    });
  });

  it('parks the saga for an operator once retries are exhausted', async () => {
    upsertTransaction.mockRejectedValue(dbOutage());

    const accepted = await postWithdrawal('idem-partial-3');
    const sagaId = accepted.body.recovery.sagaId;

    // Burn the remaining attempts (default 3 per reversible step).
    await withdrawalRecoveryCoordinator.resume(sagaId);
    await withdrawalRecoveryCoordinator.resume(sagaId);

    const saga = withdrawalRecoveryCoordinator.get(sagaId);
    expect(saga?.status).toBe('needs_manual_intervention');
    expect(saga?.requiresManualIntervention).toBe(true);
    expect(saga?.state.txHash).toBe('mock-soroban-tx-hash-abcd1234');
    expect(withdrawalRecoveryCoordinator.listPendingRecovery().map((s) => s.id)).toEqual([sagaId]);
    expect(
      withdrawalRecoveryCoordinator.getMetrics().byStatus.needs_manual_intervention,
    ).toBe(1);
  });

  it('rolls the withdrawal back when the failure precedes any irreversible step', async () => {
    sorobanMock.submitVaultOperation.mockRejectedValueOnce(
      new sorobanMock.SorobanSimulationError(
        'simulation failed: insufficient balance',
        'INSUFFICIENT_BALANCE',
        422,
      ),
    );

    const response = await postWithdrawal('idem-rollback-1');

    // Nothing durable happened, so the original failure is re-thrown and the
    // existing error mapping still applies.
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    expect(upsertTransaction).not.toHaveBeenCalled();
    expect(withdrawalRecoveryCoordinator.list()[0]).toMatchObject({
      status: 'failed',
      requiresManualIntervention: false,
    });
  });

  it('does not re-submit on chain when a client retries a recovering withdrawal', async () => {
    upsertTransaction.mockRejectedValueOnce(dbOutage());

    const first = await postWithdrawal('idem-retry-1');
    expect(first.status).toBe(202);

    // Same Idempotency-Key: replayed by the idempotency store, and even if it
    // reached the coordinator the journalled saga would be reused.
    const second = await postWithdrawal('idem-retry-1');

    expect(second.status).toBe(202);
    expect(sorobanMock.submitVaultOperation).toHaveBeenCalledTimes(1);
    expect(withdrawalRecoveryCoordinator.list({ withdrawalId: 'idem-retry-1' })).toHaveLength(1);
  });

  it('drives due sagas to completion from a sweep', async () => {
    upsertTransaction.mockRejectedValueOnce(dbOutage());
    const accepted = await postWithdrawal('idem-sweep-1');
    const sagaId = accepted.body.recovery.sagaId;

    // Make the saga due without waiting out the real backoff.
    const saga = withdrawalRecoveryCoordinator.get(sagaId)!;
    saga.nextAttemptAt = new Date(Date.now() - 1).toISOString();

    const sweep = await withdrawalRecoveryCoordinator.sweep();

    expect(sweep.resumed).toEqual([sagaId]);
    expect(withdrawalRecoveryCoordinator.get(sagaId)?.status).toBe('completed');
  });

  it('leaves deposits on the original non-journalled path', async () => {
    const response = await request(app)
      .post('/api/v1/vault/deposits')
      .send({ amount: 25, asset: 'USDC', walletAddress: WALLET });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('pending');
    // Deposits do not create withdrawal sagas.
    expect(withdrawalRecoveryCoordinator.list()).toHaveLength(0);
    expect(upsertTransaction).not.toHaveBeenCalled();
  });
});
