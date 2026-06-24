// Load environment variables FIRST before any other imports
// This ensures OTEL_ENABLED is set before tracing initialization
import dotenv from 'dotenv';
dotenv.config();

// Tracing must be initialised before any other imports so auto-instrumentation
// can patch http/express/prisma before they are first required.
import { initTracing, shutdownTracing, getCurrentTraceId } from './tracing';
initTracing();

import express, { Express, Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import NodeCache from 'node-cache';
import { loginHandler, nonceHandler, refreshHandler, requireAuth, verifyJwt } from './auth';
import {
  authLimiter,
  writesLimiter,
  readsLimiter,
  adminLimiter,
} from './rateLimiter';
import { idempotencyStore } from './idempotency';
import { createAdminAuditMiddleware, getAuditLogs, getAuditLogMetrics } from './auditLog';
import { recordAdminAuditLog } from './adminAudit';
import {
  recordAdminConfigChange, listAdminConfigChanges, getActorFromRequest
} from './adminConfigChangeAudit';
import { featureFlags } from './featureFlags';
import {
  startImpersonationSession,
  endImpersonationSession,
  validateImpersonationSession,
  listImpersonationSessions,
  resolveImpersonationSessionContext,
  type ImpersonationSessionRecord,
} from './impersonationSessionService';
import { generateAdminReceipt, getAdminReceipt, listAdminReceipts, verifyReceiptSignature } from './adminReceipt';
import { startApySnapshotScheduler } from './apySnapshot';
import { startDbBackupScheduler } from './dbBackupJob';
import { sorobanCircuitBreaker } from './circuitBreaker';
import { correlationIdMiddleware, CorrelationIdRequest } from './middleware/correlationId';
import { structuredLoggingMiddleware, logger, LogLevel } from './middleware/structuredLogging';
import { corsMiddleware } from './middleware/cors';
import { geofencingMiddleware } from './middleware/geofencing';
import { cacheMiddleware, invalidateCache, getCacheStats } from './middleware/cache';
import { validate, LoginSchema, NonceRequestSchema, RefreshSchema } from './middleware/validate';
import { tieredJsonBodyParser } from './middleware/payloadLimit';
import { requireSignedWalletAction } from './middleware/walletSignedAction';
import { timeoutMiddleware, createTimeoutFor } from './middleware/timeoutMiddleware';
import {
  setWithdrawalLimitOverride,
  listWithdrawalLimitAuditEntries,
} from './middleware/withdrawalDailyLimit';
import {
  validateApiKey,
  authenticateApiKeyValue,
  registerApiKey,
  rotateApiKey,
  revokeApiKey,
  getApiKeyMetadata,
  restoreApiKey,
  hasRequiredApiKeyRole,
  normalizeApiKeyRole,
} from './middleware/apiKeyAuth';
import {
  API_KEY_AUDIT_ACTIONS,
  isApiKeyHash,
  getApiKeyFingerprintFromHash,
  getApiKeyFingerprintFromValue,
  resolveApiKeyAuditActor,
  recordApiKeyAuditEvent,
  listApiKeyAuditEvents,
} from './apiKeyAudit';
import {
  addAddress,
  removeAddress,
  listAddresses,
  allowlistSize,
} from './middleware/allowlist';
import { adminRbacMiddleware, assertWebhookParameterUpdate } from './middleware/rbac';
import { GracefulShutdownHandler } from './gracefulShutdown';
import { db } from './database';
import vaultRouter from './vaultEndpoints';
import transactionRouter from './transactionEndpoints';
import {
  buildPortfolioHoldingsResponse,
  buildTransactionExportArtifact,
  buildTransactionsResponse,
  buildVaultHistoryResponse,
} from './listEndpoints';
import { createPaginatedResponse, createPaginationEnvelope, encodeCursor } from './pagination';
import listRouter from './listEndpoints';
import referralRouter from './referralEndpoints';
import { referralService } from './referralService';
import {
  register,
  httpRequestCount,
  httpResponseTime,
  activeConnections,
  updateVaultMetrics,
} from './metrics';
import { latencyMonitoringService } from './latencyMonitoring';
import { startEventPollingService, stopEventPollingService } from './eventPollingService';
import { prisma, getPrismaRuntimeConfig } from './prisma';
import {
  verifyWebhookEndpoint,
  registerWebhookEndpoint,
  updateWebhookEndpoint,
  deleteWebhookEndpoint,
  restoreWebhookEndpoint,
  listWebhookEndpoints,
  listWebhookDeliveryPage,
  getWebhookDeliveryMetrics,
  createWebhookSignature,
  verifyWebhookSignature,
  listWebhookDeadLetters,
  retryWebhookDeadLetter,
} from './webhookDelivery';
import {
  maintenanceModeMiddleware,
  getMaintenanceModeState,
  updateMaintenanceModeState,
  logMaintenanceTransition,
} from './maintenanceMode';
import {
  buildMaintenanceStatusPayload,
  cancelMaintenanceWindow,
  listMaintenanceWindows,
  scheduleMaintenanceWindow,
  startMaintenanceWindowScheduler,
} from './maintenanceWindow';
import {
  buildExportMetadataHeaderValue,
  getExportJobById,
  listExportJobs,
  recordExportJob,
  resolveExportGeneratedBy,
} from './exportJobs';
import { parseUtcDateRange, DateRangeParseError } from './dateRange';
import { backfillApySnapshots } from './apySnapshot';
import { getJobMetrics, getJobHealthStatus } from './jobGovernance';
import {
  createBulkExportJob,
  getBulkExportJob,
  listBulkExportJobs,
  cancelBulkExportJob,
  processBulkExportJob,
  getBulkExportArtifact,
} from './bulkExportJobs';
import { normalizeWalletAddress } from './walletUtils';
import { emailQueueService } from './emailQueue';

declare global {
  namespace Express {
    interface Request {
      rateLimit?: {
        resetTime?: number;
        current?: number;
        limit?: number;
      };
    }
  }
}

const app: Express = express();
const port = process.env.PORT || 3000;
const nodeEnv = process.env.NODE_ENV || 'development';
const logLevel = (process.env.LOG_LEVEL || (nodeEnv === 'development' ? 'debug' : 'info')) as LogLevel;
const drainTimeout = parseInt(process.env.DRAIN_TIMEOUT_MS || '30000', 10);
const cacheVaultMetricsTtl = parseInt(process.env.CACHE_TTL_MS || process.env.CACHE_VAULT_METRICS_TTL_MS || '60000', 10);

// Configure logger
logger.configure(logLevel);

// Health check cache to track dependency status
const cache = new NodeCache({ stdTTL: 30 });

function buildVaultSummaryResponse() {
  return {
    totalAssets: 0,
    totalShares: 0,
    apy: 0,
    timestamp: new Date().toISOString(),
  };
}

function resolveActingAdminAddress(req: Request): string {
  const address =
    req.get('x-admin-address') ||
    req.get('x-admin-id') ||
    req.get('x-wallet-address') ||
    'unknown';
  return address === 'unknown' ? address : normalizeWalletAddress(address);
}

function parseLimited(v: unknown, fallback: number, min: number, max: number): number {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isNaN(n) ? fallback : Math.min(Math.max(n, min), max);
}

function isDryRunRequest(req: Request): boolean {
  const value = req.body?.dryRun ?? req.query.dryRun;
  return value === true || value === 'true' || value === '1';
}

function countInclusiveDays(start: string, end: string): number {
  const startMs = Date.parse(start + 'T00:00:00.000Z');
  const endMs = Date.parse(end + 'T00:00:00.000Z');
  return Math.floor((endMs - startMs) / 86400000) + 1;
}

function paginateByLimit<T>(rows: T[], limit: number): { data: T[]; hasNextPage: boolean } {
  const hasNextPage = rows.length > limit;
  return {
    data: hasNextPage ? rows.slice(0, limit) : rows,
    hasNextPage,
  };
}

function sendStandardListEnvelope<T>(
  res: Response,
  input: {
    data: T[];
    limit: number;
    hasNextPage?: boolean;
    hasPrevPage?: boolean;
    nextCursor?: string;
    total?: number;
    statusCode?: number;
    extras?: Record<string, unknown>;
  },
): void {
  const payload = createPaginatedResponse(input.data, {
    count: input.data.length,
    total: input.total ?? input.data.length,
    nextCursor: input.nextCursor ?? null,
    prevCursor: null,
    currentPage: null,
    totalPages: null,
    hasNextPage: input.hasNextPage ?? false,
    hasPrevPage: input.hasPrevPage ?? false,
    limit: input.limit,
  });

  res.status(input.statusCode ?? 200).json({
    ...payload,
    ...(input.extras || {}),
  });
}

async function buildReferralStatsSnapshot(wallet: string) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  const stats = await referralService.getReferralStats(normalizedWallet);
  if (!stats) {
    return {
      statusCode: 404,
      body: {
        error: 'Not Found',
        status: 404,
        message: 'No referral activity found for this wallet',
      },
    };
  }

  return {
    statusCode: 200,
    body: stats,
  };
}

async function buildWalletTransactionsSnapshot(wallet: string) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  const prisma = getPrismaClient();
  const limit = 20;
  const where = { user: normalizedWallet };
  const [total, transactions] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit + 1,
    }),
  ]);
  const hasNextPage = transactions.length > limit;
  const data = hasNextPage ? transactions.slice(0, limit) : transactions;

  return createPaginatedResponse(
    data,
    createPaginationEnvelope({
      count: data.length,
      limit,
      total,
      hasNextPage,
      hasPrevPage: false,
      nextCursor: hasNextPage && data.length > 0 ? encodeCursor(data[data.length - 1].id) : null,
    }),
  );
}

async function buildImpersonatedVaultState(wallet: string) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  return {
    walletAddress: normalizedWallet,
    summary: buildVaultSummaryResponse(),
    transactions: await buildWalletTransactionsSnapshot(normalizedWallet),
    portfolioHoldings: buildPortfolioHoldingsResponse({ walletAddress: normalizedWallet }),
    vaultHistory: buildVaultHistoryResponse({}),
    referralStats: await buildReferralStatsSnapshot(normalizedWallet),
    referralCode: {
      statusCode: 200,
      body: { code: await referralService.getOrCreateReferralCode(normalizedWallet) },
    },
  };
}

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

