/**
 * @file walletNonce.ts
 * Server-side nonce tracking for signed wallet actions (replay protection).
 * Race-condition hardening for Issue #1044.
 *
 * Each nonce is single-use and expires after WALLET_NONCE_TTL_SECONDS.
 * Backed by in-memory storage with optional Redis when REDIS_URL is set.
 */

import crypto from 'crypto';
import NodeCache from 'node-cache';
import Redis from 'ioredis';
import { logger } from './middleware/structuredLogging';
import { normalizeWalletAddress } from './walletUtils';

// ─── Config ───────────────────────────────────────────────────────────────────

export type WalletAction = 'login' | 'deposit' | 'withdrawal';

const DEFAULT_NONCE_TTL_SECONDS = parseInt(process.env.WALLET_NONCE_TTL_SECONDS || '300', 10);
const MAX_ACTIVE_NONCES_PER_WALLET = parseInt(
  process.env.WALLET_NONCE_MAX_ACTIVE_PER_WALLET || '10',
  10
);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IssuedWalletNonce {
  nonce: string;
  walletAddress: string;
  action: WalletAction;
  issuedAt: string;
  expiresAt: string;
  expiresIn: number;
  message: string;
}

export interface StoredNonce {
  nonce: string;
  walletAddress: string;
  action: WalletAction;
  issuedAt: number;
  expiresAt: number;
  used: boolean;
}

export interface NonceStoreMetrics {
  issued: number;
  consumed: number;
  replayRejected: number;
  expiredRejected: number;
  notFoundRejected: number;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class NonceNotFoundError extends Error {
  readonly code = 'NONCE_NOT_FOUND';

  constructor(message = 'Nonce was not issued for this wallet and action') {
    super(message);
    this.name = 'NonceNotFoundError';
  }
}

export class NonceExpiredError extends Error {
  readonly code = 'NONCE_EXPIRED';

  constructor(message = 'Nonce has expired. Request a new nonce and sign again.') {
    super(message);
    this.name = 'NonceExpiredError';
  }
}

export class NonceReplayError extends Error {
  readonly code = 'NONCE_REPLAY';

  constructor(message = 'Nonce has already been used. Request a new nonce and sign again.') {
    super(message);
    this.name = 'NonceReplayError';
  }
}

export class NonceActionMismatchError extends Error {
  readonly code = 'NONCE_ACTION_MISMATCH';

  constructor(message = 'Nonce was issued for a different action') {
    super(message);
    this.name = 'NonceActionMismatchError';
  }
}

export class NonceWalletMismatchError extends Error {
  readonly code = 'NONCE_WALLET_MISMATCH';

  constructor(message = 'Nonce was issued for a different wallet') {
    super(message);
    this.name = 'NonceWalletMismatchError';
  }
}

export class NonceLimitExceededError extends Error {
  readonly code = 'NONCE_LIMIT_EXCEEDED';

  constructor(maxActive: number) {
    super(
      `Too many active nonces for wallet (max ${maxActive}). ` +
        'Complete or wait for existing nonces to expire.'
    );
    this.name = 'NonceLimitExceededError';
  }
}

// ─── Store interface ──────────────────────────────────────────────────────────

export type NonceSaveResult = 'saved' | 'limit_reached' | 'nonce_conflict';
export type NonceConsumeResult =
  | 'consumed'
  | 'not_found'
  | 'wallet_mismatch'
  | 'action_mismatch'
  | 'expired'
  | 'replay';

export interface INonceStore {
  saveIfBelowLimit(
    entry: StoredNonce,
    ttlSeconds: number,
    maxActive: number
  ): Promise<NonceSaveResult>;
  get(nonce: string): Promise<StoredNonce | null>;
  consume(
    nonce: string,
    walletAddress: string,
    action: WalletAction,
    now: number
  ): Promise<NonceConsumeResult>;
}

// ─── In-memory store ─────────────────────────────────────────────────────────

export class InMemoryNonceStore implements INonceStore {
  private readonly byNonce: NodeCache;
  private readonly walletIndex = new Map<string, Set<string>>();

