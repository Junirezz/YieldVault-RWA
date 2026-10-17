// Load environment variables FIRST before any other imports
// This ensures OTEL_ENABLED is set before tracing initialization
import dotenv from 'dotenv';
dotenv.config();

// Tracing must be initialised before any other imports so auto-instrumentation
// can patch http/express/prisma before they are first required.
import { initTracing, shutdownTracing, getCurrentTraceId } from './tracing';
initTracing();

import express, { Express, Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { loginHandler, nonceHandler, refreshHandler, requireAuth, revokeAccessToken, revokeAllAccessTokens, revokeCurrentSession, revokeAllSessions } from './auth';
import vaultListRouter from './routes/vaults';
import { loginHandler, nonceHandler, refreshHandler, requireAuth } from './auth';
import {
  authLimiter,
  authIpLimiter,
  authUserLimiter,
  writesLimiter,
  readsLimiter,
  adminLimiter,
  identityRateLimiter,
  getRateLimitMonitorSnapshot,
  loadConfig as loadRateLimiterConfig,
} from './rateLimiter';
import { createAdminAuditMiddleware } from './auditLog';
import { getActorFromRequest } from './adminConfigChangeAudit';
import { startApySnapshotScheduler } from './apySnapshot';
import { startDbBackupScheduler } from './dbBackupJob';
import { startPositionReconciliationScheduler, startLedgerReconciliationScheduler } from './positionReconciliationJob';
import { initializeJobGovernance } from './jobGovernance';
import { setupSwagger } from './swagger';
import { sorobanCircuitBreaker } from './circuitBreaker';
import { correlationIdMiddleware, CorrelationIdRequest } from './middleware/correlationId';
import { structuredLoggingMiddleware, logger, LogLevel } from './middleware/structuredLogging';
import {
  errorHandler,
  notFoundHandler,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  InternalError,
  RateLimitError,
} from './errors';
import { corsMiddleware } from './middleware/cors';
import { geofencingMiddleware } from './middleware/geofencing';
import { registerInvalidationHook } from './middleware/cache';
import { invalidateVaultCaches } from './vaultDataCache';
import { redisCacheClient } from './redisCache';
import { validate, LoginSchema, NonceRequestSchema, RefreshSchema } from './middleware/validate';
import { tieredJsonBodyParser } from './middleware/payloadLimit';
import { requireSignedWalletAction } from './middleware/walletSignedAction';
import { timeoutMiddleware } from './middleware/timeoutMiddleware';
import { adaptiveThrottleMiddleware } from './middleware/adaptiveThrottle';
import { validateApiKey } from './middleware/apiKeyAuth';
import { adminRbacMiddleware } from './middleware/rbac';
import { apiVersionMiddleware } from './middleware/versionNegotiation';
import { versionRoutingMiddleware } from './middleware/versionRouting';
import { createVersionDiscoveryRouter } from './routes/apiVersions';
import { GracefulShutdownHandler } from './gracefulShutdown';
import { db } from './database';
import vaultRouter from './vaultEndpoints';
import vaultsListRouter from './routes/vaults';
import walletAliasRouter from './walletAliasEndpoints';
import { walletAliasMappingService } from './walletAliasService';
import transactionRouter from './transactionEndpoints';
import { buildTransactionsResponse } from './listEndpoints';
import listRouter from './listEndpoints';
import referralRouter from './referralEndpoints';
import auditLogRouter from './auditLogEndpoints';
import {
  register,
  httpRequestCount,
  httpResponseTime,
  httpRequestErrorCount,
  activeConnections,
  updateVaultMetrics,
  syncJobGovernanceMetrics,
  rateLimitEvents,
  httpErrorCount,
  httpClientErrorCount,
} from './metrics';
import { latencyMonitoringService } from './latencyMonitoring';
import { listEndpointSlaRegistry } from './endpointSlaRegistry';
import { getEventPollingHealth, startEventPollingService, stopEventPollingService } from './eventPollingService';
import { eventOutboxService } from './eventOutbox';
import { prisma } from './prisma';
import { initializeWebhookEndpoints, WEBHOOK_SCHEMA_VERSION } from './webhookDelivery';
import { healthProbeService } from './healthProbe';
import { withdrawalRecoveryCoordinator } from './withdrawalRecovery';
import { maintenanceModeMiddleware } from './maintenanceMode';
import { buildMaintenanceStatusPayload, startMaintenanceWindowScheduler } from './maintenanceWindow';
import { getJobHealthStatus } from './jobGovernance';
import {
  reconciliationReportHandler,
  automatedReconciliationSummaryHandler,
} from './reconciliationReport';
import { diagnosticsBundleHandler } from './diagnosticsBundle';
import { errorBoundaryMiddleware } from './middleware/errorBoundary';
import { apiErrorContractMiddleware, sendApiError } from './middleware/apiError';
import { startIdempotencyRetentionScheduler } from './idempotencyRetention';
import vaultRoutes from './routes/vault';
import transactionRoutes from './routes/transactions';
import webhookRoutes, { apiV1WebhookRoutes } from './routes/webhooks';
import exportRoutes from './routes/exports';
import adminRoutes from './routes/admin';
import { cache } from './routes/shared';

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

// Configure logger
logger.configure(logLevel);

// Coordinates SIGTERM/SIGINT: stops new requests immediately, drains
// in-flight ones, then runs DB/job cleanup — see onShutdown registrations
// near the bottom of this file.
const shutdownHandler = new GracefulShutdownHandler(drainTimeout);

void walletAliasMappingService.loadFromDatabase().catch((error) => {
  logger.log('error', 'Failed to warm wallet alias cache', {
    error: error instanceof Error ? error.message : String(error),
  });
});

// â”€â”€â”€ Rate Limiting Middleware â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Issue #455: Use the Redis-backed limiter factory from rateLimiter.ts.
//
// Three pre-built instances are imported from rateLimiter.ts:
//   depositsLimiter â€“ stricter limits for write-heavy deposit/withdrawal routes
//   summaryLimiter  â€“ relaxed limits for read-only summary/metrics routes
//   defaultLimiter  â€“ fallback for all other API routes
//
// All instances use fail-open behaviour: when Redis is configured but
// unreachable the `skip` function returns true so requests are processed
// normally. When Redis is not configured an in-memory store is used.
//
// Rate-limit policy information (RateLimit-* headers) and Retry-After are
// included in all 429 responses by the handlers in rateLimiter.ts.

// â”€â”€â”€ Middleware â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

app.use(tieredJsonBodyParser());

// CORS configuration (restricted origins)
app.use(corsMiddleware);

// Correlation ID must be first to inject on all requests
app.use(correlationIdMiddleware);
app.use(apiErrorContractMiddleware);

// Structured logging with correlation IDs
app.use(structuredLoggingMiddleware);

// API version routing, negotiation & deprecation headers
app.use(versionRoutingMiddleware);
app.use(apiVersionMiddleware);

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
    if (res.statusCode >= 400) {
      httpRequestErrorCount.inc({
        ...labels,
        status_class: `${Math.floor(res.statusCode / 100)}xx`,
      });
    }
    if (res.statusCode === 429) {
      rateLimitEvents.inc({ tier: req.apiVersion ?? 'global', outcome: 'limited' });
    }

    // Track error rates for alerting (5xx = critical, 4xx = client error).
    if (res.statusCode >= 500) {
      httpErrorCount.inc(labels);
    } else if (res.statusCode >= 400) {
      httpClientErrorCount.inc(labels);
    }

    // Record latency for SLO monitoring (only track successful requests)
    if (res.statusCode < 400) {
      latencyMonitoringService.recordLatency(route, durationMs);
    }
  });

  next();
});

