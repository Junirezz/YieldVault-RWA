/**
 * @file transferOrchestrator.ts
 * Idempotent, retry-safe transfer orchestration service (Issue #1043).
 *
 * A vault transfer is a *money-moving* call: `submitVaultOperation` builds a
 * fresh transaction (fresh sequence number), signs it, and pushes it to the
 * network. Retrying that call is therefore not free — a second call is a second
 * transaction, not a repeat of the first one.
 *
 * The previous implementation wrapped the RPC in `IdempotencyStore.execute` and
 * stopped there. That covers the happy path (same key twice → one transaction,
 * replayed response) but leaves the failure paths open:
 *
 *   - **Unscoped keys.** The client-supplied key was used verbatim as the store
 *     key, so a trivial key (`"1"`) from wallet A occupied the same slot as
 *     wallet B's, and B either replayed A's transaction hash or got a spurious
 *     409. Keys are now scoped per wallet before they reach the store.
 *   - **Unvalidated input.** An empty key, or a negative/NaN amount, reached the
 *     signing path and produced a cached result or an opaque 500.
 *   - **Blind retries through the in-doubt window.** A failure *after* the
 *     envelope reached the network (unexpected submit status, socket error, or a
 *     hung call) is not evidence that nothing moved. Retrying it can transfer
 *     twice. Those failures are now classified `indeterminate`, parked, and
 *     refused until an operator reconciles them.
 *   - **Re-doing terminally rejected work.** A 422 was re-executed on every
 *     retry. Terminal rejections are now stored under the key and replayed.
 *   - **No fail-fast, no timeout, no signal.** A dead RPC was hammered with the
 *     full retry budget on every request, a hung call held the key's pending
 *     slot forever, and none of it was observable.
 *
 * Retry-safety contract
 * ---------------------
 * For a given (wallet, idempotency key) pair, at most one transaction is ever
 * submitted. Every subsequent call either replays the stored outcome or fails
 * loudly; it never silently submits a second transaction. A caller may retry
 * freely on `retryable` failures — those are proven pre-submission, so nothing
 * moved.
 */

import crypto from 'crypto';
import { submitVaultOperation } from './sorobanClient';
import {
  idempotencyStore,
  buildIdempotencyFingerprint,
  IdempotencyConflictError,
  IdempotentOperationResult,
} from './idempotency';
import { sorobanCircuitBreaker, CircuitOpenError } from './circuitBreaker';
import { isValidStellarAddress, normalizeWalletAddress } from './walletUtils';
import { logger } from './middleware/structuredLogging';
import { getCurrentTraceId } from './tracing';
import { parseMoneyAmount } from './feeCalculator';
import {
  transferOrchestrationTotal,
  transferOrchestrationReplayTotal,
  transferOrchestrationFailureTotal,
  transferOrchestrationDurationMs,
  transferOrchestrationInDoubt,
} from './metrics';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface TransferParams {
  operationType: 'deposit' | 'withdrawal';
  walletAddress: string;
  amount: string;
  asset: string;
}

/**
 * How a submission failure may be handled.
 *
 * - `retryable`    – proven to have failed *before* the envelope reached the
 *                    network. Nothing moved; the caller may retry with the same
 *                    key and it will re-execute.
 * - `terminal`     – the request itself is invalid. Retrying cannot help, so the
 *                    rejection is stored and replayed under the same key.
 * - `indeterminate` – the envelope may or may not have reached the network. The
 *                    key is parked as in-doubt and never auto-resubmitted.
 */
export type TransferFailureClass = 'retryable' | 'terminal' | 'indeterminate';

export interface TransferOrchestrationResult {
  /** Preserved shape: `body` is the on-chain transaction hash. */
  result: IdempotentOperationResult<string>;
  /** True when the response came from the idempotency store, not a new submission. */
  replayed: boolean;
  outcome: 'submitted' | 'replayed';
  transactionHash: string;
  /** The wallet-scoped key the store was keyed on. */
  storeKey: string;
}

/** An orchestrated transfer whose on-chain outcome is unknown. */
export interface InDoubtTransfer {
  storeKey: string;
  idempotencyKey: string;
  walletAddress: string;
  operationType: 'deposit' | 'withdrawal';
  amount: string;
  asset: string;
  /** Failure that opened the in-doubt window. */
  code: string;
  message: string;
  detectedAt: string;
  correlationId: string | null;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

/** Base class so the HTTP layer can map every orchestration failure uniformly. */
export class TransferOrchestrationError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly classification: TransferFailureClass;