  constructor(ttlSeconds: number) {
    this.byNonce = new NodeCache({
      stdTTL: ttlSeconds,
      checkperiod: Math.min(60, ttlSeconds),
      useClones: false,
    });
  }

  async saveIfBelowLimit(
    entry: StoredNonce,
    ttlSeconds: number,
    maxActive: number
  ): Promise<NonceSaveResult> {
    const existing = this.byNonce.get<StoredNonce>(entry.nonce);
    if (existing) return 'nonce_conflict';

    const set = this.walletIndex.get(entry.walletAddress) ?? new Set<string>();
    let active = 0;
    for (const nonce of set) {
      const indexedEntry = this.byNonce.get<StoredNonce>(nonce);
      if (indexedEntry && !indexedEntry.used && indexedEntry.expiresAt > Date.now()) {
        active++;
      } else {
        set.delete(nonce);
      }
    }

    if (active >= maxActive) return 'limit_reached';

    this.byNonce.set(entry.nonce, entry, ttlSeconds);
    set.add(entry.nonce);
    this.walletIndex.set(entry.walletAddress, set);
    return 'saved';
  }

  async get(nonce: string): Promise<StoredNonce | null> {
    return this.byNonce.get<StoredNonce>(nonce) ?? null;
  }

  async consume(
    nonce: string,
    walletAddress: string,
    action: WalletAction,
    now: number
  ): Promise<NonceConsumeResult> {
    const entry = this.byNonce.get<StoredNonce>(nonce);
    if (!entry) return 'not_found';
    if (entry.walletAddress !== walletAddress) return 'wallet_mismatch';
    if (entry.action !== action) return 'action_mismatch';
    if (entry.expiresAt <= now) return 'expired';
    if (entry.used) return 'replay';

    entry.used = true;
    const remainingTtlSeconds = Math.max(1, Math.ceil((entry.expiresAt - now) / 1000));
    this.byNonce.set(nonce, entry, remainingTtlSeconds);
    this.walletIndex.get(walletAddress)?.delete(nonce);
    return 'consumed';
  }

  flushAll(): void {
    this.byNonce.flushAll();
    this.walletIndex.clear();
  }

