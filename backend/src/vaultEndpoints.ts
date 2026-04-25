import { Router, Request, Response } from 'express';
import { emailService } from './emailService';
import { logger } from './middleware/structuredLogging';
import { idempotencyStore, IdempotencyConflictError } from './idempotency';
import crypto from 'crypto';

const router = Router();

/**
 * Helper to generate a fingerprint for the request body.
 */
function generateFingerprint(body: any): string {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

/**
 * POST /api/v1/vault/deposits
 * Submit a deposit request and send confirmation email upon "confirmation".
 * Supports idempotency via x-idempotency-key header.
 */
router.post('/deposits', async (req: Request, res: Response) => {
  const idempotencyKey = req.headers['x-idempotency-key'] as string;
  const { amount, asset, walletAddress, email } = req.body;

  if (!amount || !asset || !walletAddress) {
    return res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'Missing required fields: amount, asset, and walletAddress are required',
    });
  }

  const operation = async () => {
    // 1. Simulate on-chain transaction submission
    const txHash = `0x${crypto.randomBytes(4).toString('hex')}${crypto.randomBytes(4).toString('hex')}`;
    
    const body = {
      id: `tx-${crypto.randomBytes(4).toString('hex')}`,
      type: 'deposit',
      amount,
      asset,
      walletAddress,
      transactionHash: txHash,
      status: 'pending',
      timestamp: new Date().toISOString(),
    };

    // 2. Simulate on-chain confirmation and send email (async)
    // We trigger this after returning the response
    setTimeout(async () => {
      try {
        // Simulate on-chain confirmation delay
        await new Promise(resolve => setTimeout(resolve, 5000));
        logger.log('info', 'Deposit confirmed on-chain', { txHash, walletAddress });

        if (email) {
          await emailService.sendDepositConfirmation(email, {
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
        });
      }
    }, 100);

    return {
      statusCode: 201,
      body,
    };
  };

  try {
    if (idempotencyKey) {
      const fingerprint = generateFingerprint(req.body);
      const { result, replayed } = await idempotencyStore.execute(idempotencyKey, fingerprint, operation);
      
      if (replayed) {
        res.setHeader('idempotency-status', 'replayed');
      }
      
      return res.status(result.statusCode).json(result.body);
    }

    const result = await operation();
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return res.status(409).json({
        error: 'Conflict',
        status: 409,
        message: error.message,
      });
    }
    
    logger.log('error', 'Deposit operation failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    
    return res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: 'Failed to process deposit',
    });
  }
});

/**
 * POST /api/v1/vault/withdrawals
 * Submit a withdrawal request and send confirmation email upon "confirmation".
 */
router.post('/withdrawals', async (req: Request, res: Response) => {
  const idempotencyKey = req.headers['x-idempotency-key'] as string;
  const { amount, asset, walletAddress, email } = req.body;

  if (!amount || !asset || !walletAddress) {
    return res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'Missing required fields: amount, asset, and walletAddress are required',
    });
  }

  const operation = async () => {
    const txHash = `0x${crypto.randomBytes(4).toString('hex')}${crypto.randomBytes(4).toString('hex')}`;
    
    const body = {
      id: `tx-${crypto.randomBytes(4).toString('hex')}`,
      type: 'withdrawal',
      amount,
      asset,
      walletAddress,
      transactionHash: txHash,
      status: 'pending',
      timestamp: new Date().toISOString(),
    };

    setTimeout(async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 5000));
        logger.log('info', 'Withdrawal confirmed on-chain', { txHash, walletAddress });

        if (email) {
          await emailService.sendWithdrawalConfirmation(email, {
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
        });
      }
    }, 100);

    return {
      statusCode: 201,
      body,
    };
  };

  try {
    if (idempotencyKey) {
      const fingerprint = generateFingerprint(req.body);
      const { result, replayed } = await idempotencyStore.execute(idempotencyKey, fingerprint, operation);
      
      if (replayed) {
        res.setHeader('idempotency-status', 'replayed');
      }
      
      return res.status(result.statusCode).json(result.body);
    }

    const result = await operation();
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return res.status(409).json({
        error: 'Conflict',
        status: 409,
        message: error.message,
      });
    }
    
    return res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: 'Failed to process withdrawal',
    });
  }
});

export default router;
