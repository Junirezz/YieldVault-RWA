import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../prisma';
import { sendApiError } from './apiError';

export type ApiKeyRole = 'viewer' | 'operator' | 'admin' | 'super-admin';

interface ApiKeyMetadata {
  role: ApiKeyRole;
  createdAt: Date;
  rotatedAt?: Date;
  revokedAt?: Date;
  tenantId: string;
  scopes: string[];
  expiresAt?: Date | null;
  lastUsedAt?: Date | null;
}

declare global {
  namespace Express {
    interface Request {
      authApiKeyHash?: string;
      authApiKeyRole?: ApiKeyRole;
      authApiKeyTenantId?: string;
      authApiKeyScopes?: string[];
      authApiKeyLastUsedAt?: Date | null;
      authApiKeyLegacy?: boolean;
    }
  }
}

const ROLE_PRECEDENCE: Record<ApiKeyRole, number> = {
  viewer: 0,
  operator: 1,
  admin: 2,
  'super-admin': 3,
};

export function normalizeApiKeyRole(raw: unknown): ApiKeyRole | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const value = raw.trim().toLowerCase();
  if (value === 'viewer' || value === 'operator' || value === 'admin' || value === 'super-admin') {
    return value as ApiKeyRole;
  }
  return null;
}

function parseScopes(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export interface PersistedApiKeyStatus {
  isActive: boolean;
  deletedAt?: Date | null;
  expiresAt?: Date | null;
  tenant?: { deletedAt?: Date | null };
}

export function isPersistedApiKeyUsable(
  apiKey: PersistedApiKeyStatus | null
): apiKey is PersistedApiKeyStatus {
  return Boolean(apiKey && apiKey.isActive && !apiKey.deletedAt && !apiKey.tenant?.deletedAt);
}

export function isPersistedApiKeyExpired(
  apiKey: PersistedApiKeyStatus | null
): boolean {
  return Boolean(apiKey && apiKey.expiresAt && apiKey.expiresAt.getTime() <= Date.now());
}

export function extractTenantIdFromRequest(req: Request): string | null {
  const fromParams = req.params?.tenantId;
  if (typeof fromParams === 'string' && fromParams.trim()) {
    return fromParams.trim();
  }
  const fromQuery = req.query?.tenantId;
  if (typeof fromQuery === 'string' && fromQuery.trim()) {
    return fromQuery.trim();
  }
  const fromHeader = req.get?.('x-tenant-id');
  if (typeof fromHeader === 'string' && fromHeader.trim()) {
    return fromHeader.trim();
  }
  return null;
}

export function extractRequiredScopes(req: Request): string[] {
  const raw = (req as Request & { requiredScopes?: unknown }).requiredScopes;
  if (Array.isArray(raw)) {
    return raw.filter((s): s is string => typeof s === 'string');
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export function hasRequiredScopes(available: string[], required: string[]): boolean {
  if (required.length === 0) return true;
  if (available.includes('*')) return true;
  return required.every((scope) => available.includes(scope));
}

function sendUnauthorized(
  req: Request,
  res: Response,
  code: string,
  message: string,
  scheme: string = 'Bearer'
): void {
  res.setHeader('WWW-Authenticate', scheme);
  sendApiError(req, res, {
    status: 401,
    code,
    message,
    retrable: false,
  });
}

const LEGACY_ENV_KEY = process.env.API_KEY;
const LEGACY_ENV_TENANT = process.env.API_KEY_TENANT_ID || 'default';
const LEGACY_ENV_SCOPES = (process.env.API_KEY_SCOPES || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function checkLegacyEnvKey(providedKey: string): boolean {
  if (!LEGACY_ENV_KEY) return false;
  const a = Buffer.from(providedKey);
  const b = Buffer.from(LEGACY_ENV_KEY);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function validateApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.get?.('Authorization') || '';
  const match = authHeader.match(/^ApiKey\s+(.+)$/i);
  if (!match) {
    sendApiError(req, res, {
      status: 401,
      code: 'AUTH_API_KEY_MISSING',
      message: 'Missing or invalid API key',
      retryable: false,
    });
    return;
  }
  const providedKey = match[1];
  const hashed = crypto.createHash('sha256').update(providedKey).digest('hex');
  const requestedTenantId = extractTenantIdFromRequest(req);
  const requiredScopes = extractRequiredScopes(req);

  // Try Prisma first; fall back to in-memory store when the table doesn't exist
  // (e.g. in tests with an un-migrated SQLite database).
  let apiKey: {
    id?: string;
    hashedKey: string;
    role: string;
    tenantId: string;
    scopes: unknown;
    isActive: boolean;
    deletedAt?: Date | null;
    expiresAt?: Date | null;
    tenant?: { deletedAt?: Date | null };
  } | null = null;
  try {
    apiKey = await prisma.apiKey.findUnique({
      where: { hashedKey: hashed },
      include: { tenant: { select: { deletedAt: true } } },
    });
  } catch (err) {
    // Only fall back when the ApiKey table hasn't been created (tests / fresh DB).
    const isMissingTable =
      err instanceof Error &&
      (err.message.includes('does not exist in the current database') ||
        (err as { code?: string }).code === 'P2021');
    if (!isMissingTable) throw err;
  }

  if (apiKey) {
    if (!isPersistedApiKeyUsable(apiKey)) {
      // A persisted-but-disabled credential must fail closed. Never let it fall
      // through to the legacy in-memory store where an old duplicate could live.
      sendApiError(req, res, {
        status: 401,
        code: 'AUTH_API_KEY_INVALID',
        message: 'Invalid API key',
        retryable: false,
      });
      return;
    }

    if (isPersistedApiKeyExpired(apiKey)) {
      sendUnauthorized(req, res, 'API_KEY_EXPIRED', 'API key has expired');
      return;
    }

    // Tenant scoping: if the request targets a tenant, the key must belong to it.
    if (requestedTenantId && requestedTenantId !== apiKey.tenantId) {
      sendApiError(req, res, {
        status: 401,
        code: 'AUTH_API_KEY_INVALID',
        message: 'API key is not valid for this tenant',
        retryable: false,
      });
      return;
    }

    const availableScopes = parseScopes(apiKey.scopes);
    if (!hasRequiredScopes(availableScopes, requiredScopes)) {
      sendUnauthorized(
        req,
        res,
        'SCOPE_INSUFFICIENT',
        'API key misses required scope(s)',
        'Bearer error="insufficient_scope"'
      );
      return;
    }

    req.authApiKeyHash = apiKey.hashedKey;
    req.authApiKeyRole = apiKey.role as ApiKeyRole;
    req.authApiKeyTenantId = apiKey.tenantId;
    req.authApiKeyScopes = availableScopes;
    req.authApiKeyLegacy = false;

    // Best-effort last-used tracking for audit. Never fail auth because of it.
    try {
      const now = new Date();
      await prisma.apiKey.update({
        where: { hashedKey: apiKey.hashedKey },
        data: { lastUsedAt: now },
      });
      req.authApiKeyLastUsedAt = now;
    } catch {
      // ignore last-used update failures
    }

    next();
    return;
  }

  // Fallback: check the in-memory store (used by tests and legacy callers)
  const meta = IN_MEMORY_KEYS.get(hashed);
  if (meta && !meta.revokedAt) {
    if (meta.expiresAt && meta.expiresAt.getTime() <= Date.now()) {
      sendUnauthorized(req, res, 'API_KEY_EXPIRED', 'API key has expired');
      return;
    }
    if (requestedTenantId && requestedTenantId !== meta.tenantId) {
      sendApiError(req, res, {
        status: 401,
        code: 'AUTH_API_KEY_INVALID',
        message: 'API key is not valid for this tenant',
        retryable: false,
      });
      return;
    }
    if (!hasRequiredScopes(meta.scopes, requiredScopes)) {
      sendUnauthorized(
        req,
        res,
        'SCOPE_INSUFFICIENT',
        'API key misses required scope(s)',
        'Bearer error="insufficient_scope"'
      );
      return;
    }
    req.authApiKeyHash = hashed;
    req.authApiKeyRole = meta.role;
    req.authApiKeyTenantId = meta.tenantId;
    req.authApiKeyScopes = meta.scopes;
    req.authApiKeyLegacy = false;
    meta.lastUsedAt = new Date();
    req.authApiKeyLastUsedAt = meta.lastUsedAt;
    next();
    return;
  }

  // Legacy fallback: single global env var API_KEY. Deprecated.
  if (checkLegacyEnvKey(providedKey)) {
    console.warn(
      '[deprecation] API_KEY env var fallback is deprecated. Migrate to per-tenant API keys in the apiKey table.'
    );
    if (requestedTenantId && requestedTenantId !== LEGACY_ENV_TENANT) {
      sendApiError(req, res, {
        status: 401,
        code: 'AUTH_API_KEY_INVALID',
        message: 'APIkey is not valid for this tenant',
        retryable: false,
      });
      return;
    }
    if (!hasRequiredScopes(LEGACY_ENV_SCOPES, requiredScopes)) {
      sendUnauthorized(
        req,
        res,
        'SCOPE_INSUFFICIENT',
        'API key misses required scope(s)',
        'Bearer error="insufficient_scope"'
      );
      return;
    }
    req.authApiKeyHash = hashed;
    req.authApiKeyRole = 'admin';
    req.authApiKeyTenantId = LEGACY_ENV_TENANT;
    req.authApiKeyScopes = LEGACY_ENV_SCOPES;
    req.authApiKeyLegacy = true;
    next();
    return;
  }

  sendApiError(req, res, {
    status: 401,
    code: 'AUTH_API_KEY_INVALID',
    message: 'Invalid API key',
    retryable: false,
  });
}

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// Legacy helpers retained for compatibility – operate on in-memory map only.
const IN_MEMORY_KEYS = new Map<string, ApiKeyMetadata>();

export function registerApiKey(
  key: string,
  options?: { role?: ApiKeyRole; tenantId?: string; scopes?: string[]; expiresAt?: Date | null }
): string {
  const hash = hashApiKey(key);
  IN_MEMORY_KEYS.set(hash, {
    role: options?.role || 'admin',
    createdAt: new Date(),
    tenantId: options?.tenantId || 'unknown',
    scopes: options?.scopes || [],
    expiresAt: options?.expiresAt ?? null,
  });
  return hash;
}

export function revokeApiKey(hash: string): boolean {
  const meta = IN_MEMORY_KEYS.get(hash);
  if (meta) {
    meta.revokedAt = new Date();
    IN_MEMORY_KEYS.set(hash, meta);
  }
  return IN_MEMORY_KEYS.delete(hash);
}

export function rotateApiKey(
  oldHash: string,
  newKey: string,
  options: { role?: ApiKeyRole; tenantId?: string; scopes?: string[] } = {}
): string | null {
  const meta = IN_MEMORY_KEYS.get(oldHash);
  if (!meta) return null;
  IN_MEMORY_KEYS.delete(oldHash);
  const newHash = hashApiKey(newKey);
  IN_MEMORY_KEYS.set(newHash, {
    role: options.role || meta.role,
    createdAt: meta.createdAt,
    rotatedAt: new Date(),
    tenantId: options.tenantId || meta.tenantId,
    scopes: options.scopes || meta.scopes,
    expiresAt: meta.expiresAt ?? null,
  });
  return newHash;
}

export function restoreApiKey(hash: string): boolean {
  const meta = IN_MEMORY_KEYS.get(hash);
  if (!meta) return false;
  meta.revokedAt = undefined;
  IN_MEMORY_KEYS.set(hash, meta);
  return true;
}

export function getApiKeyMetadata(hash: string) {
  const meta = IN_MEMORY_KEYS.get(hash);
  if (!meta) return null;
  return {
    hash,
    role: meta.role,
    createdAt: meta.createdAt.toISOString(),
    ...(meta.rotatedAt ? { rotatedAt: meta.rotatedAt.toISOString() } : {}),
    ...(meta.revokedAt ? { revokedAt: meta.revokedAt.toISOString() } : {}),
    tenantId: meta.tenantId,
    scopes: meta.scopes,
    ...(meta.expiresAt ? { expiresAt: meta.expiresAt.toISOString() } : {}),
    ...(meta.lastUsedAt ? { lastUsedAt: meta.lastUsedAt.toISOString() } : {}),
  };
}

export function authenticateApiKeyValue(value: string) {
  const hash = hashApiKey(value);
  const meta = IN_MEMORY_KEYS.get(hash);
  if (!meta || meta.revokedAt) return null;
  if (meta.expiresAt && meta.expiresAt.getTime() <= Date.now()) return null;
  return { hash, role: meta.role, tenantId: meta.tenantId, scopes: meta.scopes };
}

export function hasRequiredApiKeyRole(req: Request, requiredRole: ApiKeyRole): boolean {
  const currentRole = req.authApiKeyRole || 'admin';
  return ROLE_PRECEDENCE[currentRole] >= ROLE_PRECEDENCE[requiredRole];
}
