import express, { Express, Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import NodeCache from 'node-cache';
import dotenv from 'dotenv';
import { correlationIdMiddleware, CorrelationIdRequest } from './middleware/correlationId';
import { structuredLoggingMiddleware, logger, LogLevel } from './middleware/structuredLogging';
import { cacheMiddleware, invalidateCache, getCacheStats } from './middleware/cache';
import { validateApiKey, registerApiKey } from './middleware/apiKeyAuth';
import { GracefulShutdownHandler } from './gracefulShutdown';

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

dotenv.config();

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
    res.status(429).json({
      error: 'Too many requests',
      status: 429,
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter: req.rateLimit?.resetTime,
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
    res.status(429).json({
      error: 'API rate limit exceeded',
      status: 429,
      message: 'Too many API requests. Please try again later.',
      retryAfter: req.rateLimit?.resetTime,
    });
  },
});

// ─── Middleware ──────────────────────────────────────────────────────────────

app.use(express.json());

// Correlation ID must be first to inject on all requests
app.use(correlationIdMiddleware);

// Structured logging with correlation IDs
app.use(structuredLoggingMiddleware);

app.use(globalLimiter);

// ─── Health Check Endpoints (Issue #148) ────────────────────────────────────

/**
 * GET /health
 * Returns immediately with service health status
 * Includes critical dependencies health (Stellar RPC, database, cache)
 * 
 * Response: 200 OK or 503 Service Unavailable
 */
app.get('/health', (_req: Request, res: Response) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: nodeEnv,
    checks: {
      api: 'up',
      cache: getCacheHealth(),
      stellarRpc: getStellarRpcHealth(),
    },
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
app.get('/ready', (_req: Request, res: Response) => {
  const readiness = {
    ready: true,
    timestamp: new Date().toISOString(),
    dependencies: {
      cache: checkCacheDependency(),
      stellarRpc: checkStellarRpcDependency(),
    },
  };

  // Service is ready only if all critical dependencies are available
  const isReady =
    readiness.dependencies.cache &&
    readiness.dependencies.stellarRpc;

  readiness.ready = isReady;

  res.status(isReady ? 200 : 503).json(readiness);
});

// ─── API Routes (with strict rate limiting) ────────────────────────────────

/**
 * Example protected API endpoint with caching
 * Demonstrates rate limiting per API key and response caching
 */
app.get(
  '/api/vault/summary',
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

export default app;
