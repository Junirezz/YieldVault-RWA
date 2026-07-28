import { Router, Request, Response, NextFunction } from 'express';
import { emailService } from './emailService';
import { logger } from './middleware/structuredLogging';
import { allowlistMiddleware } from './middleware/allowlist';
import { triggerCacheInvalidation, registerInvalidationHook } from './middleware/cache';
import { depositsLimiter } from './rateLimiter';
import {
  idempotencyStore,
  IdempotencyConflictError,
  type IdempotentOperationResult,
} from './idempotency';
import { sorobanCircuitBreaker, CircuitOpenError } from './circuitBreaker';
import { withSpan, getCurrentTraceId } from './tracing';
import { submitVaultOperation, SorobanSimulationError } from './sorobanClient';
import { requireFlag } from './featureFlags';
import { referralService } from './referralService';
import { getPrismaClient } from './prismaClient';
import { emitTransactionEvent, TransactionEventType } from './webhookDelivery';
import {
  validate,
  VaultDepositBodySchema,
  VaultWithdrawalBodySchema,
} from './middleware/validate';
import { withdrawalDailyLimitMiddleware } from './middleware/withdrawalDailyLimit';
import { requireSignedWalletAction } from './middleware/walletSignedAction';
import { createTimeoutFor } from './middleware/timeoutMiddleware';
import crypto from 'crypto';
// crypto is still used below for generateFingerprint and body.id generation.
import { tryAcquireWalletLock } from './walletLock';
import { normalizeWalletAddress } from './walletUtils';
import { recordVaultLifecycleEvent } from './vaultAuditLog';
import {
  registerWithdrawalPlan,
  withdrawalRecoveryCoordinator,
} from './withdrawalRecovery';
import Decimal from 'decimal.js';

const router = Router();
const ZERO = new Decimal(0);
const DEFAULT_SHARE_PRICE = new Decimal(1);

// Register cache invalidation hooks for transaction state changes
registerInvalidationHook((eventType) => {
  if (eventType.startsWith('transaction.')) {
    return [
      'GET:/api/v1/vault',
      'GET:/api/v1/transactions',
      'GET:/api/v1/portfolio',
    ];
  }
  return [];
});

function invalidateReadCaches(_req: Request, _res: Response, next: NextFunction): void {
  // Trigger adaptive cache invalidation via hooks
  triggerCacheInvalidation('transaction.write');
  next();
}

function generateFingerprint(body: any): string {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

/**
 * Submit a vault operation to the Stellar network via the real Soroban RPC,
 * wrapped in the circuit breaker (opens after repeated RPC failures) and an
 * OTel trace span.
 */
async function submitSorobanTx(type: string, payload: Record<string, unknown>): Promise<string> {
  return sorobanCircuitBreaker.execute(() =>
    withSpan('soroban.rpc.submit', async (span) => {
      span.setAttributes({ 'rpc.type': type, 'rpc.wallet': String(payload.walletAddress ?? '') });
      return submitVaultOperation(
        type as 'deposit' | 'withdrawal',
        String(payload.walletAddress),
        String(payload.amount),
        String(payload.asset),
      );
    }),
  );
}

async function updateVaultStateAndSnapshot(
  type: 'deposit' | 'withdrawal',
  amountRaw: string,
  recordedAt: Date,
): Promise<void> {
  const prisma = getPrismaClient();
  const amount = new Decimal(amountRaw);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.vaultState.findUnique({ where: { id: 1 } });
    const currentAssets = existing ? new Decimal(existing.totalAssets) : ZERO;
    const currentShares = existing ? new Decimal(existing.totalShares) : ZERO;
    const currentSharePrice = currentAssets.gt(0) && currentShares.gt(0)
      ? currentAssets.div(currentShares)
      : DEFAULT_SHARE_PRICE;

    let nextAssets = currentAssets;
    let nextShares = currentShares;

    if (type === 'deposit') {
      const mintedShares = amount.div(currentSharePrice);
      nextAssets = currentAssets.plus(amount);
      nextShares = currentShares.plus(mintedShares);
    } else {
      const burnedShares = amount.div(currentSharePrice);
      nextAssets = Decimal.max(ZERO, currentAssets.minus(amount));
      nextShares = Decimal.max(ZERO, currentShares.minus(burnedShares));
    }

    await tx.vaultState.upsert({
      where: { id: 1 },
      update: {
        totalAssets: nextAssets.toFixed(6),
        totalShares: nextShares.toFixed(6),
      },
      create: {
        id: 1,
        totalAssets: nextAssets.toFixed(6),
        totalShares: nextShares.toFixed(6),
      },
    });

    const resultingSharePrice = nextAssets.gt(0) && nextShares.gt(0)
      ? nextAssets.div(nextShares)
      : DEFAULT_SHARE_PRICE;

    await tx.sharePriceSnapshot.create({
      data: {
        sharePrice: resultingSharePrice.toFixed(6),
        totalAssets: nextAssets.toFixed(6),
        totalShares: nextShares.toFixed(6),
        source: `vault_${type}`,
        recordedAt,
      },
    });
  });
}

