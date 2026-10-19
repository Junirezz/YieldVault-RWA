/**
 * Admin export job, bulk export and report export endpoints.
 *
 * Extracted from src/index.ts (issue #1545); mounted by the composition root
 * in the same position the routes were registered, so behaviour is unchanged.
 */
import { Router, Request, Response } from 'express';
import { BulkExportBodySchema, ChecksumVerifyBodySchema, IdParamSchema, ReportExportBodySchema, validate } from '../middleware/validate';
import { DateRangeParseError, parseUtcDateRange } from '../dateRange';
import { cancelBulkExportJob, createBulkExportJob, getBulkExportArtifact, getBulkExportJob, listBulkExportJobs, processBulkExportJob } from '../bulkExportJobs';
import { createExportManifest, getExportManifestById, listExportManifests, verifyExportManifestChecksum } from '../exportManifest';
import { getExportJobById, listExportJobs, resolveExportGeneratedBy } from '../exportJobs';
import { paginateByLimit, parseLimited, resolveActingAdminAddress, sendStandardListEnvelope } from './shared';
import { validateApiKey } from '../middleware/apiKeyAuth';

const router = Router();

/**
 * GET /admin/exports/jobs - list persisted transaction export metadata
 */
router.get('/admin/exports/jobs', validateApiKey, async (req: Request, res: Response) => {
  const rawFormat = typeof req.query.format === 'string' ? req.query.format : undefined;
  const format = rawFormat === 'csv' || rawFormat === 'json' ? rawFormat : undefined;
  if (rawFormat && !format) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'format must be either csv or json',
    });
    return;
  }

  try {
    const range = parseUtcDateRange({
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined,
    });
    const limit = parseLimited(req.query.limit, 50, 1, 200);
    const jobs = await listExportJobs({
      format,
      generatedBy: typeof req.query.generatedBy === 'string' ? req.query.generatedBy : undefined,
      walletAddress: typeof req.query.walletAddress === 'string' ? req.query.walletAddress : undefined,
      checksum: typeof req.query.checksum === 'string' ? req.query.checksum : undefined,
      start: range.start,
      end: range.end,
      limit: limit + 1,
    });
    const { data, hasNextPage } = paginateByLimit(jobs, limit);

    sendStandardListEnvelope(res, {
      data,
      limit,
      hasNextPage,
      extras: {
        jobs: data,
        meta: {
          count: data.length,
          limit,
          filters: {
            format: format || null,
            generatedBy: typeof req.query.generatedBy === 'string' ? req.query.generatedBy : null,
            walletAddress: typeof req.query.walletAddress === 'string' ? req.query.walletAddress : null,
            checksum: typeof req.query.checksum === 'string' ? req.query.checksum : null,
            from: range.start || null,
            to: range.end || null,
          },
          timestamp: new Date().toISOString(),
        },
      },
    });
  } catch (error) {
    if (error instanceof DateRangeParseError) {
      res.status(error.status).json({
        error: 'Bad Request',
        status: error.status,
        message: error.message,
      });
      return;
    }

    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: error instanceof Error ? error.message : 'Failed to query export jobs',
    });
  }
});

/**
 * POST /admin/exports/jobs/:id/verify - verify a previously generated export checksum
 * Body: { checksum: string }
 */
router.post('/admin/exports/jobs/:id/verify', validateApiKey, validate({ params: IdParamSchema, body: ChecksumVerifyBodySchema }), async (req: Request, res: Response) => {
  const checksum =
    typeof req.body?.checksum === 'string'
      ? req.body.checksum.trim().toLowerCase()
      : typeof req.query.checksum === 'string'
        ? req.query.checksum.trim().toLowerCase()
        : '';

  if (!checksum) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'checksum is required',
    });
    return;
  }

  try {
    const job = await getExportJobById(String(req.params.id));
    if (!job) {
      res.status(404).json({
        error: 'Not Found',
        status: 404,
        message: 'Export job not found',
      });
      return;
    }

    res.status(200).json({
      exportJobId: job.id,
      valid: job.checksum.toLowerCase() === checksum,
      expectedChecksum: job.checksum,
      providedChecksum: checksum,
      checksumAlgorithm: job.checksumAlgorithm,
      generatedBy: job.generatedBy,
      createdAt: job.createdAt,
      fileName: job.fileName,
      format: job.format,
      rowCount: job.rowCount,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: error instanceof Error ? error.message : 'Failed to verify export checksum',
    });
  }
});

/**
 * POST /admin/exports/bulk - create a new bulk export job
 * Body: { format: "csv"|"json", filters: { ... } }
 */
router.post('/admin/exports/bulk', validateApiKey, validate({ body: BulkExportBodySchema }), async (req: Request, res: Response) => {
  try {
    const { format, filters } = req.body;
    if (format !== 'csv' && format !== 'json') {
      res.status(400).json({
        error: 'Bad Request',
        status: 400,
        message: 'format must be either csv or json',
      });
      return;
    }

    const generatedBy = resolveExportGeneratedBy(req);
    const job = await createBulkExportJob({
      format,
      generatedBy,
      filters: filters || {},
    });

    void processBulkExportJob(job.id).catch(() => {});

    res.status(201).json({
      message: 'Bulk export job created',
      job,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: error instanceof Error ? error.message : 'Failed to create bulk export job',
    });
  }
});