  expireForTests(nonce: string): void {
    const entry = this.byNonce.get<StoredNonce>(nonce);
    if (!entry) return;
    entry.expiresAt = Date.now() - 1000;
    this.byNonce.set(nonce, entry, 1);
  }
}

// ─── Redis store ─────────────────────────────────────────────────────────────

/**
 * Counts/prunes a wallet's live nonces and reserves the new nonce in one Redis
 * command. Keeping the check and write in Lua prevents concurrent replicas from
 * exceeding the wallet cap.
 */
const SAVE_NONCE_SCRIPT = `
local active = 0
local now = tonumber(ARGV[5])
local indexedNonces = redis.call('SMEMBERS', KEYS[2])

for _, indexedNonce in ipairs(indexedNonces) do
  local raw = redis.call('GET', ARGV[1] .. indexedNonce)
  local keep = false
  if raw then
    local decodedOk, decoded = pcall(cjson.decode, raw)
    local expiresAt = decodedOk and tonumber(decoded.expiresAt) or nil
    keep = decodedOk
      and decoded.used ~= true
      and expiresAt ~= nil
      and expiresAt > now
  end

  if keep then
    active = active + 1
  else
    redis.call('SREM', KEYS[2], indexedNonce)
  end
end

if active >= tonumber(ARGV[6]) then
  return 0
end

if redis.call('EXISTS', KEYS[1]) == 1 then
  return -1
end

redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[4])
redis.call('SADD', KEYS[2], ARGV[3])
redis.call('EXPIRE', KEYS[2], ARGV[4])
return 1
`;

/**
 * Validates and marks a nonce used in one Redis command. This is the replay
 * protection boundary: exactly one replica can receive result 0.
 */
const CONSUME_NONCE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return 1
end

local decodedOk, entry = pcall(cjson.decode, raw)
if not decodedOk then
  return 1
end
if entry.walletAddress ~= ARGV[1] then
  return 2
end
if entry.action ~= ARGV[2] then
  return 3
end
local expiresAt = tonumber(entry.expiresAt)
if not expiresAt then
  return 1
end
if expiresAt <= tonumber(ARGV[4]) then
  return 4
end
if entry.used == true then
  return 5
end

local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then
  return 4
end

entry.used = true
redis.call('SET', KEYS[1], cjson.encode(entry), 'PX', ttl)
redis.call('SREM', KEYS[2], ARGV[3])
return 0
`;

export class RedisNonceStore implements INonceStore {
  constructor(private readonly redis: Redis) {}

  private entryKey(nonce: string): string {
    return `wallet-nonce:${nonce}`;
  }

  private walletSetKey(walletAddress: string): string {
    return `wallet-nonce:active:${walletAddress}`;
  }

  async saveIfBelowLimit(
    entry: StoredNonce,
    ttlSeconds: number,
    maxActive: number
  ): Promise<NonceSaveResult> {
    const result = Number(
      await this.redis.eval(
        SAVE_NONCE_SCRIPT,
        2,
        this.entryKey(entry.nonce),
        this.walletSetKey(entry.walletAddress),
        'wallet-nonce:',
        JSON.stringify(entry),
        entry.nonce,
        String(ttlSeconds),
        String(Date.now()),
        String(maxActive)
      )
    );

    if (result === 1) return 'saved';
    if (result === 0) return 'limit_reached';
    return 'nonce_conflict';
  }

  async get(nonce: string): Promise<StoredNonce | null> {
    const raw = await this.redis.get(this.entryKey(nonce));
    if (!raw) return null;
    return JSON.parse(raw) as StoredNonce;
  }

  async consume(
    nonce: string,
    walletAddress: string,
    action: WalletAction,
    now: number
  ): Promise<NonceConsumeResult> {
    const result = Number(
      await this.redis.eval(
        CONSUME_NONCE_SCRIPT,
        2,
        this.entryKey(nonce),
        this.walletSetKey(walletAddress),
        walletAddress,
        action,
        nonce,
        String(now)
      )
    );

    const outcomes: Record<number, NonceConsumeResult> = {
      0: 'consumed',
      1: 'not_found',
      2: 'wallet_mismatch',
      3: 'action_mismatch',
      4: 'expired',
      5: 'replay',
    };
    return outcomes[result] ?? 'not_found';
  }
}

// ─── Service ─────────────────────────────────────────────────────────────────

function createNonceStore(): INonceStore {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const redis = new Redis(redisUrl, { lazyConnect: true, enableOfflineQueue: false });
    redis.on('error', (err) => {
      logger.log('error', 'Redis wallet nonce store error', { error: err.message });
    });
    return new RedisNonceStore(redis);
  }
  return new InMemoryNonceStore(DEFAULT_NONCE_TTL_SECONDS);
}

export class WalletNonceService {
  private readonly store: INonceStore;
  private readonly inMemoryStore: InMemoryNonceStore | null;
  private metrics: NonceStoreMetrics = {
    issued: 0,
    consumed: 0,
    replayRejected: 0,
    expiredRejected: 0,
    notFoundRejected: 0,
  };

  constructor(store: INonceStore) {
    this.store = store;
    this.inMemoryStore = store instanceof InMemoryNonceStore ? store : null;
  }

  getMetrics(): NonceStoreMetrics {
    return { ...this.metrics };
  }

  getTtlSeconds(): number {
    return DEFAULT_NONCE_TTL_SECONDS;
  }

  async issue(
    walletAddress: string,
    action: WalletAction,
    buildMessage: (meta: Omit<IssuedWalletNonce, 'message'>) => string
  ): Promise<IssuedWalletNonce> {
    const wallet = normalizeWalletAddress(walletAddress);
    // A cryptographic collision is vanishingly unlikely, but bounded retries
    // make the store contract explicit and avoid overwriting an existing nonce.
    for (let attempt = 0; attempt < 3; attempt++) {
      const now = Date.now();
      const expiresAt = now + DEFAULT_NONCE_TTL_SECONDS * 1000;
      const nonce = crypto.randomBytes(24).toString('hex');

      const base: Omit<IssuedWalletNonce, 'message'> = {
        nonce,
        walletAddress: wallet,
        action,
        issuedAt: new Date(now).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
        expiresIn: DEFAULT_NONCE_TTL_SECONDS,
      };

      const issued: IssuedWalletNonce = {
        ...base,
        message: buildMessage(base),
      };

      const result = await this.store.saveIfBelowLimit(
        {
          nonce,
          walletAddress: wallet,
          action,
          issuedAt: now,
          expiresAt,
          used: false,
        },
        DEFAULT_NONCE_TTL_SECONDS,
        MAX_ACTIVE_NONCES_PER_WALLET
      );

      if (result === 'limit_reached') {
        throw new NonceLimitExceededError(MAX_ACTIVE_NONCES_PER_WALLET);
      }
      if (result === 'saved') {
        this.metrics.issued++;
        return issued;
      }
    }

    throw new Error('Unable to allocate a unique wallet nonce');
  }

  /**
   * Loads nonce metadata and validates wallet/action/expiry without consuming.
   */
  async validateForUse(
    walletAddress: string,
    action: WalletAction,
    nonce: string
  ): Promise<IssuedWalletNonce> {
    const wallet = normalizeWalletAddress(walletAddress);
    const trimmed = nonce.trim();
    const entry = await this.store.get(trimmed);

    if (!entry) {
      this.metrics.notFoundRejected++;
      throw new NonceNotFoundError();
    }

    if (entry.walletAddress !== wallet) {
      this.metrics.notFoundRejected++;
      throw new NonceWalletMismatchError();
    }

    if (entry.action !== action) {
      this.metrics.notFoundRejected++;
      throw new NonceActionMismatchError();
    }

    if (entry.expiresAt < Date.now()) {
      this.metrics.expiredRejected++;
      throw new NonceExpiredError();
    }

    if (entry.used) {
      this.metrics.replayRejected++;
      throw new NonceReplayError();
    }

    return {
      nonce: trimmed,
      walletAddress: wallet,
      action,
      issuedAt: new Date(entry.issuedAt).toISOString(),
      expiresAt: new Date(entry.expiresAt).toISOString(),
      expiresIn: Math.max(0, Math.floor((entry.expiresAt - Date.now()) / 1000)),
      message: '',
    };
  }

  /**
   * Atomically consumes a nonce after signature verification.
   */
  async consume(walletAddress: string, action: WalletAction, nonce: string): Promise<void> {
    const wallet = normalizeWalletAddress(walletAddress);
    const result = await this.store.consume(nonce.trim(), wallet, action, Date.now());

    switch (result) {
      case 'consumed':
        this.metrics.consumed++;
        return;
      case 'wallet_mismatch':
        this.metrics.notFoundRejected++;
        throw new NonceWalletMismatchError();
      case 'action_mismatch':
        this.metrics.notFoundRejected++;
        throw new NonceActionMismatchError();
      case 'expired':
        this.metrics.expiredRejected++;
        throw new NonceExpiredError();
      case 'replay':
        this.metrics.replayRejected++;
        throw new NonceReplayError();
      case 'not_found':
        this.metrics.notFoundRejected++;
        throw new NonceNotFoundError();
    }
  }

  clearForTests(): void {
    this.inMemoryStore?.flushAll();
    this.metrics = {
      issued: 0,
      consumed: 0,
      replayRejected: 0,
      expiredRejected: 0,
      notFoundRejected: 0,
    };
  }

  /** Forces a nonce to appear expired (in-memory store tests only). */
  async expireNonceForTests(nonce: string): Promise<void> {
    this.inMemoryStore?.expireForTests(nonce);
  }
}

export const walletNonceService = new WalletNonceService(createNonceStore());
