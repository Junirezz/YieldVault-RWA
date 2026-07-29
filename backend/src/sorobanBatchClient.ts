/**
 * Soroban contract call batching for latency-sensitive read operations (Issue #955).
 *
 * Problem: Each contract read (vault state, share price, total assets, etc.) is a
 * separate HTTP round-trip to the Soroban RPC. For endpoints that need multiple
 * pieces of data this serialises latency:
 *   3 calls × 200 ms = 600 ms  →  batched: ~200 ms
 *
 * Solution: `SorobanBatchClient.batchRead` fires all read calls concurrently using
 * `Promise.all`, bounded by a configurable semaphore to avoid overwhelming the RPC.
 *
 * Usage:
 *   const client = createBatchClient(rpcUrl, contractId);
 *   const summary = await client.getVaultSummaryBatched();
 */

import { logger } from './middleware/structuredLogging';
import { getCurrentTraceId } from './tracing';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A single read call descriptor: `method` is the Soroban contract function name
 * (e.g. `"total_assets"`), `args` are the encoded argument values.
 */
export interface BatchCall {
  method: string;
  args?: unknown[];
}

/** Outcome of a single call within a batch. */
export interface BatchCallResult<T = unknown> {
  method: string;
  /** Resolved value on success. */
  value?: T;
  /** Error if the call failed. */
  error?: Error;
  success: boolean;
}

/** Aggregated vault state returned by `getVaultSummaryBatched`. */
export interface VaultSummary {
  totalAssets: string;
  totalShares: string;
  sharePrice: string;
  isPaused: boolean;
}

/** Options for constructing a `SorobanBatchClient`. */
export interface BatchClientOptions {
  rpcUrl: string;
  contractId: string;
  /** Maximum simultaneous in-flight RPC calls (default 5). */
  maxConcurrency?: number;
}

interface SimulationSourceAccount {
  accountId(): string;
  sequenceNumber(): string;
  incrementSequenceNumber(): void;
}

// ── Semaphore ─────────────────────────────────────────────────────────────────

/**
 * Simple promise-based semaphore to cap concurrent RPC requests.
 */
