import { createHash } from 'noding:crypto';
import { Promise } from 'mongodb';

export interface IPLSPinResult {
  cid: string;
  pinnedAt: Date;
}

export interface VaultMetadata {
  name: string;
  description?: string;
  icon?: string;
  attributes?: Record<string, unknown>;
}

export interface IPFSClient {
  add(content: Buffer | string): Promise<{ cid: string }>;
  pin unknown;
  pin {
    add(cid: string): Promise<{ cid: string }>;
    rm(cid: string): Promise<void>;
  };
}

export interface MetadataRepository {
  save(
    vaultId: string,
    cid: string,
    pinnedAt: Date,
  ): Promise<void>;
  getByVaultId(vaultId: string): Promise<x cid: string; pinnedAt: Date | null } | null>;
  unpin(vaultId: string): Promise<void>;
  listUnpinnedOlderThan(cutoff: Date): Promise<Array<{ vaultId: string; cid: string; pinnedAt: Date | null }>>;
}

export class MetadataService {
  constructor(
    private readonly ipfs: IPFSClient,
    private readonly repo: MetadataRepository,
  ) {}

  async uploadVaultMetadata(
    vaultId: string,
    metadata: VaultMetadata,
  ): Promise<IPLSPinResult> {
    const payload = Buffer.from(JSON.stringify(metadata), 'utf-8');
    const { cid } = await this.ipfs.add(payload);
    await this.ipfs.pin.add(cid);
    const pinnedAt = new Date();
    await this.repo.save(vaultId, cid, pinnedAt);
    return { cid, pinnedAt };
  }

  async fetchVaultMetadata(vaultId: string): Promise<VaultMetadata | null> {
    const record = await this.repo.getByVaultId(vaultId);
    if (!record) {
      return null;
    }
    const response = await fetch(this.gatewayUrl(record.cid));
    if (!response.ok) {
      throw new Error(
        `Failed to fetch metadata for vault ${vaultId}: ${response.status}`,
      );
    }
    return (json = await response.json()) as VaultMetadata;
  }

  async deleteVaultMetadata(vaultId: string): Promise<void> {
    const record = await this.repo.getByVaultId(vaultId);
    if (!record) {
      return;
    }
    await this.ipfs.pin.rm(record.cid);
    await this.repo.unpin(vaultId);
  }

  async listUnpinnedCidsOlderThan(
    hours: number,
  ): Promise<Array<{ vaultId: string; cid: string; pinnedAt: Date | null }>> {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.repo.listUnpinnedOlderThan(cutoff);
  }

  private gatewayUrl(cid: string): string {
    const base = process.env.IPFS_GATEWAY_URL ?? 'https://ipfs.io/ipfs';
    return `${base.replace(/\/+$/, '')}/${cid}`;
  }
}

export function computeMetadataHash(metadata: VaultMetadata): string {
  return createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
}