// ─── Withdrawal partial-failure recovery plan (Issue #954) ───────────────────

/** Name of the registered saga plan used by POST /vault/withdrawals. */
export const WITHDRAWAL_PLAN = 'vault.withdrawal';

/**
 * Deterministic transaction row id derived from the withdrawal identity so a
 * recovery pass upserts the same row instead of inserting a duplicate.
 */
function withdrawalRowId(withdrawalId: string): string {
  return `wd_${crypto.createHash('sha256').update(withdrawalId).digest('hex').slice(0, 28)}`;
}

/**
 * The three durable steps of a withdrawal, journalled independently so a
 * failure between any two of them can be retried, compensated, or escalated.
 *
 * Ordering matters: the on-chain submission is irreversible, so everything that
 * can fail cheaply (validation, limits, locks) already ran in middleware before
 * this plan starts.
 */
registerWithdrawalPlan(WITHDRAWAL_PLAN, [
  {
    name: 'chain_submit',
    // Funds move here. Never repeat this step: a second submission could
    // withdraw twice.
    irreversible: true,
    maxAttempts: 1,
    execute: async ({ saga }) => {
      const txHash = await submitSorobanTx('withdrawal', {
        amount: saga.amount,
        asset: saga.asset,
        walletAddress: saga.state.rawWalletAddress ?? saga.walletAddress,
      });

      recordVaultLifecycleEvent({
        operation: 'withdrawal',
        phase: 'submitted',
        actor: saga.walletAddress,
        amount: saga.amount,
        asset: saga.asset,
        txHash,
        correlationId: saga.correlationId ?? undefined,
        traceId: getCurrentTraceId(),
        metadata: { sagaId: saga.id },
      });

      return { txHash };
    },
  },
  {
    name: 'persist_transaction',
    execute: async ({ saga }) => {
      const prisma = getPrismaClient();
      const id = withdrawalRowId(saga.withdrawalId);
      const referralCode =
        typeof saga.state.referralCode === 'string' ? saga.state.referralCode : undefined;

      // Upsert on a deterministic id keeps retries idempotent even when the
      // previous attempt committed the row before failing.
      await prisma.transaction.upsert({
        where: { id },
        update: { status: 'completed' },
        create: {
          id,
          user: saga.walletAddress,
          amount: saga.amount,
          type: 'withdrawal',
          status: 'completed',
          referralCode,
        },
      });

      return { transactionRowId: id };
    },
    compensate: async ({ saga }) => {
      const id = saga.state.transactionRowId;
      if (typeof id !== 'string') return;
      const prisma = getPrismaClient();
      await prisma.transaction.update({
        where: { id },
        data: { status: 'reversed' },
      });
    },
  },
  {
    name: 'vault_state_update',
    execute: async ({ saga }) => {
      // Runs inside a single Prisma transaction, so a failure applies nothing
      // and a retry cannot double-apply the delta.
      await updateVaultStateAndSnapshot('withdrawal', saga.amount, new Date());
    },
    compensate: async ({ saga }) => {
      // Re-add the withdrawn assets and shares, restoring the pre-withdrawal
      // totals and recording the reversal as its own share-price snapshot.
      await updateVaultStateAndSnapshot('deposit', saga.amount, new Date());
    },
  },
]);

