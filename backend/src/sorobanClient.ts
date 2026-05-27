/**
 * Soroban RPC client for submitting vault operations to the Stellar network.
 * Uses @stellar/stellar-sdk for contract invocation.
 */

import {
  Keypair,
  Contract,
  SorobanRpc,
  nativeToScVal,
  StrKey,
  TransactionBuilder,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import { logger } from './middleware/structuredLogging';
import { getCurrentTraceId } from './tracing';

// Initialize Soroban RPC client
const getRpcClient = () => {
  const rpcUrl = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
  return new SorobanRpc.Server(rpcUrl);
};

// Validate that required environment variables are set
function validateEnvironment(): void {
  if (!process.env.STELLAR_SECRET_KEY) {
    throw new Error('STELLAR_SECRET_KEY environment variable is not set');
  }
  if (!process.env.VAULT_CONTRACT_ID) {
    throw new Error('VAULT_CONTRACT_ID environment variable is not set');
  }
  if (!process.env.STELLAR_NETWORK_PASSPHRASE) {
    throw new Error('STELLAR_NETWORK_PASSPHRASE environment variable is not set');
  }
}

// Get or validate keypair
let cachedKeypair: Keypair | null = null;
function getSourceKeypair(): Keypair {
  if (!cachedKeypair) {
    try {
      cachedKeypair = Keypair.fromSecret(process.env.STELLAR_SECRET_KEY!);
    } catch (err) {
      throw new Error(
        `Invalid STELLAR_SECRET_KEY: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return cachedKeypair;
}

export interface SorobanTxError extends Error {
  code?: string;
  statusCode?: number;
}

export class SorobanSimulationError extends Error implements SorobanTxError {
  public code: string;
  public statusCode: number = 502;

  constructor(message: string, code: string = 'SIMULATION_ERROR') {
    super(message);
    this.name = 'SorobanSimulationError';
    this.code = code;
  }
}

/**
 * Submit a Soroban contract invocation to the Stellar network.
 * Supports 'deposit' and 'withdrawal' operations on the vault contract.
 *
 * @param operationType - 'deposit' or 'withdrawal'
 * @param walletAddress - The Stellar wallet address making the operation
 * @param amount - The amount to deposit/withdraw
 * @param asset - The asset code (e.g., 'USDC')
 * @returns The transaction hash of the submitted transaction
 * @throws SorobanSimulationError if simulation or submission fails
 */
export async function submitVaultOperation(
  operationType: 'deposit' | 'withdrawal',
  walletAddress: string,
  amount: string,
  asset: string,
): Promise<string> {
  try {
    validateEnvironment();

    const rpc = getRpcClient();
    const sourceKeypair = getSourceKeypair();
    const contractId = process.env.VAULT_CONTRACT_ID!;
    const networkPassphrase = process.env.STELLAR_NETWORK_PASSPHRASE!;

    // Validate Stellar address format
    if (!StrKey.isValidEd25519PublicKey(walletAddress)) {
      throw new Error(`Invalid Stellar wallet address: ${walletAddress}`);
    }

    logger.log('debug', `Submitting Soroban ${operationType}`, {
      walletAddress,
      amount,
      asset,
      contractId,
      traceId: getCurrentTraceId(),
    });

    // Get account details for building the transaction
    const sourceAccount = await rpc.getAccount(sourceKeypair.publicKey());

    // Create contract instance
    const contract = new Contract(contractId);

    // Build contract invocation based on operation type
    let method: string;
    if (operationType === 'deposit') {
      method = 'deposit';
    } else if (operationType === 'withdrawal') {
      method = 'withdrawal';
    } else {
      throw new Error(`Unsupported operation type: ${operationType}`);
    }

    // Build the contract invocation operation
    const op = contract.call(
      method,
      nativeToScVal(walletAddress, { type: 'address' }),
      nativeToScVal(amount, { type: 'i128' }),
      nativeToScVal(asset, { type: 'string' }),
    );

    // Create transaction
    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(300) // 5 minute timeout
      .build();

    // Simulate the transaction to validate it and get resource requirements
    logger.log('debug', `Simulating Soroban transaction for ${operationType}`, {
      traceId: getCurrentTraceId(),
    });

    const simulated = await rpc.simulateTransaction(tx);

    if (SorobanRpc.isSimulationError(simulated)) {
      const errorMessage = `Soroban simulation error: ${
        simulated.error || 'Unknown error'
      }`;
      logger.log('error', errorMessage, {
        operationType,
        walletAddress,
        traceId: getCurrentTraceId(),
      });
      throw new SorobanSimulationError(errorMessage, 'SIMULATION_ERROR');
    }

    if (SorobanRpc.isSimulationRestore(simulated)) {
      logger.log('warn', 'Soroban transaction requires restore', {
        operationType,
        walletAddress,
        traceId: getCurrentTraceId(),
      });
      throw new SorobanSimulationError(
        'Contract state requires restore. Please try again later.',
        'RESTORE_REQUIRED'
      );
    }

    // Assemble and submit the transaction
    const prepared = SorobanRpc.assembleTransaction(tx, simulated).build();

    logger.log('debug', `Submitting Soroban transaction for ${operationType}`, {
      traceId: getCurrentTraceId(),
    });

    const txResponse = await rpc.sendTransaction(prepared);

    if (txResponse.status === 'FAILED') {
      const resultXdr = txResponse.resultXdr;
      const errorMessage = `Soroban transaction submission failed: ${resultXdr || 'Unknown error'}`;
      logger.log('error', errorMessage, {
        operationType,
        walletAddress,
        traceId: getCurrentTraceId(),
      });
      throw new SorobanSimulationError(errorMessage, 'SUBMISSION_FAILED');
    }

    if (txResponse.status === 'ERROR') {
      const errorMessage = `Soroban RPC error: ${txResponse.errorResultXdr || 'Unknown error'}`;
      logger.log('error', errorMessage, {
        operationType,
        walletAddress,
        traceId: getCurrentTraceId(),
      });
      throw new SorobanSimulationError(errorMessage, 'RPC_ERROR');
    }

    // Transaction successfully submitted; return the hash
    const transactionHash = txResponse.hash;
    logger.log('info', `Soroban ${operationType} submitted successfully`, {
      transactionHash,
      walletAddress,
      traceId: getCurrentTraceId(),
    });

    return transactionHash;
  } catch (err) {
    if (err instanceof SorobanSimulationError) {
      throw err;
    }

    const message = err instanceof Error ? err.message : String(err);
    logger.log('error', `Unexpected error in submitVaultOperation: ${message}`, {
      operationType,
      walletAddress,
      traceId: getCurrentTraceId(),
    });

    throw new SorobanSimulationError(
      `Unexpected error: ${message}`,
      'INTERNAL_ERROR'
    );
  }
}
