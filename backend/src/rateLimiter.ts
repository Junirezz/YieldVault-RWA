/**
 * @file rateLimiter.ts
 * Redis-backed rate limiting middleware for API endpoints.
 *
 * Provides per-endpoint, per-wallet-address rate limiting with fail-open
 * behaviour when Redis is unavailable.
 */

import rateLimit, { RateLimitRequestHandler, Options } from 'express-rate-limit';
import { Request, Response, RequestHandler } from 'express';
import { Redis } from 'ioredis';
import RedisStore from 'rate-limit-redis';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EndpointLimiterConfig {
  /** Route prefix used as Redis key prefix, e.g. '/api/v1/vault/deposits' */
  routePrefix: string;
  /** Maximum requests per window */
  max: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

interface RateLimiterConfig {
  deposits: { max: number; windowMs: number };
  summary: { max: number; windowMs: number };
  default: { max: number; windowMs: number };
}

// ─── Config Loader ───────────────────────────────────────────────────────────

/**
 * Reads rate-limit configuration from environment variables.
 * Falls back to compiled-in defaults when variables are absent or non-numeric.
 */
export function loadConfig(): RateLimiterConfig {
  const parseEnv = (key: string, defaultValue: number): number => {
    const raw = process.env[key];
    if (raw === undefined || raw === '') return defaultValue;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  };

  return {
    deposits: {
      max: parseEnv('DEPOSITS_RATE_LIMIT_MAX', 10),
      windowMs: parseEnv('DEPOSITS_RATE_LIMIT_WINDOW_MS', 60000),
    },
    summary: {
      max: parseEnv('SUMMARY_RATE_LIMIT_MAX', 30),
      windowMs: parseEnv('SUMMARY_RATE_LIMIT_WINDOW_MS', 60000),
    },
    default: {
      max: parseEnv('API_RATE_LIMIT_MAX_REQUESTS', 30),
      windowMs: parseEnv('API_RATE_LIMIT_WINDOW_MS', 60000),
    },
  };
}

// ─── Redis Client Manager ────────────────────────────────────────────────────

/**
 * Singleton that manages the ioredis client lifecycle.
 * Emits structured log messages on connection events.
 * Exposes isReady() for fail-open checks.
 */
class RedisClientManager {
  private client: Redis | null = null;
  private redisAvailable: boolean = false;

  constructor() {
    const redisUrl = process.env.REDIS_URL;

    if (!redisUrl) {
      console.log(
        JSON.stringify({
          level: 'warn',
          event: 'redis_not_configured',
          message: 'REDIS_URL not set; using in-memory rate limit store',
        })
      );
      return;
    }

    this.client = new Redis(redisUrl, { lazyConnect: true });

    const parsed = new URL(redisUrl);
    const host = parsed.hostname;
    const port = parseInt(parsed.port || '6379', 10);

    this.client.on('connect', () => {
      this.redisAvailable = true;
      console.log(
        JSON.stringify({ level: 'info', event: 'redis_connected', host, port })
      );
    });

    this.client.on('reconnecting', () => {
      console.log(
        JSON.stringify({ level: 'info', event: 'redis_reconnecting', host, port })
      );
    });

    this.client.on('error', (err: Error) => {
      this.redisAvailable = false;
      console.log(
        JSON.stringify({
          level: 'error',
          event: 'redis_error',
          host,
          port,
          reason: err.message,
        })
      );
    });
  }

  isReady(): boolean {
    return this.redisAvailable;
  }

  getClient(): Redis | null {
    return this.client;
  }
}

export const redisClientManager = new RedisClientManager();

// ─── Wallet Address Masking ──────────────────────────────────────────────────

/**
 * Truncates a wallet address for safe logging.
 * In production: shows first 4 + '...' + last 4 chars.
 * In other environments: returns the full address.
 */
export function maskWalletAddress(addr: string): string {
  if (process.env.NODE_ENV === 'production' && addr.length > 8) {
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
  }
  return addr;
}

// ─── Key Extraction ──────────────────────────────────────────────────────────

/**
 * Extracts the rate-limit key from a request.
 * Priority: walletAddress (body) → x-wallet-address (header) → x-api-key (header) → IP → 'unknown'
 */
export function extractRateLimitKey(req: Request): string {
  if (req.body?.walletAddress) {
    return req.body.walletAddress as string;
  }

  const walletHeader = req.headers['x-wallet-address'];
  if (walletHeader) {
    return Array.isArray(walletHeader) ? walletHeader[0] : walletHeader;
  }

  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    return Array.isArray(apiKey) ? apiKey[0] : apiKey;
  }

  if (req.ip) {
    return req.ip;
  }

  return 'unknown';
}