// ─── Shutdown Gate ───────────────────────────────────────────────────────────
// Once SIGTERM/SIGINT starts a drain, reject new requests with 503 instead of
// routing them — the health check stays exempt so liveness probes keep seeing
// 200 until the process actually exits.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (shutdownHandler.isShuttingDown() && req.path !== '/health') {
    res.set('Retry-After', '10');
    res.status(503).json({
      error: 'Service Unavailable',
      status: 503,
      code: 'SHUTTING_DOWN',
      message: 'Server is shutting down and not accepting new requests',
      retryable: true,
    });
    return;
  }
  next();
});

// Apply the Redis-backed default limiter (reads tier) globally (skip health/ready probes).
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === '/health' || req.path === '/ready') return next();
  return identityRateLimiter(req, res, (err?: unknown) => {
    if (err) return next(err as Error);
    if (res.headersSent) return;
    return readsLimiter(req, res, next);
  });
});
app.use(adaptiveThrottleMiddleware);

// Capture immutable admin audit records for every /admin request.
// Apply admin-tier rate limiting to all /admin endpoints.
app.use('/admin', adminLimiter, createAdminAuditMiddleware());
// â”€â”€â”€ Geofencing (Issue #379) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Applied after rate-limiting so bots from blocked countries are still rate-limited.
app.use(geofencingMiddleware);

