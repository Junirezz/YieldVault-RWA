import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './prismaClient';
import { isValidStellarAddress, normalizeWalletAddress } from './walletUtils';

export interface WalletAliasIdentifier {
  alias: string;
  source: string;
}

export interface WalletAliasMapping {
  canonicalId: string;
  aliases: string[];
  sources: string[];
}

type PrismaTransaction = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
type PrismaExecutor = PrismaClient | PrismaTransaction;

export class WalletAliasMappingService {
  private aliasToCanonical = new Map<string, string>();
  private aliasMetadata = new Map<string, { alias: string; source: string }>();
  private canonicalToAliases = new Map<string, Set<string>>();
  private canonicalToSources = new Map<string, Set<string>>();
  private canonicalIdCounter = 0;
  private hydrated = false;
  private hydrationPromise: Promise<void> | null = null;

  constructor(private readonly prismaProvider: () => PrismaClient = getPrismaClient) {}

  async loadFromDatabase(force = false): Promise<void> {
    if (this.hydrated && !force) {
      return;
    }

    if (this.hydrationPromise && !force) {
      return this.hydrationPromise;
    }

    this.hydrationPromise = this.loadFromDatabaseInternal();
    try {
      await this.hydrationPromise;
    } finally {
      this.hydrationPromise = null;
    }
  }

  async registerAlias(alias: string, source: string, canonicalId?: string): Promise<WalletAliasMapping> {
    const normalizedSource = this.normalizeSource(source);
    const normalizedAlias = this.normalizeAlias(alias, normalizedSource);

    if (!normalizedAlias) {
      throw new Error('Alias value is required');
    }

    if (!normalizedSource) {
      throw new Error('Source value is required');
    }

    await this.loadFromDatabase();

    const aliasKey = this.buildAliasKey(normalizedAlias, normalizedSource);
    const prisma = this.prismaProvider();
    const result = await prisma.$transaction(async (tx) => {
      await tx.walletAliasSource.upsert({
        where: { source: normalizedSource },
        create: { source: normalizedSource },
        update: {},
      });

      const existing = await tx.walletAlias.findUnique({ where: { aliasKey } });
      const targetCanonicalId = canonicalId || existing?.canonicalId || await this.createCanonicalId(tx);

      await tx.walletCanonicalIdentity.upsert({
        where: { id: targetCanonicalId },
        create: { id: targetCanonicalId },
        update: {},
      });

      if (existing && existing.canonicalId !== targetCanonicalId) {
        await this.mergeCanonicalMappingsInDatabase(existing.canonicalId, targetCanonicalId, tx);
      }

      await tx.walletAlias.upsert({
        where: { aliasKey },
        create: {
          canonicalId: targetCanonicalId,
          alias: normalizedAlias,
          source: normalizedSource,
          aliasKey,
        },
        update: {
          canonicalId: targetCanonicalId,
          alias: normalizedAlias,
          source: normalizedSource,
        },
      });

      return this.getIdentityLinksFromDatabase(targetCanonicalId, tx);
    });

    await this.loadFromDatabase(true);
    return result || this.createEmptyMapping(canonicalId || '');
  }

  async resolveAlias(alias: string, source: string): Promise<WalletAliasMapping | null> {
    const normalizedSource = this.normalizeSource(source);
    const normalizedAlias = this.normalizeAlias(alias, normalizedSource);

    if (!normalizedAlias || !normalizedSource) {
      return null;
    }

    await this.loadFromDatabase();

    const aliasKey = this.buildAliasKey(normalizedAlias, normalizedSource);
    const cachedCanonicalId = this.aliasToCanonical.get(aliasKey);
    if (cachedCanonicalId) {
      return this.getIdentityLinksFromCache(cachedCanonicalId);
    }

    const row = await this.prismaProvider().walletAlias.findUnique({ where: { aliasKey } });
    if (!row) {
      return null;
    }

    await this.loadFromDatabase(true);
    return this.getIdentityLinksFromCache(row.canonicalId);
  }

