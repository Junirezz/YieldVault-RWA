// Load environment variables FIRST before any other imports
// This ensures OTEL_ENABLED is set before tracing initialization
import dotenv from 'dotenv';
dotenv.config();

// Tracing must be initialised before any other imports so auto-instrumentation
// can patch http/express/prisma before they are first required.
import { initTracing, shutdownTracing, getCurrentTraceId } from './tracing';
initTracing();

import express, { Express, Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import NodeCache from 'node-cache';
import { correlationIdMiddleware, CorrelationIdRequest } from './middleware/correlationId';
import { structuredLoggingMiddleware, logger, LogLevel } from './middleware/structuredLogging';
import { corsMiddleware } from './middleware/cors';
import { geofencingMiddleware } from './middleware/geofencing';
import { cacheMiddleware, invalidateCache, getCacheStats } from './middleware/cache';
import { validateApiKey, registerApiKey } from './middleware/apiKeyAuth';
import {
  addAddress,
  removeAddress,
  listAddresses,
  allowlistSize,
} from './middleware/allowlist';
import { GracefulShutdownHandler } from './gracefulShutdown';
import { db } from './database';
import vaultRouter from './vaultEndpoints';
import listRouter from './listEndpoints';
import referralRouter from './referralEndpoints';
import {
  register,
  httpRequestCount,
  httpResponseTime,
  activeConnections,
  updateVaultMetrics,
} from './metrics';
import { latencyMonitoringService } from './latencyMonitoring';

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
const cacheVaultMetricsTtl = parseInt(process.env.CACHE_VAULT_METRICS_TTL_MS || '60000', 10);

// Configure logger
logger.configure(logLevel);

// Health check cache to track dependency status
const cache = new NodeCache({ stdTTL: 30 });

// ─── Rate Limiting Middleware ────────────────────────────────────────────────
// Issue #145: Rate limiting per IP/user key

/**
 * Global rate limiter
 * Default: 100 requests per 15 minutes per IP
 */
const globalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  skip: (req: Request) => {
    // Skip rate limiting for health and ready checks
    return req.path === '/health' || req.path === '/ready';
  },
  handler: (req: Request, res: Response) => {
    const retryAfter = req.rateLimit?.resetTime ? Number(req.rateLimit.resetTime) : undefined;
    res.status(429).json({
      error: 'Too many requests',
      status: 429,
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter,
    });
  },
});

/**
 * API endpoint rate limiter (stricter)
 * Per-user or per-API-key rate limiting
 */
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || '60000', 10), // 1 minute
  max: parseInt(process.env.API_RATE_LIMIT_MAX_REQUESTS || '30', 10),
  keyGenerator: (req: Request) => {
    // Use API key if provided, otherwise use IP
    return req.headers['x-api-key'] as string || req.ip || 'unknown';
  },
  handler: (req: Request, res: Response) => {
    const retryAfter = req.rateLimit?.resetTime ? Number(req.rateLimit.resetTime) : undefined;
    res.status(429).json({
      error: 'API rate limit exceeded',
      status: 429,
      message: 'Too many API requests. Please try again later.',
      retryAfter,
    });
  },
});

// ─── Middleware ──────────────────────────────────────────────────────────────

app.use(express.json());

// CORS configuration (restricted origins)
app.use(corsMiddleware);

// Correlation ID must be first to inject on all requests
app.use(correlationIdMiddleware);

// Structured logging with correlation IDs
app.use(structuredLoggingMiddleware);

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

app.use(globalLimiter);

// Capture immutable admin audit records for every /admin request.
app.use('/admin', createAdminAuditMiddleware());
// ─── Geofencing (Issue #379) ─────────────────────────────────────────────────
// Applied after rate-limiting so bots from blocked countries are still rate-limited.
app.use(geofencingMiddleware);

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

// ─── API Routes (with strict rate limiting) ────────────────────────────────

/**
 * Version redirect for unversioned API routes (Issue #150)
 */
app.get('/api/vault/summary', (req: Request, res: Response) => {
  res.setHeader('deprecation', 'true');
  res.redirect(308, '/api/v1/vault/summary');
});

// ─── Auth Routes (Issue #377) ────────────────────────────────────────────────

/**
 * POST /auth/login
 * Issue 15-min access JWT + 7-day refresh token on wallet authentication.
 */
app.post('/auth/login', apiLimiter, loginHandler);

/**
 * POST /auth/refresh
 * Rotate the refresh token and issue a new access JWT.
 * Reuse of a revoked refresh token invalidates the entire session (401).
 */
app.post('/auth/refresh', apiLimiter, refreshHandler);

// Versioned API v1
const apiV1 = express.Router();
app.use('/api/v1', apiV1);

// Backward-compatible list endpoints used by existing clients/tests.
app.use('/api', listRouter);

// Mount routers to v1
apiV1.use('/vault', vaultRouter);
apiV1.use('/', listRouter);
apiV1.use('/referrals', referralRouter);

/**
 * Example protected API endpoint with caching
 * Demonstrates rate limiting per API key and response caching
 */
app.get(
  '/api/v1/vault/summary',
  apiLimiter,
  cacheMiddleware({ ttl: cacheVaultMetricsTtl }),
  (_req: Request, res: Response) => {
    // This would typically fetch data from Stellar RPC or database
    res.json({
      totalAssets: 0,
      totalShares: 0,
      apy: 0,
      timestamp: new Date().toISOString(),
    });
  },
);

app.get(
  '/api/vault/summary',
  apiLimiter,
  cacheMiddleware({ ttl: cacheVaultMetricsTtl }),
  (_req: Request, res: Response) => {
    res.setHeader('deprecation', 'true');
    res.json({
      totalAssets: 0,
      totalShares: 0,
      apy: 0,
      timestamp: new Date().toISOString(),
    });
  },
);

