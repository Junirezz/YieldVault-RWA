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

export interface RevocationStore {
  revoke(record: RevocationRecord): Promise<void>;
  isRevoked(tokenId: string): Promise<boolean>;
  revokeAllForWallet(walletAddress: string, reason: RevocationReason): Promise<number>;
  clear(): Promise<void>;
}

/**
 * In-memory revocation store for single-instance deployments.
 */
export class InMemoryRevocationStore implements RevocationStore {
  private revoked = new Map<string, RevocationRecord>();

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
    let count = 0;
    for (const [tokenId, record] of this.revoked.entries()) {
      if (record.walletAddress === walletAddress) {
        this.revoked.delete(tokenId);
        count++;
      }
    }
    return count;
  }

  async clear(): Promise<void> {
    this.revoked.clear();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [tokenId, record] of this.revoked.entries()) {
      if (record.expiresAt < now) {
        this.revoked.delete(tokenId);
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
      
      if (tokenIds.length === 0) return 0;

      // Remove each token
      const pipeline = this.redis.pipeline();
      for (const tokenId of tokenIds) {
        const key = `${this.keyPrefix}token:${tokenId}`;
        pipeline.del(key);
      }
      pipeline.del(walletKey);
      
      await pipeline.exec();
      
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
      return 0;
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