// ─── Redis Key Builder ───────────────────────────────────────────────────────

/**
 * Constructs the Redis key for a given route prefix and identifier.
 * Format: `rl:{routePrefix}:{identifier}`
 */
export function buildRedisKey(routePrefix: string, identifier: string): string {
  return `rl:${routePrefix}:${identifier}`;
}

// ─── Limiter Factory ─────────────────────────────────────────────────────────

/**
 * Creates an express-rate-limit middleware instance.
 * Uses Redis store when available; falls back to in-memory store otherwise.
 * Fail-open: skips enforcement when Redis was configured but is currently unreachable.
 */
export function createLimiter(config: EndpointLimiterConfig): RequestHandler {
  const client = redisClientManager.getClient();
  const usingRedis = client !== null;

  const store = usingRedis
    ? new RedisStore({
        sendCommand: (...args: string[]) => client.call(...args) as Promise<unknown>,
        prefix: `rl:${config.routePrefix}:`,
      })
    : undefined;

  const options: Partial<Options> = {
    windowMs: config.windowMs,
    max: config.max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => extractRateLimitKey(req),
    skip: (_req: Request) => {
      // Fail-open: bypass enforcement when Redis was configured but is unavailable
      if (usingRedis && !redisClientManager.isReady()) {
        return true;
      }
      return false;
    },
    handler: (req: Request, res: Response) => {
      const key = extractRateLimitKey(req);
      const resetHeader = res.getHeader('RateLimit-Reset');
      const resetTime =
        typeof resetHeader === 'string' || typeof resetHeader === 'number'
          ? Number(resetHeader)
          : Math.floor((Date.now() + config.windowMs) / 1000);
      const now = Math.floor(Date.now() / 1000);
      const retryAfter = Math.max(0, resetTime - now);

      res.setHeader('Retry-After', retryAfter);

      console.log(
        JSON.stringify({
          level: 'warn',
          event: 'rate_limited',
          key: maskWalletAddress(key),
          path: req.path,
          resetTime,
        })
      );

      res.status(429).json({
        error: 'Rate limit exceeded',
        status: 429,
        message: `Too many requests. Please try again in ${retryAfter} seconds.`,
        retryAfter,
      });
    },
  };

  if (store) {
    options.store = store;
  }

  return rateLimit(options) as RateLimitRequestHandler;
}

// ─── Pre-built Limiter Instances ─────────────────────────────────────────────

const config = loadConfig();

export const depositsLimiter: RequestHandler = createLimiter({
  routePrefix: '/api/v1/vault/deposits',
  max: config.deposits.max,
  windowMs: config.deposits.windowMs,
});

export const summaryLimiter: RequestHandler = createLimiter({
  routePrefix: '/api/v1/vault/summary',
  max: config.summary.max,
  windowMs: config.summary.windowMs,
});

export const defaultLimiter: RequestHandler = createLimiter({
  routePrefix: '/api/v1',
  max: config.default.max,
  windowMs: config.default.windowMs,
});

/** Backward-compatibility alias */
export const apiLimiter = defaultLimiter;