/** Shared handler logic for deposit / withdrawal to avoid duplication. */
async function handleVaultOperation(
  req: Request,
  res: Response,
  type: 'deposit' | 'withdrawal',
): Promise<Response> {
  // Task 3: read Idempotency-Key header (spec-compliant name)
  const idempotencyKey =
    (req.headers['idempotency-key'] as string | undefined) ||
    (req.headers['x-idempotency-key'] as string | undefined);

  const { amount, asset, walletAddress, email, referralCode } = req.body;
  const normalizedWallet = normalizeWalletAddress(walletAddress);
  const correlationId = req.header('x-correlation-id') || undefined;
  const walletLock = tryAcquireWalletLock(normalizedWallet);
  // Identity for the withdrawal saga journal. When the client supplies an
  // Idempotency-Key it becomes the saga identity, so a retry resumes the
  // existing saga instead of starting a second on-chain submission. Without a
  // key each request is a distinct withdrawal, exactly as before.
  const withdrawalId = idempotencyKey || `wd-${crypto.randomBytes(12).toString('hex')}`;

  if (!walletLock.acquired) {
    return res.status(409).json({
      error: 'Conflict',
      status: 409,
      code: 'WALLET_OPERATION_IN_PROGRESS',
      message: 'Another operation is already in progress for this wallet',
      walletAddress: normalizedWallet,
    });
  }

  // Audit: the vault operation has been accepted and is about to be attempted.
  recordVaultLifecycleEvent({
    operation: type,
    phase: 'initiated',
    actor: normalizedWallet,
    amount: String(amount),
    asset: String(asset),
    correlationId,
    traceId: getCurrentTraceId(),
    metadata: { idempotent: !!idempotencyKey },
  });

  // Withdrawals may return either the created transaction (201) or a recovery
  // acknowledgement (202), so the result body is widened to a record.
  const operation = async (): Promise<IdempotentOperationResult<Record<string, unknown>>> => {
    return withSpan(`vault.${type}`, async (span) => {
      span.setAttributes({
        'vault.amount': String(amount),
        'vault.asset': String(asset),
        'vault.wallet': String(walletAddress),
      });

      let txHash: string;

      if (type === 'withdrawal') {
        // Withdrawals run as a journalled saga so a failure between the
        // on-chain submission and the ledger writes is recoverable instead of
        // leaving silent drift (Issue #954).
        const outcome = await withdrawalRecoveryCoordinator.run(WITHDRAWAL_PLAN, {
          withdrawalId,
          walletAddress: normalizedWallet,
          amount: String(amount),
          asset: String(asset),
          correlationId: correlationId ?? null,
          idempotencyKey: idempotencyKey ?? null,
          state: {
            rawWalletAddress: walletAddress,
            referralCode: referralCode ?? null,
          },
        });

        if (!outcome.completed) {
          if (outcome.partial) {
            // The on-chain withdrawal succeeded but the ledger is not caught up.
            // Returning 500 here would tell the client nothing happened, which
            // is false. Acknowledge the withdrawal and hand back a recovery
            // handle instead.
            const sagaTxHash =
              typeof outcome.saga.state.txHash === 'string'
                ? outcome.saga.state.txHash
                : undefined;

            recordVaultLifecycleEvent({
              operation: 'withdrawal',
              phase: 'failed',
              actor: normalizedWallet,
              amount: String(amount),
              asset: String(asset),
              txHash: sagaTxHash,
              correlationId,
              traceId: getCurrentTraceId(),
              errorCode: 'WITHDRAWAL_PARTIAL_FAILURE',
              errorMessage: outcome.saga.lastError?.message,
              metadata: {
                sagaId: outcome.saga.id,
                recoveryStatus: outcome.status,
                recovering: outcome.recovering,
              },
            });

            span.setAttributes({
              'vault.saga.id': outcome.saga.id,
              'vault.saga.status': outcome.status,
            });

            return {
              statusCode: 202,
              body: {
                id: outcome.saga.withdrawalId,
                type,
                amount,
                asset,
                walletAddress,
                transactionHash: sagaTxHash ?? null,
                status: 'recovering',
                recovery: {
                  sagaId: outcome.saga.id,
                  status: outcome.status,
                  automatedRetryScheduled: outcome.recovering,
                  nextAttemptAt: outcome.saga.nextAttemptAt,
                  failedStep: outcome.saga.lastError?.step ?? null,
                  steps: outcome.saga.steps.map((step) => ({
                    name: step.name,
                    status: step.status,
                  })),
                },
                timestamp: new Date().toISOString(),
              },
            };
          }

          // Nothing irreversible happened (or it was rolled back cleanly) —
          // surface the original failure so the existing error mapping applies.
          throw outcome.error ?? new Error('Withdrawal failed before submission');
        }

        txHash = String(outcome.saga.state.txHash);
        span.setAttributes({ 'vault.saga.id': outcome.saga.id });
      } else {
        txHash = await submitSorobanTx(type, { amount, asset, walletAddress });

        // Audit: the transaction was accepted by the Soroban RPC.
        recordVaultLifecycleEvent({
          operation: type,
          phase: 'submitted',
          actor: normalizedWallet,
          amount: String(amount),
          asset: String(asset),
          txHash,
          correlationId,
          traceId: getCurrentTraceId(),
        });

        // Persist transaction to DB
        const prisma = getPrismaClient();
        await prisma.transaction.create({
          data: {
            user: normalizedWallet,
            amount: String(amount),
            type,
            status: 'completed',
            referralCode,
          },
        });

        await updateVaultStateAndSnapshot(type, String(amount), new Date());
      }

      // Audit: transaction durably recorded and vault state updated.
      recordVaultLifecycleEvent({
        operation: type,
        phase: 'confirmed',
        actor: normalizedWallet,
        amount: String(amount),
        asset: String(asset),
        txHash,
        correlationId,
        traceId: getCurrentTraceId(),
      });

      // Handle referral recording on deposit
      if (type === 'deposit') {
        await referralService.recordDeposit(normalizedWallet, referralCode);
      }

      const body = {
        id: `tx-${crypto.randomBytes(4).toString('hex')}`,
        type,
        amount,
        asset,
        walletAddress,
        transactionHash: txHash,
        status: 'pending',
        timestamp: new Date().toISOString(),
      };

      // Fire webhook delivery in background so transaction API latency is not blocked.
      const eventType: TransactionEventType =
        type === 'deposit' ? 'transaction.deposit.created' : 'transaction.withdrawal.created';
      void emitTransactionEvent(eventType, {
        transactionId: body.id,
        amount: String(body.amount),
        asset: String(body.asset),
        walletAddress: String(body.walletAddress),
        transactionHash: String(body.transactionHash),
        status: String(body.status),
        timestamp: String(body.timestamp),
      }).catch((error) => {
        logger.log('error', 'Failed to emit webhook delivery', {
          error: error instanceof Error ? error.message : String(error),
          eventType,
          transactionId: body.id,
        });
      });

      span.setAttributes({ 'vault.txHash': txHash });

      // Post-confirmation email (fire-and-forget)
      const schedulePostConfirmation = process.env.NODE_ENV === 'test'
        ? (fn: () => Promise<void>) => {
            void fn();
          }
        : (fn: () => Promise<void>) => {
            setTimeout(() => {
              void fn();
            }, 100);
          };

      schedulePostConfirmation(async () => {
        try {
          const confirmationDelayMs = process.env.NODE_ENV === 'test' ? 0 : 5000;
          if (confirmationDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, confirmationDelayMs));
          }
          logger.log('info', `${type} confirmed on-chain`, {
            txHash,
            walletAddress,
            traceId: getCurrentTraceId(),
          });
          if (email) {
            const sendFn =
              type === 'deposit'
                ? emailService.sendDepositConfirmation.bind(emailService)
                : emailService.sendWithdrawalConfirmation.bind(emailService);
            await sendFn(email, {
              amount: String(amount),
              asset,
              date: new Date().toISOString(),
              txHash,
              walletAddress,
            });
          }
        } catch (error) {
          logger.log('error', 'Error in post-confirmation email logic', {
            error: error instanceof Error ? error.message : String(error),
            txHash,
            traceId: getCurrentTraceId(),
          });
        }
      });

      return { statusCode: 201, body };
    });
  };

  try {
    if (idempotencyKey) {
      const fingerprint = generateFingerprint(req.body);
      const { result, replayed } = await idempotencyStore.execute(
        idempotencyKey,
        fingerprint,
        operation,
      );
      if (replayed) res.setHeader('idempotency-status', 'replayed');
      // Trigger adaptive cache invalidation via hooks
      triggerCacheInvalidation(`transaction.${type}.completed`, {
        wallet: normalizedWallet,
        amount: String(amount),
      });
      return res.status(result.statusCode).json(result.body);
    }

    const result = await operation();
    // Trigger adaptive cache invalidation via hooks
    triggerCacheInvalidation(`transaction.${type}.completed`, {
      wallet: normalizedWallet,
      amount: String(amount),
    });
    return res.status(result.statusCode).json(result.body);
  } catch (err) {
    // Audit: the operation failed. Idempotency conflicts are replays of an
    // in-flight/complete request rather than a lifecycle failure, so they are
    // classified with a distinct error code but still recorded.
    const errorCode =
      err instanceof CircuitOpenError
        ? 'SOROBAN_CIRCUIT_OPEN'
        : err instanceof SorobanSimulationError
          ? err.code || 'SOROBAN_SIMULATION_ERROR'
          : err instanceof IdempotencyConflictError
            ? 'IDEMPOTENCY_CONFLICT'
            : 'VAULT_OPERATION_ERROR';
    recordVaultLifecycleEvent({
      operation: type,
      phase: 'failed',
      actor: normalizedWallet,
      amount: String(amount),
      asset: String(asset),
      correlationId,
      traceId: getCurrentTraceId(),
      errorCode,
      errorMessage: err instanceof Error ? err.message : String(err),
    });

    if (err instanceof IdempotencyConflictError) {
      return res.status(409).json({
        error: 'Conflict',
        status: 409,
        message: err.message,
      });
    }

    if (err instanceof CircuitOpenError) {
      const retryAfterSec = Math.ceil(err.retryAfterMs / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(503).json({
        error: 'Service Unavailable',
        status: 503,
        message: 'Soroban RPC is temporarily unavailable. Please retry later.',
        retryAfterMs: err.retryAfterMs,
      });
    }

    if (err instanceof SorobanSimulationError) {
      return res.status(err.statusCode).json({
        error: err.statusCode === 422 ? 'Unprocessable Entity' : 'Bad Gateway',
        status: err.statusCode,
        code: err.code,
        message: err.message,
      });
    }

    logger.log('error', `${type} operation failed`, {
      error: err instanceof Error ? err.message : String(err),
      traceId: getCurrentTraceId(),
    });
    return res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: `Failed to process ${type}`,
    });
  } finally {
    walletLock.release();
  }
}

