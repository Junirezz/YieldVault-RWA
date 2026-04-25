import { Request, Response, NextFunction } from 'express';
import cors, { CorsOptions } from 'cors';
import { logger } from './structuredLogging';

/**
 * CORS Configuration Middleware
 * 
 * Restricts cross-origin access to the API to only trusted frontend origins in production.
 * Supports an explicit allowlist of origins via environment variables.
 */

const getCORSOrigins = (): (string | RegExp)[] => {
  const envOrigins = process.env.CORS_ALLOWED_ORIGINS;
  
  if (!envOrigins) {
    // In development, allow localhost by default if no origins are specified
    if (process.env.NODE_ENV !== 'production') {
      return [/http:\/\/localhost:\d+/];
    }
    return [];
  }

  return envOrigins.split(',').map(origin => {
    const trimmed = origin.trim();
    // Support regex patterns if origin is wrapped in / /
    if (trimmed.startsWith('/') && trimmed.endsWith('/')) {
      return new RegExp(trimmed.slice(1, -1));
    }
    return trimmed;
  });
};

const allowedOrigins = getCORSOrigins();

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      return callback(null, true);
    }

    const isAllowed = allowedOrigins.some(allowed => {
      if (allowed instanceof RegExp) {
        return allowed.test(origin);
      }
      return allowed === origin;
    });

    if (isAllowed) {
      callback(null, true);
    } else {
      logger.log('warn', 'CORS request blocked from unauthorized origin', { origin });
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-api-key', 'x-idempotency-key', 'x-correlation-id'],
  optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
};

/**
 * Custom CORS middleware wrapper to handle rejection with 403
 */
export const corsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  cors(corsOptions)(req, res, (err) => {
    if (err) {
      return res.status(403).json({
        error: 'Forbidden',
        status: 403,
        message: 'CORS policy: This origin is not allowed access.',
      });
    }
    next();
  });
};
