/**
 * @file rateLimiter.ts
 * Rate limiting middleware for API endpoints.
 */

import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';

/**
 * API endpoint rate limiter (stricter)
 * Per-user or per-API-key rate limiting
 */
export const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || '60000', 10), // 1 minute
  max: parseInt(process.env.API_RATE_LIMIT_MAX_REQUESTS || '30', 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    // Use API key if provided, otherwise use IP
    return req.headers['x-api-key'] as string || req.ip || 'unknown';
  },
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      error: 'API rate limit exceeded',
      status: 429,
      message: 'Too many API requests. Please try again later.',
    });
  },
});