// ─── Rate Limiting Middleware ────────────────────────────────────────────────
// Issue #455: Use the Redis-backed limiter factory from rateLimiter.ts.
//
// Three pre-built instances are imported from rateLimiter.ts:
//   depositsLimiter – stricter limits for write-heavy deposit/withdrawal routes
//   summaryLimiter  – relaxed limits for read-only summary/metrics routes
//   defaultLimiter  – fallback for all other API routes
//
// All instances use fail-open behaviour: when Redis is configured but
// unreachable the `skip` function returns true so requests are processed
// normally. When Redis is not configured an in-memory store is used.
//
// Rate-limit policy information (RateLimit-* headers) and Retry-After are
// included in all 429 responses by the handlers in rateLimiter.ts.

// ─── Middleware ──────────────────────────────────────────────────────────────

app.use(tieredJsonBodyParser());

// CORS configuration (restricted origins)
app.use(corsMiddleware);

// Correlation ID must be first to inject on all requests
app.use(correlationIdMiddleware);

// Structured logging with correlation IDs
app.use(structuredLoggingMiddleware);

// Global timeout middleware (30 seconds default)
app.use(timeoutMiddleware());

// Metrics middleware to track HTTP requests
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime();
  activeConnections.inc();

  res.on('finish', () => {
    activeConnections.dec();
    const duration = process.hrtime(start);
    const durationSeconds = duration[0] + duration[1] / 1e9;
    const durationMs = durationSeconds * 1000; // Convert to milliseconds for SLO monitoring

    // Use the path pattern (e.g., /api/vault/:id) instead of the actual path if available
    const route = req.route ? req.route.path : req.path;
    const labels = {
      method: req.method,
      route,
      status_code: res.statusCode,
    };

    httpRequestCount.inc(labels);
    httpResponseTime.observe(labels, durationSeconds);

    // Record latency for SLO monitoring (only track successful requests)
    if (res.statusCode < 400) {
      latencyMonitoringService.recordLatency(route, durationMs);
    }
  });

  next();
});

// Apply the Redis-backed default limiter (reads tier) globally (skip health/ready probes).
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === '/health' || req.path === '/ready') return next();
  return readsLimiter(req, res, next);
});

// Capture immutable admin audit records for every /admin request.
// Apply admin-tier rate limiting to all /admin endpoints.
app.use('/admin', adminLimiter, createAdminAuditMiddleware());
// ─── Geofencing (Issue #379) ─────────────────────────────────────────────────
// Applied after rate-limiting so bots from blocked countries are still rate-limited.
app.use(geofencingMiddleware);

// ─── Maintenance Mode Gate (Issue #481) ──────────────────────────────────────
// Blocks mutating routes (POST/PUT/PATCH/DELETE) when maintenance mode is active.
// Health, ready, metrics, and /admin/maintenance routes are always bypassed.
app.use(maintenanceModeMiddleware);

// ─── Health Check Endpoints (Issue #148) ────────────────────────────────────

/**
 * GET /metrics
 * Exposes Prometheus metrics for operational monitoring
 */
app.get('/metrics', async (_req: Request, res: Response) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(err);
  }
});

/**
 * GET /admin/latency-status
 * Returns latency monitoring status and metrics (admin endpoint)
 * Requires API key authentication
 */
app.get('/admin/latency-status', validateApiKey, (_req: Request, res: Response) => {
  const status = latencyMonitoringService.getStatus();
  const detailedMetrics = latencyMonitoringService.getDetailedMetrics();
  
  res.json({
    status,
    metrics: detailedMetrics,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /health
 * Returns immediately with service health status
 * Includes critical dependencies health (Stellar RPC, database, cache)
 * 
 * Response: 200 OK or 503 Service Unavailable
 */
app.get('/health', async (_req: Request, res: Response) => {
  const dbHealth = await getDatabaseHealth();
  const prismaHealth = await getPrismaHealth();
  const circuitSnapshot = sorobanCircuitBreaker.toHealthSnapshot();
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: nodeEnv,
    checks: {
      api: 'up',
      cache: getCacheHealth(),
      stellarRpc: getStellarRpcHealth(),
      databasePrimary: dbHealth.primary,
      databaseReplica: dbHealth.replica,
      prisma: prismaHealth,
      jobs: getJobHealthStatus(),
    },
    sorobanCircuitBreaker: circuitSnapshot,
  };

  // Check if all dependencies are healthy
  const allHealthy = Object.values(health.checks).every((check) => check === 'up');

  res.status(allHealthy ? 200 : 503).json(health);
});

/**
 * GET /ready
 * Returns readiness status - should only return 200 if service is ready for traffic
 * Checks all critical dependencies before reporting readiness
 * 
 * Response: 200 OK if ready, 503 Service Unavailable if not ready
 */
app.get('/ready', async (_req: Request, res: Response) => {
  const dbHealth = await getDatabaseHealth();
  const prismaHealth = await getPrismaHealth();
  const readiness = {
    ready: true,
    timestamp: new Date().toISOString(),
    dependencies: {
      cache: checkCacheDependency(),
      stellarRpc: checkStellarRpcDependency(),
      database: dbHealth.primary === 'up',
      prisma: prismaHealth === 'up',
    },
  };

  // Service is ready only if all critical dependencies are available
  const isReady =
    readiness.dependencies.cache &&
    readiness.dependencies.stellarRpc &&
    readiness.dependencies.database &&
    readiness.dependencies.prisma;

  readiness.ready = isReady;

  res.status(isReady ? 200 : 503).json(readiness);
});

/**
 * GET /maintenance/status
 * Public read-only maintenance window visibility (Issue #714).
 */
app.get('/maintenance/status', (_req: Request, res: Response) => {
  res.status(200).json(buildMaintenanceStatusPayload());
});

// ─── Versioned API v1 Router ──────────────────────────────────────────────
const apiV1 = express.Router();
app.use('/api/v1', apiV1);

// Mount routers under /api/v1
apiV1.use('/vault', vaultRouter);
apiV1.use('/referrals', referralRouter);
apiV1.use('/transactions', transactionRouter);
apiV1.use('/', listRouter);

// Backward compatibility for legacy unversioned list routes (/api/*)
app.use('/api', listRouter);

// ─── Auth Routes (Issue #377) ────────────────────────────────────────────────
// Canonical versioned auth endpoints

/**
 * POST /api/v1/auth/login
 * Issue 15-min access JWT + 7-day refresh token on wallet authentication.
 */
apiV1.post('/auth/nonce', authLimiter, validate({ body: NonceRequestSchema }), nonceHandler);
apiV1.post('/auth/login', authLimiter, validate({ body: LoginSchema }), requireSignedWalletAction('login'), loginHandler);

/**
 * POST /api/v1/auth/refresh
 * Rotate the refresh token and issue a new access JWT.
 */
apiV1.post('/auth/refresh', authLimiter, validate({ body: RefreshSchema }), refreshHandler);

// Admin routes share API-key authentication and role-based authorization.
app.use('/admin', validateApiKey, adminRbacMiddleware);

/**
 * POST /api/v1/auth/logout
 * Revokes the current session. Requires Bearer token.
 */
apiV1.post('/auth/logout', readsLimiter, requireAuth, (req: Request, res: Response) => {
  try {
    const authReq = req as import('./auth').AuthenticatedRequest;
    const walletAddress = authReq.jwtPayload?.sub;
    if (!walletAddress) throw new Error('Unable to determine authenticated wallet');
    res.status(200).json({
      message: 'Session revoked successfully',
      walletAddress: walletAddress.slice(0, 8) + '…',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: err instanceof Error ? err.message : 'Failed to revoke session',
    });
  }
});

/**
 * POST /api/v1/auth/logout-all
 * Revokes all active sessions for the authenticated wallet.
 */
apiV1.post('/auth/logout-all', readsLimiter, requireAuth, (req: Request, res: Response) => {
  try {
    const authReq = req as import('./auth').AuthenticatedRequest;
    const walletAddress = authReq.jwtPayload?.sub;
    if (!walletAddress) throw new Error('Unable to determine authenticated wallet');
    res.status(200).json({
      message: 'All sessions revoked successfully',
      walletAddress: walletAddress.slice(0, 8) + '…',
      revokedCount: 1,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: err instanceof Error ? err.message : 'Failed to revoke all sessions',
    });
  }
});

// ─── Backward-compatibility redirects (301) ───────────────────────────────
// Old unversioned paths redirect to /api/v1 equivalents during transition window.

app.post('/auth/login', (req: Request, res: Response) => {
  res.redirect(301, '/api/v1/auth/login');
});
app.post('/auth/refresh', (req: Request, res: Response) => {
  res.redirect(301, '/api/v1/auth/refresh');
});
app.post('/auth/logout', (req: Request, res: Response) => {
  res.redirect(301, '/api/v1/auth/logout');
});
app.post('/auth/logout-all', (req: Request, res: Response) => {
  res.redirect(301, '/api/v1/auth/logout-all');
});

// /api/vault/* → /api/v1/vault/*
app.get('/api/vault/summary', (_req: Request, res: Response) => {
  res.setHeader('deprecation', 'true');
  res.redirect(301, '/api/v1/vault/summary');
});
app.get('/api/vault/transactions/export', (_req: Request, res: Response) => {
  res.redirect(301, '/api/v1/vault/transactions/export');
});
app.get('/api/vault/metrics', (_req: Request, res: Response) => {
  res.redirect(301, '/api/v1/vault/metrics');
});
app.get('/api/vault/apy', (_req: Request, res: Response) => {
  res.redirect(301, '/api/v1/vault/apy');
});

// /webhooks/verify → /api/v1/webhooks/verify
app.post('/webhooks/verify', (req: Request, res: Response) => {
  const { secret, payload, signature } = req.body || {};
  if (typeof secret !== 'string' || !secret.trim()) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'secret is required and must be a non-empty string',
    });
    return;
  }

  if (typeof payload === 'undefined') {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'payload is required',
    });
    return;
  }

  const computedSignature = createWebhookSignature(secret, payload);
  const verified =
    typeof signature === 'string' && signature.length > 0
      ? verifyWebhookSignature(secret, payload, signature)
      : null;

  res.status(200).json({
    algorithm: 'HMAC-SHA256',
    signature: computedSignature,
    verified,
  });
});