/**
 * GET /admin/exports/bulk/jobs - list bulk export jobs
 */
router.get('/admin/exports/bulk/jobs', validateApiKey, async (req: Request, res: Response) => {
  const limit = parseLimited(req.query.limit, 50, 1, 200);
  const jobs = await listBulkExportJobs(limit + 1);
  const { data, hasNextPage } = paginateByLimit(jobs, limit);
  sendStandardListEnvelope(res, {
    data,
    limit,
    hasNextPage,
    extras: {
      jobs: data,
      meta: {
        count: data.length,
        limit,
        timestamp: new Date().toISOString(),
      },
    },
  });
});

/**
 * GET /admin/exports/bulk/jobs/:id - get bulk export job status
 */
router.get('/admin/exports/bulk/jobs/:id', validateApiKey, async (req: Request, res: Response) => {
  const job = await getBulkExportJob(String(req.params.id));
  if (!job) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'Bulk export job not found',
    });
    return;
  }
  res.status(200).json({ job });
});

/**
 * POST /admin/exports/bulk/jobs/:id/cancel - cancel a pending/processing bulk export job
 */
router.post('/admin/exports/bulk/jobs/:id/cancel', validateApiKey, async (req: Request, res: Response) => {
  const cancelled = await cancelBulkExportJob(String(req.params.id));
  if (!cancelled) {
    const job = await getBulkExportJob(String(req.params.id));
    if (!job) {
      res.status(404).json({
        error: 'Not Found',
        status: 404,
        message: 'Bulk export job not found',
      });
      return;
    }
    res.status(409).json({
      error: 'Conflict',
      status: 409,
      message: `Bulk export job is already ${job.status} and cannot be cancelled`,
    });
    return;
  }
  res.status(200).json({
    message: 'Bulk export job cancelled',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/exports/bulk/artifacts/:artifactId - download a completed bulk export artifact
 */
router.get('/admin/exports/bulk/artifacts/:artifactId', validateApiKey, (req: Request, res: Response) => {
  const artifact = getBulkExportArtifact(String(req.params.artifactId));
  if (!artifact) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'Bulk export artifact not found or expired',
    });
    return;
  }
  res.setHeader('Content-Type', artifact.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="bulk-export-${artifact.id}.${artifact.contentType === 'text/csv' ? 'csv' : 'json'}"`);
  res.setHeader('X-Artifact-Checksum', artifact.checksum);
  res.setHeader('X-Artifact-Checksum-Algorithm', artifact.checksumAlgorithm);
  res.setHeader('X-Artifact-Row-Count', String(artifact.rowCount));
  res.status(200).send(artifact.body);
});

/**
 * POST /admin/reports/exports - generate a report export and immutable manifest record
 */
router.post('/admin/reports/exports', validateApiKey, validate({ body: ReportExportBodySchema }), async (req: Request, res: Response) => {
  const reportType = String(req.body?.reportType || 'transactions').trim();
  const requester = resolveActingAdminAddress(req);
  const filters =
    req.body?.filters && typeof req.body.filters === 'object'
      ? (req.body.filters as Record<string, unknown>)
      : {};

  const mockRows = [
    {
      reportType,
      generatedAt: new Date().toISOString(),
      filters,
    },
  ];

  const manifest = await createExportManifest({
    requester,
    reportType,
    filters,
    rows: mockRows,
  });

  res.status(201).json({
    message: 'Export generated and manifest recorded',
    manifest,
  });
});

/**
 * GET /admin/reports/exports/manifests - list immutable export manifests
 */
router.get('/admin/reports/exports/manifests', validateApiKey, async (req: Request, res: Response) => {
  const limit = parseInt(String(req.query.limit || '50'), 10);
  const offset = parseInt(String(req.query.offset || '0'), 10);
  const result = await listExportManifests(limit, offset);
  res.status(200).json({
    data: result.data,
    total: result.total,
    limit,
    offset,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/reports/exports/manifests/:id - fetch a manifest by id
 */
router.get('/admin/reports/exports/manifests/:id', validateApiKey, async (req: Request, res: Response) => {
  const manifest = await getExportManifestById(String(req.params.id));
  if (!manifest) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'Export manifest not found',
    });
    return;
  }

  res.status(200).json({
    manifest,
  });
});

/**
 * POST /admin/reports/exports/manifests/:id/verify - verify manifest checksum
 */
router.post('/admin/reports/exports/manifests/:id/verify', validateApiKey, validate({ params: IdParamSchema, body: ChecksumVerifyBodySchema }), async (req: Request, res: Response) => {
  const checksum = String(req.body?.checksum || '').trim();
  if (!checksum) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'checksum is required',
    });
    return;
  }

  const result = await verifyExportManifestChecksum(String(req.params.id), checksum);
  if (!result.manifest) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'Export manifest not found',
    });
    return;
  }

  res.status(200).json({
    match: result.match,
    manifest: result.manifest,
    timestamp: new Date().toISOString(),
  });
});

export default router;
