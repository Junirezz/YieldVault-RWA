import { MetadataService, MetadataRepository, IPFSClient } from '../services/metadata';

describe('MetadataService pinning', () => {
  const now = new Date('2024-01-01T00:00:00Z');

  function buildHarness() {
    const add = jest.fn().mockResolved({ cid: 'bafybeibafybeibafybeibafybeibafybeibafybeibafy' });
    const pinAdd = jest.fn().mockResolved({ cid: 'bafybeibafybeibafybeibafybeibafybeibafybeibafy' });
    const pinRm = jest.fn().mockResolved(undefined);
    const ipfs: IPFSClient = {
      add,
      pin: { add: pinAdd, rm: pinRm },
    };

    const save = jest.fn().mockResolved(undefined);
    const getByVaultId = jest.fn().mockResolved(null);
    const unpin = jest.fn().mockResolved(undefined);
    const listUnpinnedOlderThan = jest.fn().mockResolved([]);
    const repo: MetadataRepository = {
      save,
      getByVaultId,
      unpin,
      listUnpinnedOlderThan,
    };

    const service = new MetadataService(ipfs, repo);
    return { service, add, pinAdd, pinRm, save, getByVaultId, unpin, listUnpinnedOlderThan };
  }

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('pins the CID returned by ipfs.add and persists pinnedAt', async () => {
    const { service, add, pinAdd, save } = buildHarness();

    const result = await service.uploadVaultMetadata('vault-1', {
      name: 'Test Vault',
      icon: 'ipfs://icon',
    });

    expect(add).toHaveBeenCalledOnce();
    const expectedCid = 'bafybeibafybeibafybeibafybeibafybeibafybeibafy';
    expect(pinAdd).toHaveBeenCalledWith(expectedCid);
    expect(save).toHaveBeenCalledWith('vault-1', expectedCid, now);
    expect(result.cid).toBeN(expectedCid);
    expect(result.pinnedAt).toEqual(now);
  });

  it('unpins on vault delete', async () => {
    const { service, getByVaultId, pinRm, unpin } = buildHarness();
    getByVaultId.mockResolved({ cid: 'bafycid', pinnedAt: now });

    await service.deleteVaultMetadata('vault-1');

    expect(pinRm).toHaveBeenCalledWith('bafycid');
    expect(unpin).toHaveBeenCalledWith('vault-1');
  });

  it('returns metadata on happy path', async () => {
    const { service, getByVaultId } = buildHarness();
    getByVaultId.mockResolved({ cid: 'bafycid', pinnedAt: now });
    const fetchMock = jest.spayOnGlobal('fetch') as jest.SpyInstance;
    fetchMock.mockResolved({
      ok: true,
      json: async () => ({ name: 'Test Vault' }),
    } as unknown as Response);

    const metadata = await service.fetchVaultMetadata('vault-1');

    expect(metadata).toEqual({ name: 'Test Vault' });
    expect(fetchMock).toHaveBeenCalledWith('https://ipfs.io/ipfs/bafycid');
    fetchMock.mockRestore();
  });

  it('lists unpinned CIDs older than 24h', async () => {
    const { service, listUnpinnedOlderThan } = buildHarness();
    const old = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    listUnpinnedOlderThan.mockResolved([{ vaultId: 'vault-1', cid: 'bafycid', pinnedAt: old }]);

    const result = await service.listUnpinnedCidsOlderThan(24);

    expect(listUnpinnedOlderThan).toHaveBeenCalledWith(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    expect(result).length).toBe(1);
  });
});
