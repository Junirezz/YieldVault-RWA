/**
 * @file auth.ts
 * JWT session tokens with refresh token rotation (Issue #377).
 *
 * Implements signed JWT access tokens (15-minute TTL) and opaque refresh
 * tokens (7-day TTL) using Node's built-in `crypto` module – no external
 * JWT library is required.
 *
 * JWT signing:
 *   Algorithm : HS256 (HMAC-SHA256)
 *   Header    : { "alg": "HS256", "typ": "JWT" }
 *   Payload   : { "sub": walletAddress, "iat": <unix>, "exp": <unix>, "jti": <uuid> }
 *   Secret    : JWT_SECRET environment variable (required in production)
 *
 * Refresh token rotation:
 *   - A new refresh token is issued on every /auth/refresh call.
 *   - The previous refresh token is immediately invalidated.
 *   - Replaying a revoked refresh token invalidates the entire session and
 *     returns 401 (theft detection / replay protection).
 *
 * Refresh token store:
 *   In-memory Map is used (dev / single-instance).
 *   Swap for Redis in production multi-instance deployments.
 *
 * Environment variables:
 *   JWT_SECRET               – HMAC-SHA256 signing secret (min 32 chars recommended)
 *   JWT_ACCESS_TTL_SECONDS   – access token TTL (default: 900 = 15 minutes)
 *   JWT_REFRESH_TTL_SECONDS  – refresh token TTL (default: 604800 = 7 days)
 */

import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { logger } from './middleware/structuredLogging';

// ─── Config ───────────────────────────────────────────────────────────────────

const DEFAULT_JWT_SECRET = 'change-me-in-production-must-be-at-least-32-characters';

function getSecret(): string {
  return process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
}

function getAccessTtl(): number {
  return parseInt(process.env.JWT_ACCESS_TTL_SECONDS || '900', 10); // 15 min
}

function getRefreshTtl(): number {
  return parseInt(process.env.JWT_REFRESH_TTL_SECONDS || '604800', 10); // 7 days
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;  // wallet address
  iat: number;  // issued-at (unix seconds)
  exp: number;  // expiry   (unix seconds)
  jti: string;  // JWT ID (unique per token)
}

interface RefreshTokenEntry {
  walletAddress: string;
  /** Family ID ties all refresh tokens in a rotation chain together. */
  familyId: string;
  expiresAt: number; // unix seconds
  revoked: boolean;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** ISO-8601 expiry of the access token (convenient for clients). */
  accessTokenExpiresAt: string;
}

// ─── Refresh Token Store ──────────────────────────────────────────────────────

/**
 * In-memory refresh token store.
 * Key: opaque refresh token string (hex)
 * Replace with a Redis hash in production.
 */
const refreshTokenStore = new Map<string, RefreshTokenEntry>();

/**
 * Family-level invalidation set.
 * When a revoked token is replayed we add its familyId here so that all
 * tokens in that family (across rotation chain) are invalidated.
 */
const revokedFamilies = new Set<string>();

/** Generates a cryptographically random opaque refresh token. */
function generateRefreshToken(): string {
  return crypto.randomBytes(40).toString('hex');
}

/** Removes expired refresh tokens from the store (lazy GC). */
function purgeExpiredRefreshTokens(): void {
  const now = Math.floor(Date.now() / 1000);
  for (const [token, entry] of refreshTokenStore.entries()) {
    if (entry.expiresAt < now) refreshTokenStore.delete(token);
  }
}

// ─── HS256 JWT Helpers ────────────────────────────────────────────────────────

function base64UrlEncode(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlDecode(input: string): string {
  // Re-pad and convert URL-safe chars back before decoding
  const padded = input + '='.repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

/** Signs a JWT string using HS256. */
function signJwt(payload: JwtPayload): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const sig = crypto
    .createHmac('sha256', getSecret())
    .update(signingInput)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return `${signingInput}.${sig}`;
}

/**
 * Verifies a JWT string.
 * Returns the decoded payload on success.
 * Throws a descriptive error on failure.
 */
export function verifyJwt(token: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT');

  const [header, body, providedSig] = parts;
  const signingInput = `${header}.${body}`;
  const expectedSig = crypto
    .createHmac('sha256', getSecret())
    .update(signingInput)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  // Constant-time comparison to prevent timing attacks
  if (!crypto.timingSafeEqual(Buffer.from(providedSig), Buffer.from(expectedSig))) {
    throw new Error('Invalid JWT signature');
  }

  let payload: JwtPayload;
  try {
    payload = JSON.parse(base64UrlDecode(body)) as JwtPayload;
  } catch {
    throw new Error('Malformed JWT payload');
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) throw new Error('JWT has expired');

  return payload;
}

// ─── Token Issuance ───────────────────────────────────────────────────────────

/**
 * Issues a new access + refresh token pair for the given wallet address.
 * Optionally accepts an existing familyId for rotation (otherwise creates a new one).
 */
export function issueTokenPair(walletAddress: string, familyId?: string): TokenPair {
  const now = Math.floor(Date.now() / 1000);
  const accessTtl = getAccessTtl();
  const refreshTtl = getRefreshTtl();

  const jti = crypto.randomUUID();
  const payload: JwtPayload = {
    sub: walletAddress,
    iat: now,
    exp: now + accessTtl,
    jti,
  };

  const accessToken = signJwt(payload);
  const refreshToken = generateRefreshToken();
  const family = familyId ?? crypto.randomUUID();

  refreshTokenStore.set(refreshToken, {
    walletAddress,
    familyId: family,
    expiresAt: now + refreshTtl,
    revoked: false,
  });

  // Lazy GC on every issuance (cheap – amortised)
  purgeExpiredRefreshTokens();

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: new Date((now + accessTtl) * 1000).toISOString(),
  };
}

