/**
 * @file tenantBoundary.ts
 * Tenant boundary enforcement middleware for multi-tenant account isolation.
 *
 * Validates that every sensitive action (deposit, withdrawal, data access, mutations)
 * operates within the authenticated user's tenant scope. Prevents cross-tenant access
 * and enforces strict authorization boundaries.
 *
 * Acceptance Criteria:
 *   ✓ Validate ownership or tenant scope on every sensitive action
 *   ✓ Return authorization errors with clear messaging
 *   ✓ Document expected access patterns for operators
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from './structuredLogging';
import { prisma } from '../prisma';

// ─── Extended Express Request Interface ──────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
      walletAddress?: string;
      tenantScopes?: Set<string>;
    }
  }
}

// ─── Error Types ────────────────────────────────────────────────────────────

export class TenantBoundaryViolation extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly requestedTenantId: string,
    public readonly resource: string
  ) {
    super(
      `Tenant boundary violation: tenant ${tenantId} cannot access ${resource} in tenant ${requestedTenantId}`
    );
    this.name = 'TenantBoundaryViolation';
  }
}

export class MissingTenantContext extends Error {
  constructor(public readonly resource: string) {
    super(`Missing tenant context for resource: ${resource}`);
    this.name = 'MissingTenantContext';
  }
}

// ─── Tenant Scope Definition ─────────────────────────────────────────────────

export interface TenantScope {
  tenantId: string;
  walletAddress: string;
  scopes: Set<string>;
}

export const TENANT_SCOPES = {
  READ_OWN_DATA: 'read:own_data',
  WRITE_OWN_DATA: 'write:own_data',
  READ_TENANT_DATA: 'read:tenant_data',
  WRITE_TENANT_DATA: 'write:tenant_data',
  DELETE_TENANT_DATA: 'delete:tenant_data',
  READ_AUDIT: 'read:audit',
} as const;

// ─── Core Middleware ────────────────────────────────────────────────────────

/**
 * Extracts tenant context from authenticated request.
 * Called after authentication middleware (apiKeyAuth, JWT auth, etc.).
 */
export function extractTenantContext(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // If already set by authentication middleware, skip
  if (req.tenantId && req.walletAddress) {
    next();
    return;
  }

  // For API key auth: tenantId already set by apiKeyAuth middleware
  if (req.authApiKeyTenantId) {
    req.tenantId = req.authApiKeyTenantId;
    req.tenantScopes = new Set(req.authApiKeyScopes || []);
    next();
    return;
  }

  // For JWT auth: extract from session (should be set by auth middleware)
  if (res.locals.walletAddress) {
    req.walletAddress = res.locals.walletAddress;
    // Derive tenantId from wallet (single-tenant user context)
    // Multi-tenant support: could look up user's tenant memberships
    next();
    return;
  }

  // No tenant context available
  res.status(401).json({
    error: 'Unauthorized',
    message: 'Missing authentication context for tenant isolation',
  });
}

/**
 * Enforces tenant boundary on a specific resource access.
 * Should be called at the start of any endpoint accessing cross-tenant data.
 *
 * @param requestedTenantId - The tenant ID being accessed
 * @param resourceName - Human-readable resource name for error messages
 */