  constructor(
    message: string,
    code: string,
    statusCode: number,
    classification: TransferFailureClass,
  ) {
    super(message);
    this.name = 'TransferOrchestrationError';
    this.code = code;
    this.statusCode = statusCode;
    this.classification = classification;
  }
}

/** The request or its idempotency key is malformed. Never reaches the network. */
export class TransferValidationError extends TransferOrchestrationError {
  constructor(message: string, code = 'TRANSFER_VALIDATION_FAILED', statusCode = 400) {
    super(message, code, statusCode, 'terminal');
    this.name = 'TransferValidationError';
  }
}

/** The key was already used for a *different* request body. */
export class TransferConflictError extends TransferOrchestrationError {
  constructor(message = 'Idempotency key already used for a different transfer') {
    super(message, 'TRANSFER_IDEMPOTENCY_CONFLICT', 409, 'terminal');
    this.name = 'TransferConflictError';
  }
}

/**
 * The transfer may or may not have been submitted on chain. The key is parked
 * and will keep failing this way until an operator reconciles it — auto-retrying
 * could move funds twice.
 */
export class TransferInDoubtError extends TransferOrchestrationError {
  public readonly storeKey: string;

  constructor(storeKey: string, cause: string) {
    super(
      `Transfer outcome is unknown and requires reconciliation before retry: ${cause}`,
      'TRANSFER_IN_DOUBT',
      409,
      'indeterminate',
    );
    this.name = 'TransferInDoubtError';
    this.storeKey = storeKey;
  }
}

/** The dependency is unavailable and the transfer was not submitted. Safe to retry. */
export class TransferUnavailableError extends TransferOrchestrationError {
  public readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number, code = 'TRANSFER_DEPENDENCY_UNAVAILABLE') {
    super(message, code, 503, 'retryable');
    this.name = 'TransferUnavailableError';
    this.retryAfterMs = retryAfterMs;
  }
}

// ─── Config ───────────────────────────────────────────────────────────────────

function parseIntEnv(raw: string | undefined, fallback: number, min = 1): number {
  const parsed = parseInt(raw ?? '', 10);
  if (Number.isNaN(parsed) || parsed < min) return fallback;
  return parsed;
}

/**
 * Read at call time rather than module load so tests and operators can change
 * the value without re-importing the module.
 */
function submissionTimeoutMs(): number {
  return parseIntEnv(process.env.TRANSFER_ORCHESTRATION_TIMEOUT_MS, 45_000, 1_000);
}

function maxKeyLength(): number {
  return parseIntEnv(process.env.TRANSFER_ORCHESTRATION_MAX_KEY_LENGTH, 255, 8);
}

/** Printable ASCII without whitespace — safe as a Redis key segment. */
const KEY_CHARSET = /^[A-Za-z0-9._:~-]+$/;
const MIN_KEY_LENGTH = 8;
const STORE_KEY_PREFIX = 'transfer';

// ─── Failure classification ───────────────────────────────────────────────────

/**
 * Soroban error codes that are proven to have failed *before* the signed
 * envelope was handed to the network. See `submitVaultOperation`: each of these
 * is raised on the build/simulate path, or is an explicit RPC rejection
 * (`status === 'ERROR'`), so no transaction exists to duplicate.
 */
const PRE_SUBMISSION_CODES = new Set([
  'SIMULATION_ERROR',
  'RESTORE_REQUIRED',
  'RPC_ERROR',
  'SOROBAN_CIRCUIT_OPEN',
]);

/** Codes describing a request that cannot succeed however often it is retried. */
const TERMINAL_CODES = new Set(['INVALID_ADDRESS', 'INVALID_AMOUNT']);

/**
 * Classify a submission failure.
 *
 * Unknown failures default to **`indeterminate`**, which is the opposite of the
 * default used by the withdrawal saga coordinator and deliberately so: that
 * coordinator retries idempotent steps, whereas a retry here mints a *new*
 * transaction. When we cannot prove nothing moved, we refuse to move again and
 * escalate to an operator instead.
 */
