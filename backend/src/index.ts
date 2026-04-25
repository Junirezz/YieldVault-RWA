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
import { sanitizationMiddleware } from './sanitization';
import { setupSwagger } from './swagger';

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 3000;
const nodeEnv = process.env.NODE_ENV || 'development';

// Health check cache to track dependency status
const cache = new NodeCache({ stdTTL: 30 });

// ─── Middleware ──────────────────────────────────────────────────────────────

app.use(express.json({ limit: '100kb' })); // Restrict payload size
app.use(sanitizationMiddleware); // Sanitize globally

// Setup Swagger Documentation (Issue #257)
setupSwagger(app);

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
 * @openapi
 * /health:
 *   get:
 *     summary: Get service health status
 *     description: Returns immediately with service health status, including critical dependencies.
 *     tags: [Monitoring]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: "healthy" }
 *                 timestamp: { type: string, format: "date-time" }
 *                 uptime: { type: number }
 *                 environment: { type: string }
 *                 checks:
 *                   type: object
 *                   properties:
 *                     api: { type: string }
 *                     cache: { type: string }
 *                     stellarRpc: { type: string }
 *                     jobs: { type: string }
 *       503:
 *         description: Service or dependencies are unhealthy
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
 * @openapi
 * /ready:
 *   get:
 *     summary: Get service readiness status
 *     description: Returns 200 if the service is ready for traffic, checking all critical dependencies.
 *     tags: [Monitoring]
 *     responses:
 *       200:
 *         description: Service is ready
 *       503:
 *         description: Service is not ready
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
 * @openapi
 * /api/v1/vault/summary:
 *   get:
 *     summary: Get vault performance summary
 *     description: Returns high-level metrics for the vault including TVL and APY.
 *     tags: [Vault]
 *     responses:
 *       200:
 *         description: Vault summary data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalAssets: { type: number }
 *                 totalShares: { type: number }
 *                 apy: { type: number }
 *                 timestamp: { type: string, format: "date-time" }
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

/**
 * @openapi
 * /api/v1/vault/deposits:
 *   post:
 *     summary: Create a new deposit request
 *     description: Submits a deposit request to be processed by the vault.
 *     tags: [Vault]
 *     security:
 *       - IdempotencyKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DepositRequest'
 *     responses:
 *       201:
 *         description: Deposit request accepted
 *       400:
 *         description: Invalid request or missing idempotency key
 *       409:
 *         description: Idempotency conflict
 *       413:
 *         description: Payload too large
 */
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

/**
 * @openapi
 * /api/v1/ops/job-metrics:
 *   get:
 *     summary: Get background job metrics
 *     description: Returns performance and health metrics for background governance jobs.
 *     tags: [Operations]
 *     responses:
 *       200:
 *         description: Job metrics data
 */
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

/**
 * @openapi
 * components:
 *   schemas:
 *     DepositRequest:
 *       type: object
 *       required:
 *         - amount
 *         - asset
 *         - walletAddress
 *       properties:
 *         amount:
 *           type: number
 *           minimum: 0.0000001
 *           description: Amount to deposit
 *         asset:
 *           type: string
 *           description: Asset code (e.g., USDC, XLM)
 *         walletAddress:
 *           type: string
 *           description: Stellar wallet address
 */
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
  if (err.type === 'entity.too.large') {
    res.status(413).json({
      error: 'Payload Too Large',
      status: 413,
      message: 'Request payload exceeds the allowed limit',
    });
    return;
  }

  // Catch malformed JSON errors from express.json()
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'Malformed JSON payload',
    });
    return;
  }

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
