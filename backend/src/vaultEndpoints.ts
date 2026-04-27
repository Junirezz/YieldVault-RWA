import { Router, Request, Response } from 'express';
import { emailService } from './emailService';
import { logger } from './middleware/structuredLogging';
import { idempotencyStore, IdempotencyConflictError } from './idempotency';
import { sorobanCircuitBreaker, CircuitOpenError } from './circuitBreaker';
import { withSpan, getCurrentTraceId } from './tracing';
import { requireFlag } from './featureFlags';
import { allowlistMiddleware } from './middleware/allowlist';
import crypto from 'crypto';

const router = Router();

function generateFingerprint(body: any): string {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

/**
 * Simulates a Soroban RPC call wrapped in the circuit breaker and a trace span.
 * Replace the body with the real stellar-sdk / soroban-client call.
 */
async function submitSorobanTx(type: string, payload: Record<string, unknown>): Promise<string> {
  return sorobanCircuitBreaker.execute(() =>
    withSpan('soroban.rpc.submit', async (span) => {
      span.setAttributes({ 'rpc.type': type, 'rpc.wallet': String(payload.walletAddress ?? '') });
      // Simulate network call – replace with real Soroban RPC invocation
      await new Promise((resolve) => setTimeout(resolve, 10));
      return `0x${crypto.randomBytes(4).toString('hex')}${crypto.randomBytes(4).toString('hex')}`;
    }),
  );
}

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

  const { amount, asset, walletAddress, email } = req.body;

  if (!amount || !asset || !walletAddress) {
    return res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'Missing required fields: amount, asset, and walletAddress are required',
    });
  }

  const operation = async () => {
    return withSpan(`vault.${type}`, async (span) => {
      span.setAttributes({
        'vault.amount': String(amount),
        'vault.asset': String(asset),
        'vault.wallet': String(walletAddress),
      });

      let txHash: string;
      try {
        txHash = await submitSorobanTx(type, { amount, asset, walletAddress });
      } catch (err) {
        if (err instanceof CircuitOpenError) {
          // Bubble up so the route handler can return 503
          throw err;
        }
        throw err;
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
      return res.status(result.statusCode).json(result.body);
    }

    const result = await operation();
    return res.status(result.statusCode).json(result.body);
  } catch (err) {
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

    logger.log('error', `${type} operation failed`, {
      error: err instanceof Error ? err.message : String(err),
      traceId: getCurrentTraceId(),
    });
    return res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: `Failed to process ${type}`,
    });
  }
}

/**
 * POST /api/v1/vault/deposits
 * Accepts optional Idempotency-Key header for deduplication.
 * Requires wallet address to be on the private beta allowlist (Issue #375).
 */
router.post('/deposits', allowlistMiddleware, (req: Request, res: Response) =>
  handleVaultOperation(req, res, 'deposit'),
);

/**
 * POST /api/v1/vault/withdrawals
 * Accepts optional Idempotency-Key header for deduplication.
 * Requires wallet address to be on the private beta allowlist (Issue #375).
 */
router.post('/withdrawals', allowlistMiddleware, (req: Request, res: Response) =>
  handleVaultOperation(req, res, 'withdrawal'),
);

// ─── Feature-flagged v2 endpoints ────────────────────────────────────────────

/**
 * POST /api/v1/vault/deposits/v2
 * Gated behind the "deposit-v2" feature flag.
 * Supports per-wallet targeting via x-wallet-address header or body.walletAddress.
 */
router.post('/deposits/v2', requireFlag('deposit-v2'), (req: Request, res: Response) =>
  handleVaultOperation(req, res, 'deposit'),
);

/**
 * POST /api/v1/vault/strategy
 * Gated behind the "strategy-selection" feature flag.
 */
router.post('/strategy', requireFlag('strategy-selection'), (_req: Request, res: Response) => {
  res.status(200).json({ message: 'Strategy selection endpoint (v2 preview)' });
});

export default router;
