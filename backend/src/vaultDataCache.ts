/**
 * @file vaultDataCache.ts
 * Dedicated caching layer for frequently accessed vault data.
 *
 * Caches vault balances, strategy performance, and user stats with
 * appropriate TTLs and automatic invalidation on write operations.
 *
 * Uses the existing Redis cache infrastructure with fail-open to in-memory LRU.
 */

import { getFromCache, setInCache, invalidateCachePattern, type RedisCacheEntry } from './redisCache';
import { Counter, register as defaultRegister } from 'prom-client';

// ─── Prometheus Metrics ───────────────────────────────────────────────────────

function createOrGetCounter(name: string, help: string): Counter {
  const existing = defaultRegister.getSingleMetric(name);
  if (existing) return existing as Counter;
  return new Counter({ name, help, registers: [defaultRegister] });
}

export const vaultCacheHitCount = createOrGetCounter(
  'vault_data_cache_hit_total',
  'Vault data cache hits',
);

export const vaultCacheMissCount = createOrGetCounter(
  'vault_data_cache_miss_total',
  'Vault data cache misses',
);

// ─── Cache Key Prefixes ──────────────────────────────────────────────────────

const VAULT_PREFIX = 'vault:';

// ─── TTL Configuration ────────────────────────────────────────────────────────

/** TTL for vault summary data (balances, TVL, APY) — 30s default */
const VAULT_SUMMARY_TTL_MS = parseInt(process.env.VAULT_SUMMARY_CACHE_TTL_MS || '30000', 10);

/** TTL for strategy performance data — 60s default */
const STRATEGY_PERF_TTL_MS = parseInt(process.env.STRATEGY_PERF_CACHE_TTL_MS || '60000', 10);

/** TTL for user-specific stats — 15s default */
const USER_STATS_TTL_MS = parseInt(process.env.USER_STATS_CACHE_TTL_MS || '15000', 10);

/** TTL for share price data — 10s default */
const SHARE_PRICE_TTL_MS = parseInt(process.env.SHARE_PRICE_CACHE_TTL_MS || '10000', 10);

// ─── Cache Keys ───────────────────────────────────────────────────────────────

export const VaultCacheKeys = {
  summary: () => `${VAULT_PREFIX}summary`,
  strategyPerf: (strategyId: string) => `${VAULT_PREFIX}strategy:${strategyId}:perf`,
  userStats: (wallet: string) => `${VAULT_PREFIX}user:${wallet}:stats`,
  sharePrice: () => `${VAULT_PREFIX}share-price`,
  tvl: () => `${VAULT_PREFIX}tvl`,
  apy: () => `${VAULT_PREFIX}apy`,
  strategyList: () => `${VAULT_PREFIX}strategies`,
} as const;

// ─── Cache Operations ─────────────────────────────────────────────────────────

/**
 * Get or set vault summary data with automatic TTL.
 * Returns cached data if available and fresh, otherwise calls the fetcher
 * and caches the result.
 */
export async function getOrSetVaultSummary<T>(
  fetcher: () => Promise<T>,
): Promise<{ data: T; cached: boolean }> {
  const key = VaultCacheKeys.summary();
  const cached = await getFromCache(key);

  if (cached && cached.expiresAt > Date.now()) {
    vaultCacheHitCount.inc();
    return { data: cached.data as T, cached: true };
  }

  vaultCacheMissCount.inc();
  const data = await fetcher();

  const entry: RedisCacheEntry = {
    data,
    statusCode: 200,
    headers: {},
    expiresAt: Date.now() + VAULT_SUMMARY_TTL_MS,
    ttl: VAULT_SUMMARY_TTL_MS,
    lastUsed: Date.now(),
  };
  await setInCache(key, entry, VAULT_SUMMARY_TTL_MS);

  return { data, cached: false };
}

/**
 * Get or set strategy performance data.
 */