export function classifyTransferFailure(err: unknown): TransferFailureClass {
  if (err instanceof CircuitOpenError) return 'retryable';
  if (err instanceof TransferOrchestrationError) return err.classification;

  if (!err || typeof err !== 'object') return 'indeterminate';
  const e = err as { code?: unknown; statusCode?: unknown };

  const code = typeof e.code === 'string' ? e.code : undefined;
  if (code) {
    if (TERMINAL_CODES.has(code)) return 'terminal';
    if (PRE_SUBMISSION_CODES.has(code)) return 'retryable';
  }

  // A 4xx that is not one of the codes above is still a rejected request.
  const status = typeof e.statusCode === 'number' ? e.statusCode : undefined;
  if (status !== undefined && status >= 400 && status < 500 && status !== 409) {
    return 'terminal';
  }

  return 'indeterminate';
}

// ─── Stored record ────────────────────────────────────────────────────────────

/**
 * What is persisted under the idempotency key.
 *
 * `rejected` and `in_doubt` records are stored deliberately: replaying them is
 * how a retry is stopped from re-submitting. `retryable` failures are *not*
 * stored — they throw out of the operation so the store keeps nothing and the
 * next attempt re-executes.
 */
interface StoredTransfer {
  outcome: 'submitted' | 'rejected' | 'in_doubt';
  transactionHash: string | null;
  code: string | null;
  message: string | null;
  /** HTTP status to replay for a stored rejection. */
  statusCode: number | null;
  submittedAt: string;
}

// ─── In-doubt registry ────────────────────────────────────────────────────────

const inDoubtTransfers = new Map<string, InDoubtTransfer & { fingerprint: string }>();

function recordInDoubt(entry: InDoubtTransfer & { fingerprint: string }): void {
  inDoubtTransfers.set(entry.storeKey, entry);
  transferOrchestrationInDoubt.set(inDoubtTransfers.size);
}

/** Project the operator-facing view, dropping the internal fingerprint. */
function toOperatorView(entry: InDoubtTransfer & { fingerprint: string }): InDoubtTransfer {
  return {
    storeKey: entry.storeKey,
    idempotencyKey: entry.idempotencyKey,
    walletAddress: entry.walletAddress,
    operationType: entry.operationType,
    amount: entry.amount,
    asset: entry.asset,
    code: entry.code,
    message: entry.message,
    detectedAt: entry.detectedAt,
    correlationId: entry.correlationId,
  };
}

/** Snapshot of transfers awaiting operator reconciliation. */
export function listInDoubtTransfers(): InDoubtTransfer[] {
  return Array.from(inDoubtTransfers.values()).map(toOperatorView);
}

export function getInDoubtTransfer(storeKey: string): InDoubtTransfer | null {
  const entry = inDoubtTransfers.get(storeKey);
  return entry ? toOperatorView(entry) : null;
}

/**
 * Close an in-doubt window after an operator has checked the chain.
 *
 * - `{ transactionHash }` – the transfer *did* land. The stored record becomes a
 *   normal success so any replay of the original key returns that hash.
 * - `{ discard: true }` – nothing landed. The key is released so the client may
 *   retry the transfer from scratch.
 */
export async function resolveInDoubtTransfer(
  storeKey: string,
  resolution: { transactionHash: string } | { discard: true },
): Promise<boolean> {
  const entry = inDoubtTransfers.get(storeKey);
  if (!entry) return false;

  // Drop the parked record first; both resolutions replace or release it.
  await idempotencyStore.deleteKey(storeKey);

  if ('discard' in resolution) {
    inDoubtTransfers.delete(storeKey);
    transferOrchestrationInDoubt.set(inDoubtTransfers.size);
    logger.log('warn', 'In-doubt transfer discarded; key released for retry', {
      storeKey,
      walletAddress: entry.walletAddress,
      operationType: entry.operationType,
      traceId: getCurrentTraceId(),
    });
    return true;
  }

  const confirmed: StoredTransfer = {
    outcome: 'submitted',
    transactionHash: resolution.transactionHash,
    code: null,
    message: null,
    statusCode: null,
    submittedAt: new Date().toISOString(),
  };

  // Re-seed the key with the confirmed hash. The operation body never runs a
  // submission — it only writes the record the operator supplied.
  await idempotencyStore.execute<StoredTransfer>(storeKey, entry.fingerprint, async () => ({
    statusCode: 200,
    body: confirmed,
  }));

  inDoubtTransfers.delete(storeKey);
  transferOrchestrationInDoubt.set(inDoubtTransfers.size);
  logger.log('info', 'In-doubt transfer confirmed as submitted', {
    storeKey,
    transactionHash: resolution.transactionHash,
    walletAddress: entry.walletAddress,
    operationType: entry.operationType,
    traceId: getCurrentTraceId(),
  });
  return true;
}

