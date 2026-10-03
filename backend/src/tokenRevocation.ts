/**
 * Token revocation tracking for secure session management.
 * 
 * Tracks revoked tokens to prevent reuse after logout or rotation.
 * Supports both Redis (multi-instance) and in-memory (single-instance) backends.
 * 
 * Revocation reasons:
 * - LOGOUT: User explicitly logged out
 * - ROTATION: Token was rotated during refresh
 * - SUSPICIOUS: Suspicious activity detected
 * - COMPROMISED: Token was compromised
 *
 * Issue #1431: this store is consulted on **every** authenticated request, not
 * only on refresh. Two kinds of revocation are therefore tracked:
 *
 *   - per token id (`jti`) — the exact access token that was logged out, and
 *   - per wallet, as a high-water mark (`revokedBefore`) — every access token
 *     issued at or before that instant, which is what `/auth/logout-all` and a
 *     "this token is compromised" event need. A timestamp rather than an
 *     explicit id list keeps the store O(1) per wallet instead of O(tokens).
 */

import Redis from 'ioredis';
import { logger } from './middleware/structuredLogging';

export type RevocationReason = 'logout' | 'rotation' | 'suspicious' | 'compromised';

export interface RevocationRecord {
  tokenId: string;
  walletAddress: string;
  revokedAt: number; // Unix timestamp
  reason: RevocationReason;
  expiresAt: number; // When to remove from store
}

export interface WalletRevocation {
  /** Access tokens issued at or before this instant (unix ms) are rejected. */
  revokedBefore: number;
  reason: RevocationReason;
  /** When the wallet marker itself expires from the store. */
  expiresAt: number;
}

export interface RevocationStore {
  revoke(record: RevocationRecord): Promise<void>;
  isRevoked(tokenId: string): Promise<boolean>;
  revokeAllForWallet(walletAddress: string, reason: RevocationReason): Promise<number>;
  clear(): Promise<void>;
  /**
   * Reject every access token for `walletAddress` issued at or before
   * `issuedAtMs` (the token's `iat` claim, in unix milliseconds).
   */
  revokeWalletBefore(
    walletAddress: string,
    issuedAtMs: number,
    reason: RevocationReason,
  ): Promise<void>;
  /** True when the wallet has been revoked at or after `issuedAtMs`. */
  isWalletRevokedBefore(walletAddress: string, issuedAtMs: number): Promise<boolean>;
}

/**
 * How long a wallet-wide revocation marker is retained. No live access token
 * can predate the marker once the longest access-token TTL has elapsed, so a
 * marker older than that can never match and is safe to drop.
 */
const WALLET_REVOCATION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * In-memory revocation store for single-instance deployments.
 */
export class InMemoryRevocationStore implements RevocationStore {
  private revoked = new Map<string, RevocationRecord>();
  private walletRevocations = new Map<string, WalletRevocation>();

  async revoke(record: RevocationRecord): Promise<void> {
    this.revoked.set(record.tokenId, record);
    // Clean up expired entries
    this.cleanup();
  }

  async isRevoked(tokenId: string): Promise<boolean> {
    const record = this.revoked.get(tokenId);
    if (!record) return false;
    
    const now = Date.now();
    if (record.expiresAt < now) {
      this.revoked.delete(tokenId);
      return false;
    }
    
    return true;
  }

  async revokeAllForWallet(walletAddress: string, reason: RevocationReason): Promise<number> {
    // Drop the per-token entries for this wallet: the wallet marker written
    // below now decides. Previously this method only deleted records without
    // recording anything, which silently un-revoked every one of them.
    let count = 0;
    for (const [tokenId, record] of this.revoked.entries()) {
      if (record.walletAddress === walletAddress) {
        this.revoked.delete(tokenId);
        count++;
      }
    }
    await this.revokeWalletBefore(walletAddress, Date.now(), reason);
    return count;
  }

  async revokeWalletBefore(
    walletAddress: string,
    issuedAtMs: number,
    reason: RevocationReason,
  ): Promise<void> {
    const existing = this.walletRevocations.get(walletAddress);
    if (existing && existing.revokedBefore >= issuedAtMs) {
      // A broader (later) revocation always wins; never move the marker back.
      return;
    }
    this.walletRevocations.set(walletAddress, {
      revokedBefore: issuedAtMs,
      reason,
      expiresAt: issuedAtMs + WALLET_REVOCATION_TTL_MS,
    });
  }

  async isWalletRevokedBefore(walletAddress: string, issuedAtMs: number): Promise<boolean> {
    const marker = this.walletRevocations.get(walletAddress);
    if (!marker) return false;

    if (marker.expiresAt < Date.now()) {
      this.walletRevocations.delete(walletAddress);
      return false;
    }

    return issuedAtMs <= marker.revokedBefore;
  }

  async clear(): Promise<void> {
    this.revoked.clear();
    this.walletRevocations.clear();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [tokenId, record] of this.revoked.entries()) {
      if (record.expiresAt < now) {
        this.revoked.delete(tokenId);
      }
    }
    for (const [walletAddress, marker] of this.walletRevocations.entries()) {
      if (marker.expiresAt < now) {
        this.walletRevocations.delete(walletAddress);
      }
    }
  }
}

/**
 * Redis-backed revocation store for multi-instance deployments.
 * 
 * Key schema:
 * - `revocation:token:{tokenId}` → JSON revocation record (with TTL = expiresAt)
 * - `revocation:wallet:{walletAddress}` → set of revoked token IDs
 * - `revocation:wallet-revoked-before:{walletAddress}` → JSON
 *   {@link WalletRevocation} high-water mark (Issue #1431)
 */
