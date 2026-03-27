import express, { Express, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import NodeCache from 'node-cache';
import dotenv from 'dotenv';

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 3000;
const nodeEnv = process.env.NODE_ENV || 'development';

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
app.use(globalLimiter);

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`
    );
  });
  next();
});

// ─── Health Check Endpoints (Issue #148) ────────────────────────────────────

/**
 * GET /health
 * Returns immediately with service health status
 * Includes critical dependencies health (Stellar RPC, database, cache)
 * 
 * Response: 200 OK or 503 Service Unavailable
 */
app.get('/health', (req: Request, res: Response) => {
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
app.get('/ready', (req: Request, res: Response) => {
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
 * Example protected API endpoint
 * Demonstrates rate limiting per API key
 */
app.get('/api/vault/summary', apiLimiter, (req: Request, res: Response) => {
  // This would typically fetch data from Stellar RPC or database
  res.json({
    totalAssets: 0,
    totalShares: 0,
    apy: 0,
    timestamp: new Date().toISOString(),
  });
});

// ─── Dependency Health Checks ────────────────────────────────────────────────

/**
 * Check cache health
 */
function getCacheHealth(): string {
  try {
    const keys = cache.keys();
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

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    status: 500,
    message:
      nodeEnv === 'production'
        ? 'An unexpected error occurred'
        : err.message,
  });
});

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
  console.log(`🚀 YieldVault Backend listening on port ${port}`);
  console.log(`📊 Health check: http://localhost:${port}/health`);
  console.log(`✅ Ready check: http://localhost:${port}/ready`);
  console.log(`🌍 Environment: ${nodeEnv}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;
