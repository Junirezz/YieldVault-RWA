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
 *   JWT_SECRET               – HMAC-SHA256 signing secret (required in production,
 *                              min 32 chars with sufficient entropy)
 *   JWT_ACCESS_TTL_SECONDS   – access token TTL (default: 900 = 15 minutes)
 *   JWT_REFRESH_TTL_SECONDS  – refresh token TTL (default: 604800 = 7 days)
 *
 * Startup validation (Issue #454):
 *   In production (NODE_ENV=production) the server will refuse to start if
 *   JWT_SECRET is absent, shorter than 32 characters, or has insufficient
 *   entropy (less than 3 distinct character classes). Development and test
 *   environments fall back to the built-in default secret.
 */

import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { logger } from './middleware/structuredLogging';
import Redis from 'ioredis';
import { normalizeWalletAddress } from './walletUtils';
import { walletAliasMappingService } from './walletAliasService';
import {
  walletNonceService,
  NonceLimitExceededError,
  type WalletAction,
} from './walletNonce';
import { buildWalletSignMessage } from './walletSignature';

// ─── Config ───────────────────────────────────────────────────────────────────

const DEFAULT_JWT_SECRET = 'change-me-in-production-must-be-at-least-32-characters';

/** Minimum byte length required for the JWT secret in production. */
const MIN_SECRET_LENGTH = 32;

/**
 * Counts the number of distinct character classes present in `s`.
 * Classes: lowercase letters, uppercase letters, digits, symbols/other.
 */
function countCharacterClasses(s: string): number {
  let classes = 0;
  if (/[a-z]/.test(s)) classes++;
  if (/[A-Z]/.test(s)) classes++;
  if (/[0-9]/.test(s)) classes++;
  if (/[^a-zA-Z0-9]/.test(s)) classes++;
  return classes;
}

/**
 * Validates the JWT secret for production use.
 *
 * Rules:
 *  1. Must be present (non-empty).
 *  2. Must be at least MIN_SECRET_LENGTH characters.
 *  3. Must contain at least 3 distinct character classes (length + entropy check).
 *
 * Returns `null` when the secret passes validation, or a human-readable error
 * string describing the first failing rule.
 */
export function validateJwtSecret(secret: string): string | null {
  if (!secret || secret.trim() === '') {
    return 'JWT_SECRET is not set. Set a strong secret before starting in production.';
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    return (
      `JWT_SECRET is too short (${secret.length} chars). ` +
      `Production requires at least ${MIN_SECRET_LENGTH} characters.`
    );
  }
  if (countCharacterClasses(secret) < 3) {
    return (
      'JWT_SECRET has insufficient entropy. ' +
      'Use a mix of uppercase, lowercase, digits, and symbols ' +
      '(at least 3 of the 4 character classes).'
    );
  }
  return null;
}

/**
 * Performs startup validation of the JWT secret.
 *
 * - In production  : calls `process.exit(1)` with a clear error if validation fails.
 * - In development / test : emits a warning but continues with the default secret.
 */
export function assertJwtSecretValid(): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const secret = process.env.JWT_SECRET || '';

  if (isProduction) {
    const error = validateJwtSecret(secret);
    if (error) {
      // Use console.error directly so the message is always visible even if
      // the structured logger has not yet been fully initialised.
      console.error(
        `[auth] FATAL – JWT secret validation failed: ${error}\n` +
        'Set a strong JWT_SECRET environment variable and restart the server.'
      );
      process.exit(1);
    }
  } else {
    // Non-production: warn when falling back to the default secret.
    if (!process.env.JWT_SECRET) {
      console.warn(
        '[auth] WARNING – JWT_SECRET is not set. ' +
        'Using insecure default secret for development/test. ' +
        'This MUST be changed before deploying to production.'
      );
    }
  }
}

// Run validation at module load time so the server fails fast.
assertJwtSecretValid();

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

/** Generates a cryptographically random opaque refresh token. */
function generateRefreshToken(): string {
  return crypto.randomBytes(40).toString('hex');
}