export class RedisRevocationStore implements RevocationStore {
  private readonly keyPrefix = 'revocation:';
  private readonly fallback: InMemoryRevocationStore;

  constructor(
    private readonly redis: Redis,
  ) {
    this.fallback = new InMemoryRevocationStore();
  }

  async revoke(record: RevocationRecord): Promise<void> {
    try {
      const ttl = Math.max(1, Math.ceil((record.expiresAt - Date.now()) / 1000));
      
      // Store revocation record
      const key = `${this.keyPrefix}token:${record.tokenId}`;
      await this.redis.setex(
        key,
        ttl,
        JSON.stringify(record)
      );

      // Add to wallet's revocation set
      const walletKey = `${this.keyPrefix}wallet:${record.walletAddress}`;
      await this.redis.sadd(walletKey, record.tokenId);
      
      logger.debug('Token revoked', {
        tokenId: record.tokenId,
        reason: record.reason,
      });
    } catch (err) {
      logger.error('Failed to revoke token', {
        error: err instanceof Error ? err.message : String(err),
      });
      // Fallback to in-memory store
      await this.fallback.revoke(record);
    }
  }

  async isRevoked(tokenId: string): Promise<boolean> {
    try {
      const key = `${this.keyPrefix}token:${tokenId}`;
      const exists = await this.redis.exists(key);
      return exists === 1;
    } catch (err) {
      logger.error('Failed to check token revocation', {
        error: err instanceof Error ? err.message : String(err),
      });
      // Fallback to in-memory store
      return this.fallback.isRevoked(tokenId);
    }
  }

  async revokeAllForWallet(walletAddress: string, reason: RevocationReason): Promise<number> {
    try {
      const walletKey = `${this.keyPrefix}wallet:${walletAddress}`;
      const tokenIds = await this.redis.smembers(walletKey);

      // Remove each token: the wallet high-water mark written below now
      // decides, so keeping per-token entries would only add read cost.
      if (tokenIds.length > 0) {
        const pipeline = this.redis.pipeline();
        for (const tokenId of tokenIds) {
          const key = `${this.keyPrefix}token:${tokenId}`;
          pipeline.del(key);
        }
        pipeline.del(walletKey);

        await pipeline.exec();
      }

      await this.revokeWalletBefore(walletAddress, Date.now(), reason);

      logger.info('All tokens revoked for wallet', {
        walletAddress,
        reason,
        count: tokenIds.length,
      });

      return tokenIds.length;
    } catch (err) {
      logger.error('Failed to revoke wallet tokens', {
        walletAddress,
        error: err instanceof Error ? err.message : String(err),
      });
      return this.fallback.revokeAllForWallet(walletAddress, reason);
    }
  }

  async revokeWalletBefore(
    walletAddress: string,
    issuedAtMs: number,
    reason: RevocationReason,
  ): Promise<void> {
    try {
      const key = `${this.keyPrefix}wallet-revoked-before:${walletAddress}`;
      const existingRaw = await this.redis.get(key);

      if (existingRaw) {
        const existing = JSON.parse(existingRaw) as WalletRevocation;
        if (existing.revokedBefore >= issuedAtMs) {
          // A broader (later) revocation always wins; never move it back.
          return;
        }
      }

      const marker: WalletRevocation = {
        revokedBefore: issuedAtMs,
        reason,
        expiresAt: issuedAtMs + WALLET_REVOCATION_TTL_MS,
      };
      const ttl = Math.max(1, Math.ceil((marker.expiresAt - Date.now()) / 1000));
      await this.redis.set(key, JSON.stringify(marker), 'EX', ttl);

      logger.debug('Wallet access tokens revoked', { walletAddress, reason, issuedAtMs });
    } catch (err) {
      logger.error('Failed to revoke wallet access tokens', {
        walletAddress,
        error: err instanceof Error ? err.message : String(err),
      });
      await this.fallback.revokeWalletBefore(walletAddress, issuedAtMs, reason);
    }
  }

  async isWalletRevokedBefore(walletAddress: string, issuedAtMs: number): Promise<boolean> {
    try {
      const key = `${this.keyPrefix}wallet-revoked-before:${walletAddress}`;
      const raw = await this.redis.get(key);
      if (!raw) return false;

      const marker = JSON.parse(raw) as WalletRevocation;
      return issuedAtMs <= marker.revokedBefore;
    } catch (err) {
      logger.error('Failed to check wallet revocation', {
        walletAddress,
        error: err instanceof Error ? err.message : String(err),
      });
      return this.fallback.isWalletRevokedBefore(walletAddress, issuedAtMs);
    }
  }

  async clear(): Promise<void> {
    try {
      const keys = await this.redis.keys(`${this.keyPrefix}*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
      logger.info('Revocation store cleared', { keysRemoved: keys.length });
    } catch (err) {
      logger.error('Failed to clear revocation store', {
        error: err instanceof Error ? err.message : String(err),
      });
      await this.fallback.clear();
    }
  }
}

/**
 * Global revocation store instance.
 * Initialized by auth module based on deployment mode.
 */
let revocationStore: RevocationStore | null = null;

export function setRevocationStore(store: RevocationStore): void {
  revocationStore = store;
}

export function getRevocationStore(): RevocationStore {
  if (!revocationStore) {
    revocationStore = new InMemoryRevocationStore();
  }
  return revocationStore;
}
