/**
 * Transaction export and admin transaction backfill endpoints.
 *
 * Extracted from src/index.ts (issue #1545); mounted by the composition root
 * in the same position the routes were registered, so behaviour is unchanged.
 */
import { Router, Request, Response } from 'express';
import { TransactionBackfillBodySchema, validate } from '../middleware/validate';
import { authenticateApiKeyValue, validateApiKey } from '../middleware/apiKeyAuth';
import { buildExportMetadataHeaderValue, recordExportJob, resolveExportGeneratedBy } from '../exportJobs';
import { buildTransactionExportArtifact } from '../listEndpoints';
import { createOrResumeTransactionBackfill, getTransactionBackfillJob, listTransactionBackfillJobs } from '../transactionBackfill';
import { logger } from '../middleware/structuredLogging';
import { normalizeWalletAddress } from '../walletUtils';
import { verifyJwt } from '../auth';

function resolveTransactionExportAccess(req: Request):
  | { kind: 'admin'; walletAddress?: string }
  | { kind: 'user'; walletAddress: string }
  | null {
  const authHeader = req.get('authorization') || '';
  const walletAddress =
    typeof req.query.walletAddress === 'string' ? normalizeWalletAddress(req.query.walletAddress) : undefined;

  const apiKeyMatch = authHeader.match(/^ApiKey\s+(.+)$/i);
  if (apiKeyMatch) {
    const authenticated = authenticateApiKeyValue(apiKeyMatch[1]);
    if (!authenticated) {
      return null;
    }
    req.authApiKeyHash = authenticated.hash;
    req.authApiKeyRole = authenticated.role;
    return {
      kind: 'admin',
      walletAddress: walletAddress || undefined,
    };
  }

  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!bearerMatch) {
    return null;
  }

  const payload = verifyJwt(bearerMatch[1]);
  const userWallet = normalizeWalletAddress(payload.sub);
  if (walletAddress && walletAddress !== userWallet) {
    throw new Error('FORBIDDEN_WALLET_EXPORT');
  }

  return {
    kind: 'user',
    walletAddress: userWallet,
  };
}

function buildTransactionExportFilename(format: 'csv' | 'json'): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `transaction-history-${timestamp}.${format}`;
}

async function handleTransactionExport(req: Request, res: Response): Promise<void> {
  const format = req.query.format === 'csv' ? 'csv' : req.query.format === 'json' ? 'json' : null;
  if (!format) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'format query parameter must be either csv or json',
    });
    return;
  }

  let access;
  try {
    access = resolveTransactionExportAccess(req);
  } catch (error) {
    if (error instanceof Error && error.message === 'FORBIDDEN_WALLET_EXPORT') {
      res.status(403).json({
        error: 'Forbidden',
        status: 403,
        message: 'Users may only export their own wallet transactions',
      });
      return;
    }

    res.status(401).json({
      error: 'Unauthorized',
      status: 401,
      message: error instanceof Error ? error.message : 'Invalid authorization header',
    });
    return;
  }

  if (!access) {
    res.status(401).json({
      error: 'Unauthorized',
      status: 401,
      message: 'Authorization header must contain a Bearer token or ApiKey',
    });
    return;
  }

  const exportQuery = {
    type: typeof req.query.type === 'string' ? req.query.type : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    sortBy: typeof req.query.sortBy === 'string' ? req.query.sortBy : undefined,
    sortOrder: (
      req.query.sortOrder === 'asc' || req.query.sortOrder === 'desc'
        ? req.query.sortOrder
        : undefined
    ) as 'asc' | 'desc' | undefined,
    walletAddress: access.walletAddress,
    startDate: typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
    endDate: typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
  };

  try {
    const artifact = buildTransactionExportArtifact(format, exportQuery);
    const fileName = buildTransactionExportFilename(format);
    const job = await recordExportJob({
      format,
      fileName,
      contentType: artifact.contentType,
      checksum: artifact.checksum,
      checksumAlgorithm: artifact.checksumAlgorithm,
      generatedBy: resolveExportGeneratedBy(req),
      walletAddress: access.walletAddress,
      rowCount: artifact.rowCount,
      filters: {
        type: exportQuery.type || null,
        status: exportQuery.status || null,
        sortBy: exportQuery.sortBy || null,
        sortOrder: exportQuery.sortOrder || null,
        startDate: exportQuery.startDate || null,
        endDate: exportQuery.endDate || null,
        walletAddress: exportQuery.walletAddress || null,
      },
    });

    res.setHeader('Content-Type', artifact.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('X-Export-Job-Id', job.id);
    res.setHeader('X-Export-Checksum', artifact.checksum);
    res.setHeader('X-Export-Checksum-Algorithm', artifact.checksumAlgorithm);
    res.setHeader('X-Export-Metadata', buildExportMetadataHeaderValue(job));
    res.status(200).send(artifact.body);
  } catch (error) {
    logger.log('error', 'Transaction export failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: 'Failed to generate transaction export',
    });
  }
}

const router = Router();

router.get('/api/vault/transactions/export', (_req: Request, res: Response) => {
  res.redirect(301, '/api/v1/vault/transactions/export');
});

// â”€â”€â”€ Versioned export & summary endpoints â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/api/v1/vault/transactions/export', handleTransactionExport);

/**
 * POST /admin/transactions/backfill - controlled backfill of missing ledger index ranges
 */
router.post('/admin/transactions/backfill', validateApiKey, validate({ body: TransactionBackfillBodySchema }), async (req: Request, res: Response) => {
  const startLedger = Number(req.body?.startLedger);
  const endLedger = Number(req.body?.endLedger);
  const batchSize = req.body?.batchSize === undefined ? undefined : Number(req.body.batchSize);
  const dryRun = Boolean(req.body?.dryRun);
  const rpcUrl = String(req.body?.rpcUrl || process.env.STELLAR_RPC_URL || '').trim();
  const contractId = String(req.body?.contractId || process.env.VAULT_CONTRACT_ID || '').trim();

  if (!Number.isInteger(startLedger) || !Number.isInteger(endLedger)) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'startLedger and endLedger must be integers',
    });
    return;
  }

  if (!rpcUrl) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'rpcUrl is required (or set STELLAR_RPC_URL)',
    });
    return;
  }

  if (!contractId) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'contractId is required (or set VAULT_CONTRACT_ID)',
    });
    return;
  }

  try {
    const job = await createOrResumeTransactionBackfill({
      startLedger,
      endLedger,
      batchSize,
      dryRun,
      rpcUrl,
      contractId,
    });

    res.status(202).json({
      message: 'Backfill accepted',
      job,
    });
  } catch (error) {
    res.status(422).json({
      error: 'Unprocessable Entity',
      status: 422,
      message: error instanceof Error ? error.message : 'Backfill request failed',
    });
  }
});

/**
 * GET /admin/transactions/backfill - list recent backfill jobs
 */
router.get('/admin/transactions/backfill', validateApiKey, async (req: Request, res: Response) => {
  const limit = parseInt(String(req.query.limit || '20'), 10);
  const data = await listTransactionBackfillJobs(limit);
  res.status(200).json({
    data,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/transactions/backfill/:jobId - fetch a specific backfill job
 */
router.get('/admin/transactions/backfill/:jobId', validateApiKey, async (req: Request, res: Response) => {
  const job = await getTransactionBackfillJob(String(req.params.jobId));
  if (!job) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'Backfill job not found',
    });
    return;
  }

  res.status(200).json({
    job,
  });
});

export default router;
