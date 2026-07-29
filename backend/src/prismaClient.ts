/**
 * Centralized Prisma Client configuration.
 * Ensures a single client instance across the application and prevents
 * multiple instrumentation patches during test runs.
 *
 * The @prisma/instrumentation package may patch the PrismaClient constructor,
 * so we need to provide the options it expects to avoid panics.
 */

import { PrismaClient } from '@prisma/client';
import { assertCriticalEntityMutationAllowed } from './criticalEntityPolicy';
import { logger } from './middleware/structuredLogging';
import { observeDbQueryDuration } from './metrics';

let prismaClientInstance: PrismaClient | null = null;
let queryInstrumentationAttached = false;
const SLOW_QUERY_THRESHOLD_MS = parsePositiveInt(process.env.SLOW_QUERY_THRESHOLD_MS, 500);

/**
 * Get or create the shared Prisma Client instance.
 * This ensures only one client exists and prevents instrumentation conflicts.
 */
export function getPrismaClient(): PrismaClient {
  if (!prismaClientInstance) {
    const isTestEnv = process.env.NODE_ENV === 'test';

    if (isTestEnv) {
      logger.log('info', 'Initializing Prisma Client for test environment', {});
    }

    // Build the client options
    const clientOptions: any = {};

    // In test environments, minimize logging
    clientOptions.log = [
      {
        emit: 'event',
        level: 'error',
      },
      {
        emit: 'event',
        level: 'query',
      },
    ];

    // Create the Prisma Client instance with explicit options
    try {
      prismaClientInstance = new PrismaClient(clientOptions) as any;
      attachQueryInstrumentation(prismaClientInstance!);
    } catch (error) {
      logger.log('error', 'Failed to create Prisma Client', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  return prismaClientInstance as PrismaClient;
}

import { getQueryBudget, triggerSlowQueryAlert } from './queryBudgets';

function attachQueryInstrumentation(client: PrismaClient): void {
  if (queryInstrumentationAttached) {
    return;
  }

  client.$use(async (params, next) => {
    assertCriticalEntityMutationAllowed(params.model, params.action);
    const startedAt = process.hrtime.bigint();

    try {
      return await next(params);
    } finally {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const model = params.model || 'raw';
      const action = params.action || 'unknown';

      observeDbQueryDuration(model, action, elapsedMs);

      const budgetMs = getQueryBudget(model, action);
      if (elapsedMs >= budgetMs) {
        logger.log('warn', 'Prisma query exceeded performance budget', {
          model,
          action,
          durationMs: Math.round(elapsedMs * 100) / 100,
          budgetMs,
        });

        void triggerSlowQueryAlert(model, action, elapsedMs, budgetMs).catch((err) => {
          logger.log('error', 'Failed to trigger slow query alert', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      } else if (elapsedMs >= SLOW_QUERY_THRESHOLD_MS) {
        logger.log('warn', 'Slow Prisma query detected', {
          model,
          action,
          durationMs: Math.round(elapsedMs * 100) / 100,
        });
      }
    }
  });

  client.$on('query' as never, (event: any) => {
    logger.log('debug', 'Prisma query executed', {
      durationMs: event.duration,
      target: event.target,
    });
  });

  queryInstrumentationAttached = true;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = parseInt(raw || '', 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

/**
 * Disconnect the Prisma Client instance.
 * Call this during graceful shutdown.
 */
export async function disconnectPrismaClient(): Promise<void> {
  if (prismaClientInstance) {
    try {
      await prismaClientInstance.$disconnect();
    } catch (error) {
      logger.log('warn', 'Error disconnecting Prisma Client', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    prismaClientInstance = null;
  }
}
