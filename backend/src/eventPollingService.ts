import { getPrismaClient } from './prismaClient';
import { logger } from './middleware/structuredLogging';
import { redisClientManager } from './rateLimiter';
import { scValToNative, xdr } from '@stellar/stellar-base';
import Decimal from 'decimal.js';

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
  private lockKey: string = 'event-polling:leader-lock';
  private lockValue: string = '';
  private lockRenewalTimer?: NodeJS.Timeout;
  private isLeader = false;

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

    // Acquire leader lock before starting polling
    await this.acquireLeaderLock();

    // Replay missed events on startup. A Soroban RPC outage here must not
    // prevent continuous polling from ever starting — the next successful
    // poll will re-derive the same missed range from the persisted cursor,
    // so a failed replay is a delayed catch-up rather than lost data.
    try {
      await this.replayMissedEvents();
    } catch (error) {
      logger.log('warn', 'Event replay on startup failed — external dependency outage suspected, continuing in degraded mode', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // Start continuous polling only if we are the leader
    if (this.isLeader) {
      this.pollTimer = setInterval(() => {
        this.pollEvents().catch((err) => {
          logger.log('error', 'Event polling error', { error: err.message });
        });
      }, this.config.pollIntervalMs);

      logger.log('info', 'Event polling service started as leader', {
        pollIntervalMs: this.config.pollIntervalMs,
      });
    } else {
      logger.log('info', 'Event polling service started as follower - waiting for leadership', {
        pollIntervalMs: this.config.pollIntervalMs,
      });
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }

    // Release leader lock on shutdown
    await this.releaseLeaderLock();

    logger.log('info', 'Event polling service stopped');
  }

  /**
   * Acquires a Redis-based leader lock using SET key value NX PX pattern.
   * Returns true if lock was acquired, false otherwise.
   */
  private async acquireLeaderLock(): Promise<void> {
    const client = redisClientManager.getClient();
    if (!client || !redisClientManager.isReady()) {
      logger.log('warn', 'Redis client not available - running in single-instance mode', {
        lockKey: this.lockKey,
      });
      this.isLeader = true;
      return;
    }

    try {
      // Generate unique lock value for this instance
      this.lockValue = `leader-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Try to acquire lock with 30 second expiry
      const result = await client.set(this.lockKey, this.lockValue, 'PX', 30000, 'NX');
      
      if (result === 'OK') {
        this.isLeader = true;
        logger.log('info', 'Leader lock acquired successfully', {
          lockKey: this.lockKey,
          lockValue: this.lockValue,
        });
        
        // Start lock renewal timer (renew every 15 seconds)
        this.startLockRenewal();
      } else {
        this.isLeader = false;
        logger.log('info', 'Leader lock acquisition failed - another instance is leader', {
          lockKey: this.lockKey,
        });
      }
    } catch (error) {
      logger.log('error', 'Failed to acquire leader lock', {
        lockKey: this.lockKey,
        error: error instanceof Error ? error.message : String(error),
      });
      this.isLeader = false;
    }
  }

  /**
   * Releases the leader lock if held by this instance.
   */
  private async releaseLeaderLock(): Promise<void> {
    if (!this.isLeader || !this.lockValue) return;

    const client = redisClientManager.getClient();
    if (!client || !redisClientManager.isReady()) return;

    try {
      // Use Lua script to safely delete only if value matches
      const script = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;
      await client.eval(script, 1, this.lockKey, this.lockValue);
      
      logger.log('info', 'Leader lock released successfully', {
        lockKey: this.lockKey,
      });
    } catch (error) {
      logger.log('error', 'Failed to release leader lock', {
        lockKey: this.lockKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Starts periodic lock renewal to prevent expiration.
   */
  private startLockRenewal(): void {
    if (this.lockRenewalTimer) {
      clearInterval(this.lockRenewalTimer);
    }

    this.lockRenewalTimer = setInterval(async () => {
      if (!this.isLeader || !this.lockValue) return;

      const client = redisClientManager.getClient();
      if (!client || !redisClientManager.isReady()) return;

      try {
        // Renew lock with new 30 second expiry
        const result = await client.set(this.lockKey, this.lockValue, 'PX', 30000, 'XX');
        if (result !== 'OK') {
          logger.log('warn', 'Failed to renew leader lock - may have lost leadership', {
            lockKey: this.lockKey,
          });
          this.isLeader = false;
        }
      } catch (error) {
        logger.log('error', 'Failed to renew leader lock', {
          lockKey: this.lockKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, 15000); // Renew every 15 seconds
  }

  /**
   * Checks if this instance is the current leader.
   */
  public isCurrentLeader(): boolean {
    return this.isLeader;
  }

  /**
   * Replays events for a specific ledger range.
   * Used by admin endpoint to trigger manual replay of known ledger ranges.
   * @param fromLedger The starting ledger sequence number (inclusive)
   * @param toLedger The ending ledger sequence number (inclusive)
   */
  public async replayEventsForRange(fromLedger: number, toLedger: number): Promise<{ processedCount: number; duplicateCount: number }> {
    const startTime = Date.now();
    logger.log('info', 'Starting manual event replay for ledger range', {
      fromLedger,
      toLedger,
    });

    if (fromLedger > toLedger) {
      throw new Error(`Invalid ledger range: fromLedger (${fromLedger}) must be <= toLedger (${toLedger})`);
    }

    // Validate range bounds - limit to reasonable size to prevent overload
    const rangeSize = toLedger - fromLedger + 1;
    const maxRangeSize = parseInt(process.env.EVENT_REPLAY_MAX_RANGE_SIZE || '1000', 10);
    if (rangeSize > maxRangeSize) {
      throw new Error(`Ledger range too large: ${rangeSize} ledgers exceeds maximum allowed ${maxRangeSize}`);
    }

    let processedCount = 0;
    let duplicateCount = 0;

    // Process in batches
    for (let ledger = fromLedger; ledger <= toLedger; ledger += this.config.batchSize) {
      const endLedger = Math.min(ledger + this.config.batchSize - 1, toLedger);
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

      // Update cursor to the last processed ledger for progress tracking
      await this.updateCursor(endLedger);
    }

    const duration = Date.now() - startTime;
    logger.log('info', 'Manual event replay completed', {
      fromLedger,
      toLedger,
      processedCount,
      duplicateCount,
      durationMs: duration,
    });

    return { processedCount, duplicateCount };
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

  public async pollEvents(): Promise<void> {
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

    try {
      const parsedTopics = event.topics.map(t => {
        try {
          return typeof t === 'string' ? scValToNative(xdr.ScVal.fromXDR(t, 'base64')) : t;
        } catch {
          return t;
        }
      });

      const eventType = parsedTopics[1];
      if (eventType === 'deposit' || eventType === 'withdraw') {
        const xdrValue = typeof event.value === 'string' ? event.value : (event.value?.xdr || event.value?.raw);
        if (xdrValue) {
          const nativeValue = scValToNative(xdr.ScVal.fromXDR(xdrValue, 'base64'));
          if (Array.isArray(nativeValue) && nativeValue.length >= 2) {
            const amountVal = new Decimal(nativeValue[0].toString());
            const sharesVal = new Decimal(nativeValue[1].toString());

            await prisma.$transaction(async (tx) => {
              const existing = await tx.vaultState.findUnique({ where: { id: 1 } });
              let currentAssets = existing ? new Decimal(existing.totalAssets) : new Decimal(0);
              let currentShares = existing ? new Decimal(existing.totalShares) : new Decimal(0);

              if (eventType === 'deposit') {
                currentAssets = currentAssets.plus(amountVal);
                currentShares = currentShares.plus(sharesVal);
              } else {
                currentAssets = Decimal.max(0, currentAssets.minus(amountVal));
                currentShares = Decimal.max(0, currentShares.minus(sharesVal));
              }

              await tx.vaultState.upsert({
                where: { id: 1 },
                update: {
                  totalAssets: currentAssets.toFixed(6),
                  totalShares: currentShares.toFixed(6),
                },
                create: {
                  id: 1,
                  totalAssets: currentAssets.toFixed(6),
                  totalShares: currentShares.toFixed(6),
                },
              });

              const resultingSharePrice = currentAssets.gt(0) && currentShares.gt(0)
                ? currentAssets.div(currentShares)
                : new Decimal(1);

              await tx.sharePriceSnapshot.create({
                data: {
                  sharePrice: resultingSharePrice.toFixed(6),
                  totalAssets: currentAssets.toFixed(6),
                  totalShares: currentShares.toFixed(6),
                  source: `event_${eventType}`,
                },
              });
            });
          }
        }
      }
    } catch (err) {
      logger.log('error', 'Error processing business logic for event', {
        eventId: event.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
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
            endLedger,
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
      throw error;
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

/**
 * Replays events for a specific ledger range.
 * Used by admin endpoint to trigger manual replay of known ledger ranges.
 */
export async function replayEventsForRange(fromLedger: number, toLedger: number): Promise<{ processedCount: number; duplicateCount: number }> {
  // Get the singleton instance
  if (!pollingService) {
    throw new Error('EventPollingService not initialized');
  }
  
  return pollingService.replayEventsForRange(fromLedger, toLedger);
}
