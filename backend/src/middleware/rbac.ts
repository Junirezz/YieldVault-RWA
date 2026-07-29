/**
 * @file rbac.ts
 * Role-based access control for admin API keys.
 *
 * Roles (least → most privileged):
 *   viewer      – read-only admin endpoints
 *   operator    – operational mutations (cache, maintenance, allowlist, webhooks, jobs)
 *   admin       – full admin except impersonation / global flush / super-admin key minting
 *   super-admin – all permissions
 */

import type { Request, Response, NextFunction } from 'express';
import { normalizeApiKeyRole, type ApiKeyRole } from './apiKeyAuth';
import { getNormalizedPath } from './payloadLimit';

// ─── Permissions ─────────────────────────────────────────────────────────────

export const Permission = {
  ADMIN_READ: 'admin.read',
  CONFIG_WRITE: 'admin.config.write',
  ALLOWLIST_WRITE: 'admin.allowlist.write',
  WEBHOOKS_WRITE: 'admin.webhooks.write',
  WEBHOOKS_PRIVILEGED: 'admin.webhooks.privileged',
  API_KEYS_WRITE: 'admin.api_keys.write',
  API_KEYS_SUPER: 'admin.api_keys.super',
  EXPORTS_WRITE: 'admin.exports.write',
  JOBS_WRITE: 'admin.jobs.write',
  IDEMPOTENCY_WRITE: 'admin.idempotency.write',
  IDEMPOTENCY_FLUSH: 'admin.idempotency.flush',
  IMPERSONATE: 'admin.impersonate',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

const ALL_PERMISSIONS = Object.values(Permission) as Permission[];

const ROLE_PERMISSIONS: Record<ApiKeyRole, ReadonlySet<Permission>> = {
  viewer: new Set([
    Permission.ADMIN_READ,
  ]),
  operator: new Set([
    Permission.ADMIN_READ,
    Permission.CONFIG_WRITE,
    Permission.ALLOWLIST_WRITE,
    Permission.WEBHOOKS_WRITE,
    Permission.EXPORTS_WRITE,
    Permission.JOBS_WRITE,
    Permission.IDEMPOTENCY_WRITE,
  ]),
  admin: new Set([
    Permission.ADMIN_READ,
    Permission.CONFIG_WRITE,
    Permission.ALLOWLIST_WRITE,
    Permission.WEBHOOKS_WRITE,
    Permission.WEBHOOKS_PRIVILEGED,
    Permission.API_KEYS_WRITE,
    Permission.EXPORTS_WRITE,
    Permission.JOBS_WRITE,
    Permission.IDEMPOTENCY_WRITE,
  ]),
  'super-admin': new Set(ALL_PERMISSIONS),
};

/** Parameter fields that require admin+ (not operator) on webhook updates. */
export const WEBHOOK_PRIVILEGED_PARAMETER_KEYS = ['url', 'secret'] as const;

/** Maintenance mode body fields governed by CONFIG_WRITE. */
export const MAINTENANCE_PARAMETER_KEYS = ['enabled', 'reason', 'retryAfterSeconds'] as const;

// ─── Route → permission map ──────────────────────────────────────────────────

type RouteRule = {
  methods: string[];
  pattern: RegExp;
  permission: Permission;
};

const ADMIN_ROUTE_RULES: RouteRule[] = [
  // Super-privileged
  { methods: ['GET'], pattern: /^\/admin\/impersonate\/sessions$/, permission: Permission.IMPERSONATE },
  { methods: ['GET'], pattern: /^\/admin\/impersonate\/[^/]+$/, permission: Permission.IMPERSONATE },
  { methods: ['POST'], pattern: /^\/admin\/impersonate\/sessions$/, permission: Permission.IMPERSONATE },
  { methods: ['DELETE'], pattern: /^\/admin\/impersonate\/sessions\/[^/]+$/, permission: Permission.IMPERSONATE },
  { methods: ['DELETE'], pattern: /^\/admin\/idempotency\/keys$/, permission: Permission.IDEMPOTENCY_FLUSH },

  // Config / cache / maintenance (parameter updates)
  { methods: ['POST'], pattern: /^\/admin\/maintenance$/, permission: Permission.CONFIG_WRITE },
  { methods: ['POST'], pattern: /^\/admin\/maintenance\/windows$/, permission: Permission.CONFIG_WRITE },
  { methods: ['DELETE'], pattern: /^\/admin\/maintenance\/windows\/[^/]+$/, permission: Permission.CONFIG_WRITE },
  { methods: ['POST'], pattern: /^\/admin\/feature-flags\/overrides$/, permission: Permission.CONFIG_WRITE },
  { methods: ['DELETE'], pattern: /^\/admin\/feature-flags\/overrides\/[^/]+$/, permission: Permission.CONFIG_WRITE },
  { methods: ['POST'], pattern: /^\/admin\/cache\/invalidate$/, permission: Permission.CONFIG_WRITE },
  { methods: ['DELETE'], pattern: /^\/admin\/cache$/, permission: Permission.CONFIG_WRITE },
  { methods: ['POST'], pattern: /^\/admin\/withdrawal-limits\/override$/, permission: Permission.CONFIG_WRITE },

  // Allowlist
  { methods: ['POST'], pattern: /^\/admin\/allowlist\/add$/, permission: Permission.ALLOWLIST_WRITE },
  { methods: ['DELETE'], pattern: /^\/admin\/allowlist\/remove$/, permission: Permission.ALLOWLIST_WRITE },

  // Background jobs
  { methods: ['POST'], pattern: /^\/admin\/apy\/backfill$/, permission: Permission.JOBS_WRITE },
  { methods: ['POST'], pattern: /^\/admin\/events\/replay$/, permission: Permission.JOBS_WRITE },
  { methods: ['POST'], pattern: /^\/admin\/emails\/replay\/[^/]+$/, permission: Permission.JOBS_WRITE },
  { methods: ['POST'], pattern: /^\/admin\/jobs\/dead-letters\/.*$/, permission: Permission.JOBS_WRITE },
  { methods: ['DELETE'], pattern: /^\/admin\/jobs\/dead-letters\/[^/]+$/, permission: Permission.JOBS_WRITE },
  { methods: ['POST'], pattern: /^\/admin\/idempotency\/retention\/cleanup$/, permission: Permission.JOBS_WRITE },
  { methods: ['POST'], pattern: /^\/admin\/transactions\/backfill$/, permission: Permission.JOBS_WRITE },
  { methods: ['POST'], pattern: /^\/admin\/webhooks\/dead-letter\/[^/]+\/retry$/, permission: Permission.JOBS_WRITE },

  // API keys
  { methods: ['POST'], pattern: /^\/admin\/api-keys\/register$/, permission: Permission.API_KEYS_WRITE },
  { methods: ['POST'], pattern: /^\/admin\/api-keys\/rotate$/, permission: Permission.API_KEYS_WRITE },
  { methods: ['POST'], pattern: /^\/admin\/api-keys\/revoke$/, permission: Permission.API_KEYS_WRITE },

  // Scoped admin tokens (Issue #858)
  { methods: ['POST'],   pattern: /^\/admin\/scoped-tokens$/, permission: Permission.API_KEYS_SUPER },
  { methods: ['POST'],   pattern: /^\/admin\/scoped-tokens\/[^/]+\/rotate$/, permission: Permission.API_KEYS_SUPER },
  { methods: ['POST'],   pattern: /^\/admin\/scoped-tokens\/[^/]+\/revoke$/, permission: Permission.API_KEYS_SUPER },
  { methods: ['GET'],    pattern: /^\/admin\/scoped-tokens$/, permission: Permission.ADMIN_READ },
  { methods: ['GET'],    pattern: /^\/admin\/scoped-tokens\/[^/]+$/, permission: Permission.ADMIN_READ },
  { methods: ['GET'],    pattern: /^\/admin\/scoped-tokens\/[^/]+\/rotations$/, permission: Permission.ADMIN_READ },

  // Webhooks
  { methods: ['POST'], pattern: /^\/admin\/webhooks$/, permission: Permission.WEBHOOKS_WRITE },
  { methods: ['POST'], pattern: /^\/admin\/webhooks\/[^/]+\/verify$/, permission: Permission.WEBHOOKS_WRITE },
  { methods: ['PATCH'], pattern: /^\/admin\/webhooks\/[^/]+$/, permission: Permission.WEBHOOKS_WRITE },
  { methods: ['DELETE'], pattern: /^\/admin\/webhooks\/[^/]+$/, permission: Permission.WEBHOOKS_WRITE },
  { methods: ['POST'], pattern: /^\/admin\/webhooks\/[^/]+\/restore$/, permission: Permission.WEBHOOKS_WRITE },      // Webhook deduplication management
      { methods: ['DELETE'], pattern: /^\/admin\/webhooks\/deduplication\/[^/]+$/, permission: Permission.WEBHOOKS_WRITE },

      // Exports
  { methods: ['POST'], pattern: /^\/admin\/exports\/bulk$/, permission: Permission.EXPORTS_WRITE },
  { methods: ['POST'], pattern: /^\/admin\/exports\/bulk\/jobs\/[^/]+\/cancel$/, permission: Permission.EXPORTS_WRITE },
  { methods: ['POST'], pattern: /^\/admin\/exports\/jobs\/[^/]+\/verify$/, permission: Permission.EXPORTS_WRITE },
  { methods: ['POST'], pattern: /^\/admin\/governance\/snapshots\/export$/, permission: Permission.EXPORTS_WRITE },
  { methods: ['POST'], pattern: /^\/admin\/reports\/exports$/, permission: Permission.EXPORTS_WRITE },
  { methods: ['POST'], pattern: /^\/admin\/reports\/exports\/manifests\/[^/]+\/verify$/, permission: Permission.EXPORTS_WRITE },

  // Idempotency (single-key delete)
  { methods: ['DELETE'], pattern: /^\/admin\/idempotency\/keys\/[^/]+$/, permission: Permission.IDEMPOTENCY_WRITE },
];

// ─── Core helpers ────────────────────────────────────────────────────────────

export function resolveApiKeyRole(req: Request): ApiKeyRole {
  return normalizeApiKeyRole(req.authApiKeyRole) ?? 'admin';
}

export function roleHasPermission(role: ApiKeyRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export function hasPermission(req: Request, permission: Permission): boolean {
  return roleHasPermission(resolveApiKeyRole(req), permission);
}

export function resolveAdminRoutePermission(req: Request): Permission {
  const path = getNormalizedPath(req);
  const method = req.method.toUpperCase();

  for (const rule of ADMIN_ROUTE_RULES) {
    if (rule.methods.includes(method) && rule.pattern.test(path)) {
      return rule.permission;
    }
  }

  if (method === 'GET' || method === 'HEAD') {
    return Permission.ADMIN_READ;
  }

  // Unknown mutating admin route – require full admin write surface
  return Permission.API_KEYS_WRITE;
}

export function forbiddenResponse(
  res: Response,
  message: string,
  requiredPermission?: Permission,
): void {
  res.status(403).json({
    error: 'Forbidden',
    status: 403,
    message,
    ...(requiredPermission ? { requiredPermission } : {}),
  });
}

// ─── Parameter-update guards ─────────────────────────────────────────────────

/**
 * Ensures the caller may update maintenance-mode parameters in the request body.
 */
export function assertMaintenanceParameterUpdate(req: Request, res: Response): boolean {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const keys = Object.keys(body).filter((k) =>
    (MAINTENANCE_PARAMETER_KEYS as readonly string[]).includes(k),
  );

  if (!keys.length) {
    return true;
  }

  if (!hasPermission(req, Permission.CONFIG_WRITE)) {
    forbiddenResponse(
      res,
      'Operator role or higher is required to update maintenance mode parameters',
      Permission.CONFIG_WRITE,
    );
    return false;
  }

  return true;
}

/**
 * Ensures the caller may update webhook endpoint parameters.
 * `url` and `secret` require admin+ (WEBHOOKS_PRIVILEGED); other fields need operator+.
 */
export function assertWebhookParameterUpdate(req: Request, res: Response): boolean {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const keys = Object.keys(body);

  if (!keys.length) {
    return true;
  }

  const privileged = keys.filter((k) =>
    (WEBHOOK_PRIVILEGED_PARAMETER_KEYS as readonly string[]).includes(k),
  );

  if (privileged.length > 0 && !hasPermission(req, Permission.WEBHOOKS_PRIVILEGED)) {
    forbiddenResponse(
      res,
      `Admin role or higher is required to update webhook parameters: ${privileged.join(', ')}`,
      Permission.WEBHOOKS_PRIVILEGED,
    );
    return false;
  }

  const operational = keys.filter((k) => !privileged.includes(k));
  if (operational.length > 0 && !hasPermission(req, Permission.WEBHOOKS_WRITE)) {
    forbiddenResponse(
      res,
      'Operator role or higher is required to update webhook configuration',
      Permission.WEBHOOKS_WRITE,
    );
    return false;
  }

  return true;
}

// ─── Middleware ──────────────────────────────────────────────────────────────

/**
 * Enforces RBAC for `/admin/*` routes. Must run after `validateApiKey`.
 */
function tagImpersonationDenied(req: Request): void {
  const path = getNormalizedPath(req);
  const match = path.match(/^\/admin\/impersonate\/([^/]+)$/);
  const wallet = match?.[1] || 'unknown';
  const actor =
    req.get('x-admin-address') ||
    req.get('x-admin-id') ||
    req.get('x-wallet-address') ||
    'unknown';

  req.adminAuditAction = 'admin.impersonate.denied';
  req.adminAuditMetadata = {
    actingAdminAddress: actor,
    adminRole: resolveApiKeyRole(req),
    targetWallet: wallet,
    impersonation: true,
  };
}

export function adminRbacMiddleware(req: Request, res: Response, next: NextFunction): void {
  const required = resolveAdminRoutePermission(req);

  if (!hasPermission(req, required)) {
    if (required === Permission.IMPERSONATE) {
      tagImpersonationDenied(req);
    }
    forbiddenResponse(
      res,
      `Insufficient permissions. Required: ${required}`,
      required,
    );
    return;
  }

  next();
}

/**
 * Factory for route-level permission checks outside the `/admin` prefix.
 */
export function requirePermission(...permissions: Permission[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const allowed = permissions.some((p) => hasPermission(req, p));
    if (!allowed) {
      forbiddenResponse(
        res,
        `Insufficient permissions. Required one of: ${permissions.join(', ')}`,
        permissions[0],
      );
      return;
    }
    next();
  };
}
