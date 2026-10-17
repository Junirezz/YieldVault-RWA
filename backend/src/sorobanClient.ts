/**
 * Soroban RPC client for submitting vault operations to the Stellar network.
 * Uses @stellar/stellar-sdk for contract invocation.
 */

import fs from 'fs';
import path from 'path';
import {
  Keypair,
  Contract,
  rpc,
  nativeToScVal,
  StrKey,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { getDeterministicBaseFee, moneyAmountToBaseUnits } from './feeCalculator';
import { logger } from './middleware/structuredLogging';
import { getCurrentTraceId } from './tracing';
import { sorobanRetryBudget } from './retryBudget';

// Well-known Stellar network passphrases (avoids importing Networks which is
// not consistently re-exported across stellar-sdk minor versions).
const NETWORK_PASSPHRASES: Record<string, string> = {
  testnet: 'Test SDF Network ; September 2015',
  mainnet: 'Public Global Stellar Network ; September 2015',
  public: 'Public Global Stellar Network ; September 2015',
};

// ─── Config helpers ───────────────────────────────────────────────────────────

const getRpcClient = () => {
  const rpcUrl = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
  return new rpc.Server(rpcUrl);
};

/**
 * Returns the vault contract ID.
 * Checks VAULT_CONTRACT_ID env var first, then falls back to the
 * deployments/contracts.<network>.json file so the value is never hard-coded.
 */
export function resolveContractId(): string {
  if (process.env.VAULT_CONTRACT_ID) return process.env.VAULT_CONTRACT_ID;

  const network = process.env.STELLAR_NETWORK || 'testnet';
  const deploymentFile = path.resolve(
    __dirname,
    `../../deployments/contracts.${network}.json`,
  );
  try {
    const deployment = JSON.parse(fs.readFileSync(deploymentFile, 'utf-8'));
    const id: string | undefined = deployment?.contracts?.vault;
    if (id) return id;
  } catch {
    // deployments file missing or unreadable — fall through to error
  }

  throw new Error(
    'VAULT_CONTRACT_ID is not set and no vault address found in the deployments file',
  );
}

function resolveNetworkPassphrase(): string {
  if (process.env.STELLAR_NETWORK_PASSPHRASE) return process.env.STELLAR_NETWORK_PASSPHRASE;
  const network = process.env.STELLAR_NETWORK || 'testnet';
  return NETWORK_PASSPHRASES[network] ?? NETWORK_PASSPHRASES.testnet;
}

export interface StellarSigner {
  publicKey: string;
  sign(payload: Uint8Array): Promise<Uint8Array>;
}

let configuredSignerPair: { active: StellarSigner; standby: StellarSigner } | undefined;

/**
 * Configure an active and standby signer. KMS/HSM adapters implement StellarSigner
 * and return the raw Ed25519 signature for the transaction hash passed to sign().
 * The returned function restores environment-based signer resolution.
 */
export function configureStellarSigners(
  active: StellarSigner,
  standby: StellarSigner,
): () => void {
  if (active.publicKey === standby.publicKey) {
    throw new Error('Active and standby Stellar signers must have different public keys');
  }
  const pair = { active, standby };
  configuredSignerPair = pair;
  return () => {
    if (configuredSignerPair === pair) configuredSignerPair = undefined;
  };
}

/**
 * Rotate to the prepared standby signer without dropping the previous signer.
 * Operationally, authorize the standby public key on the Stellar account first,
 * configure both signers, rotate, and verify a successful signed transaction.
 * Persist the new active signer in deployment configuration before removing the
 * old key from the signer pair.
 */
export function rotateStellarSigner(): string {
  if (configuredSignerPair) {
    [configuredSignerPair.active, configuredSignerPair.standby] = [
      configuredSignerPair.standby,
      configuredSignerPair.active,
    ];
    return configuredSignerPair.active.publicKey;
  }

  const activeSlot = process.env.STELLAR_ACTIVE_SIGNER === 'next' ? 'next' : 'primary';
  const standbySlot = activeSlot === 'primary' ? 'next' : 'primary';
  const standbySecret = standbySlot === 'next'
    ? process.env.STELLAR_SECRET_KEY_NEXT
    : process.env.STELLAR_SECRET_KEY;
  if (!standbySecret) {
    throw new Error('A standby Stellar signer must be configured before rotation');
  }
  process.env.STELLAR_ACTIVE_SIGNER = standbySlot;
  return createEnvironmentSigner(standbySecret).publicKey;
}

function createEnvironmentSigner(secret: string): StellarSigner {
  try {
    const keypair = Keypair.fromSecret(secret);
    return {
      publicKey: keypair.publicKey(),
      sign: async (payload) => keypair.sign(Buffer.from(payload)),
    };
  } catch (err) {
    throw new Error(
      `Invalid Stellar secret key: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function getSourceSigner(): StellarSigner {
  if (configuredSignerPair) return configuredSignerPair.active;

  const activeSlot = process.env.STELLAR_ACTIVE_SIGNER === 'next' ? 'next' : 'primary';
  const secret = activeSlot === 'next'
    ? process.env.STELLAR_SECRET_KEY_NEXT
    : process.env.STELLAR_SECRET_KEY;
  if (!secret) {
    throw new Error(
      activeSlot === 'next'
        ? 'STELLAR_SECRET_KEY_NEXT is not set for the selected signer'
        : 'STELLAR_SECRET_KEY environment variable is not set',
    );
  }
  return createEnvironmentSigner(secret);
}

function validateEnvironment(): void {
  getSourceSigner();
  // Validate contract ID is resolvable early so the error message is clear.
  resolveContractId();
}

// ─── Error types ─────────────────────────────────────────────────────────────

export interface SorobanTxError extends Error {
  code?: string;
  statusCode?: number;
}

export class SorobanSimulationError extends Error implements SorobanTxError {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code: string = 'SIMULATION_ERROR', statusCode: number = 502) {
    super(message);
    this.name = 'SorobanSimulationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

// ─── Core RPC call ────────────────────────────────────────────────────────────

const MAX_RPC_RETRIES = parseInt(process.env.SOROBAN_MAX_RETRIES || '3', 10);
const RETRY_DELAY_MS = parseInt(process.env.SOROBAN_RETRY_DELAY_MS || '1000', 10);

/**
 * Retry helper with exponential backoff and budget control.
 */
async function retryWithBudget<T>(
  operation: () => Promise<T>,
  operationName: string,
  maxRetries: number = MAX_RPC_RETRIES,
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();
      sorobanRetryBudget.recordAttempt(true);
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      
      // Don't retry on validation errors
      if (err instanceof SorobanSimulationError && err.statusCode === 422) {
        sorobanRetryBudget.recordAttempt(false);
        throw err;
      }

      const isLastAttempt = attempt === maxRetries;
      if (isLastAttempt || !sorobanRetryBudget.canRetry()) {
        sorobanRetryBudget.recordAttempt(false);
        logger.log('error', `${operationName} failed after ${attempt + 1} attempts`, {
          error: lastError.message,
          retryBudgetStats: sorobanRetryBudget.getStats(),
          traceId: getCurrentTraceId(),
        });
        throw lastError;
      }

      const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
      logger.log('warn', `${operationName} failed, retrying`, {
        attempt: attempt + 1,
        maxRetries,
        delayMs: delay,
        error: lastError.message,
        traceId: getCurrentTraceId(),
      });
      
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error(`${operationName} failed with no error`);
}

/**
 * Submit a Soroban vault contract invocation (deposit or withdrawal) to the
 * Stellar network. Steps:
 *  1. Build the transaction with the correct contract arguments.
 *  2. Simulate to validate inputs and obtain the resource footprint.
 *  3. Assemble (inject footprint + auth entries), sign, and submit.
 *  4. Return the on-chain transaction hash once the tx is PENDING.
 *
 * @throws SorobanSimulationError for any Stellar/RPC-level failure.
 */
export async function submitVaultOperation(
  operationType: 'deposit' | 'withdrawal',
  walletAddress: string,
  amount: string,
  asset: string,
): Promise<string> {
  try {
    validateEnvironment();

    const rpcClient = getRpcClient();
    const sourceSigner = getSourceSigner();
    const contractId = resolveContractId();
    const networkPassphrase = resolveNetworkPassphrase();

    if (!StrKey.isValidEd25519PublicKey(walletAddress)) {
      throw new SorobanSimulationError(
        `Invalid Stellar wallet address: ${walletAddress}`,
        'INVALID_ADDRESS',
        422,
      );
    }

    logger.log('debug', `Submitting Soroban ${operationType}`, {
      walletAddress,
      amount,
      asset,
      contractId,
      traceId: getCurrentTraceId(),
    });

    const sourceAccount = await rpcClient.getAccount(sourceSigner.publicKey);
    const contract = new Contract(contractId);

    // Convert the decimal token amount to exact 7-decimal base units.
    let amountBigInt: bigint;
    try {
      amountBigInt = BigInt(moneyAmountToBaseUnits(amount));
    } catch {
      throw new SorobanSimulationError(
        `Invalid amount value: ${amount}`,
        'INVALID_AMOUNT',
        422,
      );
    }

    const op = contract.call(
      operationType,
      nativeToScVal(walletAddress, { type: 'address' }),
      nativeToScVal(amountBigInt, { type: 'i128' }),
      nativeToScVal(asset, { type: 'string' }),
    );

    const tx = new TransactionBuilder(sourceAccount, {
      fee: getDeterministicBaseFee(),
      networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(300)
      .build();

    logger.log('debug', `Simulating Soroban transaction for ${operationType}`, {
      traceId: getCurrentTraceId(),
    });

    const simulated = await retryWithBudget(
      () => rpcClient.simulateTransaction(tx),
      'Soroban simulation',
    );

    if (rpc.Api.isSimulationError(simulated)) {
      const errorMessage = `Soroban simulation failed: ${
        'error' in simulated ? String(simulated.error) : 'unknown simulation error'
      }`;
      logger.log('error', errorMessage, {
        operationType,
        walletAddress,
        traceId: getCurrentTraceId(),
      });
      throw new SorobanSimulationError(errorMessage, 'SIMULATION_ERROR');
    }

    if (rpc.Api.isSimulationRestore(simulated)) {
      logger.log('warn', 'Soroban transaction requires ledger entry restore', {
        operationType,
        walletAddress,
        traceId: getCurrentTraceId(),
      });
      throw new SorobanSimulationError(
        'Contract state requires ledger restore. Please retry in a few minutes.',
        'RESTORE_REQUIRED',
        503,
      );
    }

    // assembleTransaction injects the resource footprint and auth entries.
    // .build() gives a Transaction; it must be signed before submission.
    const assembled = rpc.assembleTransaction(tx, simulated).build();
    const signature = await sourceSigner.sign(assembled.hash());
    assembled.addSignature(sourceSigner.publicKey, Buffer.from(signature));

    logger.log('debug', `Submitting assembled Soroban transaction for ${operationType}`, {
      traceId: getCurrentTraceId(),
    });

    const txResponse = await retryWithBudget(
      () => rpcClient.sendTransaction(assembled),
      'Soroban transaction submission',
    );

    if (txResponse.status === 'ERROR') {
      const detail = txResponse.errorResult?.toXDR?.('base64') ?? 'unknown error';
      const errorMessage = `Soroban RPC rejected transaction: ${detail}`;
      logger.log('error', errorMessage, {
        operationType,
        walletAddress,
        traceId: getCurrentTraceId(),
      });
      throw new SorobanSimulationError(errorMessage, 'RPC_ERROR');
    }

    if (txResponse.status !== 'PENDING') {
      const detail = txResponse.errorResult?.toXDR?.('base64') ?? txResponse.status;
      const errorMessage = `Unexpected transaction status: ${detail}`;
      logger.log('error', errorMessage, {
        operationType,
        walletAddress,
        traceId: getCurrentTraceId(),
      });
      throw new SorobanSimulationError(errorMessage, 'SUBMISSION_FAILED');
    }

    logger.log('info', `Soroban ${operationType} submitted`, {
      transactionHash: txResponse.hash,
      walletAddress,
      traceId: getCurrentTraceId(),
    });

    return txResponse.hash;
  } catch (err) {
    if (err instanceof SorobanSimulationError) throw err;

    const message = err instanceof Error ? err.message : String(err);
    logger.log('error', `Unexpected error in submitVaultOperation: ${message}`, {
      operationType,
      walletAddress,
      traceId: getCurrentTraceId(),
    });
    throw new SorobanSimulationError(`Unexpected error: ${message}`, 'INTERNAL_ERROR');
  }
}