/**
 * GET /api/vault/metrics - Cache with configurable TTL
 */
app.get(
  '/api/vault/metrics',
  cacheMiddleware({ ttl: cacheVaultMetricsTtl }),
  (_req: Request, res: Response) => {
    res.json({
      message: 'Vault metrics',
      timestamp: new Date().toISOString(),
    });
  },
);

/**
 * GET /api/vault/apy - Cache with configurable TTL
 */
app.get(
  '/api/vault/apy',
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
 * POST /admin/cache/invalidate - Invalidate cache by pattern
 * Requires API key authentication
 */
app.post('/admin/cache/invalidate', validateApiKey, (req: Request, res: Response) => {
  const { pattern } = req.body;
  invalidateCache(pattern);
  res.json({
    message: 'Cache invalidated',
    pattern,
    stats: getCacheStats(),
  });
});

/**
 * GET /admin/cache/stats - Get cache statistics
 * Requires API key authentication
 */
app.get('/admin/cache/stats', validateApiKey, (_req: Request, res: Response) => {
  res.json({
    cache: getCacheStats(),
    timestamp: new Date().toISOString(),
  });
});

// ─── Allowlist Admin Endpoints (Issue #375) ──────────────────────────────────

/**
 * POST /admin/allowlist/add
 * Adds a wallet address to the private beta allowlist.
 * Requires API key authentication.
 * Body: { "walletAddress": "G..." }
 */
app.post('/admin/allowlist/add', validateApiKey, (req: Request, res: Response) => {
  const { walletAddress } = req.body;
  if (!walletAddress || typeof walletAddress !== 'string') {
    res.status(400).json({ error: 'Missing or invalid walletAddress in request body' });
    return;
  }
  const added = addAddress(walletAddress);
  res.status(added ? 201 : 200).json({
    message: added ? 'Wallet added to allowlist' : 'Wallet already in allowlist',
    walletAddress: walletAddress.trim().toUpperCase(),
    count: allowlistSize(),
  });
});

/**
 * DELETE /admin/allowlist/remove
 * Removes a wallet address from the private beta allowlist.
 * Requires API key authentication.
 * Body: { "walletAddress": "G..." }
 */
app.delete('/admin/allowlist/remove', validateApiKey, (req: Request, res: Response) => {
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
  res.json({
    message: 'Wallet removed from allowlist',
    walletAddress: walletAddress.trim().toUpperCase(),
    count: allowlistSize(),
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
 * POST /admin/api-keys/register - Register a new API key
 * Requires API key authentication (for boostrapping, requires special permission)
 */
app.post('/admin/api-keys/register', validateApiKey, (req: Request, res: Response) => {
  const { key } = req.body;
  if (!key) {
    res.status(400).json({ error: 'Missing key in request body' });
    return;
  }

  const hash = registerApiKey(key);
  res.json({
    message: 'API key registered',
    hash,
    created: new Date().toISOString(),
  });
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
      enabled,
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
 * PATCH /admin/webhooks/:id - update webhook endpoint
 */
app.patch('/admin/webhooks/:id', validateApiKey, (req: Request, res: Response) => {
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
app.get('/admin/webhooks', validateApiKey, (_req: Request, res: Response) => {
  res.status(200).json({
    endpoints: listWebhookEndpoints(),
    metrics: getWebhookDeliveryMetrics(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/webhooks/deliveries - list recent webhook delivery attempts
 */
app.get('/admin/webhooks/deliveries', validateApiKey, (req: Request, res: Response) => {
  const limit = parseInt(String(req.query.limit || '100'), 10);
  res.status(200).json({
    deliveries: listWebhookDeliveries(limit),
    metrics: getWebhookDeliveryMetrics(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/audit/logs - list admin activity logs
 */
app.get('/admin/audit/logs', validateApiKey, (req: Request, res: Response) => {
  const statusCode = req.query.statusCode ? parseInt(String(req.query.statusCode), 10) : undefined;
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;

  const logs = getAuditLogs({
    actor: req.query.actor ? String(req.query.actor) : undefined,
    action: req.query.action ? String(req.query.action) : undefined,
    path: req.query.path ? String(req.query.path) : undefined,
    statusCode,
    limit,
  });

  res.status(200).json({
    logs,
    metrics: getAuditLogMetrics(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/audit-logs - list admin audit entries (Issue #253)
 */
app.get('/admin/audit-logs', validateApiKey, async (req: Request, res: Response) => {
  const parseLimited = (v: unknown, fallback: number, min: number, max: number) => {
    const n = parseInt(String(v ?? ''), 10);
    return Number.isNaN(n) ? fallback : Math.min(Math.max(n, min), max);
  };
  const limit = parseLimited(req.query.limit, 50, 1, 200);
  const statusCode = req.query.statusCode
    ? parseLimited(req.query.statusCode, 0, 100, 599)
    : undefined;

  const rows = getAuditLogs({
    action: typeof req.query.action === 'string' ? req.query.action : undefined,
    actor: typeof req.query.actor === 'string' ? req.query.actor : undefined,
    statusCode,
    limit,
  });

  void recordAdminAuditLog(req, 'audit-logs.read', 200, {
    limit,
    returned: rows.length,
  });

  res.json({
    data: rows,
    meta: {
      count: rows.length,
      limit,
      timestamp: new Date().toISOString(),
    },
  });
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

// Register database shutdown task
shutdownHandler.onShutdown(async () => {
  await db.shutdown();
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
