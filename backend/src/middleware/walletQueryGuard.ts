/**
 * @file walletQueryGuard.ts
 * Centralized wallet-scope query guards for list and detail endpoints.
 *
 * Prevents accidental cross-wallet data access by providing reusable
 * Prisma `where` clause builders and an Express middleware that injects
 * the resolved wallet filter into `req.walletScope`.
 *
 * Issue #701
 */

import type { Request, Response, NextFunction } from 'express';
import { normalizeWalletAddress, formatWalletForLog } from '../walletUtils';
import { getAuthenticatedWalletAddress } from './tenantGuard';
import { hasPermission, Permission } from './rbac';
import { logger } from './structuredLogging';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WalletScope {
  /** The normalized wallet address that all queries MUST filter on. */
  walletAddress: string;
  /** True when the caller is an admin bypassing tenant isolation. */
  isAdminBypass: boolean;
}

declare global {
  namespace Express {
    interface Request {
      walletScope?: WalletScope;
    }
  }
}

export interface WalletQueryGuardOptions {
  /**
   * Dot-separated path(s) to look up the wallet address on the request,
   * checked in order. First non-empty match wins.
   * Defaults to `['query.walletAddress', 'params.walletAddress']`.
   */
  walletParamPaths?: string[];
  /** Whether an admin API key can bypass the wallet scope. */
  allowAdminBypass?: boolean;
  /** Permission required for admin bypass. Defaults to ADMIN_READ. */
  adminBypassPermission?: Permission;
  /** If true, requests without a wallet parameter receive 400. */
  requireWallet?: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractFromRequest(req: Request, path: string): unknown {
  const parts = path.split('.');
  let current: any = req; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function resolveRequestedWallet(
  req: Request,
  paths: string[],
): string | null {
  for (const p of paths) {
    const raw = extractFromRequest(req, p);
    if (raw && typeof raw === 'string' && raw.trim().length > 0) {
      return normalizeWalletAddress(raw);
    }
  }
  return null;
}

// ─── Middleware ──────────────────────────────────────────────────────────────

/**
 * Express middleware that resolves and validates the wallet scope for the
 * current request.  Downstream handlers read `req.walletScope` to build
 * Prisma/SQL queries that are guaranteed to be tenant-safe.
 */
export function walletQueryGuard(options: WalletQueryGuardOptions = {}) {
  const {
    walletParamPaths = ['query.walletAddress', 'params.walletAddress'],
    allowAdminBypass = false,
    adminBypassPermission = Permission.ADMIN_READ,
    requireWallet = true,
  } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    const requestedWallet = resolveRequestedWallet(req, walletParamPaths);

    // 1. If wallet is required but missing → 400
    if (!requestedWallet) {
      if (requireWallet) {
        res.status(400).json({
          error: 'Bad Request',
          code: 'WALLET_ADDRESS_REQUIRED',
          status: 400,
          message: 'A walletAddress parameter is required for this endpoint.',
        });
        return;
      }
      // Non-required: skip scope injection, let handler decide
      next();
      return;
    }

    // 2. Admin bypass check
    const authHeader = req.headers.authorization || '';
    const isApiKey = /^ApiKey\s+/i.test(authHeader);
    if (isApiKey && allowAdminBypass && hasPermission(req, adminBypassPermission)) {
      req.walletScope = { walletAddress: requestedWallet, isAdminBypass: true };
      logger.log('debug', 'walletQueryGuard: admin bypass', { walletAddress: formatWalletForLog(requestedWallet) });
      next();
      return;
    }

    // 3. Authenticated user — must own the requested wallet
    const authenticatedWallet = getAuthenticatedWalletAddress(req);
    if (authenticatedWallet && authenticatedWallet !== requestedWallet) {
      res.status(403).json({
        error: 'Forbidden',
        code: 'WALLET_SCOPE_VIOLATION',
        status: 403,
        message: 'You can only access your own wallet data.',
      });
      return;
    }

    req.walletScope = { walletAddress: requestedWallet, isAdminBypass: false };
    next();
  };
}

// ─── Query Helpers ──────────────────────────────────────────────────────────

/**
 * Returns a Prisma-compatible `where` filter scoped to the authenticated
 * wallet.  Throws if `req.walletScope` was not set by the middleware.
 *
 * Usage:
 * ```ts
 * const where = scopedWalletWhere(req);
 * const rows = await prisma.transaction.findMany({ where: { ...where, status: 'completed' } });
 * ```
 */
export function scopedWalletWhere(req: Request): { walletAddress: string } {
  if (!req.walletScope) {
    throw new Error(
      'walletQueryGuard middleware must be applied before calling scopedWalletWhere',
    );
  }
  return { walletAddress: req.walletScope.walletAddress };
}

/**
 * Validates that a single record belongs to the scoped wallet.
 * Returns true if the record is safe to return; false otherwise.
 */
export function isOwnedByScope(
  req: Request,
  recordWalletAddress: string,
): boolean {
  if (!req.walletScope) return false;
  return (
    req.walletScope.isAdminBypass ||
    normalizeWalletAddress(recordWalletAddress) === req.walletScope.walletAddress
  );
}

/**
 * Asserts that a record belongs to the scoped wallet and throws a
 * descriptive error otherwise.  Useful in detail (GET /:id) handlers.
 */
export function assertOwnedByScope(
  req: Request,
  recordWalletAddress: string,
): void {
  if (!isOwnedByScope(req, recordWalletAddress)) {
    const err = new Error('WALLET_SCOPE_VIOLATION') as Error & { statusCode: number; code: string };
    err.statusCode = 403;
    err.code = 'WALLET_SCOPE_VIOLATION';
    throw err;
  }
}
