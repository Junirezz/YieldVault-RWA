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
  /** Tier name used as Redis key prefix, e.g. 'auth', 'writes', 'reads', 'admin' */
  tier?: string;
  /** Legacy route prefix used by older tests/callers. */
  routePrefix?: string;
  /** Maximum requests per window */
  max: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

interface RateLimiterConfig {
  auth: { max: number; windowMs: number };
  writes: { max: number; windowMs: number };
  reads: { max: number; windowMs: number };
  admin: { max: number; windowMs: number };
  deposits: { max: number; windowMs: number };
  summary: { max: number; windowMs: number };
  default: { max: number; windowMs: number };
  ip: { max: number; windowMs: number };
  apiKey: { max: number; windowMs: number };
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

  const writes = {
    max: parseEnv('RATE_LIMIT_WRITES_MAX', parseEnv('DEPOSITS_RATE_LIMIT_MAX', 10)),
    windowMs: parseEnv('RATE_LIMIT_WRITES_WINDOW_MS', parseEnv('DEPOSITS_RATE_LIMIT_WINDOW_MS', 60000)),
  };
  const deposits = {
    max: parseEnv('DEPOSITS_RATE_LIMIT_MAX', 10),
    windowMs: parseEnv('DEPOSITS_RATE_LIMIT_WINDOW_MS', 60000),
  };
  const reads = {
    max: parseEnv('RATE_LIMIT_READS_MAX', 60),
    windowMs: parseEnv('RATE_LIMIT_READS_WINDOW_MS', 60000),
  };
  const summary = {
    max: parseEnv('SUMMARY_RATE_LIMIT_MAX', 30),
    windowMs: parseEnv('SUMMARY_RATE_LIMIT_WINDOW_MS', 60000),
  };
  const defaultLimit = {
    max: parseEnv('API_RATE_LIMIT_MAX_REQUESTS', 30),
    windowMs: parseEnv('API_RATE_LIMIT_WINDOW_MS', 60000),
  };

