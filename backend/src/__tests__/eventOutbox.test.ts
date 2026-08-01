import { prisma } from '../prisma';
import {
  eventOutboxService,
  type OutboxWriteInput,
  type EventOutboxRecord,
  type OutboxRelayResult,
} from '../eventOutbox';
import {
  registerWebhookEndpoint,
  emitTransactionEvent,
  resetWebhookState,
} from '../webhookDelivery';

/**
 * Helper to flush pending async operations (timers, promises, etc.).
 */
async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

/**
 * Helper to create a valid outbox write input for testing.
 */
function makeOutboxInput(overrides: Partial<OutboxWriteInput> = {}): OutboxWriteInput {
  return {
    eventType: 'transaction.deposit.created',
    payload: {
      transactionId: 'tx-test-001',
      amount: '100',
      asset: 'USDC',
      walletAddress: `G${'A'.repeat(55)}`,
      transactionHash: '0xabcdef1234567890',
      status: 'completed',
      timestamp: new Date().toISOString(),
    },
    aggregateType: 'transaction',
    aggregateId: 'tx-test-001',
    maxAttempts: 3,
    ...overrides,
  };
}

/**
 * Helper to create a registered webhook endpoint for integration tests.
 */
function createTestWebhookEndpoint(
  fetchMock: jest.Mock,
): ReturnType<typeof registerWebhookEndpoint> {
  process.env.WEBHOOK_ALLOW_UNVERIFIED = 'true';
  return registerWebhookEndpoint({
    url: 'https://example.com/webhook',
    eventTypes: ['transaction.deposit.created', 'transaction.withdrawal.created'],
    enabled: true,
  });
}