  async getIdentityLinks(canonicalId: string): Promise<WalletAliasMapping | null> {
    await this.loadFromDatabase();

    const cached = this.getIdentityLinksFromCache(canonicalId);
    if (cached) {
      return cached;
    }

    const mapping = await this.getIdentityLinksFromDatabase(canonicalId, this.prismaProvider());
    if (!mapping) {
      return null;
    }

    await this.loadFromDatabase(true);
    return this.getIdentityLinksFromCache(canonicalId);
  }

  async listIdentityLinks(): Promise<WalletAliasMapping[]> {
    await this.loadFromDatabase();

    return Array.from(this.canonicalToAliases.keys())
      .sort()
      .map((canonicalId) => this.getIdentityLinksFromCache(canonicalId))
      .filter((mapping): mapping is WalletAliasMapping => Boolean(mapping));
  }

  async deleteIdentityGroup(canonicalId: string): Promise<boolean> {
    await this.loadFromDatabase();

    const existing = await this.prismaProvider().walletCanonicalIdentity.findUnique({
      where: { id: canonicalId },
    });

    if (!existing) {
      return false;
    }

    await this.prismaProvider().walletCanonicalIdentity.delete({
      where: { id: canonicalId },
    });
    await this.loadFromDatabase(true);

    return true;
  }

  /**
   * Links a provider-specific alias to an existing canonical identity.
   */
  async linkProviderIdentity(
    primaryAlias: string,
    primarySource: string,
    linkedAlias: string,
    linkedSource: string,
  ): Promise<WalletAliasMapping> {
    const primary = await this.registerAlias(primaryAlias, primarySource);
    return this.registerAlias(linkedAlias, linkedSource, primary.canonicalId);
  }

  /**
   * Resolves any provider alias to the canonical Stellar wallet when one exists
   * in the identity group. Prevents duplicate records for the same user across
   * wallet providers.
   */
  async resolveCanonicalWallet(alias: string, source: string): Promise<string> {
    const normalizedSource = this.normalizeSource(source);
    const normalizedAlias = this.normalizeAlias(alias, normalizedSource);

    if (!normalizedAlias) {
      return '';
    }

    if (isValidStellarAddress(normalizedAlias)) {
      const stellar = normalizeWalletAddress(normalizedAlias);
      const existing = await this.resolveAlias(stellar, 'stellar');
      if (!existing) {
        await this.registerAlias(stellar, 'stellar');
      }
      return stellar;
    }

    const mapping = await this.resolveAlias(normalizedAlias, normalizedSource);
    if (!mapping) {
      await this.registerAlias(normalizedAlias, normalizedSource);
      return normalizedAlias;
    }

    const stellarAlias = mapping.aliases.find((entry) => isValidStellarAddress(entry));
    return stellarAlias ? normalizeWalletAddress(stellarAlias) : normalizedAlias;
  }

  /**
   * Returns true when two aliases refer to the same canonical identity.
   */
  async areSameIdentity(aliasA: string, sourceA: string, aliasB: string, sourceB: string): Promise<boolean> {
    const mappingA = await this.resolveAlias(aliasA, sourceA);
    const mappingB = await this.resolveAlias(aliasB, sourceB);

    if (!mappingA || !mappingB) {
      return false;
    }

    return mappingA.canonicalId === mappingB.canonicalId;
  }

  async resetForTests(): Promise<void> {
    this.clearCache();
    this.hydrated = false;
    this.hydrationPromise = null;

    const prisma = this.prismaProvider();
    await prisma.walletAlias.deleteMany();
    await prisma.walletAliasSource.deleteMany();
    await prisma.walletCanonicalIdentity.deleteMany();
  }