export async function getOrSetStrategyPerf<T>(
  strategyId: string,
  fetcher: () => Promise<T>,
): Promise<{ data: T; cached: boolean }> {
  const key = VaultCacheKeys.strategyPerf(strategyId);
  const cached = await getFromCache(key);

  if (cached && cached.expiresAt > Date.now()) {
    vaultCacheHitCount.inc();
    return { data: cached.data as T, cached: true };
  }

  vaultCacheMissCount.inc();
  const data = await fetcher();

  const entry: RedisCacheEntry = {
    data,
    statusCode: 200,
    headers: {},
    expiresAt: Date.now() + STRATEGY_PERF_TTL_MS,
    ttl: STRATEGY_PERF_TTL_MS,
    lastUsed: Date.now(),
  };
  await setInCache(key, entry, STRATEGY_PERF_TTL_MS);

  return { data, cached: false };
}

/**
 * Get or set user-specific stats.
 */
export async function getOrSetUserStats<T>(
  wallet: string,
  fetcher: () => Promise<T>,
): Promise<{ data: T; cached: boolean }> {
  const key = VaultCacheKeys.userStats(wallet);
  const cached = await getFromCache(key);

  if (cached && cached.expiresAt > Date.now()) {
    vaultCacheHitCount.inc();
    return { data: cached.data as T, cached: true };
  }

  vaultCacheMissCount.inc();
  const data = await fetcher();

  const entry: RedisCacheEntry = {
    data,
    statusCode: 200,
    headers: {},
    expiresAt: Date.now() + USER_STATS_TTL_MS,
    ttl: USER_STATS_TTL_MS,
    lastUsed: Date.now(),
  };
  await setInCache(key, entry, USER_STATS_TTL_MS);

  return { data, cached: false };
}

/**
 * Get or set share price data.
 */
export async function getOrSetSharePrice<T>(
  fetcher: () => Promise<T>,
): Promise<{ data: T; cached: boolean }> {
  const key = VaultCacheKeys.sharePrice();
  const cached = await getFromCache(key);

  if (cached && cached.expiresAt > Date.now()) {
    vaultCacheHitCount.inc();
    return { data: cached.data as T, cached: true };
  }

  vaultCacheMissCount.inc();
  const data = await fetcher();

  const entry: RedisCacheEntry = {
    data,
    statusCode: 200,
    headers: {},
    expiresAt: Date.now() + SHARE_PRICE_TTL_MS,
    ttl: SHARE_PRICE_TTL_MS,
    lastUsed: Date.now(),
  };
  await setInCache(key, entry, SHARE_PRICE_TTL_MS);

  return { data, cached: false };
}

// ─── Cache Invalidation ───────────────────────────────────────────────────────

/**
 * Invalidate vault caches after a write operation (deposit, withdrawal, etc.)
 * Automatically called by the cache invalidation hooks.
 */
export async function invalidateVaultCaches(eventType: string, metadata?: Record<string, unknown>): Promise<void> {
  const patterns: string[] = [];

  if (eventType.startsWith('transaction.')) {
    patterns.push(`${VAULT_PREFIX}*`);
  }

  if (eventType === 'vault.deposit.created' || eventType === 'vault.withdrawal.created') {
    patterns.push(`${VAULT_PREFIX}summary`);
    patterns.push(`${VAULT_PREFIX}tvl`);
    patterns.push(`${VAULT_PREFIX}share-price`);
    patterns.push(`${VAULT_PREFIX}apy`);

    const wallet = metadata?.wallet as string | undefined;
    if (wallet) {
      patterns.push(VaultCacheKeys.userStats(wallet));
    }
  }

  if (eventType === 'vault.strategy.changed') {
    patterns.push(`${VAULT_PREFIX}strategy*`);
    patterns.push(`${VAULT_PREFIX}strategies`);
  }

  for (const pattern of patterns) {
    await invalidateCachePattern(pattern);
  }
}
