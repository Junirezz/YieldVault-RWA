import express, { Express, Request, Response, NextFunction } from 'express';
import NodeCache from 'node-cache';
import dotenv from 'dotenv';
import listEndpoints from './listEndpoints';
import { apiLimiter } from './rateLimiter';
import {
  buildIdempotencyFingerprint,
  idempotencyStore,
  IdempotencyConflictError,
} from './idempotency';
import { getJobHealthStatus, getJobMetrics } from './jobGovernance';

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 3000;
const nodeEnv = process.env.NODE_ENV || 'development';

// Health check cache to track dependency status
const cache = new NodeCache({ stdTTL: 30 });

// ─── Middleware ──────────────────────────────────────────────────────────────

app.use(express.json());

app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/v1')) {
    next();
    return;
  }

  const redirectedPath = req.originalUrl.replace(/^\/api(?!\/v1)/, '/api/v1');
  res.setHeader('Deprecation', 'true');
  res.setHeader(
    'Sunset',
    new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toUTCString()
  );
  res.setHeader('Link', `<${redirectedPath}>; rel="alternate"`);
  res.redirect(308, redirectedPath);
});

app.use('/api/v1', (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-API-Version', 'v1');
  next();
});

app.use('/api/v1', apiLimiter);

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
      jobs: getJobHealthStatus(),
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
 * Example protected API endpoint
 * Demonstrates rate limiting per API key
 */
app.get('/api/v1/vault/summary', (_req: Request, res: Response) => {
  // This would typically fetch data from Stellar RPC or database
  res.json({
    totalAssets: 0,
    totalShares: 0,
    apy: 0,
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/v1/vault/deposits', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const idempotencyKey = getIdempotencyKey(req);
    if (!idempotencyKey) {
      res.status(400).json({
        error: 'Missing Idempotency Key',
        status: 400,
        message: 'Provide x-idempotency-key for mutation requests.',
      });
      return;
    }

    const depositRequest = normalizeDepositRequest(req.body);
    if (!depositRequest.valid) {
      res.status(400).json({
        error: 'Invalid request body',
        status: 400,
        message: depositRequest.message,
      });
      return;
    }

    const fingerprint = buildIdempotencyFingerprint(depositRequest.value);
    const { result, replayed } = await idempotencyStore.execute(
      idempotencyKey,
      fingerprint,
      async () => ({
        statusCode: 201,
        body: {
          depositId: `dep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          status: 'queued',
          receivedAt: new Date().toISOString(),
          ...depositRequest.value,
        },
      })
    );

    res.setHeader('Idempotency-Key', idempotencyKey);
    res.setHeader('Idempotency-Status', replayed ? 'replayed' : 'created');
    res.status(result.statusCode).json(result.body);
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      res.status(409).json({
        error: 'Idempotency conflict',
        status: 409,
        message: error.message,
      });
      return;
    }

    next(error);
  }
});

app.get('/api/v1/ops/job-metrics', (_req: Request, res: Response) => {
  res.json({
    timestamp: new Date().toISOString(),
    ...getJobMetrics(),
  });
});

// ─── List Endpoints with Pagination ─────────────────────────────────────────

app.use('/api/v1', listEndpoints);

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
    const rpcUrl = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
    if (!rpcUrl) {
      return 'down';
    }
    // Assume up if a URL is configured
    // Real implementation would make a test RPC call
    return 'up';
  } catch {
    return 'down';
  }
}

function checkStellarRpcDependency(): boolean {
  return getStellarRpcHealth() === 'up';
}

interface DepositRequest {
  amount: number;
  asset: string;
  walletAddress: string;
}

function getIdempotencyKey(req: Request): string | undefined {
  const key = req.header('x-idempotency-key');
  return key?.trim() || undefined;
}

function normalizeDepositRequest(body: unknown):
  | { valid: true; value: DepositRequest }
  | { valid: false; message: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, message: 'Request body must be a JSON object.' };
  }

  const payload = body as Record<string, unknown>;
  const amount = typeof payload.amount === 'number' ? payload.amount : Number(payload.amount);
  const asset = typeof payload.asset === 'string' ? payload.asset.trim() : '';
  const walletAddress =
    typeof payload.walletAddress === 'string' ? payload.walletAddress.trim() : '';

  if (!Number.isFinite(amount) || amount <= 0) {
    return { valid: false, message: 'amount must be a positive number.' };
  }

  if (!asset) {
    return { valid: false, message: 'asset is required.' };
  }

  if (!walletAddress) {
    return { valid: false, message: 'walletAddress is required.' };
  }

  return {
    valid: true,
    value: {
      amount,
      asset,
      walletAddress,
    },
  };
}

// ─── Error Handler ──────────────────────────────────────────────────────────

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
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

// Only start server if this file is run directly (not imported as a module)
if (require.main === module) {
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
}

export default app;