/**
 * POST /api/v1/vault/deposits
 * Accepts optional Idempotency-Key header for deduplication.
 * Requires wallet address to be on the private beta allowlist (Issue #375).
 */
router.post(
  '/deposits',
  depositsLimiter,
  invalidateReadCaches,
  requireSignedWalletAction('deposit'),
  allowlistMiddleware,
  validate({ body: VaultDepositBodySchema }),
  createTimeoutFor.write(),
  (req: Request, res: Response) => handleVaultOperation(req, res, 'deposit'),
);

/**
 * POST /api/v1/vault/withdrawals
 * Accepts optional Idempotency-Key header for deduplication.
 * Requires wallet address to be on the private beta allowlist (Issue #375).
 */
router.post(
  '/withdrawals',
  depositsLimiter,
  invalidateReadCaches,
  requireSignedWalletAction('withdrawal'),
  allowlistMiddleware,
  validate({ body: VaultWithdrawalBodySchema }),
  withdrawalDailyLimitMiddleware(),
  createTimeoutFor.write(),
  (req: Request, res: Response) => handleVaultOperation(req, res, 'withdrawal'),
);

// ─── Feature-flagged v2 endpoints ────────────────────────────────────────────

/**
 * POST /api/v1/vault/deposits/v2
 * Gated behind the "deposit-v2" feature flag.
 * Supports per-wallet targeting via x-wallet-address header or body.walletAddress.
 */
router.post(
  '/deposits/v2',
  depositsLimiter,
  invalidateReadCaches,
  requireSignedWalletAction('deposit'),
  requireFlag('deposit-v2'),
  validate({ body: VaultDepositBodySchema }),
  (req: Request, res: Response) => handleVaultOperation(req, res, 'deposit'),
);

/**
 * POST /api/v1/vault/strategy
 * Gated behind the "strategy-selection" feature flag.
 */
router.post('/strategy', depositsLimiter, requireFlag('strategy-selection'), (_req: Request, res: Response) => {
  res.status(200).json({ message: 'Strategy selection endpoint (v2 preview)' });
});

export default router;