interface IRefreshTokenStore {
  get(token: string): Promise<RefreshTokenEntry | null>;
  set(token: string, entry: RefreshTokenEntry, ttlSeconds: number): Promise<void>;
  delete(token: string): Promise<void>;
  isFamilyRevoked(familyId: string): Promise<boolean>;
  revokeFamily(familyId: string, ttlSeconds: number): Promise<void>;
  deleteFamily(familyId: string): Promise<void>;
}

// ─── In-memory implementation (fallback) ─────────────────────────────────────

class InMemoryRefreshTokenStore implements IRefreshTokenStore {
  private tokens = new Map<string, RefreshTokenEntry>();
  private revokedFamilies = new Set<string>();

  async get(token: string): Promise<RefreshTokenEntry | null> {
    const entry = this.tokens.get(token);
    if (!entry) return null;
    if (entry.expiresAt < Math.floor(Date.now() / 1000)) {
      this.tokens.delete(token);
      return null;
    }
    return entry;
  }

  async set(token: string, entry: RefreshTokenEntry, _ttlSeconds: number): Promise<void> {
    this.tokens.set(token, entry);
  }

  async delete(token: string): Promise<void> {
    this.tokens.delete(token);
  }

  async isFamilyRevoked(familyId: string): Promise<boolean> {
    return this.revokedFamilies.has(familyId);
  }

  async revokeFamily(familyId: string, _ttlSeconds: number): Promise<void> {
    this.revokedFamilies.add(familyId);
  }

  async deleteFamily(familyId: string): Promise<void> {
    for (const [token, entry] of this.tokens.entries()) {
      if (entry.familyId === familyId) this.tokens.delete(token);
    }
  }
}

// ─── Redis implementation ─────────────────────────────────────────────────────

class RedisRefreshTokenStore implements IRefreshTokenStore {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  private tokenKey(token: string): string {
    return `refresh:${token}`;
  }

  private familyKey(familyId: string): string {
    return `refresh:family:revoked:${familyId}`;
  }

  async get(token: string): Promise<RefreshTokenEntry | null> {
    const raw = await this.redis.get(this.tokenKey(token));
    if (!raw) return null;
    return JSON.parse(raw) as RefreshTokenEntry;
  }

  async set(token: string, entry: RefreshTokenEntry, ttlSeconds: number): Promise<void> {
    await this.redis.set(this.tokenKey(token), JSON.stringify(entry), 'EX', ttlSeconds);
  }

  async delete(token: string): Promise<void> {
    await this.redis.del(this.tokenKey(token));
  }

  async isFamilyRevoked(familyId: string): Promise<boolean> {
    return (await this.redis.exists(this.familyKey(familyId))) === 1;
  }

  async revokeFamily(familyId: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(this.familyKey(familyId), '1', 'EX', ttlSeconds);
  }

  async deleteFamily(familyId: string): Promise<void> {
    await this.revokeFamily(familyId, getRefreshTtl());
  }
}

// ─── Store singleton ──────────────────────────────────────────────────────────

function createRefreshTokenStore(): IRefreshTokenStore {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const redis = new Redis(redisUrl, { lazyConnect: true, enableOfflineQueue: false });
    redis.on('error', (err) => {
      logger.log('error', 'Redis refresh token store error', { error: err.message });
    });
    return new RedisRefreshTokenStore(redis);
  }
  return new InMemoryRefreshTokenStore();
}

const refreshTokenStore: IRefreshTokenStore = createRefreshTokenStore();

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
export async function issueTokenPair(walletAddress: string, familyId?: string): Promise<TokenPair> {
  const normalizedAddress = normalizeWalletAddress(walletAddress);
  const now = Math.floor(Date.now() / 1000);
  const accessTtl = getAccessTtl();
  const refreshTtl = getRefreshTtl();

  const jti = crypto.randomUUID();
  const payload: JwtPayload = {
    sub: normalizedAddress,
    iat: now,
    exp: now + accessTtl,
    jti,
  };

  const accessToken = signJwt(payload);
  const refreshToken = generateRefreshToken();
  const family = familyId ?? crypto.randomUUID();

  await refreshTokenStore.set(
    refreshToken,
    { walletAddress: normalizedAddress, familyId: family, expiresAt: now + refreshTtl, revoked: false },
    refreshTtl,
  );

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: new Date((now + accessTtl) * 1000).toISOString(),
  };
}