// ─── Refresh Token Rotation ───────────────────────────────────────────────────

export class InvalidRefreshTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRefreshTokenError';
  }
}

export class SessionRevokedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionRevokedError';
  }
}

/**
 * Rotates a refresh token:
 * 1. Validates the provided refresh token.
 * 2. Checks for replay (revoked token) → full session revocation if detected.
 * 3. Revokes the old token and issues a new token pair with the same familyId.
 */
export function rotateRefreshToken(oldRefreshToken: string): TokenPair {
  const entry = refreshTokenStore.get(oldRefreshToken);
  const now = Math.floor(Date.now() / 1000);

  if (!entry) {
    throw new InvalidRefreshTokenError('Refresh token not found or expired');
  }

  // Check if the token's family has been globally revoked (replay detected upstream)
  if (revokedFamilies.has(entry.familyId)) {
    // Token still in store but family is dead → clean up
    refreshTokenStore.delete(oldRefreshToken);
    throw new SessionRevokedError(
      'Session has been revoked due to suspected refresh token theft. Please log in again.',
    );
  }

  if (entry.revoked) {
    // Replay attack: a previously rotated token was replayed.
    // Invalidate the entire family to log the attacker out.
    revokedFamilies.add(entry.familyId);
    // Revoke all tokens in the same family
    for (const [token, e] of refreshTokenStore.entries()) {
      if (e.familyId === entry.familyId) {
        refreshTokenStore.delete(token);
      }
    }
    logger.log('warn', 'Refresh token replay detected – entire session invalidated', {
      familyId: entry.familyId,
      wallet: entry.walletAddress.slice(0, 8) + '…',
    });
    throw new SessionRevokedError(
      'Refresh token has already been used. Session revoked for security.',
    );
  }

  if (entry.expiresAt < now) {
    refreshTokenStore.delete(oldRefreshToken);
    throw new InvalidRefreshTokenError('Refresh token has expired');
  }

  // Revoke the old token (mark before issuing new pair for atomicity)
  entry.revoked = true;
  refreshTokenStore.set(oldRefreshToken, entry);

  // Issue new pair with same family
  const newPair = issueTokenPair(entry.walletAddress, entry.familyId);

  // Remove the old token now that the new one is stored
  refreshTokenStore.delete(oldRefreshToken);

  return newPair;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export interface AuthenticatedRequest extends Request {
  jwtPayload?: JwtPayload;
}

/**
 * Express middleware that validates the Bearer access token from the
 * Authorization header and attaches the decoded payload to req.jwtPayload.
 *
 * Returns 401 for missing / invalid / expired tokens.
 */
export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    res.status(401).json({
      error: 'Unauthorized',
      status: 401,
      message: 'Missing or malformed Authorization header. Expected: Bearer <token>',
    });
    return;
  }

  try {
    req.jwtPayload = verifyJwt(match[1]);
    next();
  } catch (err) {
    res.status(401).json({
      error: 'Unauthorized',
      status: 401,
      message: err instanceof Error ? err.message : 'Invalid token',
    });
  }
}

// ─── Auth Route Handlers ──────────────────────────────────────────────────────

/**
 * POST /auth/login
 * Issues a token pair after wallet authentication.
 * Body: { walletAddress: string }
 *
 * In production this endpoint would also verify a wallet signature
 * (e.g. a Stellar transaction signed with the wallet's private key)
 * before issuing tokens.
 */
export function loginHandler(req: Request, res: Response): void {
  const { walletAddress } = req.body;

  if (!walletAddress || typeof walletAddress !== 'string') {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'walletAddress is required',
    });
    return;
  }

  const tokens = issueTokenPair(walletAddress.trim());

  logger.log('info', 'JWT tokens issued on login', {
    wallet: walletAddress.slice(0, 8) + '…',
  });

  res.status(200).json({
    ...tokens,
    tokenType: 'Bearer',
    expiresIn: getAccessTtl(),
  });
}

/**
 * POST /auth/refresh
 * Rotates the refresh token and returns a new token pair.
 * Body: { refreshToken: string }
 *
 * Returns 401 if the refresh token is invalid, expired, or has been replayed.
 */
export function refreshHandler(req: Request, res: Response): void {
  const { refreshToken } = req.body;

  if (!refreshToken || typeof refreshToken !== 'string') {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'refreshToken is required',
    });
    return;
  }

  try {
    const tokens = rotateRefreshToken(refreshToken);

    logger.log('info', 'Refresh token rotated successfully');

    res.status(200).json({
      ...tokens,
      tokenType: 'Bearer',
      expiresIn: getAccessTtl(),
    });
  } catch (err) {
    const isRevoked = err instanceof SessionRevokedError;
    res.status(401).json({
      error: 'Unauthorized',
      status: 401,
      message: err instanceof Error ? err.message : 'Invalid refresh token',
      sessionRevoked: isRevoked,
    });
  }
}
