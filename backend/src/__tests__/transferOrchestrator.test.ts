// src/__tests__/transferOrchestrator.test.ts
//
// The orchestrator imports './sorobanClient', which jest.config.js remaps to
// src/__tests__/mocks/sorobanClient.js. The previous version of this file called
// jest.mock('../sorobanClient') instead — a different module id, which the
// mapper does not redirect — so the spy it asserted on was never the function
// the orchestrator called and the assertion could not pass. Drive the mapped
// mock directly.
import {
  orchestrateTransfer,
  buildTransferStoreKey,
  classifyTransferFailure,
  listInDoubtTransfers,
  getInDoubtTransfer,
  resolveInDoubtTransfer,
  resetTransferOrchestratorForTests,
  TransferValidationError,
  TransferConflictError,
  TransferInDoubtError,
  TransferUnavailableError,
  TransferOrchestrationError,
  type TransferParams,
} from '../transferOrchestrator';
import { idempotencyStore } from '../idempotency';
import { sorobanCircuitBreaker, CircuitOpenError } from '../circuitBreaker';
import { VALID_TEST_WALLET, SECOND_TEST_WALLET } from './setup';

// Requiring the mock by its own path lands on the same module-registry entry
// the mapper hands the orchestrator, so this spy really is the function under
// test. Requiring '../sorobanClient' would resolve the *real* module instead —
// the mapper only rewrites the './sorobanClient' specifier.
const sorobanClient = require('./mocks/sorobanClient') as {
  submitVaultOperation: jest.Mock;
};