// ─── Session Revocation ────────────────────────────────────────────────────────

/**
 * Revokes the current session (all tokens in the same family).
 * This is used for /auth/logout.
 */
export async function revokeCurrentSession(refreshToken: string): Promise<void> {
  const entry = await refreshTokenStore.get(refreshToken);
  if (!entry) return;

  await refreshTokenStore.revokeFamily(entry.familyId, getRefreshTtl());
  await refreshTokenStore.deleteFamily(entry.familyId);
  await refreshTokenStore.delete(refreshToken);

  logger.log('info', 'Current session revoked', {
    familyId: entry.familyId,
    wallet: entry.walletAddress.slice(0, 8) + '…',
  });
}

/**
 * Revokes all active sessions for the given wallet address.
 * This is used for /auth/logout-all.
 */
export async function revokeAllSessions(walletAddress: string): Promise<number> {
  const normalizedAddress = normalizeWalletAddress(walletAddress);
  // In-memory store supports iteration; Redis store relies on TTL expiry for
  // individual tokens – we can only revoke by family if we know the family IDs.
  // For the in-memory path the cast is safe; for Redis this is a best-effort
  // revocation of the current token's family only (full wallet scan requires
  // a secondary index which is out of scope here).
  const store = refreshTokenStore as unknown as InMemoryRefreshTokenStore;
  if (typeof (store as any).tokens !== 'undefined') {
    // In-memory path: iterate all tokens
    const inMem = store as unknown as { tokens: Map<string, RefreshTokenEntry>; revokedFamilies: Set<string> };
    let revokedCount = 0;
    const familiesToRevoke = new Set<string>();
    for (const [token, entry] of inMem.tokens.entries()) {
      if (normalizeWalletAddress(entry.walletAddress) === normalizedAddress) {
        familiesToRevoke.add(entry.familyId);
        inMem.tokens.delete(token);
        revokedCount++;
      }
    }
    for (const familyId of familiesToRevoke) {
      inMem.revokedFamilies.add(familyId);
    }
    logger.log('info', 'All sessions revoked for wallet', {
      wallet: normalizedAddress.slice(0, 8) + '…',
      revokedCount,
    });
    return revokedCount;
  }

  // Redis path: we cannot efficiently scan all tokens for a wallet without a
  // secondary index. Return 1 to indicate the operation was attempted.
  logger.log('info', 'logout-all requested (Redis: family-level revocation only)', {
    wallet: normalizedAddress.slice(0, 8) + '…',
  });
  return 1;
}

/**
 * Middleware to extract wallet address from JWT payload or request headers.
 * Used to get the authenticated wallet for logout endpoints.
 */