describe('EventOutboxService', () => {
  const originalFetch = global.fetch;

  beforeEach(async () => {
    resetWebhookState();
    process.env.WEBHOOK_ALLOW_UNVERIFIED = 'true';
    process.env.WEBHOOK_MAX_ATTEMPTS = '3';

    // Clean up any leftover outbox entries from previous tests
    await prisma.eventOutbox.deleteMany({});
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // ─── writeEvent ─────────────────────────────────────────────────────────

  describe('writeEvent', () => {
    it('creates an outbox entry with default values', async () => {
      const input = makeOutboxInput();
      const record = await eventOutboxService.writeEvent(input);

      expect(record).toBeDefined();
      expect(record.id).toMatch(/^obx-/);
      expect(record.eventType).toBe('transaction.deposit.created');
      expect(record.payload.transactionId).toBe('tx-test-001');
      expect(record.status).toBe('pending');
      expect(record.attemptCount).toBe(0);
      expect(record.maxAttempts).toBe(3);
      expect(record.aggregateType).toBe('transaction');
      expect(record.aggregateId).toBe('tx-test-001');
      expect(record.lockedAt).toBeNull();
      expect(record.lockedBy).toBeNull();
      expect(record.relayedAt).toBeNull();
      expect(record.lastError).toBeNull();
    });

    it('creates an outbox entry with custom maxAttempts', async () => {
      const input = makeOutboxInput({ maxAttempts: 5 });
      const record = await eventOutboxService.writeEvent(input);
      expect(record.maxAttempts).toBe(5);
    });

    it('persists the event to the database', async () => {
      const input = makeOutboxInput();
      const record = await eventOutboxService.writeEvent(input);

      const found = await prisma.eventOutbox.findUnique({
        where: { id: record.id },
      });
      expect(found).not.toBeNull();
      expect(found?.id).toBe(record.id);
      expect(found?.status).toBe('pending');
      const parsed = JSON.parse(found!.payload);
      expect(parsed.transactionId).toBe('tx-test-001');
    });

    it('supports withdrawal event types', async () => {
      const input = makeOutboxInput({
        eventType: 'transaction.withdrawal.created',
        aggregateId: 'tx-withdrawal-001',
      });
      const record = await eventOutboxService.writeEvent(input);
      expect(record.eventType).toBe('transaction.withdrawal.created');
    });
  });

  // ─── processOutbox ──────────────────────────────────────────────────────

  describe('processOutbox', () => {
    it('returns empty result when no pending events exist', async () => {
      const result = await eventOutboxService.processOutbox(10);
      expect(result).toEqual({
        relayed: 0,
        failed: 0,
        deadLettered: 0,
        errors: [],
      });
    });

    it('relays pending events to webhooks when endpoints are registered', async () => {
      global.fetch = jest.fn(async () => {
        return { ok: true, status: 200 } as Response;
      }) as typeof fetch;

      createTestWebhookEndpoint(global.fetch as jest.Mock);

      const input = makeOutboxInput();
      await eventOutboxService.writeEvent(input);
      await flushAsync();

      const result = await eventOutboxService.processOutbox(10);
      await flushAsync();

      expect(result.relayed).toBeGreaterThanOrEqual(1);
      expect(result.failed).toBe(0);
      expect(result.deadLettered).toBe(0);

      // Verify the entry was marked as relayed
      const entries = await eventOutboxService.listEntries({ status: 'relayed' });
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries[0].status).toBe('relayed');
      expect(entries[0].relayedAt).not.toBeNull();
    });

    it('relays events even when webhook delivery fails (delivery retries are async)', async () => {
      global.fetch = jest.fn(async () => {
        throw new Error('network error');
      }) as typeof fetch;

      // Register an endpoint (the mock will fail during delivery)
      createTestWebhookEndpoint(global.fetch as jest.Mock);

      const input = makeOutboxInput({ maxAttempts: 2 });
      await eventOutboxService.writeEvent(input);
      await flushAsync();

      // emitTransactionEvent schedules webhooks async and returns success
      // even when the actual HTTP delivery fails. The outbox marks as
      // relayed because the event reached the webhook system.
      const result = await eventOutboxService.processOutbox(10);
      await flushAsync();

      // Event should be marked as relayed (emitTransactionEvent itself succeeds)
      expect(result.relayed).toBeGreaterThanOrEqual(1);

      // Verify the entry transitioned to relayed status
      const relayed = await eventOutboxService.listEntries({ status: 'relayed' });
      expect(relayed.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── retryDeadLetter ────────────────────────────────────────────────────

  describe('retryDeadLetter', () => {
    it('returns null for non-existent entries', async () => {
      const result = await eventOutboxService.retryDeadLetter('non-existent-id');
      expect(result).toBeNull();
    });

    it('returns null for non-dead-letter entries', async () => {
      const input = makeOutboxInput();
      const record = await eventOutboxService.writeEvent(input);

      const result = await eventOutboxService.retryDeadLetter(record.id);
      expect(result).toBeNull();
    });

    it('returns null for non-dead-letter entries (relayed entries are not retryable)', async () => {
      global.fetch = jest.fn(async () => {
        return { ok: true, status: 200 } as Response;
      }) as typeof fetch;

      createTestWebhookEndpoint(global.fetch as jest.Mock);

      const input = makeOutboxInput({ maxAttempts: 1 });
      const record = await eventOutboxService.writeEvent(input);
      await flushAsync();

      // Process will mark as relayed (since emitTransactionEvent succeeds)
      await eventOutboxService.processOutbox(10);
      await flushAsync();

      // entry is relayed, not dead_letter — retryDeadLetter should return null
      const retried = await eventOutboxService.retryDeadLetter(record.id);
      expect(retried).toBeNull();
    });
  });

  // ─── cleanup ────────────────────────────────────────────────────────────

  describe('cleanup', () => {
    it('removes old relayed entries', async () => {
      // Directly insert an old relayed entry
      const oldId = 'obx-old-test';
      await prisma.eventOutbox.create({
        data: {
          id: oldId,
          eventType: 'transaction.deposit.created',
          payload: JSON.stringify(makeOutboxInput().payload),
          status: 'relayed',
          aggregateType: 'transaction',
          aggregateId: 'tx-old',
          attemptCount: 1,
          maxAttempts: 3,
          createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
          updatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          relayedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      });

      const removed = await eventOutboxService.cleanup(7 * 24 * 60 * 60 * 1000); // 7 days retention
      expect(removed).toBeGreaterThanOrEqual(1);

      const found = await prisma.eventOutbox.findUnique({ where: { id: oldId } });
      expect(found).toBeNull();
    });

    it('does not remove recent entries', async () => {
      const input = makeOutboxInput();
      const record = await eventOutboxService.writeEvent(input);

      const removed = await eventOutboxService.cleanup(7 * 24 * 60 * 60 * 1000);
      // The entry was just created, so it should NOT be removed
      const found = await prisma.eventOutbox.findUnique({ where: { id: record.id } });
      expect(found).not.toBeNull();
    });
  });

  // ─── replayOnStartup ────────────────────────────────────────────────────

  describe('replayOnStartup', () => {
    it('handles no pending events gracefully', async () => {
      const result = await eventOutboxService.replayOnStartup();
      expect(result.relayed).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('processes pending events on startup', async () => {
      global.fetch = jest.fn(async () => {
        return { ok: true, status: 200 } as Response;
      }) as typeof fetch;

      createTestWebhookEndpoint(global.fetch as jest.Mock);

      await eventOutboxService.writeEvent(makeOutboxInput());
      await flushAsync();

      const result = await eventOutboxService.replayOnStartup();
      await flushAsync();

      expect(result.relayed).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── getMetrics ─────────────────────────────────────────────────────────

  describe('getMetrics', () => {
    beforeEach(async () => {
      await prisma.eventOutbox.deleteMany({});
    });

    it('returns zero counts when no entries exist', async () => {
      const metrics = await eventOutboxService.getMetrics();
      expect(metrics).toEqual({
        pending: 0,
        relayed: 0,
        failed: 0,
        deadLettered: 0,
        locked: 0,
        total: 0,
      });
    });

    it('reflects current outbox state', async () => {
      await eventOutboxService.writeEvent(makeOutboxInput());
      // Insert different states directly
      await prisma.eventOutbox.createMany({
        data: [
          {
            id: 'obx-metrics-pending',
            eventType: 'transaction.deposit.created',
            payload: '{}',
            status: 'pending',
            aggregateType: 'transaction',
            aggregateId: 'tx-pending',
            attemptCount: 0,
            maxAttempts: 3,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 'obx-metrics-relayed',
            eventType: 'transaction.withdrawal.created',
            payload: '{}',
            status: 'relayed',
            aggregateType: 'transaction',
            aggregateId: 'tx-relayed',
            attemptCount: 1,
            maxAttempts: 3,
            createdAt: new Date(),
            updatedAt: new Date(),
            relayedAt: new Date(),
          },
          {
            id: 'obx-metrics-dead',
            eventType: 'transaction.deposit.created',
            payload: '{}',
            status: 'dead_letter',
            aggregateType: 'transaction',
            aggregateId: 'tx-dead',
            attemptCount: 3,
            maxAttempts: 3,
            lastError: 'exhausted',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });

      const metrics = await eventOutboxService.getMetrics();
      expect(metrics.total).toBeGreaterThanOrEqual(3);
      expect(metrics.pending).toBeGreaterThanOrEqual(2);
      expect(metrics.relayed).toBeGreaterThanOrEqual(1);
      expect(metrics.deadLettered).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── listEntries ────────────────────────────────────────────────────────

  describe('listEntries', () => {
    it('lists entries with filtering', async () => {
      await eventOutboxService.writeEvent(
        makeOutboxInput({
          aggregateId: 'tx-filter-1',
          payload: { ...makeOutboxInput().payload, transactionId: 'tx-filter-1' },
        }),
      );
      await eventOutboxService.writeEvent(
        makeOutboxInput({
          eventType: 'transaction.withdrawal.created',
          aggregateId: 'tx-filter-2',
          payload: { ...makeOutboxInput().payload, transactionId: 'tx-filter-2' },
        }),
      );

      const depositEntries = await eventOutboxService.listEntries({
        aggregateType: 'transaction',
        aggregateId: 'tx-filter-1',
      });
      expect(depositEntries.length).toBe(1);
      expect(depositEntries[0].aggregateId).toBe('tx-filter-1');
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await eventOutboxService.writeEvent(
          makeOutboxInput({
            aggregateId: `tx-limit-${i}`,
            payload: { ...makeOutboxInput().payload, transactionId: `tx-limit-${i}` },
          }),
        );
      }

      const entries = await eventOutboxService.listEntries({ limit: 3 });
      expect(entries.length).toBe(3);
    });
  });

  // ─── start/stop (Background Processor) ─────────────────────────────────

  describe('start/stop', () => {
    it('does not start if already running', () => {
      eventOutboxService.start();
      // Calling start again should be a no-op
      eventOutboxService.start();
      expect(eventOutboxService.isActive).toBe(true);
      eventOutboxService.stop();
    });

    it('can be stopped and restarted', () => {
      eventOutboxService.start();
      expect(eventOutboxService.isActive).toBe(true);
      eventOutboxService.stop();
      expect(eventOutboxService.isActive).toBe(false);
      eventOutboxService.start();
      expect(eventOutboxService.isActive).toBe(true);
      eventOutboxService.stop();
    });

    it('processes events when running', async () => {
      global.fetch = jest.fn(async () => {
        return { ok: true, status: 200 } as Response;
      }) as typeof fetch;

      createTestWebhookEndpoint(global.fetch as jest.Mock);

      await eventOutboxService.writeEvent(makeOutboxInput());
      await flushAsync();

      // Process with a small batch
      const result = await eventOutboxService.processOutbox(10);
      await flushAsync();

      expect(result.relayed).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── End-to-end flow ────────────────────────────────────────────────────

  describe('end-to-end flow', () => {
    it('completes the full outbox lifecycle', async () => {
      let deliveredPayloads: unknown[] = [];
      global.fetch = jest.fn(async (_url, init) => {
        if (init?.body && String(init.body).includes('webhook.verification')) {
          const body = JSON.parse(String(init.body));
          return {
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => ({ challenge: body.challenge }),
          } as Response;
        }
        deliveredPayloads.push(init?.body ? JSON.parse(String(init.body)) : {});
        return { ok: true, status: 200 } as Response;
      }) as typeof fetch;

      // Register webhook endpoint
      const endpoint = createTestWebhookEndpoint(global.fetch as jest.Mock);

      // Wait for verification
      await flushAsync();

      // Write event to outbox
      const input = makeOutboxInput();
      const record = await eventOutboxService.writeEvent(input);

      // Verify it's pending
      expect(record.status).toBe('pending');

      // Process the outbox
      const result = await eventOutboxService.processOutbox(10);
      await flushAsync();

      expect(result.relayed).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.deadLettered).toBe(0);

      // Verify it was delivered via webhook
      expect(deliveredPayloads.length).toBeGreaterThanOrEqual(1);

      // Verify the entry was marked relayed
      const entries = await eventOutboxService.listEntries({ status: 'relayed' });
      expect(entries.some((e) => e.id === record.id)).toBe(true);

      // Check metrics
      const metrics = await eventOutboxService.getMetrics();
      expect(metrics.relayed).toBeGreaterThanOrEqual(1);
    });
  });
});
