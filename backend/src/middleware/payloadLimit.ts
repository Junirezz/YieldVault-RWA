/**
 * @file payloadLimit.ts
 * Route-tier-specific payload size middleware.
 *
 * Selects a body-size cap from the request path before parsing JSON, so stricter
 * tiers are not bypassed by a global parser. Converts Express's built-in
 * `PayloadTooLargeError` (HTTP 413) into the standard API error envelope:
 *
 *   { "error": "Payload Too Large", "status": 413, "message": "...", "limit": "<tier>" }
 *
 * ── Tiers ────────────────────────────────────────────────────────────────────
 *
 *  Tier     Env var                  Default  Applies to
 *  ─────    ──────────────────────   ───────  ──────────────────────────────────
 *  global   PAYLOAD_LIMIT_GLOBAL     1mb      All routes (last-resort baseline)
 *  auth     PAYLOAD_LIMIT_AUTH       4kb      /api/v1/auth/* routes
 *  admin    PAYLOAD_LIMIT_ADMIN      16kb     /admin/* routes
 *  writes   PAYLOAD_LIMIT_WRITES     32kb     POST /api/v1/vault/deposits,
 *                                             /withdrawals, /deposits/v2, /strategy
 */

import express, { Request, Response, NextFunction, RequestHandler, ErrorRequestHandler } from 'express';
import { sendApiError } from './apiError';

// ─── Tier Definitions ─────────────────────────────────────────────────────────

export type Tier = 'global' | 'auth' | 'admin' | 'writes';

const TIER_ENV_VARS: Record<Tier, string> = {
  global: 'PAYLOAD_LIMIT_GLOBAL',
  auth:   'PAYLOAD_LIMIT_AUTH',
  admin:  'PAYLOAD_LIMIT_ADMIN',
  writes: 'PAYLOAD_LIMIT_WRITES',
};

const TIER_DEFAULTS: Record<Tier, string> = {
  global: '1mb',
  auth:   '4kb',
  admin:  '16kb',
  writes: '32kb',
};

const VAULT_WRITE_PATH =
  /^\/api\/v1\/vault\/(?:deposits(?:\/v2)?|withdrawals|strategy)\/?$/;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolves effective byte limit for a tier.
 * Reads from the corresponding env var; falls back to the hardcoded default.
 */
export function resolveTierLimit(tier: Tier): string {
  const envVal = process.env[TIER_ENV_VARS[tier]];
  return envVal && envVal.trim() ? envVal.trim() : TIER_DEFAULTS[tier];
}

/**
 * Normalizes the request path used for tier selection (baseUrl + path).
 */
export function getNormalizedPath(req: Request): string {
  const base = req.baseUrl || '';
  const path = req.path || '/';
  let combined = `${base}${path}`.replace(/\/+/g, '/') || '/';
  if (combined.length > 1 && combined.endsWith('/')) {
    combined = combined.slice(0, -1);
  }
  return combined;
}

/**
 * Maps a request to its payload tier before the body is parsed.
 */
export function resolvePayloadTier(req: Request): Tier {
  const path = getNormalizedPath(req);
  const method = req.method.toUpperCase();

  if (path.startsWith('/admin')) {
    return 'admin';
  }

  if (path.startsWith('/api/v1/auth') || path.startsWith('/auth/')) {
    return 'auth';
  }

  if (method === 'POST' && VAULT_WRITE_PATH.test(path)) {
    return 'writes';
  }

  return 'global';
}

// ─── 413 Error Handler ────────────────────────────────────────────────────────

interface PayloadTooLargeError {
  status?: number;
  statusCode?: number;
  type?: string;
  message?: string;
}

function isPayloadTooLargeError(err: unknown): err is PayloadTooLargeError {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as Record<string, unknown>;
  return (
    candidate.status === 413 ||
    candidate.statusCode === 413 ||
    candidate.type === 'entity.too.large'
  );
}

function makePayloadErrorHandler(tier: Tier): ErrorRequestHandler {
  const limit = resolveTierLimit(tier);

  return (err: unknown, req: Request, res: Response, next: NextFunction): void => {
    if (isPayloadTooLargeError(err)) {
      sendApiError(req, res, {
        status: 413,
        code: 'PAYLOAD_TOO_LARGE',
        message: `Request body exceeds the ${limit} limit for ${tier} routes. Reduce the payload size and retry.`,
        limit,
        details: { limit, tier },
        retryable: false,
      });
      return;
    }
    next(err);
  };
}

// ─── Parser cache (one json parser per tier) ─────────────────────────────────

const parserByTier = new Map<Tier, [RequestHandler, ErrorRequestHandler]>();

function getParserPair(tier: Tier): [RequestHandler, ErrorRequestHandler] {
  let pair = parserByTier.get(tier);
  if (!pair) {
    pair = createBodyParser(tier);
    parserByTier.set(tier, pair);
  }
  return pair;
}

/** Clears cached parsers (for tests that change env limits). */
export function clearPayloadParserCache(): void {
  parserByTier.clear();
}

// ─── Public Factory ───────────────────────────────────────────────────────────

/**
 * Creates a [jsonParser, errorHandler] middleware pair for the specified tier.
 */
export function createBodyParser(tier: Tier): [RequestHandler, ErrorRequestHandler] {
  const limit = resolveTierLimit(tier);
  const jsonParser: RequestHandler = express.json({ limit });
  const errorHandler = makePayloadErrorHandler(tier);
  return [jsonParser, errorHandler];
}

/**
 * Route-aware JSON body parser: picks auth/admin/writes/global tier from the
 * request path, then parses with that tier's limit and consistent 413 envelope.
 */
export function tieredJsonBodyParser(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const tier = resolvePayloadTier(req);
    const [parser, errorHandler] = getParserPair(tier);
    parser(req, res, (err: unknown) => {
      if (err) {
        errorHandler(err, req, res, next);
        return;
      }
      next();
    });
  };
}
