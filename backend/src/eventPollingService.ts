import { getPrismaClient } from './prismaClient';
import { logger } from './middleware/structuredLogging';

const prisma = getPrismaClient();

interface StellarEvent {
  id: string;
  type: string;
  ledger: number;
  contractId: string;
  txHash: string;
  topics: string[];
  value: any;
}

interface EventPollingConfig {
  rpcUrl: string;
  contractId: string;
  pollIntervalMs: number;
  batchSize: number;
}

export class EventPollingService {
  private config: EventPollingConfig;
  private isRunning = false;
  private pollTimer?: NodeJS.Timeout;

  constructor(config: EventPollingConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.log('warn', 'Event polling service already running');
      return;
    }

    this.isRunning = true;
    logger.log('info', 'Starting event polling service');

    // Replay missed events on startup - let errors propagate
    await this.replayMissedEvents();

    // Start continuous polling
    this.pollTimer = setInterval(() => {
      this.pollEvents().catch((err) => {
        logger.log('error', 'Event polling error', { error: err.message });
      });
    }, this.config.pollIntervalMs);

    logger.log('info', 'Event polling service started', {
      pollIntervalMs: this.config.pollIntervalMs,
    });
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }

    logger.log('info', 'Event polling service stopped');
  }

  private async replayMissedEvents(): Promise<void> {
    const startTime = Date.now();
    logger.log('info', 'Starting event replay');

    const cursor = await this.getLastProcessedLedger();
    const currentLedger = await this.getCurrentLedger();

    if (currentLedger <= cursor) {
      logger.log('info', 'No missed events to replay', { cursor, currentLedger });
      return;
    }

    const missedLedgers = currentLedger - cursor;
    logger.log('info', 'Replaying missed events', {
      fromLedger: cursor + 1,
      toLedger: currentLedger,
      missedLedgers,
    });

    let processedCount = 0;
    let duplicateCount = 0;

    // Process in batches
    for (let ledger = cursor + 1; ledger <= currentLedger; ledger += this.config.batchSize) {
      const endLedger = Math.min(ledger + this.config.batchSize - 1, currentLedger);
      const events = await this.fetchEventsForLedgerRange(ledger, endLedger);

      for (const event of events) {
        const isDuplicate = await this.isEventProcessed(event.id);
        if (!isDuplicate) {
          await this.processEvent(event);
          processedCount++;
        } else {
          duplicateCount++;
        }
      }

      await this.updateCursor(endLedger);
    }

    const duration = Date.now() - startTime;
    logger.log('info', 'Event replay completed', {
      processedCount,
      duplicateCount,
      missedLedgers,
      durationMs: duration,
    });

    if (duration > 60000) {
      logger.log('warn', 'Event replay exceeded 60s SLA', { durationMs: duration });
    }
  }

  private async pollEvents(): Promise<void> {
    try {
      const lastLedger = await this.getLastProcessedLedger();
      const currentLedger = await this.getCurrentLedger();

      if (currentLedger <= lastLedger) return;

      const events = await this.fetchEventsForLedgerRange(lastLedger + 1, currentLedger);

      for (const event of events) {
        const isDuplicate = await this.isEventProcessed(event.id);
        if (!isDuplicate) {
          await this.processEvent(event);
        }
      }

      await this.updateCursor(currentLedger);
    } catch (error) {
      logger.log('error', 'Event polling failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async getLastProcessedLedger(): Promise<number> {
    const cursor = await prisma.eventCursor.findUnique({ where: { id: 1 } });
    return cursor?.lastLedgerSeq ?? 0;
  }

  private async updateCursor(ledgerSeq: number): Promise<void> {
    await prisma.eventCursor.upsert({
      where: { id: 1 },
      update: { lastLedgerSeq: ledgerSeq },
      create: { id: 1, lastLedgerSeq: ledgerSeq },
    });
  }

  private async isEventProcessed(eventId: string): Promise<boolean> {
    const existing = await prisma.processedEvent.findUnique({
      where: { id: eventId },
    });
    return !!existing;
  }

  private async processEvent(event: StellarEvent): Promise<void> {
    // Idempotent upsert - prevents duplicate processing
    await prisma.processedEvent.upsert({
      where: { id: event.id },
      update: {},
      create: {
        id: event.id,
        ledgerSeq: event.ledger,
        eventType: event.type,
        contractId: event.contractId,
        txHash: event.txHash,
      },
    });

    logger.log('info', 'Event processed', {
      eventId: event.id,
      type: event.type,
      ledger: event.ledger,
    });

    // Add business logic here (e.g., update vault state, send webhooks)
  }

  private async getCurrentLedger(): Promise<number> {
    try {
      const response = await fetch(this.config.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getLatestLedger',
          params: [],
        }),
      });

      const data = await response.json();
      return data.result?.sequence ?? 0;
    } catch (error) {
      logger.log('error', 'Failed to fetch current ledger', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  }

  private async fetchEventsForLedgerRange(
    startLedger: number,
    endLedger: number,
  ): Promise<StellarEvent[]> {
    try {
      const response = await fetch(this.config.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getEvents',
          params: {
            startLedger,
            filters: [
              {
                type: 'contract',
                contractIds: [this.config.contractId],
              },
            ],
            pagination: {
              limit: 1000,
            },
          },
        }),
      });

      const data = await response.json();
      const events = data.result?.events ?? [];

      return events
        .filter((e: any) => e.ledger >= startLedger && e.ledger <= endLedger)
        .map((e: any) => ({
          id: e.id,
          type: e.type,
          ledger: e.ledger,
          contractId: e.contractId,
          txHash: e.txHash,
          topics: e.topic ?? [],
          value: e.value,
        }));
    } catch (error) {
      logger.log('error', 'Failed to fetch events', {
        startLedger,
        endLedger,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }
}

// Singleton instance
let pollingService: EventPollingService | null = null;

export function startEventPollingService(config: EventPollingConfig): EventPollingService {
  if (pollingService) {
    logger.log('warn', 'Event polling service already initialized');
    return pollingService;
  }

  pollingService = new EventPollingService(config);
  pollingService.start().catch((err) => {
    logger.log('error', 'Failed to start event polling service', { error: err.message });
  });

  return pollingService;
}

export function stopEventPollingService(): void {
  if (pollingService) {
    pollingService.stop().catch((err) => {
      logger.log('error', 'Failed to stop event polling service', { error: err.message });
    });
    pollingService = null;
  }
}
