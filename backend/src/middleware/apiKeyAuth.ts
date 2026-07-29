import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../prisma';

export type ApiKeyRole = 'viewer' | 'operator' | 'admin' | 'super-admin';

interface ApiKeyMetadata {
  role: ApiKeyRole;
  createdAt: Date;
  rotatedAt?: Date;
  revokedAt?: Date;
  tenantId: string;
  scopes: string[];
}

declare global {
  namespace Express {
    interface Request {
      authApiKeyHash?: string;
      authApiKeyRole?: ApiKeyRole;
      authApiKeyTenantId?: string;
      authApiKeyScopes?: string[];
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
  tenant?: { deletedAt?: Date | null };
}

export function isPersistedApiKeyUsable(
  apiKey: PersistedApiKeyStatus | null
): apiKey is PersistedApiKeyStatus {
  return Boolean(apiKey && apiKey.isActive && !apiKey.deletedAt && !apiKey.tenant?.deletedAt);
}

export async function validateApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.get?.('Authorization') || '';
  const match = authHeader.match(/^ApiKey\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: 'Unauthorized', message: 'Missing or invalid API key' });
    return;
  }
  const providedKey = match[1];
  const hashed = crypto.createHash('sha256').update(providedKey).digest('hex');

  // Try Prisma first; fall back to in-memory store when the table doesn't exist
  // (e.g. in tests with an un-migrated SQLite database).
  let apiKey: {
    hashedKey: string;
    role: string;
    tenantId: string;
    scopes: unknown;
    isActive: boolean;
    deletedAt?: Date | null;
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
    if (isPersistedApiKeyUsable(apiKey)) {
      req.authApiKeyHash = apiKey.hashedKey;
      req.authApiKeyRole = apiKey.role as ApiKeyRole;
      req.authApiKeyTenantId = apiKey.tenantId;
      req.authApiKeyScopes = parseScopes(apiKey.scopes);
      next();
      return;
    }

    // A persisted-but-disabled credential must fail closed. Never let it fall
    // through to the legacy in-memory store where an old duplicate could live.
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid API key' });
    return;
  }

  // Fallback: check the in-memory store (used by tests and legacy callers)
  const meta = IN_MEMORY_KEYS.get(hashed);
  if (!meta || meta.revokedAt) {
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid API key' });
    return;
  }
  req.authApiKeyHash = hashed;
  req.authApiKeyRole = meta.role;
  req.authApiKeyTenantId = meta.tenantId;
  req.authApiKeyScopes = meta.scopes;
  next();
}

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// Legacy helpers retained for compatibility – they operate on in‑memory map only.
const IN_MEMORY_KEYS = new Map<string, ApiKeyMetadata>();

export function registerApiKey(
  key: string,
  options?: { role?: ApiKeyRole; tenantId?: string; scopes?: string[] }
): string {
  const hash = hashApiKey(key);
  IN_MEMORY_KEYS.set(hash, {
    role: options?.role || 'admin',
    createdAt: new Date(),
    tenantId: options?.tenantId || 'unknown',
    scopes: options?.scopes || [],
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
  };
}

export function authenticateApiKeyValue(value: string) {
  const hash = hashApiKey(value);
  const meta = IN_MEMORY_KEYS.get(hash);
  if (!meta || meta.revokedAt) return null;
  return { hash, role: meta.role };
}

export function hasRequiredApiKeyRole(req: Request, requiredRole: ApiKeyRole): boolean {
  const currentRole = req.authApiKeyRole || 'admin';
  return ROLE_PRECEDENCE[currentRole] >= ROLE_PRECEDENCE[requiredRole];
}
