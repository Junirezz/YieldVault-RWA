import { createHash } from 'crypto';
import type { Prisma } from '@prisma/client';
import { registerInvalidationHook, triggerCacheInvalidation } from './middleware/cache';

export const VAULT_COUNT_TTL_MS = 5000;

interface CountEntry {
  value: Promise<number>;
  expiresAt: number;
}

/** Bounded, process-local fallback: page and sorting options never enter the key. */
export class VaultCountCache {
  private entries = new Map<string, CountEntry>();
  private generation = 0;

  constructor(private readonly maxEntries = 500) {}

  clear(): void {
    this.generation++;
    this.entries.clear();
  }

  async get(
    filterHash: string,
    load: () => Promise<number>
  ): Promise<{ total: number; status: 'HIT' | 'MISS' }> {
    const generation = this.generation;
    let entry = this.entries.get(filterHash);
    const hit = !!entry && entry.expiresAt > Date.now();
    if (hit && entry) {
      // Refresh LRU order without extending the five-second lifetime.
      this.entries.delete(filterHash);
      this.entries.set(filterHash, entry);
    } else {
      this.entries.delete(filterHash);
      if (this.entries.size >= this.maxEntries) {
        const oldest = this.entries.keys().next().value;
        if (oldest !== undefined) this.entries.delete(oldest);
      }
      entry = { value: Promise.resolve().then(load), expiresAt: Infinity };
      this.entries.set(filterHash, entry);
      const current = entry;
      void current.value.then(
        () => {
          current.expiresAt = Date.now() + VAULT_COUNT_TTL_MS;
        },
        () => {
          if (this.entries.get(filterHash) === current) this.entries.delete(filterHash);
        }
      );
    }
    const total = await (entry as CountEntry).value;
    // A write during an in-flight count must not repopulate or return a stale total.
    if (generation !== this.generation) return this.get(filterHash, load);
    return { total, status: hit ? 'HIT' : 'MISS' };
  }
}

/** Sort object keys recursively; preserve array order and Prisma Date values. */
export function buildVaultFilterHash(where: Prisma.VaultWhereInput): string {
  const serialized = JSON.stringify(where, (_key, value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      );
    }
    return value;
  });
  return createHash('sha256').update(serialized).digest('hex');
}

export const vaultCountCache = new VaultCountCache();

registerInvalidationHook((eventType) => {
  if (['vault.create', 'vault.update', 'vault.delete'].includes(eventType)) {
    // All filters are cleared: updates can move a vault between filter groups.
    vaultCountCache.clear();
  }
  return [];
});

/** Used by both application Prisma clients, only after a successful write. */
export function invalidateVaultCountAfterMutation(
  model: string | undefined,
  operation: string
): void {
  if (model !== 'Vault') return;
  const events: Record<string, string> = {
    create: 'vault.create',
    createMany: 'vault.create',
    update: 'vault.update',
    updateMany: 'vault.update',
    upsert: 'vault.update',
    delete: 'vault.delete',
    deleteMany: 'vault.delete',
  };
  const event = events[operation];
  if (event) triggerCacheInvalidation(event);
}