// ─── Backward-compatibility redirects for list/router-mounted paths ──────────
// Generic catch-all redirects for unversioned /vault/*, /referrals/*,
// /transactions/*, /portfolio/* paths → /api/v1 equivalents.
app.use('/vault', (req: Request, res: Response) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(301, `/api/v1/vault${req.path}${qs}`);
});
app.use('/referrals', (req: Request, res: Response) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(301, `/api/v1/referrals${req.path}${qs}`);
});
app.use('/transactions', (req: Request, res: Response) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(301, `/api/v1/transactions${req.path}${qs}`);
});
app.use('/portfolio', (req: Request, res: Response) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(301, `/api/v1/portfolio${req.path}${qs}`);
});

// ─── Versioned export & summary endpoints ────────────────────────────────
app.get('/api/v1/vault/transactions/export', handleTransactionExport);

// ─── Versioned vault summary/metrics/apy endpoints ───────────────────────

/**
 * GET /api/v1/vault/summary – read-only summary; relaxed rate limit.
 */
app.get(
  '/api/v1/vault/summary',
  readsLimiter,
  cacheMiddleware({ ttl: cacheVaultMetricsTtl }),
  (_req: Request, res: Response) => {
    res.json(buildVaultSummaryResponse());
  },
);

/**
 * GET /api/v1/vault/metrics - Cache with configurable TTL
 */
app.get(
  '/api/v1/vault/metrics',
  cacheMiddleware({ ttl: cacheVaultMetricsTtl }),
  (_req: Request, res: Response) => {
    res.json({
      message: 'Vault metrics',
      timestamp: new Date().toISOString(),
    });
  },
);

/**
 * GET /api/v1/vault/apy - Cache with configurable TTL
 */
app.get(
  '/api/v1/vault/apy',
  cacheMiddleware({ ttl: cacheVaultMetricsTtl }),
  (_req: Request, res: Response) => {
    res.json({
      message: 'Vault APY',
      timestamp: new Date().toISOString(),
    });
  },
);

// ─── Admin Routes (with API key authentication) ──────────────────────────────

/**
 * POST /admin/apy/backfill - backfill missing APY snapshots for a date range
 * Body: { start: "YYYY-MM-DD", end: "YYYY-MM-DD" }
 * Requires API key authentication.
 */
app.post('/admin/apy/backfill', validateApiKey, async (req: Request, res: Response) => {
  const { start, end } = req.body;
  if (!start || !end || typeof start !== 'string' || typeof end !== 'string') {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: '`start` and `end` (YYYY-MM-DD) are required',
    });
    return;
  }

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(start) || !datePattern.test(end)) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: '`start` and `end` must be in YYYY-MM-DD format',
    });
    return;
  }

  if (end < start) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: '`end` must be >= `start`',
    });
    return;
  }

  const actor = resolveActingAdminAddress(req);
  const jobStart = Date.now();

  try {
    if (isDryRunRequest(req)) {
      void recordAdminAuditLog(req, 'apy.backfill.dry_run', 200, {
        start,
        end,
        actor,
        estimatedDates: countInclusiveDays(start, end),
      });

      res.status(200).json({
        dryRun: true,
        message: 'APY backfill dry-run preview',
        start,
        end,
        estimatedDates: countInclusiveDays(start, end),
        wouldCreateSnapshots: true,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const result = await backfillApySnapshots(start, end);
    const durationMs = Date.now() - jobStart;

    const receipt = await generateAdminReceipt({
      action: 'apy.backfill',
      actor,
      input: { start, end },
      resultingState: {
        created: result.created,
        skipped: result.skipped,
        durationMs,
      },
    });

    void recordAdminAuditLog(req, 'apy.backfill', 200, {
      start,
      end,
      created: result.created,
      skipped: result.skipped,
      durationMs,
      actor,
      receiptId: receipt.id,
    });

    res.status(200).json({
      message: 'APY backfill completed',
      start,
      end,
      created: result.created,
      skipped: result.skipped,
      dates: result.dates,
      durationMs,
      timestamp: new Date().toISOString(),
      receipt,
    });
  } catch (err) {
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

/**
 * GET /admin/maintenance - get current maintenance mode state
 * Requires API key authentication.
 */
app.get('/admin/maintenance', validateApiKey, (_req: Request, res: Response) => {
  res.status(200).json({
    maintenance: getMaintenanceModeState(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /admin/maintenance - enable or disable maintenance mode
 * Body: { enabled: boolean, reason?: string, retryAfterSeconds?: number }
 * Requires API key authentication.
 */
app.post('/admin/maintenance', validateApiKey, async (req: Request, res: Response) => {
  const { enabled, reason, retryAfterSeconds } = req.body;
  if (typeof enabled !== 'boolean') {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: '`enabled` (boolean) is required',
    });
    return;
  }

  const actor = resolveActingAdminAddress(req);
  const previous = getMaintenanceModeState();
  const dryRun = isDryRunRequest(req);
  const preview = {
    enabled: enabled ?? previous.enabled,
    reason:
      reason === undefined
        ? previous.reason
        : typeof reason === 'string'
          ? reason.trim() || undefined
          : undefined,
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
    retryAfterSeconds: retryAfterSeconds ?? previous.retryAfterSeconds,
  };

  if (dryRun) {
    void recordAdminAuditLog(req, 'maintenance.toggle.dry_run', 200, {
      enabled: preview.enabled,
      previousEnabled: previous.enabled,
      reason: preview.reason,
      actor,
    });

    res.status(200).json({
      dryRun: true,
      message: `Maintenance mode would be ${preview.enabled ? 'enabled' : 'disabled'}`,
      previous,
      maintenance: preview,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const next = updateMaintenanceModeState({ enabled, reason, retryAfterSeconds, actor });

  await recordAdminConfigChange({
    configType: 'maintenance',
    action: 'toggle',
    actor,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
    preChangeSnapshot: previous as Record<string, unknown>,
    postChangeSnapshot: next as Record<string, unknown>,
    metadata: { receiptId: '' },
  });

  const receipt = await generateAdminReceipt({
    action: 'maintenance.toggle',
    actor,
    input: { enabled, reason, retryAfterSeconds },
    resultingState: {
      enabled: next.enabled,
      reason: next.reason,
      retryAfterSeconds: next.retryAfterSeconds,
      previousEnabled: previous.enabled,
    },
  });

  logMaintenanceTransition({
    enabled: next.enabled,
    actor,
    reason: next.reason,
    retryAfterSeconds: next.retryAfterSeconds,
    previousEnabled: previous.enabled,
  });

  void recordAdminAuditLog(req, 'maintenance.toggle', 200, {
    enabled: next.enabled,
    previousEnabled: previous.enabled,
    reason: next.reason,
    actor,
    receiptId: receipt.id,
  });

  res.status(200).json({
    message: `Maintenance mode ${next.enabled ? 'enabled' : 'disabled'}`,
    maintenance: next,
    timestamp: new Date().toISOString(),
    receipt,
  });
});

/**
 * GET /admin/maintenance/windows - list scheduled maintenance windows
 */
app.get('/admin/maintenance/windows', validateApiKey, (_req: Request, res: Response) => {
  res.status(200).json({
    windows: listMaintenanceWindows(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /admin/maintenance/windows - schedule a maintenance window
 * Body: { title: string, reason?: string, startsAt: string, endsAt: string }
 */
app.post('/admin/maintenance/windows', validateApiKey, (req: Request, res: Response) => {
  const { title, reason, startsAt, endsAt } = req.body;
  if (typeof title !== 'string' || !title.trim()) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: '`title` (string) is required',
    });
    return;
  }
  if (typeof startsAt !== 'string' || typeof endsAt !== 'string') {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: '`startsAt` and `endsAt` (ISO strings) are required',
    });
    return;
  }

  try {
    const actor = resolveActingAdminAddress(req);
    const window = scheduleMaintenanceWindow({
      title,
      reason: typeof reason === 'string' ? reason : undefined,
      startsAt,
      endsAt,
      actor,
    });
    res.status(201).json({ window, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * DELETE /admin/maintenance/windows/:windowId - cancel a scheduled window
 */
app.delete('/admin/maintenance/windows/:windowId', validateApiKey, (req: Request, res: Response) => {
  const cancelled = cancelMaintenanceWindow(req.params.windowId);
  if (!cancelled) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'Maintenance window not found',
    });
    return;
  }
  res.status(200).json({
    cancelled: true,
    windowId: req.params.windowId,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/config-changes - List admin configuration changes
 * Requires API key authentication
 */
app.get('/admin/config-changes', validateApiKey, async (req: Request, res: Response) => {
  const { configType, actor, start, end, limit } = req.query;
  const configChanges = await listAdminConfigChanges({
    configType: typeof configType === 'string' ? configType : undefined,
    actor: typeof actor === 'string' ? actor : undefined,
    start: typeof start === 'string' ? start : undefined,
    end: typeof end === 'string' ? end : undefined,
    limit: typeof limit === 'string' ? parseInt(limit, 10) : 100,
  });

  res.json({
    data: configChanges,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/feature-flags/overrides - List active feature flag overrides
 * Requires API key authentication
 */
app.get('/admin/feature-flags/overrides', validateApiKey, async (_req: Request, res: Response) => {
  const overrides = await featureFlags.listActiveOverrides();
  res.json({
    data: overrides,
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /admin/feature-flags/overrides - Create a new feature flag override
 * Requires API key authentication
 * Body: {
 *   flagName: string,
 *   enabled: boolean,
 *   scopeType: "wallet" | "environment",
 *   scopeValue?: string,
 *   expiresAt: string (ISO 8601)
 * }
 */
app.post('/admin/feature-flags/overrides', validateApiKey, async (req: Request, res: Response) => {
  const { flagName, enabled, scopeType, scopeValue, expiresAt } = req.body;

  if (!flagName || typeof flagName !== 'string') {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: '`flagName` (string) is required'
    });
    return;
  }

  if (typeof enabled !== 'boolean') {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: '`enabled` (boolean) is required'
    });
    return;
  }

  if (!scopeType || !['wallet', 'environment'].includes(scopeType)) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: '`scopeType` must be "wallet" or "environment"'
    });
    return;
  }

  if (scopeType === 'wallet' && (!scopeValue || typeof scopeValue !== 'string')) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: '`scopeValue` (string) is required for wallet scope'
    });
    return;
  }

  if (scopeType === 'environment' && (!scopeValue || typeof scopeValue !== 'string')) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: '`scopeValue` (string) is required for environment scope'
    });
    return;
  }

  if (!expiresAt || typeof expiresAt !== 'string') {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: '`expiresAt` (ISO 8601 string) is required'
    });
    return;
  }

  const expiresAtDate = new Date(expiresAt);
  if (isNaN(expiresAtDate.getTime()) || expiresAtDate <= new Date()) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: '`expiresAt` must be a valid future date in ISO 8601 format'
    });
    return;
  }

  const actor = resolveActingAdminAddress(req);
  const override = await featureFlags.createOverride(
    flagName,
    enabled,
    scopeType as 'wallet' | 'environment',
    scopeValue,
    expiresAtDate,
    actor
  );

  res.status(201).json({
    message: 'Feature flag override created successfully',
    data: override,
    timestamp: new Date().toISOString(),
  });
});

/**
 * DELETE /admin/feature-flags/overrides/:id - Delete a feature flag override
 * Requires API key authentication
 */
app.delete('/admin/feature-flags/overrides/:id', validateApiKey, async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'Override ID is required'
    });
    return;
  }

  try {
    await featureFlags.deleteOverride(id);
    res.status(200).json({
      message: 'Feature flag override deleted successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'Feature flag override not found'
    });
  }
});

/**
 * GET /admin/cache/stats - Get cache statistics including hit rate (R8)
 * Requires API key authentication
 */
app.get('/admin/cache/stats', validateApiKey, async (_req: Request, res: Response) => {
  const stats = getCacheStats();
  // Compute hit rate from Prometheus counters by reading the registry metrics text
  let hitRate: number | null = null;
  try {
    const metricsText = await register.metrics();
    const hitMatch = metricsText.match(/^cache_hit_count(?:\{[^}]*\})?\s+([\d.]+)/m);
    const missMatch = metricsText.match(/^cache_miss_count(?:\{[^}]*\})?\s+([\d.]+)/m);
    // Sum all label combinations
    const hitTotal = hitMatch
      ? metricsText
          .split('\n')
          .filter((l) => l.startsWith('cache_hit_count'))
          .reduce((acc, l) => {
            const m = l.match(/\s+([\d.]+)$/);
            return acc + (m ? parseFloat(m[1]) : 0);
          }, 0)
      : 0;
    const missTotal = missMatch
      ? metricsText
          .split('\n')
          .filter((l) => l.startsWith('cache_miss_count'))
          .reduce((acc, l) => {
            const m = l.match(/\s+([\d.]+)$/);
            return acc + (m ? parseFloat(m[1]) : 0);
          }, 0)
      : 0;
    const total = hitTotal + missTotal;
    hitRate = total > 0 ? parseFloat((hitTotal / total).toFixed(4)) : null;
  } catch {
    hitRate = null;
  }

  res.json({
    entryCount: stats.size,
    entries: stats.entries,
    hitRate,
    timestamp: new Date().toISOString(),
  });
});

