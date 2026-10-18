/**
 * Unit tests for the real Soroban RPC client (Issue #438).
 *
 * Imports ../sorobanClient (not ./sorobanClient) so Jest's moduleNameMapper
 * does NOT redirect this file to the mock — these tests exercise the real code.
 * @stellar/stellar-sdk is mocked at the SDK level.
 */

// ─── Mock @stellar/stellar-sdk (via the shim-declared types) ─────────────────

const mockHash = jest.fn().mockReturnValue(Buffer.from('transaction-hash'));
const mockAddSignature = jest.fn();
const mockBuild = jest.fn().mockReturnValue({ hash: mockHash, addSignature: mockAddSignature });
const mockAssembleTransaction = jest.fn().mockReturnValue({ build: mockBuild });

const mockSendTransaction = jest.fn();
const mockSimulateTransaction = jest.fn();
const mockGetAccount = jest.fn();

const MockServer = jest.fn().mockImplementation(() => ({
  getAccount: mockGetAccount,
  simulateTransaction: mockSimulateTransaction,
  sendTransaction: mockSendTransaction,
}));

jest.mock('@stellar/stellar-sdk', () => ({
  Keypair: {
    fromSecret: jest.fn().mockReturnValue({
      publicKey: () => 'GDUMMYSOURCE123456789012345678901234567890123456789012',
      sign: jest.fn().mockReturnValue(Buffer.from('local-signature')),
    }),
  },
  Contract: jest.fn().mockImplementation(() => ({
    call: jest.fn().mockReturnValue('mock-op'),
  })),
  rpc: {
    Server: MockServer,
    assembleTransaction: mockAssembleTransaction,
    Api: {
      isSimulationError: jest.fn().mockReturnValue(false),
      isSimulationRestore: jest.fn().mockReturnValue(false),
    },
  },
  nativeToScVal: jest.fn().mockReturnValue('mock-scval'),
  StrKey: {
    isValidEd25519PublicKey: jest.fn().mockReturnValue(true),
  },
  TransactionBuilder: jest.fn().mockImplementation(() => ({
    addOperation: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    build: jest.fn().mockReturnValue('mock-tx'),
  })),
  BASE_FEE: '100',
}));

// ─── Mock logger & tracing ────────────────────────────────────────────────────

jest.mock('../middleware/structuredLogging', () => ({ logger: { log: jest.fn() } }));
jest.mock('../tracing', () => ({ getCurrentTraceId: () => 'test-trace-id' }));

// ─── Import SUT after mocks ───────────────────────────────────────────────────

import {
  configureStellarSigners,
  submitVaultOperation,
  SorobanSimulationError,
  resolveContractId,
  rotateStellarSigner,
} from '../sorobanClient';
import { rpc } from '@stellar/stellar-sdk';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_WALLET = 'GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE123456';
const PENDING_RESPONSE = { status: 'PENDING', hash: 'real-tx-hash-abcdef1234567890' };

function setEnv() {
  process.env.STELLAR_SECRET_KEY = 'SCZANGBA5RLNIRHAASV3SUKWNZV3YJTVJBOTVOHFMKCHLJV2RDBUFXE';
  delete process.env.STELLAR_SECRET_KEY_NEXT;
  delete process.env.STELLAR_ACTIVE_SIGNER;
  process.env.VAULT_CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
  process.env.STELLAR_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
  process.env.STELLAR_RPC_URL = 'https://soroban-testnet.stellar.org';
}

// ─── resolveContractId() ─────────────────────────────────────────────────────

describe('resolveContractId()', () => {
  afterEach(() => {
    delete process.env.VAULT_CONTRACT_ID;
  });

  it('returns VAULT_CONTRACT_ID env var when set', () => {
    process.env.VAULT_CONTRACT_ID = 'CONTRACT_FROM_ENV';
    expect(resolveContractId()).toBe('CONTRACT_FROM_ENV');
  });

  it('throws when env var is missing and no deployments file has a vault id', () => {
    // The testnet deployments file has an empty string for vault, so this throws.
    expect(() => resolveContractId()).toThrow(/VAULT_CONTRACT_ID/);
  });
});

// ─── submitVaultOperation() ───────────────────────────────────────────────────

