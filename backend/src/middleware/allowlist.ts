/**
 * @file middleware/allowlist.ts
 * Wallet address allowlist for private beta access control (Issue #375).
 *
 * During the private beta phase, only pre-approved wallet addresses may
 * perform write operations (deposits, withdrawals). All other wallets receive
 * HTTP 403 Forbidden.
 *
 * Key design choices:
 * - The in-memory Set gives O(1) lookups well under the 2 ms budget.
 * - The feature can be disabled entirely via ALLOWLIST_ENABLED=false so the
 *   same binary ships to public launch without a code change.
 * - Wallet addresses are normalised to upper-case before storage/lookup so
 *   that address casing differences do not cause false rejections.
 * - Admin endpoints (add / remove / list) are protected by the existing API
 *   key middleware – they must be mounted behind `validateApiKey`.
 *
 * Environment variables:
 *   ALLOWLIST_ENABLED          – set to "false" to disable checks (default: "true")
 *   ALLOWLIST_ADDRESSES        – comma-separated seed list of approved addresses
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from '../middleware/structuredLogging';

// ─── Store ────────────────────────────────────────────────────────────────────

/**
 * In-memory allowlist store.
 * Normalised wallet addresses (upper-case) are stored as Set members.
 * Replace with a Redis SET or DB table for multi-instance deployments.
 */
const allowedAddresses = new Set<string>();

/**
 * Seed the allowlist from the ALLOWLIST_ADDRESSES environment variable.
 * Called once at module load time.
 */
function seedFromEnv(): void {
  const raw = process.env.ALLOWLIST_ADDRESSES || '';
  raw
    .split(',')
    .map((addr) => addr.trim().toUpperCase())
    .filter(Boolean)
    .forEach((addr) => allowedAddresses.add(addr));

  if (allowedAddresses.size > 0) {
    logger.log('info', 'Allowlist seeded from ALLOWLIST_ADDRESSES', {
      count: allowedAddresses.size,
    });
  }
}

seedFromEnv();

// ─── Public Store API ─────────────────────────────────────────────────────────

/** Returns true if the address is in the allowlist. */
export function isAllowed(walletAddress: string): boolean {
  return allowedAddresses.has(walletAddress.trim().toUpperCase());
}

/** Adds a wallet address to the allowlist. Returns false if already present. */
export function addAddress(walletAddress: string): boolean {
  const normalised = walletAddress.trim().toUpperCase();
  if (allowedAddresses.has(normalised)) return false;
  allowedAddresses.add(normalised);
  return true;
}

/** Removes a wallet address from the allowlist. Returns false if not present. */
export function removeAddress(walletAddress: string): boolean {
  return allowedAddresses.delete(walletAddress.trim().toUpperCase());
}

/** Returns a sorted array of all allowlisted addresses (for admin visibility). */
export function listAddresses(): string[] {
  return Array.from(allowedAddresses).sort();
}

/** Returns the current size of the allowlist. */
export function allowlistSize(): number {
  return allowedAddresses.size;
}

/**
 * Removes all addresses from the allowlist.
 * Exposed for testing; not wired to any HTTP endpoint.
 */
export function clearAllowlist(): void {
  allowedAddresses.clear();
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Express middleware that enforces the wallet allowlist on write operations.
 *
 * When ALLOWLIST_ENABLED is "false" the check is skipped entirely (pass-through).
 * Otherwise, the wallet address is read from:
 *   1. req.body.walletAddress
 *   2. x-wallet-address request header
 * A missing wallet address is treated as not allowlisted (403).
 *
 * Allowlist checks add < 2 ms latency (O(1) Set lookup + env read).
 */
export function allowlistMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Feature flag: disabled → allow all wallets through
  if (process.env.ALLOWLIST_ENABLED === 'false') {
    next();
    return;
  }

  const wallet: string | undefined =
    (req.body?.walletAddress as string | undefined) ||
    (req.headers['x-wallet-address'] as string | undefined);

  if (!wallet) {
    res.status(403).json({
      error: 'Forbidden',
      status: 403,
      message: 'Wallet address is required and must be approved for private beta access.',
    });
    return;
  }

  if (!isAllowed(wallet)) {
    logger.log('warn', 'Allowlist check failed – wallet not approved', {
      wallet: wallet.slice(0, 8) + '…', // partial log for privacy
    });
    res.status(403).json({
      error: 'Forbidden',
      status: 403,
      message:
        'Your wallet address is not approved for private beta access. ' +
        'Please contact the YieldVault team to request access.',
    });
    return;
  }

  next();
}