/** Test hook: clears the in-doubt registry and its gauge. */
export function resetTransferOrchestratorForTests(): void {
  inDoubtTransfers.clear();
  transferOrchestrationInDoubt.set(0);
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Amounts arrive as strings to survive JSON without float rounding. Accept a
 * plain positive decimal only — no exponents, no signs, no `Infinity`/`NaN`,
 * all of which `Number()` would happily coerce further down the stack.
 */
function assertValidKey(idempotencyKey: unknown): string {
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
    throw new TransferValidationError(
      'An idempotency key is required for transfer orchestration',
      'TRANSFER_IDEMPOTENCY_KEY_REQUIRED',
    );
  }

  const key = idempotencyKey.trim();
  if (key.length < MIN_KEY_LENGTH) {
    throw new TransferValidationError(
      `Idempotency key must be at least ${MIN_KEY_LENGTH} characters`,
      'TRANSFER_IDEMPOTENCY_KEY_TOO_SHORT',
    );
  }
  if (key.length > maxKeyLength()) {
    throw new TransferValidationError(
      `Idempotency key must be at most ${maxKeyLength()} characters`,
      'TRANSFER_IDEMPOTENCY_KEY_TOO_LONG',
    );
  }
  if (!KEY_CHARSET.test(key)) {
    throw new TransferValidationError(
      'Idempotency key may only contain letters, digits and the characters . _ : ~ -',
      'TRANSFER_IDEMPOTENCY_KEY_INVALID',
    );
  }
  return key;
}

function assertValidParams(params: TransferParams): TransferParams {
  if (params?.operationType !== 'deposit' && params?.operationType !== 'withdrawal') {
    throw new TransferValidationError(
      'operationType must be "deposit" or "withdrawal"',
      'TRANSFER_OPERATION_INVALID',
      422,
    );
  }
  if (!isValidStellarAddress(params.walletAddress)) {
    throw new TransferValidationError(
      'walletAddress is not a valid Stellar public key',
      'TRANSFER_WALLET_INVALID',
      422,
    );
  }
  let amount: string;
  try {
    amount = parseMoneyAmount(params.amount).toFixed();
  } catch (error) {
    throw new TransferValidationError(
      error instanceof Error ? error.message : 'amount is invalid',
      'TRANSFER_AMOUNT_INVALID',
      422,
    );
  }
  if (typeof params.asset !== 'string' || params.asset.trim() === '') {
    throw new TransferValidationError('asset is required', 'TRANSFER_ASSET_INVALID', 422);
  }

  // Canonicalise so two spellings of the same request share one fingerprint.
  return {
    operationType: params.operationType,
    walletAddress: normalizeWalletAddress(params.walletAddress),
    amount,
    asset: params.asset.trim().toUpperCase(),
  };
}

/**
 * Scope the caller's key to the wallet so a guessed or trivially-chosen key
 * cannot collide across wallets. The wallet is hashed rather than embedded so
 * the key stays a bounded length and does not leak an address into Redis
 * keyspace listings.
 */
export function buildTransferStoreKey(walletAddress: string, idempotencyKey: string): string {
  const walletScope = crypto
    .createHash('sha256')
    .update(normalizeWalletAddress(walletAddress))
    .digest('hex')
    .slice(0, 16);
  return `${STORE_KEY_PREFIX}:${walletScope}:${idempotencyKey}`;
}

// ─── Timeout guard ────────────────────────────────────────────────────────────

class TransferTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Transfer submission did not settle within ${timeoutMs}ms`);
    this.name = 'TransferTimeoutError';
  }
}

/**
 * Bound the submission so a hung RPC cannot pin the key's in-flight slot for the
 * lifetime of the process. A timeout is *not* proof that nothing was submitted,
 * so it is classified `indeterminate` by the caller.
 */
async function withTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new TransferTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─── Orchestration ────────────────────────────────────────────────────────────

/**
 * Orchestrate a vault transfer idempotently and retry-safely.
 *
 * @param params - transfer details; canonicalised before fingerprinting
 * @param idempotencyKey - stable client-supplied key (e.g. a UUID)
 *
 * @throws {TransferValidationError}   malformed request or key (400/422)
 * @throws {TransferConflictError}     key reused with a different body (409)
 * @throws {TransferInDoubtError}      outcome unknown; needs reconciliation (409)
 * @throws {TransferUnavailableError}  dependency down, nothing submitted (503)
 * @throws {TransferOrchestrationError} stored terminal rejection, replayed
 */
export async function orchestrateTransfer(
  params: TransferParams,
  idempotencyKey: string,
): Promise<TransferOrchestrationResult> {
  const key = assertValidKey(idempotencyKey);
  const canonical = assertValidParams(params);
  const storeKey = buildTransferStoreKey(canonical.walletAddress, key);
  const fingerprint = buildIdempotencyFingerprint(canonical);
  const operation = canonical.operationType;
  const startedAt = Date.now();

  let stored: { result: IdempotentOperationResult<StoredTransfer>; replayed: boolean };
  try {
    stored = await idempotencyStore.execute<StoredTransfer>(storeKey, fingerprint, async () => {
      const record = await submitOnce(canonical, storeKey, key, fingerprint);
      return { statusCode: 200, body: record };
    });
  } catch (err) {
    if (err instanceof IdempotencyConflictError) {
      transferOrchestrationTotal.inc({ operation, outcome: 'conflict' });
      logger.log('warn', 'Transfer idempotency key reused with a different body', {
        storeKey,
        operationType: operation,
        walletAddress: canonical.walletAddress,
        traceId: getCurrentTraceId(),
      });
      throw new TransferConflictError();
    }
    // A retryable failure: nothing was stored, so the next call re-executes.
    throw toPublicError(err, storeKey, operation, startedAt);
  }

  const record = stored.result.body;

  if (record.outcome === 'in_doubt') {
    // Raised for the caller that opened the window *and* for every later replay
    // of the parked key, so no caller ever sees a success-shaped result.
    if (stored.replayed) transferOrchestrationReplayTotal.inc({ operation, replay_of: 'in_doubt' });
    throw new TransferInDoubtError(storeKey, record.message ?? record.code ?? 'unknown failure');
  }

  if (record.outcome === 'rejected') {
    if (stored.replayed) transferOrchestrationReplayTotal.inc({ operation, replay_of: 'rejected' });
    throw new TransferOrchestrationError(
      record.message ?? 'Transfer was rejected',
      record.code ?? 'TRANSFER_REJECTED',
      record.statusCode ?? 422,
      'terminal',
    );
  }

  const outcome = stored.replayed ? 'replayed' : 'submitted';
  transferOrchestrationTotal.inc({ operation, outcome });
  transferOrchestrationDurationMs.observe({ operation, outcome }, Date.now() - startedAt);
  if (stored.replayed) {
    transferOrchestrationReplayTotal.inc({ operation, replay_of: 'submitted' });
  }

  logger.log('info', `Transfer orchestration ${outcome}`, {
    storeKey,
    operationType: operation,
    walletAddress: canonical.walletAddress,
    amount: canonical.amount,
    asset: canonical.asset,
    transactionHash: record.transactionHash,
    replayed: stored.replayed,
    traceId: getCurrentTraceId(),
  });

  return {
    result: { statusCode: 200, body: record.transactionHash as string },
    replayed: stored.replayed,
    outcome,
    transactionHash: record.transactionHash as string,
    storeKey,
  };
}

/**
 * Submit exactly once, translating the outcome into a record to store or an
 * error to propagate.
 *
 * Returning a record means "store this under the key"; throwing means "store
 * nothing, this may be retried".
 */
async function submitOnce(
  canonical: TransferParams,
  storeKey: string,
  idempotencyKey: string,
  fingerprint: string,
): Promise<StoredTransfer> {
  const operation = canonical.operationType;
  const attemptStartedAt = Date.now();

  try {
    const transactionHash = await withTimeout(
      () =>
        sorobanCircuitBreaker.execute(() =>
          submitVaultOperation(
            canonical.operationType,
            canonical.walletAddress,
            canonical.amount,
            canonical.asset,
          ),
        ),
      submissionTimeoutMs(),
    );

    return {
      outcome: 'submitted',
      transactionHash,
      code: null,
      message: null,
      statusCode: null,
      submittedAt: new Date().toISOString(),
    };
  } catch (err) {
    const classification = classifyTransferFailure(err);
    const code = errorCode(err);
    const message = err instanceof Error ? err.message : String(err);

    transferOrchestrationFailureTotal.inc({ operation, classification, code });
    transferOrchestrationDurationMs.observe(
      { operation, outcome: classification },
      Date.now() - attemptStartedAt,
    );

    if (classification === 'terminal') {
      logger.log('warn', 'Transfer rejected terminally; caching rejection under key', {
        storeKey,
        operationType: operation,
        walletAddress: canonical.walletAddress,
        code,
        error: message,
        traceId: getCurrentTraceId(),
      });
      transferOrchestrationTotal.inc({ operation, outcome: 'rejected' });
      return {
        outcome: 'rejected',
        transactionHash: null,
        code,
        message,
        statusCode: httpStatusOf(err, 422),
        submittedAt: new Date().toISOString(),
      };
    }

    if (classification === 'indeterminate') {
      // Park the key. Storing an `in_doubt` record is what stops a retry from
      // minting a second transaction; the alert is what gets it reconciled.
      recordInDoubt({
        storeKey,
        idempotencyKey,
        walletAddress: canonical.walletAddress,
        operationType: canonical.operationType,
        amount: canonical.amount,
        asset: canonical.asset,
        code,
        message,
        detectedAt: new Date().toISOString(),
        correlationId: getCurrentTraceId() ?? null,
        fingerprint,
      });
      transferOrchestrationTotal.inc({ operation, outcome: 'in_doubt' });
      logger.log('error', 'Transfer outcome unknown; parked for reconciliation', {
        alert: 'transfer-in-doubt',
        storeKey,
        operationType: operation,
        walletAddress: canonical.walletAddress,
        amount: canonical.amount,
        asset: canonical.asset,
        code,
        error: message,
        traceId: getCurrentTraceId(),
      });
      return {
        outcome: 'in_doubt',
        transactionHash: null,
        code,
        message,
        statusCode: 409,
        submittedAt: new Date().toISOString(),
      };
    }

    // Retryable: throw so the store keeps nothing and a retry re-executes.
    logger.log('warn', 'Transfer failed before submission; safe to retry', {
      storeKey,
      operationType: operation,
      walletAddress: canonical.walletAddress,
      code,
      error: message,
      traceId: getCurrentTraceId(),
    });
    throw err;
  }
}

/**
 * Map a thrown (i.e. retryable, nothing-stored) failure onto the public error
 * surface, so callers get a 503 with a retry hint instead of a raw RPC error.
 */
function toPublicError(
  err: unknown,
  storeKey: string,
  operation: 'deposit' | 'withdrawal',
  startedAt: number,
): Error {
  if (err instanceof TransferOrchestrationError) return err;

  transferOrchestrationTotal.inc({ operation, outcome: 'retryable_failure' });
  transferOrchestrationDurationMs.observe(
    { operation, outcome: 'retryable_failure' },
    Date.now() - startedAt,
  );

  if (err instanceof CircuitOpenError) {
    return new TransferUnavailableError(
      'Soroban RPC circuit breaker is open; transfer was not submitted',
      err.retryAfterMs,
      'TRANSFER_CIRCUIT_OPEN',
    );
  }

  const message = err instanceof Error ? err.message : String(err);
  return new TransferUnavailableError(
    `Transfer was not submitted: ${message}`,
    0,
    errorCode(err) || 'TRANSFER_DEPENDENCY_UNAVAILABLE',
  );
}

function errorCode(err: unknown): string {
  if (err instanceof CircuitOpenError) return 'SOROBAN_CIRCUIT_OPEN';
  if (err instanceof TransferTimeoutError) return 'TRANSFER_TIMEOUT';
  if (err && typeof err === 'object') {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && code) return code;
    const name = (err as { name?: unknown }).name;
    if (typeof name === 'string' && name) return name;
  }
  return 'UNKNOWN';
}

function httpStatusOf(err: unknown, fallback: number): number {
  if (err && typeof err === 'object') {
    const status = (err as { statusCode?: unknown }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 600) return status;
  }
  return fallback;
}