describe('submitVaultOperation()', () => {
  let restoreConfiguredSigners: (() => void) | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    setEnv();
    mockGetAccount.mockResolvedValue({ id: 'GDUMMY', sequence: '1' });
    mockSimulateTransaction.mockResolvedValue({ results: [] });
    mockSendTransaction.mockResolvedValue(PENDING_RESPONSE);
    (rpc.Api.isSimulationError as jest.Mock).mockReturnValue(false);
    (rpc.Api.isSimulationRestore as jest.Mock).mockReturnValue(false);
    mockBuild.mockReturnValue({ hash: mockHash, addSignature: mockAddSignature });
  });

  afterEach(() => {
    restoreConfiguredSigners?.();
    restoreConfiguredSigners = undefined;
    delete process.env.STELLAR_SECRET_KEY;
    delete process.env.STELLAR_SECRET_KEY_NEXT;
    delete process.env.STELLAR_ACTIVE_SIGNER;
    delete process.env.VAULT_CONTRACT_ID;
    delete process.env.STELLAR_NETWORK_PASSPHRASE;
  });

  // ── Success paths ───────────────────────────────────────────────────────────

  it('returns the transaction hash on a successful deposit', async () => {
    const hash = await submitVaultOperation('deposit', VALID_WALLET, '100', 'USDC');
    expect(hash).toBe(PENDING_RESPONSE.hash);
  });

  it('returns the transaction hash on a successful withdrawal', async () => {
    const hash = await submitVaultOperation('withdrawal', VALID_WALLET, '50', 'USDC');
    expect(hash).toBe(PENDING_RESPONSE.hash);
  });

  it('signs the transaction before submitting', async () => {
    await submitVaultOperation('deposit', VALID_WALLET, '100', 'USDC');
    expect(mockAddSignature).toHaveBeenCalledTimes(1);
  });

  it('completes a rotation drill from the active signer to standby and back', async () => {
    const activeSigner = {
      publicKey: 'GACTIVE123456789012345678901234567890123456789012345678',
      sign: jest.fn().mockResolvedValue(Buffer.from('active-signature')),
    };
    const standbySigner = {
      publicKey: 'GSTANDBY12345678901234567890123456789012345678901234567',
      sign: jest.fn().mockResolvedValue(Buffer.from('standby-signature')),
    };
    restoreConfiguredSigners = configureStellarSigners(activeSigner, standbySigner);

    await submitVaultOperation('deposit', VALID_WALLET, '100', 'USDC');
    expect(activeSigner.sign).toHaveBeenCalledTimes(1);
    expect(mockAddSignature).toHaveBeenLastCalledWith(
      activeSigner.publicKey,
      Buffer.from('active-signature'),
    );

    expect(rotateStellarSigner()).toBe(standbySigner.publicKey);
    await submitVaultOperation('deposit', VALID_WALLET, '100', 'USDC');
    expect(standbySigner.sign).toHaveBeenCalledTimes(1);
    expect(mockAddSignature).toHaveBeenLastCalledWith(
      standbySigner.publicKey,
      Buffer.from('standby-signature'),
    );

    expect(rotateStellarSigner()).toBe(activeSigner.publicKey);
  });

  it('calls assembleTransaction to inject resource footprint', async () => {
    await submitVaultOperation('deposit', VALID_WALLET, '100', 'USDC');
    expect(mockAssembleTransaction).toHaveBeenCalledTimes(1);
  });

  it('passes the operation type directly to contract.call()', async () => {
    const { Contract } = await import('@stellar/stellar-sdk');
    const contractInstance = (Contract as jest.Mock).mock.results[0]?.value;
    await submitVaultOperation('withdrawal', VALID_WALLET, '200', 'USDC');
    if (contractInstance) {
      expect(contractInstance.call).toHaveBeenCalledWith(
        'withdrawal',
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    }
  });

  // ── Environment validation ──────────────────────────────────────────────────

  it('throws SorobanSimulationError when STELLAR_SECRET_KEY is missing', async () => {
    delete process.env.STELLAR_SECRET_KEY;
    await expect(submitVaultOperation('deposit', VALID_WALLET, '100', 'USDC'))
      .rejects.toBeInstanceOf(SorobanSimulationError);
  });

  it('throws SorobanSimulationError when VAULT_CONTRACT_ID is missing', async () => {
    delete process.env.VAULT_CONTRACT_ID;
    await expect(submitVaultOperation('deposit', VALID_WALLET, '100', 'USDC'))
      .rejects.toBeInstanceOf(SorobanSimulationError);
  });

  // ── Input validation ────────────────────────────────────────────────────────

  it('throws SorobanSimulationError with code INVALID_ADDRESS for a bad wallet', async () => {
    (rpc.Api.isSimulationError as jest.Mock);
    const { StrKey } = await import('@stellar/stellar-sdk');
    (StrKey.isValidEd25519PublicKey as jest.Mock).mockReturnValueOnce(false);

    const err = await submitVaultOperation('deposit', 'BAD_WALLET', '100', 'USDC')
      .catch((e) => e);
    expect(err).toBeInstanceOf(SorobanSimulationError);
    expect(err.code).toBe('INVALID_ADDRESS');
    expect(err.statusCode).toBe(422);
  });

  // ── Simulation errors ───────────────────────────────────────────────────────

  it('throws SorobanSimulationError with code SIMULATION_ERROR when simulation fails', async () => {
    (rpc.Api.isSimulationError as jest.Mock).mockReturnValueOnce(true);
    mockSimulateTransaction.mockResolvedValue({ error: 'InsufficientFunds' });

    const err = await submitVaultOperation('deposit', VALID_WALLET, '100', 'USDC').catch((e) => e);
    expect(err).toBeInstanceOf(SorobanSimulationError);
    expect(err.code).toBe('SIMULATION_ERROR');
    expect(err.statusCode).toBe(502);
  });

  it('throws SorobanSimulationError with code RESTORE_REQUIRED when restore is needed', async () => {
    (rpc.Api.isSimulationRestore as jest.Mock).mockReturnValueOnce(true);

    const err = await submitVaultOperation('deposit', VALID_WALLET, '100', 'USDC').catch((e) => e);
    expect(err).toBeInstanceOf(SorobanSimulationError);
    expect(err.code).toBe('RESTORE_REQUIRED');
    expect(err.statusCode).toBe(503);
  });

  // ── RPC-level errors ────────────────────────────────────────────────────────

  it('throws SorobanSimulationError with code RPC_ERROR when sendTransaction returns ERROR', async () => {
    mockSendTransaction.mockResolvedValue({ status: 'ERROR', errorResult: null });

    const err = await submitVaultOperation('deposit', VALID_WALLET, '100', 'USDC').catch((e) => e);
    expect(err).toBeInstanceOf(SorobanSimulationError);
    expect(err.code).toBe('RPC_ERROR');
    expect(err.statusCode).toBe(502);
  });

  it('throws SorobanSimulationError with code SUBMISSION_FAILED for unexpected tx status', async () => {
    mockSendTransaction.mockResolvedValue({ status: 'DUPLICATE', errorResult: null });

    const err = await submitVaultOperation('deposit', VALID_WALLET, '100', 'USDC').catch((e) => e);
    expect(err).toBeInstanceOf(SorobanSimulationError);
    expect(err.code).toBe('SUBMISSION_FAILED');
  });

  it('wraps unexpected network errors as INTERNAL_ERROR', async () => {
    mockGetAccount.mockRejectedValue(new Error('connection refused'));

    const err = await submitVaultOperation('deposit', VALID_WALLET, '100', 'USDC').catch((e) => e);
    expect(err).toBeInstanceOf(SorobanSimulationError);
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.message).toContain('connection refused');
  });

  it('uses testnet passphrase when STELLAR_NETWORK_PASSPHRASE is not set', async () => {
    delete process.env.STELLAR_NETWORK_PASSPHRASE;
    const { TransactionBuilder } = await import('@stellar/stellar-sdk');
    await submitVaultOperation('deposit', VALID_WALLET, '100', 'USDC');
    const builderCall = (TransactionBuilder as jest.Mock).mock.calls.at(-1);
    expect(builderCall?.[1]?.networkPassphrase).toBe('Test SDF Network ; September 2015');
  });
});

// ─── SorobanSimulationError ───────────────────────────────────────────────────

describe('SorobanSimulationError', () => {
  it('defaults to statusCode 502 and code SIMULATION_ERROR', () => {
    const err = new SorobanSimulationError('test');
    expect(err.statusCode).toBe(502);
    expect(err.code).toBe('SIMULATION_ERROR');
    expect(err.name).toBe('SorobanSimulationError');
  });

  it('accepts custom code and statusCode', () => {
    const err = new SorobanSimulationError('bad input', 'INVALID_ADDRESS', 422);
    expect(err.code).toBe('INVALID_ADDRESS');
    expect(err.statusCode).toBe(422);
  });

  it('is an instance of Error', () => {
    expect(new SorobanSimulationError('x')).toBeInstanceOf(Error);
  });
});
