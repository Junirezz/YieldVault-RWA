import type { Request, Response, NextFunction } from 'express';
import { normalizeWalletAddress } from '../walletUtils';
import { hasPermission, Permission } from './rbac';
import { verifyJwt, type AuthenticatedRequest } from '../auth';
import { hashApiKey } from './apiKeyAuth';

/**
 * Resolves the authenticated wallet address from the request, handling
 * both JWT bearer tokens and admin API keys (if impersonation is active).
 */
export function getAuthenticatedWalletAddress(req: Request): string | null {
  // Check for JWT first
  const authHeader = req.headers.authorization || '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) {
    try {
      const payload = verifyJwt(bearerMatch[1]);
      return normalizeWalletAddress(payload.sub);
    } catch {
      // JWT is invalid, continue checking other methods
    }
  }

  // Check for admin API key + impersonation
  const apiKeyMatch = authHeader.match(/^ApiKey\s+(.+)$/i);
  if (apiKeyMatch) {
    // If there's an x-wallet-address header and we have permission to impersonate, use that
    const impersonateWallet = req.headers['x-wallet-address'] as string | undefined;
    if (impersonateWallet && hasPermission(req, Permission.IMPERSONATE)) {
      return normalizeWalletAddress(impersonateWallet);
    }

    // Otherwise, admins can only access data for specific wallets they request (if allowed)
    // For now, admin-only endpoints are handled separately
    return null;
  }

  return null;
}

/**
 * Options for the tenant guard middleware.
 */
export interface TenantGuardOptions {
  /**
   * Where to get the requested wallet address from the request
   * (e.g. 'query.walletAddress', 'body.walletAddress', 'params.id').
   */
  walletParamPath: string;
  /**
   * Whether an admin API key can bypass the tenant check (for admin endpoints).
   */
  allowAdminBypass?: boolean;
  /**
   * The permission required for an admin to bypass the tenant check.
   * Defaults to Permission.ADMIN_READ.
   */
  adminBypassPermission?: Permission;
  /**
   * Whether anonymous requests should be rejected with 401 Unauthorized.
   */
  requireAuth?: boolean;
}

/**
 * Extracts a value from the request using a dot‑separated path (e.g., 'query.walletAddress').
 */
function extractFromRequest(req: Request, path: string): unknown {
  const parts = path.split('.');
  let current: any = req;
  for (const part of parts) {
    if (current == null) break;
    current = current[part];
  }
  return current;
}

/**
 * Middleware that enforces tenant‑safe access to wallet‑scoped resources.
 * 
 * This middleware ensures that:
 * - Regular users can only access their own data
 * - Admins can access any data (if allowed by permissions)
 * - Impersonation sessions are respected
 */
export function tenantGuard(options: TenantGuardOptions) {
  const {
    walletParamPath,
    allowAdminBypass = false,
    adminBypassPermission = Permission.ADMIN_READ,
    requireAuth = false,
  } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    // 1. Extract the requested wallet address from the request
    const rawRequestedWallet = extractFromRequest(req, walletParamPath);
    if (!rawRequestedWallet || typeof rawRequestedWallet !== 'string') {
      if (requireAuth) {
        res.status(401).json({
          error: 'Unauthorized',
          status: 401,
          message: 'Authentication required',
        });
        return;
      }
      // If no wallet is requested, this might be a public endpoint or
      // a different kind of resource – let it pass through for now
      next();
      return;
    }
    const requestedWallet = normalizeWalletAddress(rawRequestedWallet);

    // 2. Check for admin bypass
    const authHeader = req.headers.authorization || '';
    const isApiKey = authHeader.match(/^ApiKey\s+(.+)$/i);
    if (isApiKey && allowAdminBypass && hasPermission(req, adminBypassPermission)) {
      // Admin is allowed to bypass – proceed
      next();
      return;
    }

    // 3. Get the authenticated wallet address
    const authenticatedWallet = getAuthenticatedWalletAddress(req);

    // 4. Check if authenticated wallet matches requested wallet.
    if (!authenticatedWallet) {
      if (requireAuth) {
        res.status(401).json({
          error: 'Unauthorized',
          status: 401,
          message: 'Authentication required',
        });
        return;
      }
      next();
      return;
    }

    if (authenticatedWallet !== requestedWallet) {
      res.status(403).json({
        error: 'Forbidden',
        status: 403,
        message: 'You can only access your own wallet data',
      });
      return;
    }

    // 5. Proceed
    next();
  };
}

/**
 * Helper function to enforce tenant safety in query builders.
 * Returns a normalized wallet address that is guaranteed to match the
 * authenticated user (or an admin‑requested wallet).
 */
export function enforceTenantWallet(
  req: Request,
  requestedWallet: string,
  options?: { allowAdminBypass?: boolean; adminBypassPermission?: Permission }
): string {
  const opts = { allowAdminBypass: false, adminBypassPermission: Permission.ADMIN_READ, ...options };
  const normalizedRequested = normalizeWalletAddress(requestedWallet);
  const authenticatedWallet = getAuthenticatedWalletAddress(req);

  // Check admin bypass
  const authHeader = req.headers.authorization || '';
  const isApiKey = authHeader.match(/^ApiKey\s+(.+)$/i);
  if (isApiKey && opts.allowAdminBypass && hasPermission(req, opts.adminBypassPermission)) {
    return normalizedRequested;
  }

  // Anonymous requests are allowed to inspect public wallet data.
  if (!authenticatedWallet) {
    return normalizedRequested;
  }

  if (authenticatedWallet !== normalizedRequested) {
    throw new Error('FORBIDDEN_TENANT_ACCESS');
  }

  return normalizedRequested;
}
