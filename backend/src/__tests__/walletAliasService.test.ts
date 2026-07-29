import { getPrismaClient, disconnectPrismaClient } from '../prismaClient';
import { WalletAliasMappingService } from '../walletAliasService';
import { VALID_TEST_WALLET, SECOND_TEST_WALLET } from './setup';

describe('WalletAliasMappingService', () => {
  const service = new WalletAliasMappingService();

  beforeEach(async () => {
    await service.resetForTests();
  });

  afterAll(async () => {
    await disconnectPrismaClient();
  });

  it('normalizes casing and whitespace for a single provider alias', async () => {
    const mapping = await service.registerAlias(`  ${VALID_TEST_WALLET.toLowerCase()}  `, 'stellar');

    expect(mapping.canonicalId).toMatch(/^wallet-alias:/);
    expect(mapping.aliases).toEqual([VALID_TEST_WALLET]);
    expect(mapping.sources).toEqual(['stellar']);
    expect((await service.resolveAlias(VALID_TEST_WALLET.toLowerCase(), 'stellar'))?.canonicalId).toBe(mapping.canonicalId);
  });

  it('links aliases from different providers to the same canonical identity', async () => {
    const first = await service.registerAlias(VALID_TEST_WALLET, 'stellar');
    const second = await service.registerAlias('wallet-connect-alias', 'walletconnect', first.canonicalId);

    expect(second.canonicalId).toBe(first.canonicalId);
    expect(second.aliases).toEqual(expect.arrayContaining([VALID_TEST_WALLET, 'wallet-connect-alias']));
    expect(second.sources).toEqual(expect.arrayContaining(['stellar', 'walletconnect']));
    expect((await service.resolveAlias('wallet-connect-alias', 'walletconnect'))?.canonicalId).toBe(first.canonicalId);
  });

  it('preserves a canonical identity when a previously linked alias is registered again', async () => {
    const first = await service.registerAlias('wallet-connect-alias', 'walletconnect');
    const second = await service.registerAlias('WALLET-CONNECT-ALIAS', 'walletconnect');

    expect(second.canonicalId).toBe(first.canonicalId);
    expect((await service.getIdentityLinks(first.canonicalId))?.aliases).toEqual(['wallet-connect-alias']);
    expect((await service.getIdentityLinks(first.canonicalId))?.sources).toEqual(['walletconnect']);
  });

  it('normalizes provider names across formatting variants to the same identity', async () => {
    const first = await service.registerAlias('wallet-connect-alias', 'Wallet Connect');
    const second = await service.registerAlias('wallet-connect-alias', 'wallet-connect');

    expect(first.canonicalId).toBe(second.canonicalId);
    expect((await service.getIdentityLinks(first.canonicalId))?.sources).toEqual(['walletconnect']);
  });

  it('resolves linked provider aliases to the canonical Stellar wallet', async () => {
    await service.linkProviderIdentity(
      VALID_TEST_WALLET,
      'stellar',
      'wallet-connect-alias',
      'walletconnect',
    );

    expect(await service.resolveCanonicalWallet('wallet-connect-alias', 'walletconnect')).toBe(
      VALID_TEST_WALLET,
    );
    expect(
      await service.areSameIdentity(
        VALID_TEST_WALLET,
        'stellar',
        'wallet-connect-alias',
        'walletconnect',
      ),
    ).toBe(true);
  });

  it('hydrates persisted aliases into a fresh service instance', async () => {
    const first = await service.linkProviderIdentity(
      VALID_TEST_WALLET,
      'stellar',
      'wallet-connect-alias',
      'walletconnect',
    );

    const freshService = new WalletAliasMappingService();
    await freshService.loadFromDatabase();

    expect((await freshService.resolveAlias('wallet-connect-alias', 'walletconnect'))?.canonicalId).toBe(
      first.canonicalId,
    );
    expect(await freshService.resolveCanonicalWallet('wallet-connect-alias', 'walletconnect')).toBe(
      VALID_TEST_WALLET,
    );
  });

  it('persists merge behavior when an alias moves between canonical groups', async () => {
    const first = await service.registerAlias('wallet-connect-alias', 'walletconnect');
    const second = await service.registerAlias(SECOND_TEST_WALLET, 'stellar');
    const merged = await service.registerAlias('wallet-connect-alias', 'walletconnect', second.canonicalId);

    expect(merged.canonicalId).toBe(second.canonicalId);
    expect(await service.getIdentityLinks(first.canonicalId)).toBeNull();
    expect((await service.resolveAlias('wallet-connect-alias', 'walletconnect'))?.canonicalId).toBe(second.canonicalId);

    const prisma = getPrismaClient();
    await expect(
      prisma.walletCanonicalIdentity.findUnique({ where: { id: first.canonicalId } }),
    ).resolves.toBeNull();
  });
});