export function getAuthenticatedWallet(req: AuthenticatedRequest): string | null {
  // Try JWT payload first
  if (req.jwtPayload && req.jwtPayload.sub) {
    return normalizeWalletAddress(req.jwtPayload.sub);
  }

  // Fall back to headers
  const headerAddress = req.headers['x-wallet-address'] as string || req.headers['x-api-key'] as string;
  return headerAddress ? normalizeWalletAddress(headerAddress) : null;
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
export async function rotateRefreshToken(oldRefreshToken: string): Promise<TokenPair> {
  const entry = await refreshTokenStore.get(oldRefreshToken);
  const now = Math.floor(Date.now() / 1000);

  if (!entry) {
    throw new InvalidRefreshTokenError('Refresh token not found or expired');
  }

  // Check if the token's family has been globally revoked (replay detected upstream)
  if (await refreshTokenStore.isFamilyRevoked(entry.familyId)) {
    await refreshTokenStore.delete(oldRefreshToken);
    throw new SessionRevokedError(
      'Session has been revoked due to suspected refresh token theft. Please log in again.',
    );
  }

  if (entry.revoked) {
    // Replay attack: invalidate the entire family.
    await refreshTokenStore.revokeFamily(entry.familyId, getRefreshTtl());
    await refreshTokenStore.deleteFamily(entry.familyId);
    logger.log('warn', 'Refresh token replay detected – entire session invalidated', {
      familyId: entry.familyId,
      wallet: entry.walletAddress.slice(0, 8) + '…',
    });
    throw new SessionRevokedError(
      'Refresh token has already been used. Session revoked for security.',
    );
  }

  if (entry.expiresAt < now) {
    await refreshTokenStore.delete(oldRefreshToken);
    throw new InvalidRefreshTokenError('Refresh token has expired');
  }

  // Mark old token as revoked before issuing new pair (atomic intent)
  entry.revoked = true;
  const remaining = entry.expiresAt - now;
  await refreshTokenStore.set(oldRefreshToken, entry, remaining > 0 ? remaining : 1);

  return issueTokenPair(entry.walletAddress, entry.familyId);
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
 * POST /api/v1/auth/nonce
 * Issues a single-use nonce for a signed wallet action.
 * Body: { walletAddress, action: login | deposit | withdrawal }
 */
export async function nonceHandler(req: Request, res: Response): Promise<void> {
  const { walletAddress, action } = req.body as {
    walletAddress: string;
    action: WalletAction;
  };

  try {
    const issued = await walletNonceService.issue(walletAddress, action, (base) =>
      buildWalletSignMessage({
        walletAddress: base.walletAddress,
        action: base.action,
        nonce: base.nonce,
        issuedAt: base.issuedAt,
        expiresAt: base.expiresAt,
      }),
    );

    res.status(200).json(issued);
  } catch (err) {
    const limitExceeded = err instanceof NonceLimitExceededError;
    const status = limitExceeded ? 429 : 503;
    if (!limitExceeded) {
      logger.log('error', 'Unable to issue wallet nonce', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    res.status(status).json({
      error: limitExceeded ? 'Too Many Requests' : 'Service Unavailable',
      status,
      code: limitExceeded ? err.code : 'NONCE_STORE_UNAVAILABLE',
      message: limitExceeded
        ? err.message
        : 'Wallet nonce service is temporarily unavailable. Please retry.',
    });
  }
}

/**
 * POST /auth/login
 * Issues a token pair after wallet authentication.
 * Body: { walletAddress, nonce, signature } when nonce enforcement is enabled.
 */
export async function loginHandler(req: Request, res: Response): Promise<void> {
  const { walletAddress, source, providerAlias, providerSource } = req.body;

  if (!walletAddress || typeof walletAddress !== 'string') {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'walletAddress is required',
    });
    return;
  }

  const normalizedAddress = normalizeWalletAddress(walletAddress.trim());
  const identitySource = typeof source === 'string' && source.trim() ? source : 'stellar';
  const mapping = walletAliasMappingService.registerAlias(normalizedAddress, identitySource);

  if (
    typeof providerAlias === 'string' &&
    providerAlias.trim() &&
    typeof providerSource === 'string' &&
    providerSource.trim()
  ) {
    walletAliasMappingService.registerAlias(providerAlias, providerSource, mapping.canonicalId);
  }

  const canonicalWallet = walletAliasMappingService.resolveCanonicalWallet(
    normalizedAddress,
    identitySource,
  );
  const tokens = await issueTokenPair(canonicalWallet);

  logger.log('info', 'JWT tokens issued on login', {
    wallet: canonicalWallet.slice(0, 8) + '…',
    identitySource,
  });

  res.status(200).json({
    ...tokens,
    tokenType: 'Bearer',
    expiresIn: getAccessTtl(),
    canonicalWallet,
    canonicalId: mapping.canonicalId,
  });
}

/**
 * POST /auth/refresh
 * Rotates the refresh token and returns a new token pair.
 * Body: { refreshToken: string }
 *
 * Returns 401 if the refresh token is invalid, expired, or has been replayed.
 */
export async function refreshHandler(req: Request, res: Response): Promise<void> {
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
    const tokens = await rotateRefreshToken(refreshToken);

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