/** Mirrors SorobanSimulationError's shape (code + statusCode). */
class FakeSorobanError extends Error {
  code: string;
  statusCode: number;
  constructor(message: string, code: string, statusCode = 502) {
    super(message);
    this.name = 'SorobanSimulationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const params: TransferParams = {
  operationType: 'deposit',
  walletAddress: VALID_TEST_WALLET,
  amount: '1000',
  asset: 'USDC',
};

let keyCounter = 0;
/** Unique per test so the shared idempotency store never leaks across cases. */
const freshKey = () => `idem-key-${Date.now()}-${keyCounter++}`;

describe('transferOrchestrator', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    sorobanClient.submitVaultOperation.mockReset();
    sorobanClient.submitVaultOperation.mockResolvedValue('txhash-123');
    idempotencyStore.clear();
    resetTransferOrchestratorForTests();
    // Keep the shared breaker CLOSED regardless of what other suites did.
    jest.spyOn(sorobanCircuitBreaker, 'execute').mockImplementation((fn) => fn());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Happy path & replay ─────────────────────────────────────────────────────

  describe('submission and replay', () => {
    test('submits once and returns the transaction hash', async () => {
      const res = await orchestrateTransfer(params, freshKey());

      expect(sorobanClient.submitVaultOperation).toHaveBeenCalledTimes(1);
      expect(sorobanClient.submitVaultOperation).toHaveBeenCalledWith(
        'deposit',
        VALID_TEST_WALLET,
        '1000',
        'USDC',
      );
      expect(res.result).toEqual({ statusCode: 200, body: 'txhash-123' });
      expect(res.transactionHash).toBe('txhash-123');
      expect(res.replayed).toBe(false);
      expect(res.outcome).toBe('submitted');
    });

    test('preserves the smallest supported token amount exactly', async () => {
      await orchestrateTransfer({ ...params, amount: '0.0000001' }, freshKey());

      expect(sorobanClient.submitVaultOperation).toHaveBeenCalledWith(
        'deposit',
        VALID_TEST_WALLET,
        '0.0000001',
        'USDC',
      );
    });

    test('a repeat with the same key replays without a second submission', async () => {
      const key = freshKey();
      const first = await orchestrateTransfer(params, key);
      const second = await orchestrateTransfer(params, key);

      expect(sorobanClient.submitVaultOperation).toHaveBeenCalledTimes(1);
      expect(second.transactionHash).toBe(first.transactionHash);
      expect(second.replayed).toBe(true);
      expect(second.outcome).toBe('replayed');
    });

    test('concurrent calls with the same key coalesce into one submission', async () => {
      const key = freshKey();
      let release!: (hash: string) => void;
      sorobanClient.submitVaultOperation.mockImplementation(
        () => new Promise<string>((resolve) => { release = resolve; }),
      );

      const inFlight = Promise.all([
        orchestrateTransfer(params, key),
        orchestrateTransfer(params, key),
        orchestrateTransfer(params, key),
      ]);
      // Let all three reach the store before the RPC settles.
      await new Promise((resolve) => setImmediate(resolve));
      release('txhash-concurrent');

      const results = await inFlight;
      expect(sorobanClient.submitVaultOperation).toHaveBeenCalledTimes(1);
      expect(results.map((r) => r.transactionHash)).toEqual([
        'txhash-concurrent',
        'txhash-concurrent',
        'txhash-concurrent',
      ]);
      expect(results.filter((r) => r.replayed)).toHaveLength(2);
    });

    test('canonicalises the request so equivalent spellings share one key', async () => {
      const key = freshKey();
      await orchestrateTransfer(params, key);
      // Lower-case wallet, lower-case asset, padded amount — same transfer.
      const replay = await orchestrateTransfer(
        {
          operationType: 'deposit',
          walletAddress: VALID_TEST_WALLET.toLowerCase(),
          amount: ' 1000 ',
          asset: 'usdc',
        },
        key,
      );

      expect(sorobanClient.submitVaultOperation).toHaveBeenCalledTimes(1);
      expect(replay.replayed).toBe(true);
    });

    test('the same key trims to the same store key', async () => {
      const key = freshKey();
      await orchestrateTransfer(params, key);
      const replay = await orchestrateTransfer(params, `  ${key}  `);
      expect(replay.replayed).toBe(true);
      expect(sorobanClient.submitVaultOperation).toHaveBeenCalledTimes(1);
    });
  });

  // ── Key scoping ─────────────────────────────────────────────────────────────

  describe('key scoping', () => {
    test('the same client key on two wallets does not collide', async () => {
      const key = freshKey();
      sorobanClient.submitVaultOperation
        .mockResolvedValueOnce('txhash-wallet-a')
        .mockResolvedValueOnce('txhash-wallet-b');

      const a = await orchestrateTransfer(params, key);
      const b = await orchestrateTransfer(
        { ...params, walletAddress: SECOND_TEST_WALLET },
        key,
      );

      expect(sorobanClient.submitVaultOperation).toHaveBeenCalledTimes(2);
      expect(a.transactionHash).toBe('txhash-wallet-a');
      expect(b.transactionHash).toBe('txhash-wallet-b');
      expect(a.storeKey).not.toBe(b.storeKey);
    });

    test('store keys are wallet-scoped, case-insensitively, and hide the address', () => {
      const upper = buildTransferStoreKey(VALID_TEST_WALLET, 'abcdefgh');
      const lower = buildTransferStoreKey(VALID_TEST_WALLET.toLowerCase(), 'abcdefgh');
      const other = buildTransferStoreKey(SECOND_TEST_WALLET, 'abcdefgh');

      expect(upper).toBe(lower);
      expect(upper).not.toBe(other);
      expect(upper).toMatch(/^transfer:[0-9a-f]{16}:abcdefgh$/);
      expect(upper).not.toContain(VALID_TEST_WALLET);
    });

    test('reusing a key with a different body is a conflict, not a second transfer', async () => {
      const key = freshKey();
      await orchestrateTransfer(params, key);

      await expect(orchestrateTransfer({ ...params, amount: '2000' }, key)).rejects.toThrow(
        TransferConflictError,
      );
      expect(sorobanClient.submitVaultOperation).toHaveBeenCalledTimes(1);
    });
  });

  // ── Validation ──────────────────────────────────────────────────────────────

  describe('validation', () => {
    const rejects = async (
      overrides: Partial<TransferParams>,
      key: string | undefined,
      code: string,
    ) => {
      await expect(
        orchestrateTransfer({ ...params, ...overrides } as TransferParams, key as string),
      ).rejects.toMatchObject({ name: expect.stringContaining('Transfer'), code });
      expect(sorobanClient.submitVaultOperation).not.toHaveBeenCalled();
    };

    test.each([
      ['missing', undefined, 'TRANSFER_IDEMPOTENCY_KEY_REQUIRED'],
      ['empty', '   ', 'TRANSFER_IDEMPOTENCY_KEY_REQUIRED'],
      ['too short', 'abc', 'TRANSFER_IDEMPOTENCY_KEY_TOO_SHORT'],
      ['whitespace-bearing', 'abc def ghi', 'TRANSFER_IDEMPOTENCY_KEY_INVALID'],
      ['newline-injecting', 'abcdefgh\nx', 'TRANSFER_IDEMPOTENCY_KEY_INVALID'],
    ])('rejects a %s idempotency key', async (_label, key, code) => {
      await rejects({}, key as string | undefined, code);
    });

    test('rejects an over-long idempotency key', async () => {
      await rejects({}, 'a'.repeat(256), 'TRANSFER_IDEMPOTENCY_KEY_TOO_LONG');
    });

    test.each([
      ['a negative amount', { amount: '-1' }, 'TRANSFER_AMOUNT_INVALID'],
      ['a zero amount', { amount: '0' }, 'TRANSFER_AMOUNT_INVALID'],
      ['an amount with excessive precision', { amount: '1.12345678' }, 'TRANSFER_AMOUNT_INVALID'],
      [
        'an amount above i128 base-unit capacity',
        { amount: '17014118346046923173168730371588.4105728' },
        'TRANSFER_AMOUNT_INVALID',
      ],
      ['an amount with excessive precision', { amount: '1.12345678' }, 'TRANSFER_AMOUNT_INVALID'],
      ['an amount above i128 base-unit capacity', { amount: '17014118346046923173168730371.5884106' }, 'TRANSFER_AMOUNT_INVALID'],
      ['a NaN amount', { amount: 'NaN' }, 'TRANSFER_AMOUNT_INVALID'],
      ['an Infinity amount', { amount: 'Infinity' }, 'TRANSFER_AMOUNT_INVALID'],
      ['an exponent amount', { amount: '1e3' }, 'TRANSFER_AMOUNT_INVALID'],
      ['an empty amount', { amount: '' }, 'TRANSFER_AMOUNT_INVALID'],
      ['a malformed wallet', { walletAddress: 'not-a-wallet' }, 'TRANSFER_WALLET_INVALID'],
      ['an empty asset', { asset: '  ' }, 'TRANSFER_ASSET_INVALID'],
      [
        'an unknown operation',
        { operationType: 'transfer' as unknown as 'deposit' },
        'TRANSFER_OPERATION_INVALID',
      ],
    ])('rejects %s before signing', async (_label, overrides, code) => {
      await rejects(overrides as Partial<TransferParams>, freshKey(), code);
    });

    test('validation errors are TransferValidationError with a 4xx status', async () => {
      await expect(orchestrateTransfer(params, 'x')).rejects.toBeInstanceOf(
        TransferValidationError,
      );
      await expect(
        orchestrateTransfer({ ...params, amount: '-5' }, freshKey()),
      ).rejects.toMatchObject({ statusCode: 422, classification: 'terminal' });
    });
  });

  // ── Failure classification ──────────────────────────────────────────────────

  describe('classifyTransferFailure', () => {
    test.each([
      ['SIMULATION_ERROR', 'retryable'],
      ['RESTORE_REQUIRED', 'retryable'],
      ['RPC_ERROR', 'retryable'],
      ['SOROBAN_CIRCUIT_OPEN', 'retryable'],
      ['INVALID_ADDRESS', 'terminal'],
      ['INVALID_AMOUNT', 'terminal'],
      ['SUBMISSION_FAILED', 'indeterminate'],
      ['INTERNAL_ERROR', 'indeterminate'],
    ])('classifies %s as %s', (code, expected) => {
      expect(classifyTransferFailure(new FakeSorobanError('boom', code))).toBe(expected);
    });

    test('an open circuit is retryable', () => {
      expect(classifyTransferFailure(new CircuitOpenError(1000))).toBe('retryable');
    });

    test('an unrecognised failure defaults to indeterminate, never retryable', () => {
      expect(classifyTransferFailure(new Error('socket hang up'))).toBe('indeterminate');
      expect(classifyTransferFailure(undefined)).toBe('indeterminate');
      expect(classifyTransferFailure('a string')).toBe('indeterminate');
    });

    test('a 4xx status without a known code is terminal', () => {
      expect(classifyTransferFailure(new FakeSorobanError('bad', 'WEIRD', 422))).toBe('terminal');
    });
  });

  // ── Retryable failures ──────────────────────────────────────────────────────

  describe('retryable failures', () => {
    test('a pre-submission failure stores nothing and the retry re-executes', async () => {
      const key = freshKey();
      sorobanClient.submitVaultOperation
        .mockRejectedValueOnce(new FakeSorobanError('sim failed', 'SIMULATION_ERROR'))
        .mockResolvedValueOnce('txhash-after-retry');

      await expect(orchestrateTransfer(params, key)).rejects.toBeInstanceOf(
        TransferUnavailableError,
      );

      const retried = await orchestrateTransfer(params, key);
      expect(retried.transactionHash).toBe('txhash-after-retry');
      expect(retried.replayed).toBe(false);
      expect(sorobanClient.submitVaultOperation).toHaveBeenCalledTimes(2);
    });

    test('an open circuit fails fast with a retry hint and never calls the RPC', async () => {
      jest
        .spyOn(sorobanCircuitBreaker, 'execute')
        .mockRejectedValue(new CircuitOpenError(5000) as never);

      await expect(orchestrateTransfer(params, freshKey())).rejects.toMatchObject({
        code: 'TRANSFER_CIRCUIT_OPEN',
        statusCode: 503,
        retryAfterMs: 5000,
        classification: 'retryable',
      });
      expect(sorobanClient.submitVaultOperation).not.toHaveBeenCalled();
    });
  });

  // ── Terminal rejections ─────────────────────────────────────────────────────

  describe('terminal rejections', () => {
    test('a rejection is stored and replayed without re-submitting', async () => {
      const key = freshKey();
      sorobanClient.submitVaultOperation.mockRejectedValue(
        new FakeSorobanError('Invalid Stellar wallet address', 'INVALID_ADDRESS', 422),
      );

      const expected = { code: 'INVALID_ADDRESS', statusCode: 422, classification: 'terminal' };
      await expect(orchestrateTransfer(params, key)).rejects.toMatchObject(expected);
      await expect(orchestrateTransfer(params, key)).rejects.toMatchObject(expected);

      expect(sorobanClient.submitVaultOperation).toHaveBeenCalledTimes(1);
    });

    test('a replayed rejection is a TransferOrchestrationError, not a success', async () => {
      const key = freshKey();
      sorobanClient.submitVaultOperation.mockRejectedValue(
        new FakeSorobanError('bad amount', 'INVALID_AMOUNT', 422),
      );
      await expect(orchestrateTransfer(params, key)).rejects.toThrow(TransferOrchestrationError);
      await expect(orchestrateTransfer(params, key)).rejects.toThrow('bad amount');
    });
  });

  // ── In-doubt window ─────────────────────────────────────────────────────────

  describe('in-doubt handling', () => {
    test('an indeterminate failure parks the key and refuses to resubmit', async () => {
      const key = freshKey();
      sorobanClient.submitVaultOperation.mockRejectedValue(
        new FakeSorobanError('Unexpected transaction status: TRY_AGAIN_LATER', 'SUBMISSION_FAILED'),
      );

      await expect(orchestrateTransfer(params, key)).rejects.toBeInstanceOf(TransferInDoubtError);
      // The critical assertion: a retry must NOT mint a second transaction.
      await expect(orchestrateTransfer(params, key)).rejects.toBeInstanceOf(TransferInDoubtError);
      await expect(orchestrateTransfer(params, key)).rejects.toMatchObject({
        code: 'TRANSFER_IN_DOUBT',
        statusCode: 409,
        classification: 'indeterminate',
      });

      expect(sorobanClient.submitVaultOperation).toHaveBeenCalledTimes(1);
    });

    test('a hung submission times out and is treated as in-doubt', async () => {
      const previous = process.env.TRANSFER_ORCHESTRATION_TIMEOUT_MS;
      process.env.TRANSFER_ORCHESTRATION_TIMEOUT_MS = '1000';
      sorobanClient.submitVaultOperation.mockImplementation(() => new Promise<string>(() => {}));

      try {
        await expect(orchestrateTransfer(params, freshKey())).rejects.toBeInstanceOf(
          TransferInDoubtError,
        );
        expect(listInDoubtTransfers()[0]).toMatchObject({ code: 'TRANSFER_TIMEOUT' });
      } finally {
        if (previous === undefined) delete process.env.TRANSFER_ORCHESTRATION_TIMEOUT_MS;
        else process.env.TRANSFER_ORCHESTRATION_TIMEOUT_MS = previous;
      }
    });

    test('a parked transfer is exposed to operators with reconciliation context', async () => {
      const key = freshKey();
      sorobanClient.submitVaultOperation.mockRejectedValue(
        new FakeSorobanError('socket hang up', 'INTERNAL_ERROR'),
      );
      await expect(orchestrateTransfer(params, key)).rejects.toBeInstanceOf(TransferInDoubtError);

      const parked = listInDoubtTransfers();
      expect(parked).toHaveLength(1);
      expect(parked[0]).toMatchObject({
        idempotencyKey: key,
        walletAddress: VALID_TEST_WALLET,
        operationType: 'deposit',
        amount: '1000',
        asset: 'USDC',
        code: 'INTERNAL_ERROR',
        message: 'socket hang up',
      });
      expect(getInDoubtTransfer(parked[0].storeKey)).not.toBeNull();
      // The internal fingerprint must not leak through the operator view.
      expect(parked[0]).not.toHaveProperty('fingerprint');
    });

    test('confirming an in-doubt transfer makes replays return the real hash', async () => {
      const key = freshKey();
      sorobanClient.submitVaultOperation.mockRejectedValue(
        new FakeSorobanError('unknown', 'SUBMISSION_FAILED'),
      );
      await expect(orchestrateTransfer(params, key)).rejects.toBeInstanceOf(TransferInDoubtError);
      const { storeKey } = listInDoubtTransfers()[0];

      expect(await resolveInDoubtTransfer(storeKey, { transactionHash: 'txhash-onchain' })).toBe(
        true,
      );
      expect(listInDoubtTransfers()).toHaveLength(0);

      const replay = await orchestrateTransfer(params, key);
      expect(replay.transactionHash).toBe('txhash-onchain');
      expect(replay.replayed).toBe(true);
      // Still exactly the one original attempt.
      expect(sorobanClient.submitVaultOperation).toHaveBeenCalledTimes(1);
    });

    test('discarding an in-doubt transfer releases the key for a fresh attempt', async () => {
      const key = freshKey();
      sorobanClient.submitVaultOperation.mockRejectedValueOnce(
        new FakeSorobanError('unknown', 'SUBMISSION_FAILED'),
      );
      await expect(orchestrateTransfer(params, key)).rejects.toBeInstanceOf(TransferInDoubtError);
      const { storeKey } = listInDoubtTransfers()[0];

      expect(await resolveInDoubtTransfer(storeKey, { discard: true })).toBe(true);
      expect(listInDoubtTransfers()).toHaveLength(0);

      sorobanClient.submitVaultOperation.mockResolvedValueOnce('txhash-second-attempt');
      const retried = await orchestrateTransfer(params, key);
      expect(retried.transactionHash).toBe('txhash-second-attempt');
      expect(retried.replayed).toBe(false);
      expect(sorobanClient.submitVaultOperation).toHaveBeenCalledTimes(2);
    });

    test('resolving an unknown key is a no-op', async () => {
      expect(await resolveInDoubtTransfer('transfer:deadbeef:nope', { discard: true })).toBe(false);
    });
  });
});