/**
 * DELETE /admin/cache - Clear entire cache or by regex pattern (R8)
 * ?pattern=<regex> removes only matching entries
 * Requires API key authentication
 */
app.delete('/admin/cache', validateApiKey, (req: Request, res: Response) => {
  const pattern = typeof req.query.pattern === 'string' ? req.query.pattern : undefined;

  if (pattern !== undefined) {
    if (pattern.trim() === '') {
      res.status(400).json({
        error: 'Bad Request',
        status: 400,
        message: 'pattern query parameter must not be empty; omit it to clear the entire cache',
      });
      return;
    }
    try {
      new RegExp(pattern);
    } catch (e) {
      res.status(400).json({
        error: 'Bad Request',
        status: 400,
        message: `Invalid regex pattern "${pattern}": ${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }
  }

  const removed = invalidateCache(pattern);
  res.json({
    removed,
    pattern: pattern ?? null,
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /admin/cache/invalidate - Invalidate cache by pattern (legacy endpoint)
 * Requires API key authentication
 */
app.post('/admin/cache/invalidate', validateApiKey, (req: Request, res: Response) => {
  const { pattern } = req.body;
  if (isDryRunRequest(req)) {
    res.json({
      dryRun: true,
      message: 'Cache invalidation dry-run preview',
      pattern,
      wouldInvalidate: true,
      stats: getCacheStats(),
      timestamp: new Date().toISOString(),
    });
    return;
  }

  invalidateCache(pattern);
  res.json({
    message: 'Cache invalidated',
    pattern,
    stats: getCacheStats(),
  });
});

/**
 * POST /admin/events/replay - Manual admin endpoint to replay events for a specific ledger range
 * Requires API key authentication
 */
app.post('/admin/events/replay', validateApiKey, async (req: Request, res: Response) => {
  try {
    const { fromLedger, toLedger } = req.body;
    
    if (fromLedger === undefined || toLedger === undefined) {
      res.status(400).json({
        error: 'Bad Request',
        status: 400,
        message: 'fromLedger and toLedger are required in request body',
      });
      return;
    }
    
    if (typeof fromLedger !== 'number' || typeof toLedger !== 'number') {
      res.status(400).json({
        error: 'Bad Request',
        status: 400,
        message: 'fromLedger and toLedger must be numbers',
      });
      return;
    }
    
    // Validate ledger range
    if (fromLedger < 0 || toLedger < 0 || fromLedger > toLedger) {
      res.status(400).json({
        error: 'Bad Request',
        status: 400,
        message: 'fromLedger must be >= 0, toLedger must be >= 0, and fromLedger must be <= toLedger',
      });
      return;
    }

    const actor = resolveActingAdminAddress(req);
    if (isDryRunRequest(req)) {
      void recordAdminAuditLog(req, 'events.replay.manual.dry_run', 200, {
        fromLedger,
        toLedger,
        ledgerCount: toLedger - fromLedger + 1,
        actor,
        timestamp: new Date().toISOString(),
      });

      res.status(200).json({
        dryRun: true,
        message: 'Event replay dry-run preview',
        fromLedger,
        toLedger,
        ledgerCount: toLedger - fromLedger + 1,
        wouldReplay: true,
        timestamp: new Date().toISOString(),
      });
      return;
    }
    
    // Import the replay function
    const { replayEventsForRange } = await import('./eventPollingService');
    
    const startTime = Date.now();
    const result = await replayEventsForRange(fromLedger, toLedger);
    const duration = Date.now() - startTime;

    const receipt = await generateAdminReceipt({
      action: 'events.replay.manual',
      actor,
      input: { fromLedger, toLedger },
      resultingState: {
        processedCount: result.processedCount,
        duplicateCount: result.duplicateCount,
        durationMs: duration,
      },
    });
    
    // Record replay job metadata
    void recordAdminAuditLog(req, 'events.replay.manual', 200, {
      fromLedger,
      toLedger,
      processedCount: result.processedCount,
      duplicateCount: result.duplicateCount,
      durationMs: duration,
      timestamp: new Date().toISOString(),
      receiptId: receipt.id,
    });
    
    res.status(200).json({
      message: 'Event replay completed successfully',
      fromLedger,
      toLedger,
      processedCount: result.processedCount,
      duplicateCount: result.duplicateCount,
      durationMs: duration,
      timestamp: new Date().toISOString(),
      receipt,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    
    // Record failed replay attempt
    void recordAdminAuditLog(req, 'events.replay.manual.failed', 500, {
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
    
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: errorMessage,
    });
  }
});

/**
 * POST /admin/withdrawal-limits/override
 * Grants a temporary admin override for a wallet's daily withdrawal limit.
 * Requires super-admin API key.
 */
app.post('/admin/withdrawal-limits/override', validateApiKey, async (req: Request, res: Response) => {
  const walletAddress = typeof req.body?.walletAddress === 'string' ? req.body.walletAddress.trim() : '';
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  const ttlSeconds =
    typeof req.body?.ttlSeconds === 'number' && req.body.ttlSeconds > 0
      ? req.body.ttlSeconds
      : 3600;

  if (!walletAddress || !reason) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'walletAddress and reason are required',
    });
    return;
  }

  if (!hasRequiredApiKeyRole(req, 'super-admin')) {
    res.status(403).json({
      error: 'Forbidden',
      status: 403,
      message: 'Super-admin role is required to override withdrawal limits',
    });
    return;
  }

  const actor = resolveActingAdminAddress(req);
  const override = setWithdrawalLimitOverride(walletAddress, reason, actor, ttlSeconds);

  await recordAdminAuditLog(req, 'withdrawal.limit.override.grant', 201, {
    walletAddress: override.wallet,
    reason: override.reason,
    expiresAt: override.expiresAt,
    actor,
  });

  res.status(201).json({ override });
});

/**
 * GET /admin/withdrawal-limits/audit
 * Lists recent blocked and overridden withdrawal attempts.
 */
app.get('/admin/withdrawal-limits/audit', validateApiKey, (req: Request, res: Response) => {
  const limit = parseLimited(req.query.limit, 50, 1, 200);
  const windowed = listWithdrawalLimitAuditEntries(limit + 1);
  const { data, hasNextPage } = paginateByLimit(windowed, limit);

  sendStandardListEnvelope(res, {
    data,
    limit,
    hasNextPage,
    extras: { entries: data },
  });
});

/**
 * GET /admin/emails/queue
 * Lists queued outbound emails, optionally filtered by status.
 */
app.get('/admin/emails/queue', validateApiKey, async (req: Request, res: Response) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const emails = await emailQueueService.getEmailQueue(status);

  res.status(200).json({
    emails,
    count: emails.length,
  });
});

/**
 * POST /admin/emails/replay/:id
 * Requeues a failed/dead-letter email for another send attempt.
 */
app.post('/admin/emails/replay/:id', validateApiKey, async (req: Request, res: Response) => {
  try {
    const email = await emailQueueService.replayEmail(req.params.id);
    res.status(200).json({
      message: 'Email requeued successfully',
      email,
    });
  } catch {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'Email queue item not found',
    });
  }
});

// ─── Allowlist Admin Endpoints (Issue #375) ──────────────────────────────────

/**
 * POST /admin/allowlist/add
 * Adds a wallet address to the private beta allowlist.
 * Requires API key authentication.
 * Body: { "walletAddress": "G..." }
 */
app.post('/admin/allowlist/add', validateApiKey, async (req: Request, res: Response) => {
  const { walletAddress } = req.body;
  if (!walletAddress || typeof walletAddress !== 'string') {
    res.status(400).json({ error: 'Missing or invalid walletAddress in request body' });
    return;
  }
  const added = addAddress(walletAddress);
  const actor = resolveActingAdminAddress(req);

  const receipt = await generateAdminReceipt({
    action: 'allowlist.add',
    actor,
    input: { walletAddress },
    resultingState: {
      added,
      totalCount: allowlistSize(),
    },
  });

  void recordAdminAuditLog(req, 'allowlist.add', added ? 201 : 200, {
    walletAddress,
    added,
    actor,
    receiptId: receipt.id,
  });

  res.status(added ? 201 : 200).json({
    message: added ? 'Wallet added to allowlist' : 'Wallet already in allowlist',
    walletAddress: walletAddress.trim().toUpperCase(),
    count: allowlistSize(),
    receipt,
  });
});

/**
 * DELETE /admin/allowlist/remove
 * Removes a wallet address from the private beta allowlist.
 * Requires API key authentication.
 * Body: { "walletAddress": "G..." }
 */
app.delete('/admin/allowlist/remove', validateApiKey, async (req: Request, res: Response) => {
  const { walletAddress } = req.body;
  if (!walletAddress || typeof walletAddress !== 'string') {
    res.status(400).json({ error: 'Missing or invalid walletAddress in request body' });
    return;
  }
  const removed = removeAddress(walletAddress);
  if (!removed) {
    res.status(404).json({ error: 'Wallet address not found in allowlist' });
    return;
  }

  const actor = resolveActingAdminAddress(req);
  const receipt = await generateAdminReceipt({
    action: 'allowlist.remove',
    actor,
    input: { walletAddress },
    resultingState: {
      removed: true,
      totalCount: allowlistSize(),
    },
  });

  void recordAdminAuditLog(req, 'allowlist.remove', 200, {
    walletAddress,
    actor,
    receiptId: receipt.id,
  });

  res.json({
    message: 'Wallet removed from allowlist',
    walletAddress: walletAddress.trim().toUpperCase(),
    count: allowlistSize(),
    receipt,
  });
});

/**
 * GET /admin/allowlist
 * Lists all wallet addresses on the allowlist.
 * Requires API key authentication.
 */
app.get('/admin/allowlist', validateApiKey, (_req: Request, res: Response) => {
  res.json({
    addresses: listAddresses(),
    count: allowlistSize(),
    enabled: process.env.ALLOWLIST_ENABLED !== 'false',
  });
});

/**
 * POST /admin/impersonate/sessions - start a time-bounded impersonation session
 * Requires super-admin API key.
 */
app.post('/admin/impersonate/sessions', validateApiKey, async (req: Request, res: Response) => {
  const actingAdminAddress = resolveActingAdminAddress(req);
  const { actor, apiKeyHash, ipAddress, userAgent } = resolveImpersonationSessionContext(req);
  const targetWallet = typeof req.body?.targetWallet === 'string' ? req.body.targetWallet.trim() : '';
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';

  req.adminAuditActor = actingAdminAddress;
  req.adminAuditMetadata = {
    actingAdminAddress,
    adminRole: req.authApiKeyRole || 'admin',
    targetWallet: targetWallet || 'unknown',
    impersonation: true,
  };

  if (!targetWallet || !reason) {
    req.adminAuditAction = 'admin.impersonate.session.invalid';
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'targetWallet and reason are required',
    });
    return;
  }

  if (!hasRequiredApiKeyRole(req, 'super-admin')) {
    req.adminAuditAction = 'admin.impersonate.session.denied';
    res.status(403).json({
      error: 'Forbidden',
      status: 403,
      message: 'Super-admin role is required for impersonation sessions',
    });
    return;
  }

  try {
    const session = await startImpersonationSession({
      actor: actingAdminAddress,
      apiKeyHash,
      targetWallet,
      reason,
      ipAddress,
      userAgent,
    });

    req.adminAuditAction = 'admin.impersonate.session.started';
    req.adminAuditMetadata = {
      ...req.adminAuditMetadata,
      sessionId: session.id,
      expiresAt: session.expiresAt,
    };

    res.status(201).json({ session });
  } catch (error) {
    req.adminAuditAction = 'admin.impersonate.session.failed';
    req.adminAuditMetadata = {
      ...req.adminAuditMetadata,
      error: error instanceof Error ? error.message : String(error),
    };
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: 'Failed to start impersonation session',
    });
  }
});

/**
 * GET /admin/impersonate/sessions - list active and historical impersonation sessions
 * Requires super-admin API key.
 */
app.get('/admin/impersonate/sessions', validateApiKey, async (req: Request, res: Response) => {
  const actingAdminAddress = resolveActingAdminAddress(req);

  req.adminAuditActor = actingAdminAddress;
  req.adminAuditMetadata = {
    actingAdminAddress,
    adminRole: req.authApiKeyRole || 'admin',
    impersonation: true,
  };

  if (!hasRequiredApiKeyRole(req, 'super-admin')) {
    req.adminAuditAction = 'admin.impersonate.session.list.denied';
    res.status(403).json({
      error: 'Forbidden',
      status: 403,
      message: 'Super-admin role is required to list impersonation sessions',
    });
    return;
  }

  const statusRaw = typeof req.query.status === 'string' ? req.query.status : 'all';
  const status =
    statusRaw === 'active' || statusRaw === 'ended' || statusRaw === 'expired' ? statusRaw : 'all';
  const actor = typeof req.query.actor === 'string' ? req.query.actor : undefined;
  const targetWallet = typeof req.query.targetWallet === 'string' ? req.query.targetWallet : undefined;
  const limit = parseLimited(req.query.limit, 50, 1, 200);

  try {
    const sessions = await listImpersonationSessions({
      status,
      actor,
      targetWallet,
      limit: limit + 1,
    });
    const { data, hasNextPage } = paginateByLimit(sessions, limit);

    req.adminAuditAction = 'admin.impersonate.session.list';
    sendStandardListEnvelope(res, {
      data,
      limit,
      hasNextPage,
      extras: {
        sessions: data,
        count: data.length,
      },
    });
  } catch (error) {
    req.adminAuditAction = 'admin.impersonate.session.list.failed';
    req.adminAuditMetadata = {
      ...req.adminAuditMetadata,
      error: error instanceof Error ? error.message : String(error),
    };
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: 'Failed to list impersonation sessions',
    });
  }
});

/**
 * DELETE /admin/impersonate/sessions/:id - end an active impersonation session
 * Requires super-admin API key.
 */
app.delete('/admin/impersonate/sessions/:id', validateApiKey, async (req: Request, res: Response) => {
  const actingAdminAddress = resolveActingAdminAddress(req);
  const sessionId = String(req.params.id || '').trim();

  req.adminAuditActor = actingAdminAddress;
  req.adminAuditMetadata = {
    actingAdminAddress,
    adminRole: req.authApiKeyRole || 'admin',
    sessionId: sessionId || 'unknown',
    impersonation: true,
  };

  if (!sessionId) {
    req.adminAuditAction = 'admin.impersonate.session.end.invalid';
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'session id is required',
    });
    return;
  }

  if (!hasRequiredApiKeyRole(req, 'super-admin')) {
    req.adminAuditAction = 'admin.impersonate.session.end.denied';
    res.status(403).json({
      error: 'Forbidden',
      status: 403,
      message: 'Super-admin role is required to end impersonation sessions',
    });
    return;
  }

  try {
    const session = await endImpersonationSession(sessionId, actingAdminAddress);
    if (!session) {
      req.adminAuditAction = 'admin.impersonate.session.end.not_found';
      res.status(404).json({
        error: 'Not Found',
        status: 404,
        message: 'Impersonation session not found or already expired',
      });
      return;
    }

    req.adminAuditAction = 'admin.impersonate.session.ended';
    res.status(200).json({ session });
  } catch (error) {
    req.adminAuditAction = 'admin.impersonate.session.end.failed';
    req.adminAuditMetadata = {
      ...req.adminAuditMetadata,
      error: error instanceof Error ? error.message : String(error),
    };
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: 'Failed to end impersonation session',
    });
  }
});

/**
 * GET /admin/impersonate/:wallet - inspect vault state as a specific wallet
 * Requires super-admin API key and a valid non-expired impersonation session.
 */
app.get('/admin/impersonate/:wallet', validateApiKey, async (req: Request, res: Response) => {
  const wallet = String(req.params.wallet || '').trim();
  const actingAdminAddress = resolveActingAdminAddress(req);
  const sessionId = String(req.get('x-impersonation-session-id') || '').trim();

  req.adminAuditActor = actingAdminAddress;
  req.adminAuditMetadata = {
    actingAdminAddress,
    adminRole: req.authApiKeyRole || 'admin',
    targetWallet: wallet || 'unknown',
    sessionId: sessionId || undefined,
    impersonation: true,
  };

  if (!wallet) {
    req.adminAuditAction = 'admin.impersonate.invalid';
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'wallet path parameter is required',
    });
    return;
  }

  if (!hasRequiredApiKeyRole(req, 'super-admin')) {
    req.adminAuditAction = 'admin.impersonate.denied';
    res.status(403).json({
      error: 'Forbidden',
      status: 403,
      message: 'Super-admin role is required for impersonation',
    });
    return;
  }

  if (!sessionId && process.env.IMPERSONATION_SESSION_STORAGE) {
    req.adminAuditAction = 'admin.impersonate.session.required';
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'x-impersonation-session-id header is required',
    });
    return;
  }

  try {
    let activeSession: ImpersonationSessionRecord | undefined;

    if (sessionId) {
      const validation = await validateImpersonationSession(sessionId, wallet, actingAdminAddress);
      if (!validation.ok) {
        const statusCode = validation.reason === 'not_found' ? 404 : 403;
        req.adminAuditAction =
          validation.reason === 'expired'
            ? 'admin.impersonate.session.expired'
            : validation.reason === 'ended'
              ? 'admin.impersonate.session.ended'
              : validation.reason === 'wallet_mismatch'
                ? 'admin.impersonate.session.wallet_mismatch'
                : validation.reason === 'actor_mismatch'
                  ? 'admin.impersonate.session.actor_mismatch'
                  : 'admin.impersonate.session.invalid';
        req.adminAuditMetadata = {
          ...req.adminAuditMetadata,
          validationReason: validation.reason,
        };
        res.status(statusCode).json({
          error: statusCode === 404 ? 'Not Found' : 'Forbidden',
          status: statusCode,
          message:
            validation.reason === 'expired'
              ? 'Impersonation session has expired'
              : validation.reason === 'ended'
                ? 'Impersonation session has ended'
                : validation.reason === 'wallet_mismatch'
                  ? 'Session wallet does not match target wallet'
                  : validation.reason === 'actor_mismatch'
                    ? 'Session actor does not match requesting admin'
                    : 'Impersonation session is invalid',
        });
        return;
      }
      activeSession = validation.session;
    }

    req.adminAuditAction = 'admin.impersonate';

    const vaultState = await buildImpersonatedVaultState(wallet);
    res.status(200).json({
      ...vaultState,
      impersonationSession: activeSession
        ? {
            id: activeSession.id,
            reason: activeSession.reason,
            startedAt: activeSession.startedAt,
            expiresAt: activeSession.expiresAt,
          }
        : undefined,
    });
    } catch (error) {
      req.adminAuditAction = 'admin.impersonate.failed';
      req.adminAuditMetadata = {
        ...req.adminAuditMetadata,
        error: error instanceof Error ? error.message : String(error),
      };
      res.status(500).json({
        error: 'Internal Server Error',
        status: 500,
        message: 'Failed to build impersonated vault state',
      });
  }
});

app.get('/admin/receipts', validateApiKey, async (req: Request, res: Response) => {
  const action = typeof req.query.action === 'string' ? req.query.action : undefined;
  const actor = typeof req.query.actor === 'string' ? req.query.actor : undefined;
  const limit = parseLimited(req.query.limit, 50, 1, 200);

  try {
    const receipts = await listAdminReceipts({ action, actor, limit: limit + 1 });
    const { data, hasNextPage } = paginateByLimit(receipts, limit);

    sendStandardListEnvelope(res, {
      data,
      limit,
      hasNextPage,
      extras: {
        receipts: data,
        count: data.length,
      },
    });
  } catch (err) {
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

/**
 * GET /admin/receipts/:id
 * Retrieves a specific admin action receipt.
 * Requires API key authentication.
 */
app.get('/admin/receipts/:id', validateApiKey, async (req: Request, res: Response) => {
  try {
    const receipt = await getAdminReceipt(req.params.id);
    if (!receipt) {
      res.status(404).json({ error: 'Receipt not found' });
      return;
    }
    res.json(receipt);
  } catch (err) {
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

/**
 * GET /admin/receipts/:id/verify
 * Verifies the integrity of an admin action receipt.
 * Requires API key authentication.
 */
app.get('/admin/receipts/:id/verify', validateApiKey, async (req: Request, res: Response) => {
  try {
    const receipt = await getAdminReceipt(req.params.id);
    if (!receipt) {
      res.status(404).json({ error: 'Receipt not found' });
      return;
    }

    const isValid = verifyReceiptSignature(receipt);
    res.json({
      id: receipt.id,
      isValid,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

/**
 * POST /admin/api-keys/register - Register a new API key
 * Requires API key authentication (for boostrapping, requires special permission)
 */
app.post('/admin/api-keys/register', validateApiKey, async (req: Request, res: Response) => {
  const { key, role: requestedRole } = req.body;
  if (!key || typeof key !== 'string' || !key.trim()) {
    res.status(400).json({ error: 'Missing key in request body' });
    return;
  }

  const role = normalizeApiKeyRole(requestedRole) || 'admin';
  if (role === 'super-admin' && !hasRequiredApiKeyRole(req, 'super-admin')) {
    res.status(403).json({
      error: 'Forbidden',
      status: 403,
      message: 'Super-admin role is required to register super-admin API keys',
    });
    return;
  }

  const normalizedKey = key.trim();
  const hash = registerApiKey(normalizedKey, { role });

  try {
    await recordApiKeyAuditEvent({
      actor: resolveApiKeyAuditActor(req),
      action: API_KEY_AUDIT_ACTIONS.created,
      keyFingerprint: getApiKeyFingerprintFromHash(hash),
    });

    res.json({
      message: 'API key registered',
      hash,
      fingerprint: getApiKeyFingerprintFromHash(hash),
      role,
      created: new Date().toISOString(),
    });
  } catch (error) {
    revokeApiKey(hash);
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: error instanceof Error ? error.message : 'Failed to persist API key audit event',
    });
  }
});

/**
 * POST /admin/api-keys/rotate - Rotate an API key
 * Body: { oldHash: string, newKey: string }
 * Requires API key authentication.
 */
app.post('/admin/api-keys/rotate', validateApiKey, async (req: Request, res: Response) => {
  const { oldHash, newKey } = req.body || {};
  if (!isApiKeyHash(oldHash)) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'oldHash must be a valid SHA-256 API key hash',
    });
    return;
  }

  if (typeof newKey !== 'string' || !newKey.trim()) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'newKey is required',
    });
    return;
  }

  const previousMetadata = getApiKeyMetadata(oldHash);
  if (!previousMetadata) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'API key not found',
    });
    return;
  }

  const normalizedNewKey = newKey.trim();
  const newHash = rotateApiKey(oldHash, normalizedNewKey);
  if (!newHash) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'API key not found',
    });
    return;
  }

  try {
    await recordApiKeyAuditEvent({
      actor: resolveApiKeyAuditActor(req),
      action: API_KEY_AUDIT_ACTIONS.rotated,
      keyFingerprint: getApiKeyFingerprintFromValue(normalizedNewKey),
    });

    res.status(200).json({
      message: 'API key rotated',
      oldFingerprint: getApiKeyFingerprintFromHash(oldHash),
      newHash,
      newFingerprint: getApiKeyFingerprintFromHash(newHash),
      rotatedAt: new Date().toISOString(),
    });
  } catch (error) {
    revokeApiKey(newHash);
    restoreApiKey(oldHash, previousMetadata);
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: error instanceof Error ? error.message : 'Failed to persist API key audit event',
    });
  }
});

/**
 * POST /admin/api-keys/revoke - Revoke an API key
 * Body: { hash: string }
 * Requires API key authentication.
 */
app.post('/admin/api-keys/revoke', validateApiKey, async (req: Request, res: Response) => {
  const { hash } = req.body || {};
  if (!isApiKeyHash(hash)) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'hash must be a valid SHA-256 API key hash',
    });
    return;
  }

  const previousMetadata = getApiKeyMetadata(hash);
  if (!previousMetadata) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'API key not found',
    });
    return;
  }

  revokeApiKey(hash);

  try {
    await recordApiKeyAuditEvent({
      actor: resolveApiKeyAuditActor(req),
      action: API_KEY_AUDIT_ACTIONS.revoked,
      keyFingerprint: getApiKeyFingerprintFromHash(hash),
    });

    res.status(200).json({
      message: 'API key revoked',
      fingerprint: getApiKeyFingerprintFromHash(hash),
      revokedAt: new Date().toISOString(),
    });
  } catch (error) {
    restoreApiKey(hash, previousMetadata);
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: error instanceof Error ? error.message : 'Failed to persist API key audit event',
    });
  }
});

/**
 * GET /admin/api-keys/audit-events - list API key lifecycle audit events
 * Supports ?action=created|rotated|revoked&from=<ISO or YYYY-MM-DD>&to=<ISO or YYYY-MM-DD>&limit=N
 */
app.get('/admin/api-keys/audit-events', validateApiKey, async (req: Request, res: Response) => {
  const rawAction = typeof req.query.action === 'string' ? req.query.action : undefined;
  const action =
    rawAction === API_KEY_AUDIT_ACTIONS.created ||
    rawAction === API_KEY_AUDIT_ACTIONS.rotated ||
    rawAction === API_KEY_AUDIT_ACTIONS.revoked
      ? rawAction
      : undefined;

  if (rawAction && !action) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'action must be one of: created, rotated, revoked',
    });
    return;
  }

  try {
    const range = parseUtcDateRange({
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined,
    });
    const limit = parseLimited(req.query.limit, 50, 1, 200);
    const events = await listApiKeyAuditEvents({
      action,
      start: range.start,
      end: range.end,
      limit: limit + 1,
    });
    const { data, hasNextPage } = paginateByLimit(events, limit);

    sendStandardListEnvelope(res, {
      data,
      limit,
      hasNextPage,
      extras: {
        events: data,
        meta: {
          count: data.length,
          limit,
          filters: {
            action: action || null,
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
      message: error instanceof Error ? error.message : 'Failed to read API key audit events',
    });
  }
});

/**
 * POST /admin/webhooks - register webhook endpoint for transaction events
 */
app.post('/admin/webhooks', validateApiKey, (req: Request, res: Response) => {
  try {
    const { url, eventTypes, enabled, secret } = req.body;
    if (!url || typeof url !== 'string') {
      res.status(400).json({
        error: 'Bad Request',
        status: 400,
        message: 'url is required and must be a string',
      });
      return;
    }

    const endpoint = registerWebhookEndpoint({
      url,
      eventTypes,
      enabled: enabled ?? true,
      secret,
    });

    res.status(201).json({
      message: 'Webhook endpoint registered',
      endpoint,
    });
  } catch (error) {
    res.status(422).json({
      error: 'Unprocessable Entity',
      status: 422,
      message: error instanceof Error ? error.message : 'Invalid webhook configuration',
    });
  }
});

/**
 * POST /admin/webhooks/:id/verify - run challenge-response verification for an endpoint
 */
app.post('/admin/webhooks/:id/verify', validateApiKey, async (req: Request, res: Response) => {
  try {
    const endpoint = await verifyWebhookEndpoint(req.params.id);
    if (!endpoint) {
      res.status(404).json({
        error: 'Not Found',
        status: 404,
        message: 'Webhook endpoint not found',
      });
      return;
    }

    await recordAdminAuditLog(req, 'webhook.verify', endpoint.verificationStatus === 'verified' ? 200 : 422, {
      endpointId: endpoint.id,
      verificationStatus: endpoint.verificationStatus,
      lastVerificationError: endpoint.lastVerificationError,
    });

    res.status(endpoint.verificationStatus === 'verified' ? 200 : 422).json({
      message:
        endpoint.verificationStatus === 'verified'
          ? 'Webhook endpoint verified'
          : 'Webhook endpoint verification failed',
      endpoint,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: error instanceof Error ? error.message : 'Failed to verify webhook endpoint',
    });
  }
});

/**
 * PATCH /admin/webhooks/:id - update webhook endpoint
 */
app.patch('/admin/webhooks/:id', validateApiKey, (req: Request, res: Response) => {
  if (!assertWebhookParameterUpdate(req, res)) {
    return;
  }

  try {
    const endpoint = updateWebhookEndpoint(req.params.id, req.body || {});
    if (!endpoint) {
      res.status(404).json({
        error: 'Not Found',
        status: 404,
        message: 'Webhook endpoint not found',
      });
      return;
    }

    res.status(200).json({
      message: 'Webhook endpoint updated',
      endpoint,
    });
  } catch (error) {
    res.status(422).json({
      error: 'Unprocessable Entity',
      status: 422,
      message: error instanceof Error ? error.message : 'Failed to update webhook endpoint',
    });
  }
});

/**
 * GET /admin/webhooks - list webhook endpoints
 */
app.get('/admin/webhooks', validateApiKey, (req: Request, res: Response) => {
  const includeDeleted = req.query.includeDeleted === 'true';
  const limit = parseLimited(req.query.limit, 100, 1, 500);
  const allEndpoints = listWebhookEndpoints(includeDeleted);
  const windowed = allEndpoints.slice(0, limit + 1);
  const { data, hasNextPage } = paginateByLimit(windowed, limit);

  sendStandardListEnvelope(res, {
    data,
    limit,
    hasNextPage,
    total: allEndpoints.length,
    extras: {
      endpoints: data,
      metrics: getWebhookDeliveryMetrics(),
    },
  });
});

/**
 * DELETE /admin/webhooks/:id - soft delete webhook endpoint
 */
app.delete('/admin/webhooks/:id', validateApiKey, async (req: Request, res: Response) => {
  const actor = resolveActingAdminAddress(req);
  const endpoint = deleteWebhookEndpoint(req.params.id, actor);

  if (!endpoint) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'Webhook endpoint not found or already deleted',
    });
    return;
  }

  void recordAdminAuditLog(req, 'webhook.delete', 200, {
    endpointId: endpoint.id,
    url: endpoint.url,
    actor,
  });

  res.status(200).json({
    message: 'Webhook endpoint soft-deleted',
    endpoint,
  });
});

/**
 * POST /admin/webhooks/:id/restore - restore soft-deleted webhook endpoint
 */
app.post('/admin/webhooks/:id/restore', validateApiKey, async (req: Request, res: Response) => {
  const actor = resolveActingAdminAddress(req);
  const endpoint = restoreWebhookEndpoint(req.params.id, actor);

  if (!endpoint) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'Webhook endpoint not found or not deleted',
    });
    return;
  }

  void recordAdminAuditLog(req, 'webhook.restore', 200, {
    endpointId: endpoint.id,
    url: endpoint.url,
    actor,
  });

  res.status(200).json({
    message: 'Webhook endpoint restored',
    endpoint,
  });
});

/**
 * GET /admin/webhooks/dead-letter - list permanently failed webhook deliveries
 */
app.get('/admin/webhooks/dead-letter', validateApiKey, (req: Request, res: Response) => {
  const endpointId = typeof req.query.endpointId === 'string' ? req.query.endpointId : undefined;
  const eventType = typeof req.query.eventType === 'string' ? req.query.eventType : undefined;
  const start = typeof req.query.start === 'string' ? req.query.start : undefined;
  const end = typeof req.query.end === 'string' ? req.query.end : undefined;
  const limit = parseLimited(req.query.limit, 100, 1, 500);

  const rows = listWebhookDeadLetters({
    endpointId,
    eventType: eventType as any,
    start,
    end,
    limit: limit + 1,
  });
  const { data, hasNextPage } = paginateByLimit(rows, limit);

  sendStandardListEnvelope(res, {
    data,
    limit,
    hasNextPage,
    extras: {
      deadLetters: data,
    },
  });
});

/**
 * POST /admin/webhooks/dead-letter/:id/retry - re-queue a dead-letter delivery
 */
app.post('/admin/webhooks/dead-letter/:id/retry', validateApiKey, async (req: Request, res: Response) => {
  try {
    const entry = await retryWebhookDeadLetter(req.params.id);
    if (!entry) {
      res.status(404).json({
        error: 'Not Found',
        status: 404,
        message: 'Dead-letter entry not found',
      });
      return;
    }

    res.status(200).json({
      message: 'Dead-letter entry re-queued for delivery',
      deadLetter: entry,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: error instanceof Error ? error.message : 'Failed to retry dead-letter entry',
    });
  }
});

/**
 * GET /admin/webhooks/deliveries - list recent webhook delivery attempts
 * Supports cursor-based pagination: ?limit=N&cursor=<opaque>
 */
app.get('/admin/webhooks/deliveries', validateApiKey, (req: Request, res: Response) => {
  const limit = parseLimited(req.query.limit, 100, 1, 500);
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

  try {
    const page = listWebhookDeliveryPage({ limit, cursor });
    sendStandardListEnvelope(res, {
      data: page.deliveries,
      limit,
      hasNextPage: page.hasNextPage,
      hasPrevPage: Boolean(cursor),
      nextCursor: page.nextCursor,
      extras: {
        deliveries: page.deliveries,
        nextCursor: page.nextCursor,
        hasNextPage: page.hasNextPage,
        metrics: getWebhookDeliveryMetrics(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Invalid or expired cursor')) {
      res.status(400).json({
        error: 'Bad Request',
        status: 400,
        message: 'Invalid or expired cursor. Start a new page without a cursor.',
      });
      return;
    }
    res.status(500).json({ error: 'Internal Server Error', status: 500, message });
  }
});

/**
 * POST /api/v1/webhooks/verify - verify webhook secret/signature pairing before go-live
 */
app.post('/api/v1/webhooks/verify', (req: Request, res: Response) => {
  const { secret, payload, signature } = req.body || {};
  if (typeof secret !== 'string' || !secret.trim()) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'secret is required and must be a non-empty string',
    });
    return;
  }

  if (typeof payload === 'undefined') {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'payload is required',
    });
    return;
  }

  const computedSignature = createWebhookSignature(secret, payload);
  const verified =
    typeof signature === 'string' && signature.length > 0
      ? verifyWebhookSignature(secret, payload, signature)
      : null;

  res.status(200).json({
    algorithm: 'HMAC-SHA256',
    signature: computedSignature,
    verified,
  });
});

/**
 * GET /admin/audit/logs - list admin activity logs
 */
app.get('/admin/audit/logs', validateApiKey, (req: Request, res: Response) => {
  const statusCode = req.query.statusCode ? parseInt(String(req.query.statusCode), 10) : undefined;
  const limit = parseLimited(req.query.limit, 100, 1, 500);

  const logs = getAuditLogs({
    actor: req.query.actor ? String(req.query.actor) : undefined,
    action: req.query.action ? String(req.query.action) : undefined,
    path: req.query.path ? String(req.query.path) : undefined,
    statusCode,
    limit: limit + 1,
  });
  const { data, hasNextPage } = paginateByLimit(logs, limit);

  sendStandardListEnvelope(res, {
    data,
    limit,
    hasNextPage,
    extras: {
      logs: data,
      metrics: getAuditLogMetrics(),
    },
  });
});

/**
 * GET /admin/audit-logs - list admin audit entries (Issue #253)
 */
app.get('/admin/audit-logs', validateApiKey, async (req: Request, res: Response) => {
  const limit = parseLimited(req.query.limit, 50, 1, 200);
  const statusCode = req.query.statusCode
    ? parseLimited(req.query.statusCode, 0, 100, 599)
    : undefined;

  const rows = getAuditLogs({
    action: typeof req.query.action === 'string' ? req.query.action : undefined,
    actor: typeof req.query.actor === 'string' ? req.query.actor : undefined,
    statusCode,
    limit: limit + 1,
  });
  const { data, hasNextPage } = paginateByLimit(rows, limit);

  void recordAdminAuditLog(req, 'audit-logs.read', 200, {
    limit,
    returned: data.length,
  });

  sendStandardListEnvelope(res, {
    data,
    limit,
    hasNextPage,
    extras: {
      meta: {
        count: data.length,
        limit,
        timestamp: new Date().toISOString(),
      },
    },
  });
});

/**
 * GET /admin/exports/jobs - list persisted transaction export metadata
 */
app.get('/admin/exports/jobs', validateApiKey, async (req: Request, res: Response) => {
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
app.post('/admin/exports/jobs/:id/verify', validateApiKey, async (req: Request, res: Response) => {
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
app.post('/admin/exports/bulk', validateApiKey, async (req: Request, res: Response) => {
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
app.get('/admin/exports/bulk/jobs', validateApiKey, async (req: Request, res: Response) => {
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
app.get('/admin/exports/bulk/jobs/:id', validateApiKey, async (req: Request, res: Response) => {
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
app.post('/admin/exports/bulk/jobs/:id/cancel', validateApiKey, async (req: Request, res: Response) => {
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
app.get('/admin/exports/bulk/artifacts/:artifactId', validateApiKey, (req: Request, res: Response) => {
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
 * GET /admin/prisma/config - operational prisma runtime settings (Issue #254)
 */
app.get('/admin/prisma/config', validateApiKey, (_req: Request, res: Response) => {
  res.status(200).json({
    config: getPrismaConfig(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/jobs/monitor - structured JSON for background jobs/webhook workers
 */
app.get('/admin/jobs/monitor', validateApiKey, (_req: Request, res: Response) => {
  res.status(200).json({
    jobHealth: getJobHealthStatus(),
    jobs: getJobMetrics(),
    webhooks: getWebhookDeliveryMetrics(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/jobs/metrics - JSON metrics dashboard for background jobs (Issue #255)
 */
app.get('/admin/jobs/metrics', validateApiKey, (req: Request, res: Response) => {
  const metrics = getJobMetrics();
  const summary = {
    totalDeadLetters: metrics.totalDeadLetters,
    recurringFailureJobs: Object.keys(metrics.recurringFailures),
    jobHealth: getJobHealthStatus(),
    activeJobs: Object.values(metrics.runtime).filter((job) => job.inFlight > 0).length,
  };

  void recordAdminAuditLog(req, 'jobs.metrics.read', 200);

  res.json({
    summary,
    metrics,
    prisma: getPrismaRuntimeConfig(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/jobs/dashboard - lightweight HTML dashboard for operators
 */
app.get('/admin/jobs/dashboard', validateApiKey, (_req: Request, res: Response) => {
  const jobMetrics = getJobMetrics();
  const webhookMetrics = getWebhookDeliveryMetrics();

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>YieldVault Job Dashboard</title>
        <style>
          body { font-family: 'Segoe UI', sans-serif; margin: 2rem; background: #f6f8fa; color: #0f172a; }
          h1 { margin-bottom: 1rem; }
          .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; }
          .card { background: #ffffff; border: 1px solid #dbe3ec; border-radius: 10px; padding: 1rem; box-shadow: 0 2px 10px rgba(15,23,42,0.05); }
          .label { color: #64748b; font-size: 0.9rem; margin-bottom: 0.25rem; }
          .value { font-size: 1.4rem; font-weight: 600; }
          pre { background: #0f172a; color: #e2e8f0; padding: 1rem; border-radius: 8px; overflow: auto; }
        </style>
      </head>
      <body>
        <h1>Background Job Monitoring</h1>
        <div class="grid">
          <div class="card"><div class="label">Job Health</div><div class="value">${getJobHealthStatus()}</div></div>
          <div class="card"><div class="label">Dead Letters</div><div class="value">${jobMetrics.totalDeadLetters}</div></div>
          <div class="card"><div class="label">Webhook Endpoints</div><div class="value">${webhookMetrics.totalEndpoints}</div></div>
          <div class="card"><div class="label">Webhook Failures</div><div class="value">${webhookMetrics.failed}</div></div>
        </div>
        <h2>Job Metrics</h2>
        <pre>${JSON.stringify(jobMetrics, null, 2)}</pre>
        <h2>Webhook Metrics</h2>
        <pre>${JSON.stringify(webhookMetrics, null, 2)}</pre>
      </body>
    </html>
  `);
});

// ─── Idempotency Admin Endpoints (Issues #457 & #466) ────────────────────────

/**
 * GET /admin/idempotency/keys
 * Lists idempotency keys with metadata.
 * Optional query param: ?prefix=<string> to filter keys by prefix.
 * Requires API key authentication.
 */
app.get('/admin/idempotency/keys', validateApiKey, (req: Request, res: Response) => {
  const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : undefined;
  const keys = idempotencyStore.inspectKeys(prefix);
  res.status(200).json({
    keys,
    count: keys.length,
    metrics: idempotencyStore.getMetrics(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * DELETE /admin/idempotency/keys/:key
 * Removes a single idempotency key from the store.
 * Requires API key authentication.
 */
app.delete('/admin/idempotency/keys/:key', validateApiKey, (req: Request, res: Response) => {
  const key = decodeURIComponent(req.params.key);
  if (isDryRunRequest(req)) {
    const exists = idempotencyStore.inspectKeys().some((entry) => entry.key === key);
    res.status(exists ? 200 : 404).json({
      dryRun: true,
      message: exists
        ? `Idempotency key '${key}' would be deleted`
        : `Idempotency key '${key}' not found`,
      key,
      wouldDelete: exists,
      metrics: idempotencyStore.getMetrics(),
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const deleted = idempotencyStore.deleteKey(key);
  if (!deleted) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: `Idempotency key '${key}' not found`,
    });
    return;
  }
  res.status(200).json({
    message: `Idempotency key '${key}' deleted`,
    metrics: idempotencyStore.getMetrics(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * DELETE /admin/idempotency/keys
 * Flushes the entire idempotency store.
 * Requires super-admin API key.
 */
app.delete('/admin/idempotency/keys', validateApiKey, (req: Request, res: Response) => {
  if (!hasRequiredApiKeyRole(req, 'super-admin')) {
    res.status(403).json({
      error: 'Forbidden',
      status: 403,
      message: 'Super-admin role is required to flush the idempotency store',
    });
    return;
  }
  if (isDryRunRequest(req)) {
    const keys = idempotencyStore.inspectKeys();
    res.status(200).json({
      dryRun: true,
      message: 'Idempotency store flush dry-run preview',
      wouldFlush: true,
      keyCount: keys.length,
      metrics: idempotencyStore.getMetrics(),
      timestamp: new Date().toISOString(),
    });
    return;
  }

  idempotencyStore.clear();
  res.status(200).json({
    message: 'Idempotency store flushed',
    metrics: idempotencyStore.getMetrics(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/idempotency/metrics
 * Returns hit/conflict/eviction counters for the idempotency store.
 * Requires API key authentication.
 */
app.get('/admin/idempotency/metrics', validateApiKey, (_req: Request, res: Response) => {
  res.status(200).json({
    metrics: idempotencyStore.getMetrics(),
    timestamp: new Date().toISOString(),
  });
});

// ─── Vault Metrics Poll Cycle ────────────────────────────────────────────────

/**
 * Mock vault metrics poll cycle
 * In a real application, this would fetch data from a database or Stellar RPC
 */
const pollVaultMetrics = () => {
  // Mock data for TVL and Share Price
  const mockTvl = 1000000 + Math.random() * 100000;
  const mockSharePrice = 1.25 + Math.random() * 0.05;

  updateVaultMetrics(mockTvl, mockSharePrice);

  logger.log('info', 'Vault metrics updated in Prometheus gauges', {
    tvl: mockTvl,
    sharePrice: mockSharePrice,
  });
};

// Start poll cycle every 60 seconds (configurable)
const METRICS_POLL_INTERVAL = parseInt(process.env.METRICS_POLL_INTERVAL_MS || '60000', 10);
const metricsInterval =
  process.env.NODE_ENV === 'test'
    ? null
    : setInterval(pollVaultMetrics, METRICS_POLL_INTERVAL);

if (process.env.NODE_ENV !== 'test') {
  pollVaultMetrics(); // Initial call
}

// Start latency monitoring
latencyMonitoringService.startMonitoring();

// ─── Event Polling Service (Issue: Event Replay) ────────────────────────────
if (process.env.NODE_ENV !== 'test' && process.env.VAULT_CONTRACT_ID) {
  startEventPollingService({
    rpcUrl: process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
    contractId: process.env.VAULT_CONTRACT_ID,
    pollIntervalMs: parseInt(process.env.EVENT_POLL_INTERVAL_MS || '10000', 10),
    batchSize: parseInt(process.env.EVENT_REPLAY_BATCH_SIZE || '100', 10),
  });
}

// ─── Dependency Health Checks ────────────────────────────────────────────────

/**
 * Check cache health
 */
function getCacheHealth(): string {
  try {
    cache.set('health-check', true);
    const value = cache.get('health-check');
    return value ? 'up' : 'down';
  } catch {
    return 'down';
  }
}

function checkCacheDependency(): boolean {
  return getCacheHealth() === 'up';
}

/**
 * Check database health
 */
async function getDatabaseHealth(): Promise<{ primary: string; replica: string }> {
  try {
    return await db.getHealth();
  } catch {
    return { primary: 'down', replica: 'down' };
  }
}

async function getPrismaHealth(): Promise<'up' | 'down'> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return 'up';
  } catch {
    return 'down';
  }
}

function getPrismaConfig() {
  const config = getPrismaRuntimeConfig();
  return {
    prismaPoolSize: config.poolMax,
    prismaQueryTimeoutMs: config.queryTimeoutMs,
    prismaPoolTimeoutMs: config.poolTimeoutMs,
  };
}

/**
 * Check Stellar RPC health
 * In production, this would make actual RPC calls
 */
function getStellarRpcHealth(): string {
  try {
    // Simulate RPC availability check
    // In production: make actual call to VITE_SOROBAN_RPC_URL
    const rpcUrl = process.env.STELLAR_RPC_URL;
    if (!rpcUrl) {
      /* eslint-disable-next-line no-console */
      console.warn('STELLAR_RPC_URL not configured');
      return 'down';
    }
    // Assume up if URL is configured
    // Real implementation would make a test RPC call
    return 'up';
  } catch {
    return 'down';
  }
}

function checkStellarRpcDependency(): boolean {
  return getStellarRpcHealth() === 'up';
}

// ─── Error Handler ──────────────────────────────────────────────────────────

const errorHandler: ErrorRequestHandler = (
  err: any,
  req: CorrelationIdRequest,
  res: Response,
  _next: NextFunction,
) => {
  logger.log('error', 'Unhandled error', {
    correlationId: req.correlationId,
    traceId: getCurrentTraceId(),
    error: err.message,
    stack: nodeEnv === 'development' ? err.stack : undefined,
  });

  res.status(500).json({
    error: 'Internal Server Error',
    status: 500,
    message:
      nodeEnv === 'production'
        ? 'An unexpected error occurred'
        : err.message,
    correlationId: req.correlationId,
  });
};

app.use(errorHandler);

// ─── 404 Handler ────────────────────────────────────────────────────────────

app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    status: 404,
    path: req.path,
    message: `${req.method} ${req.path} not found`,
  });
});

// ─── Server Start ───────────────────────────────────────────────────────────

if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(port, () => {
    logger.log('info', '🚀 YieldVault Backend started', {
      port,
      environment: nodeEnv,
      logLevel,
      drainTimeout,
      cacheMetricsTtl: cacheVaultMetricsTtl,
    });
    logger.log('info', '📊 Health check: http://localhost:' + port + '/health');
    logger.log('info', '✅ Ready check: http://localhost:' + port + '/ready');
  });

  // Register graceful shutdown handler
  const shutdownHandler = new GracefulShutdownHandler(drainTimeout);
  shutdownHandler.register(server);

  // ─── APY Snapshot Scheduler (Issue #374) ────────────────────────────────────
  const stopApyScheduler = startApySnapshotScheduler();
  shutdownHandler.onShutdown(async () => {
    stopApyScheduler();
  });

  const stopMaintenanceWindowScheduler = startMaintenanceWindowScheduler();
  shutdownHandler.onShutdown(async () => {
    stopMaintenanceWindowScheduler();
  });

  // ─── Database Backup Scheduler (Issue #376) ──────────────────────────────────
  const stopDbBackupScheduler = startDbBackupScheduler();
  shutdownHandler.onShutdown(async () => {
    stopDbBackupScheduler();
  });

  // Register event polling service shutdown
  shutdownHandler.onShutdown(async () => {
    stopEventPollingService();
  });

  // Register database shutdown task
  shutdownHandler.onShutdown(async () => {
    await db.shutdown();
  });

  shutdownHandler.onShutdown(async () => {
    await prisma.$disconnect();
  });

  // Flush and shut down the OTel SDK on process exit
  shutdownHandler.onShutdown(async () => {
    await shutdownTracing();
  });
}

export default app;