  private async loadFromDatabaseInternal(): Promise<void> {
    const rows = await this.prismaProvider().walletAlias.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    this.clearCache();

    for (const row of rows) {
      this.addAliasToCache(row.canonicalId, row.alias, row.source);
      this.canonicalIdCounter = Math.max(
        this.canonicalIdCounter,
        this.parseCanonicalIdCounter(row.canonicalId),
      );
    }

    this.hydrated = true;
  }

  private async getIdentityLinksFromDatabase(
    canonicalId: string,
    prisma: PrismaExecutor,
  ): Promise<WalletAliasMapping | null> {
    const rows = await prisma.walletAlias.findMany({
      where: { canonicalId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    if (rows.length === 0) {
      return null;
    }

    return {
      canonicalId,
      aliases: Array.from(new Set(rows.map((row) => row.alias))),
      sources: Array.from(new Set(rows.map((row) => row.source))),
    };
  }

  private getIdentityLinksFromCache(canonicalId: string): WalletAliasMapping | null {
    const aliases = this.canonicalToAliases.get(canonicalId);
    const sources = this.canonicalToSources.get(canonicalId);

    if (!aliases || !sources) {
      return null;
    }

    return {
      canonicalId,
      aliases: Array.from(aliases),
      sources: Array.from(sources),
    };
  }

  private addAliasToCache(canonicalId: string, alias: string, source: string): void {
    const aliasKey = this.buildAliasKey(alias, source);
    this.aliasToCanonical.set(aliasKey, canonicalId);
    this.aliasMetadata.set(aliasKey, { alias, source });

    const aliases = this.canonicalToAliases.get(canonicalId) || new Set<string>();
    const sources = this.canonicalToSources.get(canonicalId) || new Set<string>();

    aliases.add(alias);
    sources.add(source);

    this.canonicalToAliases.set(canonicalId, aliases);
    this.canonicalToSources.set(canonicalId, sources);
  }

  private async mergeCanonicalMappingsInDatabase(
    existingCanonicalId: string,
    targetCanonicalId: string,
    tx: PrismaTransaction,
  ): Promise<void> {
    await tx.walletAlias.updateMany({
      where: { canonicalId: existingCanonicalId },
      data: { canonicalId: targetCanonicalId },
    });

    await tx.walletCanonicalIdentity.deleteMany({
      where: { id: existingCanonicalId },
    });
  }

  private normalizeAlias(alias: string, source?: string): string {
    const trimmed = alias?.trim();

    if (!trimmed) {
      return '';
    }

    if (this.isStellarAddress(trimmed) || source === 'stellar') {
      return normalizeWalletAddress(trimmed);
    }

    return trimmed.toLowerCase();
  }

  private normalizeSource(source: string): string {
    const trimmed = source?.trim();

    if (!trimmed) {
      return '';
    }

    return trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  private buildAliasKey(alias: string, source: string): string {
    return `${source}:${alias}`;
  }

  private async createCanonicalId(tx: PrismaTransaction): Promise<string> {
    while (true) {
      this.canonicalIdCounter += 1;
      const id = `wallet-alias:${this.canonicalIdCounter}`;
      const existing = await tx.walletCanonicalIdentity.findUnique({ where: { id } });
      if (!existing) {
        return id;
      }
    }
  }

  private parseCanonicalIdCounter(canonicalId: string): number {
    const match = canonicalId.match(/^wallet-alias:(\d+)$/);
    if (!match) {
      return 0;
    }

    return Number.parseInt(match[1], 10) || 0;
  }

  private isStellarAddress(alias: string): boolean {
    return /^G[A-Z0-9]{55,63}$/i.test(alias);
  }

  private createEmptyMapping(canonicalId: string): WalletAliasMapping {
    return {
      canonicalId,
      aliases: [],
      sources: [],
    };
  }

  private clearCache(): void {
    this.aliasToCanonical.clear();
    this.aliasMetadata.clear();
    this.canonicalToAliases.clear();
    this.canonicalToSources.clear();
    this.canonicalIdCounter = 0;
  }
}

export const walletAliasMappingService = new WalletAliasMappingService();