// â”€â”€â”€ Maintenance Mode Gate (Issue #481) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Blocks mutating routes (POST/PUT/PATCH/DELETE) when maintenance mode is active.
// Health, ready, metrics, and /admin/maintenance routes are always bypassed.
app.use(maintenanceModeMiddleware);

// â”€â”€â”€ Health Check Endpoints (Issue #148) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * GET /metrics
 * Exposes Prometheus metrics for operational monitoring
 */
app.get('/metrics', async (_req: Request, res: Response) => {
  try {
    syncJobGovernanceMetrics();
    latencyMonitoringService.syncSloMetrics();
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
 * GET /admin/sla/registry
 * Returns the canonical endpoint SLA / latency budget registry for monitoring and alerts.
 */
app.get('/admin/sla/registry', validateApiKey, (_req: Request, res: Response) => {
  res.json({
    endpoints: listEndpointSlaRegistry(),
    generatedAt: new Date().toISOString(),
  });
});

/**
 * GET /admin/rate-limits
 * Rate-limit monitoring snapshot: allowed vs limited counts by tier.
 */
app.get('/admin/rate-limits', validateApiKey, (_req: Request, res: Response) => {
  const cfg = loadRateLimiterConfig();
  res.json({
    snapshot: getRateLimitMonitorSnapshot(),
    tiers: {
      auth: cfg.auth,
      writes: cfg.writes,
      reads: cfg.reads,
      admin: cfg.admin,
      deposits: cfg.deposits,
      ip: cfg.ip,
      apiKey: cfg.apiKey,
    },
    headers: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After'],
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
  const indexerHealth = getEventPollingHealth();
  const circuitSnapshot = sorobanCircuitBreaker.toHealthSnapshot();
  const lastIndexedLedger = await (async () => {
    try {
      const cursor = await prisma.eventCursor.findUnique({ where: { id: 1 } });
      return cursor?.lastLedgerSeq ?? 0;
    } catch {
      return 0;
    }
  })();

  const health = {
    status: 'healthy' as 'healthy' | 'degraded' | 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: nodeEnv,
    lastIndexedLedger,
    checks: {
      api: 'up',
      cache: getCacheHealth(),
      stellarRpc: getStellarRpcHealth(),
      databasePrimary: dbHealth.primary,
      databaseReplica: dbHealth.replica,
      prisma: prismaHealth,
      jobs: getJobHealthStatus(),
      indexer: indexerHealth.status,
    },
    sorobanCircuitBreaker: circuitSnapshot,
  };

  // 'degraded' is acceptable for cache (in-memory fallback active); only 'down' is unhealthy
  const allHealthy = Object.entries(health.checks).every(([key, check]) => {
    if (key === 'cache') return check === 'up' || check === 'degraded';
    return check === 'up';
  });

  const anyOperational = Object.values(health.checks).some((check) => check === 'up' || check === 'degraded');
  health.status = allHealthy ? 'healthy' : anyOperational ? 'degraded' : 'unhealthy';

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
      indexer: getEventPollingHealth().status === 'up',
    },
  };

  // Service is ready only if all critical dependencies are available
  const isReady =
    readiness.dependencies.cache &&
    readiness.dependencies.stellarRpc &&
    readiness.dependencies.database &&
    readiness.dependencies.prisma &&
    readiness.dependencies.indexer;

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

// Enable Swagger UI documentation
setupSwagger(app);

// â”€â”€â”€ Versioned API v1 Router â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const apiV1 = express.Router();
app.use('/api/v1', apiV1);
app.use('/api', createVersionDiscoveryRouter());

// Mount routers under /api/v1
apiV1.use('/vault', vaultRouter);
apiV1.use('/vaults', vaultsListRouter);
apiV1.use('/vaults', vaultListRouter);
apiV1.use('/wallet-aliases', walletAliasRouter);
apiV1.use('/referrals', referralRouter);
apiV1.use('/transactions', transactionRouter);
apiV1.use('/audit-logs', auditLogRouter);
apiV1.use('/', listRouter);

// Register vault data cache invalidation hooks
registerInvalidationHook(invalidateVaultCaches);

// Backward compatibility for legacy unversioned list routes (/api/*)
app.use('/api', listRouter);
app.use('/api/vaults', vaultListRouter);
app.use('/vaults', vaultListRouter);

// â”€â”€â”€ Auth Routes (Issue #377) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Canonical versioned auth endpoints

/**
 * POST /api/v1/auth/login
 * Issue 15-min access JWT + 7-day refresh token on wallet authentication.
 */
apiV1.post('/auth/nonce', authIpLimiter, authLimiter, authUserLimiter, validate({ body: NonceRequestSchema }), nonceHandler);
apiV1.post('/auth/login', authIpLimiter, authLimiter, authUserLimiter, validate({ body: LoginSchema }), requireSignedWalletAction('login'), loginHandler);

/**
 * POST /api/v1/auth/refresh
 * Rotate the refresh token and issue a new access JWT.
 */
apiV1.post('/auth/refresh', authIpLimiter, authLimiter, authUserLimiter, validate({ body: RefreshSchema }), refreshHandler);

// Webhook registration on /api/v1 (src/routes/webhooks.ts).
apiV1.use(apiV1WebhookRoutes);

// Admin routes share API-key authentication and role-based authorization.
app.use('/admin', validateApiKey, adminRbacMiddleware);

/**
 * POST /api/v1/auth/logout
 *
 * Revokes the presented access token (`jti`) on the revocation list, so the
 * very next request with it is rejected 401 `TOKEN_REVOKED` (Issue #1431).
 * When a `refreshToken` is also supplied the whole refresh family is revoked,
 * so the session cannot be resurrected by rotation.
 */
apiV1.post('/auth/logout', readsLimiter, requireAuth, async (req: Request, res: Response) => {
  const authReq = req as import('./auth').AuthenticatedRequest;
  const payload = authReq.jwtPayload;
  const walletAddress = payload?.sub;

  if (!payload || !walletAddress) {
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: 'Unable to determine authenticated wallet',
    });
    return;
  }

  try {
    await revokeAccessToken(payload, 'logout');

    const refreshToken =
      typeof (req.body as { refreshToken?: unknown } | undefined)?.refreshToken === 'string'
        ? ((req.body as { refreshToken: string }).refreshToken)
        : undefined;
    if (refreshToken) {
      await revokeCurrentSession(refreshToken);
    }

    res.status(200).json({
      message: 'Session revoked successfully',
      walletAddress: walletAddress.slice(0, 8) + '…',
      revokedAccessToken: true,
      refreshSessionRevoked: Boolean(refreshToken),
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
 *
 * Revokes every access token currently issued to the wallet by writing a
 * wallet-wide high-water mark, so tokens minted before now stop working even
 * though we hold no list of them (Issue #1431). Also revokes all refresh
 * families for the wallet.
 */
apiV1.post('/auth/logout-all', readsLimiter, requireAuth, async (req: Request, res: Response) => {
  const authReq = req as import('./auth').AuthenticatedRequest;
  const walletAddress = authReq.jwtPayload?.sub;

  if (!walletAddress) {
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: 'Unable to determine authenticated wallet',
    });
    return;
  }

  try {
    const revokedAccessTokens = await revokeAllAccessTokens(walletAddress, 'logout');
    const revokedRefreshTokens = await revokeAllSessions(walletAddress);

    res.status(200).json({
      message: 'All sessions revoked successfully',
      walletAddress: walletAddress.slice(0, 8) + '…',
      revokedCount: revokedRefreshTokens,
      revokedAccessTokens,
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

// â”€â”€â”€ Backward-compatibility redirects (301) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Backward-compatibility redirects for list/router-mounted paths â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Generic catch-all redirects for unversioned /vault/*, /referrals/*,
// /transactions/*, /portfolio/* paths â†’ /api/v1 equivalents.
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

// ─── Feature routers (src/routes/, issue #1545) ─────────────────────────────
// Mounted where these routes were previously registered, after the legacy
// redirects above, so request handling order is unchanged.
app.use(vaultRoutes);
app.use(transactionRoutes);
app.use(webhookRoutes);
app.use(exportRoutes);
app.use(adminRoutes);

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
  void initializeWebhookEndpoints();
}

// Start latency monitoring
latencyMonitoringService.startMonitoring();

// â”€â”€â”€ Event Polling Service (Issue: Event Replay) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if (process.env.NODE_ENV !== 'test' && process.env.VAULT_CONTRACT_ID) {
  startEventPollingService({
    rpcUrl: process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
    contractId: process.env.VAULT_CONTRACT_ID,
    pollIntervalMs: parseInt(process.env.EVENT_POLL_INTERVAL_MS || '10000', 10),
    batchSize: parseInt(process.env.EVENT_REPLAY_BATCH_SIZE || '100', 10),
  });

  // stopEventPollingService() is a no-op if the service was never started,
  // so this is safe to register unconditionally alongside the block above.
  shutdownHandler.onShutdown(async () => {
    stopEventPollingService();
  });
}

// â”€â”€â”€ Outbox Pattern Processor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Starts the background outbox event relay processor.
// Writes from vault operations go to the EventOutbox table atomically;
// this processor reads them and delivers via the webhook system.
if (process.env.NODE_ENV !== 'test') {
  eventOutboxService.replayOnStartup().catch((err) => {
    logger.log('error', 'Outbox startup replay failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
  eventOutboxService.start();

  // Register graceful shutdown for the outbox processor so pending events
  // are not abandoned when the process receives a termination signal.
  // Runs only after in-flight HTTP requests have drained (see
  // GracefulShutdownHandler), so it can't race a request still writing to
  // the outbox.
  shutdownHandler.onShutdown(async () => {
    eventOutboxService.stop();
  });
  const shutdownController = new AbortController();
  const shutdownSignal = shutdownController.signal;
  eventOutboxService.start({ signal: shutdownSignal });

  // Register graceful shutdown for the outbox processor: abort in-flight work
  // and wait for the poller to drain before the process tears down resources.
  const stopOutbox = () => {
    shutdownController.abort();
    void eventOutboxService.stop();
  };
  process.on('SIGTERM', stopOutbox);
  process.on('SIGINT', stopOutbox);
}


// â”€â”€â”€ Dependency Health Checks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Check cache health.
 * Tests the in-memory NodeCache first; also probes Redis when configured.
 * Returns 'up' when the primary store is healthy (Redis or memory).
 */
function getCacheHealth(): string {
  try {
    cache.set('health-check', true);
    const value = cache.get('health-check');
    if (!value) return 'down';

    // If Redis is configured, surface its connection status as well
    if (redisCacheClient.isConfigured && !redisCacheClient.isReady) {
      // Redis configured but not yet connected → degraded, memory cache still up
      return 'degraded';
    }

    return 'up';
  } catch {
    return 'down';
  }
}

function checkCacheDependency(): boolean {
  const health = getCacheHealth();
  // 'degraded' means memory fallback is active — service is still operational
  return health === 'up' || health === 'degraded';
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

// â”€â”€â”€ Health Probe Registration (Issue #719) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
healthProbeService.register('database', async () => {
  const health = await getDatabaseHealth();
  return health.primary === 'up' ? 'up' : 'down';
});
healthProbeService.register('cache', async () => {
  return getCacheHealth() as 'up' | 'down';
});
healthProbeService.register('stellarRpc', async () => {
  return getStellarRpcHealth() as 'up' | 'down';
});
healthProbeService.register('prisma', async () => {
  return await getPrismaHealth();
});
healthProbeService.register('queue', async () => {
  return getJobHealthStatus() === 'up' ? 'up' : 'down';
});
healthProbeService.register('indexer', async () => {
  return getEventPollingHealth().status === 'up' ? 'up' : 'down';
});

/**
 * GET /health/probes
 * Returns per-dependency probe states with latency and last-error details.
 * Issue #719: Health probe decomposition.
 */
app.get('/health/probes', async (_req: Request, res: Response) => {
  const probes = await healthProbeService.checkAll();
  const allHealthy = Object.values(probes).every((p) => p.status === 'up');

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    probes,
    timestamp: new Date().toISOString(),
  });
});

// Resume partially failed withdrawals in the background. Disabled under test so
// suites drive the sweeper explicitly.
if (process.env.NODE_ENV !== 'test') {
  withdrawalRecoveryCoordinator.startSweeper();

  // Initialize job governance from persisted dead-letter records
  void initializeJobGovernance();
}

// Normalize dependency and unhandled application failures before the 404 route.
app.use(errorBoundaryMiddleware);
app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const status =
    typeof err === 'object' && err !== null && 'statusCode' in err &&
    typeof (err as { statusCode?: unknown }).statusCode === 'number'
      ? (err as { statusCode: number }).statusCode
      : 500;

  sendApiError(req, res, {
    status: status >= 400 && status < 600 ? status : 500,
    code: status >= 400 && status < 500 ? 'REQUEST_ERROR' : 'INTERNAL_ERROR',
    message:
      status >= 500
        ? 'An unexpected server error occurred. Please retry shortly.'
        : err instanceof Error
          ? err.message
          : 'The request could not be completed.',
    retryable: status >= 500,
  });
});

// Catch-all 404 handler. Must be the last middleware registered so it only
// fires for requests no route above matched, instead of Express's default
// plain-text/HTML 404 page.
app.use((req: Request, res: Response) => {
  sendApiError(req, res, {
    status: 404,
    code: 'ROUTE_NOT_FOUND',
    message: `Cannot ${req.method} ${req.originalUrl}`,
    // `path` is also surfaced at the top level because that is where the
    // documented not-found envelope puts it; `details.path` stays for callers
    // that already read the field from there.
    path: req.originalUrl,
    details: { path: req.originalUrl },
    retryable: false,
  });
});

// â”€â”€â”€ Server Startup & Graceful Shutdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Tests import `app` directly via supertest and never bind a real port.
if (process.env.NODE_ENV !== 'test') {
  // Disconnect Prisma last, after the HTTP listener has finished draining
  // in-flight requests (see GracefulShutdownHandler) — this is what stops a
  // termination signal from severing an open prisma.vault.update transaction
  // mid-commit and leaving a row locked for the next deploy's migration.
  shutdownHandler.onShutdown(async () => {
    await prisma.$disconnect();
  });

  const server = app.listen(port, () => {
    logger.log('info', `Server listening on port ${port}`);
  });
  shutdownHandler.register(server);
}

// Exported for tests: lets the shutdown-gate middleware behavior be verified
// without sending a real process signal (which would also tear down other
// suites' background jobs sharing this module in the Jest worker).
export { shutdownHandler };
export default app;
