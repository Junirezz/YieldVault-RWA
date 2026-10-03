/**
 * Regression tests for #1380: a Prisma client without the eventOutbox model
 * must fail fast instead of surfacing as a swallowed TypeError.
 */

const MISSING_MODEL_MESSAGE = /missing the eventOutbox model/;

function loadWithPrisma(fakePrisma: unknown): typeof import('../eventOutbox') {
  let mod!: typeof import('../eventOutbox');
  jest.isolateModules(() => {
    jest.doMock('../prisma', () => ({ prisma: fakePrisma }));
    mod = require('../eventOutbox');
  });
  return mod;
}

describe('eventOutbox model guard', () => {
  afterEach(() => {
    jest.dontMock('../prisma');
  });

  describe('assertEventOutboxModelAvailable', () => {
    const { assertEventOutboxModelAvailable } = loadWithPrisma({});

    it.each([
      ['undefined client', undefined],
      ['null client', null],
      ['client without eventOutbox', {}],
      ['eventOutbox without create', { eventOutbox: {} }],
    ])('throws for %s', (_label, client) => {
      expect(() => assertEventOutboxModelAvailable(client)).toThrow(MISSING_MODEL_MESSAGE);
    });

    it('passes when the eventOutbox delegate exposes create', () => {
      expect(() =>
        assertEventOutboxModelAvailable({ eventOutbox: { create: jest.fn() } }),
      ).not.toThrow();
    });
  });

  describe('EventOutboxService with a client missing eventOutbox', () => {
    const input = {
      eventType: 'transaction.deposit.created' as const,
      payload: {
        transactionId: 'tx-guard-001',
        amount: '1',
        asset: 'USDC',
        walletAddress: `G${'A'.repeat(55)}`,
        transactionHash: '0xguard',
        status: 'completed',
        timestamp: new Date().toISOString(),
      },
      aggregateType: 'transaction' as const,
      aggregateId: 'tx-guard-001',
    };

    it('start() throws synchronously and does not mark the processor active', () => {
      const { eventOutboxService } = loadWithPrisma({});
      expect(() => eventOutboxService.start()).toThrow(MISSING_MODEL_MESSAGE);
      expect(eventOutboxService.isActive).toBe(false);
    });

    it('writeEvent rejects with a descriptive error instead of a TypeError', async () => {
      const { eventOutboxService } = loadWithPrisma({});
      await expect(eventOutboxService.writeEvent(input)).rejects.toThrow(MISSING_MODEL_MESSAGE);
    });

    it('replayOnStartup rejects with a descriptive error', async () => {
      const { eventOutboxService } = loadWithPrisma({});
      await expect(eventOutboxService.replayOnStartup()).rejects.toThrow(MISSING_MODEL_MESSAGE);
    });
  });
});