class Semaphore {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.running++;
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// ── RPC read helper (injectable for testing) ──────────────────────────────────

/**
 * Type of the low-level RPC reader.  The default implementation calls the
 * Soroban simulateTransaction endpoint; tests inject a mock.
 */
export type RpcReader = (
  rpcUrl: string,
  contractId: string,
  method: string,
  args: unknown[],
) => Promise<unknown>;

/**
 * Default RPC reader — calls the Soroban RPC `simulateTransaction` for a
 * read-only contract invocation and returns the decoded result.
 *
 * This is intentionally lightweight: it does not sign or submit a transaction.
 */
export const defaultRpcReader: RpcReader = async (
  rpcUrl: string,
  contractId: string,
  method: string,
  args: unknown[],
): Promise<unknown> => {
  // Lazy import to keep this module testable without the full Stellar SDK.
  const { rpc, Contract, nativeToScVal, TransactionBuilder, Keypair } =
    await import('@stellar/stellar-sdk');

  const server = new rpc.Server(rpcUrl);
  const contract = new Contract(contractId);

  // Build a dummy source account for simulation (sequence=0, no real funds needed)
  const dummyKeypair = Keypair.random();
  const sourceAccount: SimulationSourceAccount = {
    accountId: () => dummyKeypair.publicKey(),
    sequenceNumber: () => '0',
    incrementSequenceNumber: () => {},
  };

  const scArgs = (args ?? []).map((a) =>
    nativeToScVal(a as Parameters<typeof nativeToScVal>[0]),
  );

  const op = contract.call(method, ...scArgs);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: '100',
    networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015',
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Soroban simulation error for ${method}: ${'error' in sim ? String(sim.error) : 'unknown'}`);
  }

  // Return the raw result for the caller to decode
  return (sim as { result?: { retval?: unknown } }).result?.retval ?? null;
};

// ── SorobanBatchClient ────────────────────────────────────────────────────────

export class SorobanBatchClient {
  private readonly semaphore: Semaphore;
  private readonly rpcUrl: string;
  private readonly contractId: string;
  private readonly reader: RpcReader;

  constructor(options: BatchClientOptions, reader: RpcReader = defaultRpcReader) {
    this.rpcUrl = options.rpcUrl;
    this.contractId = options.contractId;
    this.semaphore = new Semaphore(options.maxConcurrency ?? 5);
    this.reader = reader;
  }

  /**
   * Fire all calls concurrently (up to `maxConcurrency` at a time).
   * Rejects if any call throws (use `batchReadWithFallback` for partial-failure tolerance).
   */
  async batchRead<T = unknown>(calls: BatchCall[]): Promise<T[]> {
    if (calls.length === 0) return [];

    const startMs = Date.now();
    let sumIndividualMs = 0;

    const results = await Promise.all(
      calls.map((call) =>
        this.semaphore.run(async () => {
          const callStart = Date.now();
          const value = await this.reader(this.rpcUrl, this.contractId, call.method, call.args ?? []);
          sumIndividualMs += Date.now() - callStart;
          return value as T;
        }),
      ),
    );

    const batchMs = Date.now() - startMs;
    logger.log('debug', 'soroban batch read complete', {
      callCount: calls.length,
      batchMs,
      sumIndividualMs,
      latencySavingMs: Math.max(0, sumIndividualMs - batchMs),
      traceId: getCurrentTraceId(),
    });

    return results;
  }

  /**
   * Like `batchRead`, but each failing call returns `fallback` instead of
   * rejecting the whole batch.  Useful for non-critical supplementary data.
   */
  async batchReadWithFallback<T = unknown>(
    calls: BatchCall[],
    fallback: T,
  ): Promise<BatchCallResult<T>[]> {
    if (calls.length === 0) return [];

    const startMs = Date.now();

    const results = await Promise.all(
      calls.map(async (call): Promise<BatchCallResult<T>> => {
        try {
          const value = await this.semaphore.run(() =>
            this.reader(this.rpcUrl, this.contractId, call.method, call.args ?? []),
          );
          return { method: call.method, value: value as T, success: true };
        } catch (err) {
          logger.log('warn', `batch call failed — using fallback for ${call.method}`, {
            error: err instanceof Error ? err.message : String(err),
            traceId: getCurrentTraceId(),
          });
          return {
            method: call.method,
            value: fallback,
            error: err instanceof Error ? err : new Error(String(err)),
            success: false,
          };
        }
      }),
    );

    const batchMs = Date.now() - startMs;
    const failed = results.filter((r) => !r.success).length;
    if (failed > 0) {
      logger.log('warn', `batch read completed with ${failed}/${calls.length} failures`, {
        batchMs,
        traceId: getCurrentTraceId(),
      });
    }

    return results;
  }

  /**
   * Fetch vault summary (totalAssets, totalShares, sharePrice, isPaused)
   * in a single batched call where all four reads are fired concurrently.
   */
  async getVaultSummaryBatched(): Promise<VaultSummary> {
    const calls: BatchCall[] = [
      { method: 'total_assets' },
      { method: 'total_shares' },
      { method: 'share_price' },
      { method: 'is_paused' },
    ];

    const results = await this.batchReadWithFallback<unknown>(calls, null);

    const get = (method: string): unknown =>
      results.find((r) => r.method === method)?.value ?? null;

    const coerceString = (v: unknown): string => {
      if (v === null || v === undefined) return '0';
      if (typeof v === 'bigint') return v.toString();
      return String(v);
    };

    return {
      totalAssets: coerceString(get('total_assets')),
      totalShares: coerceString(get('total_shares')),
      sharePrice: coerceString(get('share_price')),
      isPaused: Boolean(get('is_paused')),
    };
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a `SorobanBatchClient` using environment-resolved defaults.
 *
 * @param rpcUrl    Soroban RPC endpoint (default: `STELLAR_RPC_URL` env var).
 * @param contractId  Vault contract address (default: `VAULT_CONTRACT_ID` env var).
 * @param maxConcurrency  Cap on simultaneous RPC calls (default 5).
 */
export function createBatchClient(
  rpcUrl?: string,
  contractId?: string,
  maxConcurrency = 5,
): SorobanBatchClient {
  const resolvedRpc = rpcUrl ?? process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';
  const resolvedContract =
    contractId ?? process.env.VAULT_CONTRACT_ID ?? '';

  if (!resolvedContract) {
    throw new Error(
      'createBatchClient: contractId must be provided or VAULT_CONTRACT_ID env var must be set',
    );
  }

  return new SorobanBatchClient({ rpcUrl: resolvedRpc, contractId: resolvedContract, maxConcurrency });
}
