import { NextFunction, Request, Response } from 'express';
import { logger } from './structuredLogging';
import { redisClientManager } from '../rateLimiter';
import { adaptiveThrottleBlockCount } from '../metrics';
import type { Redis } from 'ioredis';

interface AbuseState {
  score: number;
  blockedUntil: number;
  lastSeenAt: number;
}

// In-memory fallback store
const abuseByIp = new Map<string, AbuseState>();

const HALFLIFE_MS = parseInt(process.env.ADAPTIVE_THROTTLE_HALFLIFE_MS || '300000', 10);
const BASE_BLOCK_MS = parseInt(process.env.ADAPTIVE_THROTTLE_BASE_BLOCK_MS || '15000', 10);
const SCORE_THRESHOLD = parseFloat(process.env.ADAPTIVE_THROTTLE_SCORE_THRESHOLD || '6');
const MAX_BLOCK_MS = parseInt(process.env.ADAPTIVE_THROTTLE_MAX_BLOCK_MS || '300000', 10);

// Redis-backed abuse store
class RedisAbuseStore {
  private redis: Redis | null;
  private keyPrefix = 'throttle:';

  constructor() {
    this.redis = redisClientManager.getClient();
    if (!this.redis) {
      console.log(
        JSON.stringify({
          level: 'warn',
          event: 'adaptive_throttle_fallback',
          message: 'REDIS_URL not set; adaptive throttle using in-memory store',
        })
      );
    }
  }

  private buildKey(ip: string): string {
    return `${this.keyPrefix}${ip}`;
  }

  async get(ip: string): Promise<AbuseState | null> {
    if (!this.redis || !redisClientManager.isReady()) {
      return abuseByIp.get(ip) || null;
    }

    try {
      const key = this.buildKey(ip);
      const data = await this.redis.get(key);
      if (!data) return null;
      return JSON.parse(data) as AbuseState;
    } catch (err) {
      logger.log('error', 'Redis get error in adaptive throttle', {
        error: err instanceof Error ? err.message : String(err),
      });
      return abuseByIp.get(ip) || null;
    }
  }

  async set(ip: string, state: AbuseState): Promise<void> {
    if (!this.redis || !redisClientManager.isReady()) {
      abuseByIp.set(ip, state);
      return;
    }

    try {
      const key = this.buildKey(ip);
      const ttlMs = Math.max(state.blockedUntil - Date.now(), HALFLIFE_MS);
      await this.redis.set(key, JSON.stringify(state), 'PX', ttlMs);
      // Also store in memory as fallback
      abuseByIp.set(ip, state);
    } catch (err) {
      logger.log('error', 'Redis set error in adaptive throttle', {
        error: err instanceof Error ? err.message : String(err),
      });
      abuseByIp.set(ip, state);
    }
  }

  isUsingRedis(): boolean {
    return this.redis !== null && redisClientManager.isReady();
  }
}

const abuseStore = new RedisAbuseStore();

function getIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || 'unknown';
}

function decayScore(score: number, elapsedMs: number): number {
  if (elapsedMs <= 0) {
    return score;
  }
  const decayFactor = Math.pow(0.5, elapsedMs / Math.max(1000, HALFLIFE_MS));
  return score * decayFactor;
}

function scoreForStatus(statusCode: number): number {
  if (statusCode === 401 || statusCode === 403) return 1.5;
  if (statusCode === 404) return 0.5;
  if (statusCode >= 400 && statusCode < 500) return 1;
  return 0;
}

export function adaptiveThrottleMiddleware(req: Request, res: Response, next: NextFunction): void {
  const ip = getIp(req);
  const now = Date.now();

  // Use async IIFE to handle Redis operations
  void (async () => {
    const existing = await abuseStore.get(ip);

    if (existing) {
      existing.score = decayScore(existing.score, now - existing.lastSeenAt);
      existing.lastSeenAt = now;

      if (existing.blockedUntil > now) {
        const retryAfter = Math.ceil((existing.blockedUntil - now) / 1000);
        res.setHeader('Retry-After', retryAfter);
        res.status(429).json({
          error: 'Too many invalid requests',
          status: 429,
          code: 'ADAPTIVE_THROTTLE',
          message: 'Adaptive throttle activated due to repeated invalid requests.',
          retryable: true,
          retryAfter,
          retryAfterSeconds: retryAfter,
        });
        return;
      }
    }

    res.on('finish', () => {
      void (async () => {
        if (res.statusCode < 400 || res.statusCode >= 500) {
          return;
        }

        const state = (await abuseStore.get(ip)) || {
          score: 0,
          blockedUntil: 0,
          lastSeenAt: now,
        };

        const current = Date.now();
        state.score = decayScore(state.score, current - state.lastSeenAt);
        state.lastSeenAt = current;
        state.score += scoreForStatus(res.statusCode);

        if (state.score >= SCORE_THRESHOLD) {
          const multiplier = Math.max(1, Math.floor(state.score / SCORE_THRESHOLD));
          const blockMs = Math.min(MAX_BLOCK_MS, BASE_BLOCK_MS * multiplier);
          state.blockedUntil = current + blockMs;

          adaptiveThrottleBlockCount.inc({ using_redis: String(abuseStore.isUsingRedis()) });

          logger.log('warn', 'Adaptive throttle triggered', {
            ip,
            score: Number(state.score.toFixed(2)),
            blockMs,
            path: req.path,
            usingRedis: abuseStore.isUsingRedis(),
          });
        }

        await abuseStore.set(ip, state);
      })();
    });

    next();
  })();
}

export function resetAdaptiveThrottleStateForTests(): void {
  abuseByIp.clear();
}