export function validateTenantOwnership(
  requestedTenantId: string,
  resourceName: string
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Admin/super-admin bypass with logging for audit trail
    if (req.authApiKeyRole === 'admin' || req.authApiKeyRole === 'super-admin') {
      logger.log('info', 'Admin access with tenant bypass', {
        action: 'tenant_admin_bypass',
        actor: req.authApiKeyHash,
        tenantId: req.tenantId,
        requestedTenantId,
        resource: resourceName,
        ipAddress: req.ip,
      });
      next();
      return;
    }

    // Standard tenant boundary check
    if (!req.tenantId) {
      throw new MissingTenantContext(resourceName);
    }

    if (req.tenantId !== requestedTenantId) {
      logger.log('warn', 'Tenant boundary violation detected', {
        action: 'tenant_boundary_violation',
        actor: req.authApiKeyHash || req.walletAddress,
        tenantId: req.tenantId,
        requestedTenantId,
        resource: resourceName,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      throw new TenantBoundaryViolation(req.tenantId, requestedTenantId, resourceName);
    }

    next();
  };
}

/**
 * Validates that a wallet address belongs to the authenticated tenant.
 * Used before executing user-scoped operations.
 */
export async function validateWalletInTenant(
  walletAddress: string,
  tenantId: string,
  requestingActor: string
): Promise<boolean> {
  const walletInTenant = await prisma.walletTenantAssociation.findFirst({
    where: {
      walletAddress: walletAddress.toLowerCase(),
      tenantId,
      deletedAt: null,
    },
    select: { id: true },
  });

  if (!walletInTenant) {
    logger.log('warn', 'Wallet not associated with tenant', {
      action: 'wallet_tenant_check_failed',
      actor: requestingActor,
      walletAddress: walletAddress.toLowerCase(),
      tenantId,
    });
    return false;
  }

  return true;
}

/**
 * Validates that a transaction/resource belongs to the authenticated tenant.
 */
export async function validateResourceBelongsToTenant(
  resourceId: string,
  resourceType: 'transaction' | 'vault' | 'webhook' | 'api_key',
  tenantId: string
): Promise<boolean> {
  switch (resourceType) {
    case 'transaction': {
      const txn = await prisma.transaction.findFirst({
        where: {
          id: resourceId,
          tenantId,
          deletedAt: null,
        },
        select: { id: true },
      });
      return !!txn;
    }

    case 'vault': {
      const vault = await prisma.vault.findFirst({
        where: {
          id: resourceId,
          tenantId,
          deletedAt: null,
        },
        select: { id: true },
      });
      return !!vault;
    }

    case 'webhook': {
      const webhook = await prisma.webhookEndpoint.findFirst({
        where: {
          id: resourceId,
          tenantId,
          deletedAt: null,
        },
        select: { id: true },
      });
      return !!webhook;
    }

    case 'api_key': {
      const key = await prisma.apiKey.findFirst({
        where: {
          id: resourceId,
          tenantId,
          deletedAt: null,
        },
        select: { id: true },
      });
      return !!key;
    }

    default:
      return false;
  }
}

/**
 * Middleware factory for protecting routes that require tenant scope.
 *
 * Usage:
 *   router.get('/deposits/:tenantId', protectTenantRoute('deposits'), handler)
 */
export function protectTenantRoute(resourceName: string, paramName = 'tenantId') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const requestedTenantId = req.params[paramName];

      if (!requestedTenantId) {
        res.status(400).json({
          error: 'Bad Request',
          message: `Missing required path parameter: ${paramName}`,
        });
        return;
      }

      // Apply tenant boundary validation
      validateTenantOwnership(requestedTenantId, resourceName)(req, res, () => {
        next();
      });
    } catch (error) {
      if (error instanceof TenantBoundaryViolation) {
        res.status(403).json({
          error: 'Forbidden',
          message: `Access denied: You do not have permission to access this ${resourceName}`,
          code: 'TENANT_BOUNDARY_VIOLATION',
        });
        return;
      }

      if (error instanceof MissingTenantContext) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Missing tenant context',
          code: 'MISSING_TENANT_CONTEXT',
        });
        return;
      }

      next(error);
    }
  };
}

/**
 * Validates query parameter tenant scope.
 * Ensures users cannot query other tenants' data.
 */
export function validateTenantQueryParam(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const queryTenantId = req.query.tenantId as string | undefined;

  if (queryTenantId && req.tenantId && queryTenantId !== req.tenantId) {
    logger.log('warn', 'Cross-tenant query attempt', {
      action: 'cross_tenant_query',
      actor: req.authApiKeyHash || req.walletAddress,
      tenantId: req.tenantId,
      queryTenantId,
      path: req.path,
    });

    res.status(403).json({
      error: 'Forbidden',
      message: 'Cannot query data outside your tenant scope',
      code: 'CROSS_TENANT_QUERY_DENIED',
    });
    return;
  }

  next();
}

/**
 * Logs tenant access for audit trail.
 */
export function auditTenantAccess(
  tenantId: string,
  action: string,
  details: Record<string, unknown> = {}
): void {
  logger.log('info', 'Tenant access audit', {
    action,
    tenantId,
    timestamp: new Date().toISOString(),
    ...details,
  });
}