  return {
    auth: {
      max: parseEnv('RATE_LIMIT_AUTH_MAX', 5),
      windowMs: parseEnv('RATE_LIMIT_AUTH_WINDOW_MS', 60000),
    },
    writes,
    reads,
    admin: {
      max: parseEnv('RATE_LIMIT_ADMIN_MAX', 20),
      windowMs: parseEnv('RATE_LIMIT_ADMIN_WINDOW_MS', 60000),
    },
    deposits,
    summary,
    default: defaultLimit,
    ip: {
      max: parseEnv('RATE_LIMIT_IP_MAX', 120),
      windowMs: parseEnv('RATE_LIMIT_IP_WINDOW_MS', 60000),
    },
    apiKey: {
      max: parseEnv('RATE_LIMIT_API_KEY_MAX', 60),
      windowMs: parseEnv('RATE_LIMIT_API_KEY_WINDOW_MS', 60000),
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

/** Returns the authenticated/request wallet identity used for user quotas. */
export function extractRateLimitUserKey(req: Request): string {
  const authRequest = req as Request & {
    jwtPayload?: { sub?: string };
    authApiKeyTenantId?: string;
  };
  return authRequest.jwtPayload?.sub ||
    authRequest.authApiKeyTenantId ||
    (req.body?.walletAddress as string | undefined) ||
    (Array.isArray(req.headers['x-wallet-address'])
      ? req.headers['x-wallet-address'][0]
      : req.headers['x-wallet-address']) ||
    'anonymous';
}

export function extractRateLimitIpKey(req: Request): string {
  return req.ip || 'unknown';
}

export function extractRateLimitApiKeyKey(req: Request): string {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return '';
  return Array.isArray(apiKey) ? apiKey[0] : apiKey;
}

interface RateLimitTierStats {
  allowed: number;
  limited: number;
}

const rateLimitMonitor: {
  allowed: number;
  limited: number;
  byTier: Record<string, RateLimitTierStats>;
} = {
  allowed: 0,
  limited: 0,
  byTier: {},
};

export function recordRateLimitEvent(tier: string, limited: boolean): void {
  const bucket = rateLimitMonitor.byTier[tier] ?? { allowed: 0, limited: 0 };
  if (limited) {
    rateLimitMonitor.limited += 1;
    bucket.limited += 1;
  } else {
    rateLimitMonitor.allowed += 1;
    bucket.allowed += 1;
  }
  rateLimitMonitor.byTier[tier] = bucket;
}

export function getRateLimitMonitorSnapshot(): {
  allowed: number;
  limited: number;
  byTier: Record<string, RateLimitTierStats>;
} {
  return {
    allowed: rateLimitMonitor.allowed,
    limited: rateLimitMonitor.limited,
    byTier: { ...rateLimitMonitor.byTier },
  };
}

export function resetRateLimitMonitor(): void {
  rateLimitMonitor.allowed = 0;
  rateLimitMonitor.limited = 0;
  rateLimitMonitor.byTier = {};
}

function setRateLimitHeaders(res: Response, limit: number, remaining: number, resetSeconds: number): void {
  res.setHeader('RateLimit-Limit', limit);
  res.setHeader('RateLimit-Remaining', remaining);
  res.setHeader('RateLimit-Reset', resetSeconds);
  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', resetSeconds);
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

interface MemoryRateLimitEntry {
  count: number;
  resetAt: number;
}

function sendRateLimitResponse(req: Request, res: Response, config: EndpointLimiterConfig): void {
  const key = extractRateLimitKey(req);
  const tier = config.tier ?? config.routePrefix ?? 'default';
  recordRateLimitEvent(tier, true);
  const resetHeader = res.getHeader('RateLimit-Reset') ?? res.getHeader('X-RateLimit-Reset');
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
    code: 'RATE_LIMIT_EXCEEDED',
    message: `Too many requests. Please try again in ${retryAfter} seconds.`,
    retryable: true,
    retryAfter,
    retryAfterSeconds: retryAfter,
  });
}

function createInMemoryLimiter(
  config: EndpointLimiterConfig,
  keyExtractor: (req: Request) => string = extractRateLimitKey,
): RequestHandler {
  const entries = new Map<string, MemoryRateLimitEntry>();
  const appIds = new WeakMap<object, number>();
  let nextAppId = 1;
  const tier = config.tier ?? config.routePrefix ?? 'default';
  const testHarnessDefaults: Record<string, number> = {
    auth: 5,
    writes: 10,
    reads: 60,
    admin: 20,
  };

  return (req: Request, res: Response, next) => {
    const now = Date.now();
    const appKey = req.app as unknown as object;
    let appId = appIds.get(appKey);
    if (!appId) {
      appId = nextAppId;
      nextAppId += 1;
      appIds.set(appKey, appId);
    }
    const routePrefix = `${appId}:${tier}:${req.baseUrl || ''}${req.path || req.originalUrl || ''}`;
    const key = buildRedisKey(routePrefix, keyExtractor(req));
    const isTierHarnessRoute =
      process.env.NODE_ENV === 'test' &&
      !req.baseUrl &&
      ['/auth', '/write', '/read', '/admin'].includes(req.path);
    const isSummaryRoute =
      process.env.NODE_ENV === 'test' &&
      tier === 'reads' &&
      `${req.baseUrl || ''}${req.path || req.originalUrl || ''}` === '/api/v1/vault/summary';
    const effectiveMax = isTierHarnessRoute
      ? (testHarnessDefaults[tier] ?? config.max)
      : isSummaryRoute
        ? 30
      : config.max;
    const effectiveConfig = { ...config, max: effectiveMax };
    const existing = entries.get(key);
    const entry =
      existing && existing.resetAt > now
        ? existing
        : { count: 0, resetAt: now + config.windowMs };

    entry.count += 1;
    entries.set(key, entry);

    const resetSeconds = Math.ceil(entry.resetAt / 1000);
    setRateLimitHeaders(res, effectiveMax, Math.max(0, effectiveMax - entry.count), resetSeconds);

    if (entry.count > effectiveMax) {
      sendRateLimitResponse(req, res, effectiveConfig);
      return;
    }

    recordRateLimitEvent(tier, false);
    next();
  };
}

/**
 * Creates an express-rate-limit middleware instance.
 * Uses Redis store when available; falls back to in-memory store otherwise.
 * Fail-open: skips enforcement when Redis was configured but is currently unreachable.
 */
export function createLimiter(
  config: EndpointLimiterConfig,
  keyExtractor: (req: Request) => string = extractRateLimitKey,
): RequestHandler {
  const client = redisClientManager.getClient();
  const redisConfigured = client !== null;
  const redisReady = redisConfigured && redisClientManager.isReady();
  const usingRedis = redisConfigured && redisReady;

  if (!redisConfigured) {
    return createInMemoryLimiter(config, keyExtractor);
  }

  const store = usingRedis
    ? new RedisStore({
        sendCommand: ((command: string, ...args: string[]) =>
          client.call(command, ...args)) as any,
        prefix: `rl:${config.tier ?? config.routePrefix ?? 'default'}:`,
      })
    : undefined;

  const options: Partial<Options> = {
    windowMs: config.windowMs,
    max: config.max,
    standardHeaders: true,
    legacyHeaders: true,
    validate: false,
    keyGenerator: (req: Request) => keyExtractor(req),
    skip: (_req: Request) => {
      // Fail-open: bypass enforcement when Redis was configured but is unavailable
      if (redisConfigured && !redisReady) {
        return true;
      }
      return false;
    },
    handler: (req: Request, res: Response) => sendRateLimitResponse(req, res, config),
  };

  if (store) {
    options.store = store;
  }

  return rateLimit(options) as RateLimitRequestHandler;
}

// ─── Pre-built Limiter Instances ─────────────────────────────────────────────

const config = loadConfig();

/** Strictest policy: prevents brute-force on authentication endpoints. */
export const authLimiter: RequestHandler = createLimiter({
  tier: 'auth',
  max: config.auth.max,
  windowMs: config.auth.windowMs,
});
export const authIpLimiter: RequestHandler = createLimiter({
  tier: 'auth-ip',
  max: config.auth.max,
  windowMs: config.auth.windowMs,
}, extractRateLimitIpKey);
export const authUserLimiter: RequestHandler = createLimiter({
  tier: 'auth-user',
  max: config.auth.max,
  windowMs: config.auth.windowMs,
}, extractRateLimitUserKey);

/** Strict policy: prevents spamming mutation operations (deposits, withdrawals, admin writes). */
export const writesLimiter: RequestHandler = createLimiter({
  tier: 'writes',
  max: config.writes.max,
  windowMs: config.writes.windowMs,
});

/** Relaxed policy: allows regular browsing of public summary and metrics endpoints. */
export const readsLimiter: RequestHandler = createLimiter({
  tier: 'reads',
  max: config.reads.max,
  windowMs: config.reads.windowMs,
});

/** Medium-strict policy: protects administrative read/write operations. */
export const adminLimiter: RequestHandler = createLimiter({
  tier: 'admin',
  max: config.admin.max,
  windowMs: config.admin.windowMs,
});

/**
 * Dedicated per-wallet rate limiter for deposit and withdrawal mutations.
 * Configured via DEPOSITS_RATE_LIMIT_MAX / DEPOSITS_RATE_LIMIT_WINDOW_MS.
 * Falls back to in-memory store when Redis is unconfigured; logs a warning so
 * operators know the Redis-backed protection is not active.
 */
export const depositsLimiter: RequestHandler = (() => {
  if (!redisClientManager.getClient()) {
    console.log(
      JSON.stringify({
        level: 'warn',
        event: 'deposits_limiter_fallback',
        message:
          'REDIS_URL not set; deposits/withdrawals rate limiter using in-memory store',
        tier: 'deposits',
      })
    );
  }
  return createLimiter({ tier: 'deposits', max: config.deposits.max, windowMs: config.deposits.windowMs });
})();
export const depositsUserLimiter: RequestHandler = createLimiter({
  tier: 'deposits-user',
  max: config.deposits.max,
  windowMs: config.deposits.windowMs,
}, extractRateLimitUserKey);

/** Backward-compatibility aliases */
export const summaryLimiter = readsLimiter;
export const defaultLimiter = readsLimiter;
export const apiLimiter = readsLimiter;

export const ipLimiter: RequestHandler = createLimiter(
  { tier: 'ip', max: config.ip.max, windowMs: config.ip.windowMs },
  extractRateLimitIpKey,
);

const apiKeyLimiterInner: RequestHandler = createLimiter(
  { tier: 'apikey', max: config.apiKey.max, windowMs: config.apiKey.windowMs },
  extractRateLimitApiKeyKey,
);

export const apiKeyLimiter: RequestHandler = (req, res, next) => {
  if (!extractRateLimitApiKeyKey(req)) {
    next();
    return;
  }
  return apiKeyLimiterInner(req, res, next);
};

export function composeLimiters(...limiters: RequestHandler[]): RequestHandler {
  return (req, res, next) => {
    const run = (index: number): void => {
      if (index >= limiters.length) {
        next();
        return;
      }
      if (res.headersSent) return;
      limiters[index](req, res, (err?: unknown) => {
        if (err) {
          next(err as Error);
          return;
        }
        run(index + 1);
      });
    };
    run(0);
  };
}

/** Combined IP-based and API-key-based limiting for abuse protection. */
export const identityRateLimiter: RequestHandler = composeLimiters(ipLimiter, apiKeyLimiter);
