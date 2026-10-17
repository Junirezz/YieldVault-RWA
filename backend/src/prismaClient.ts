/**
 * Centralized Prisma Client configuration.
 * Ensures a single client instance across the application and prevents
 * multiple instrumentation patches during test runs.
 *
 * The @prisma/instrumentation package may patch the PrismaClient constructor,
 * so we need to provide the options it expects to avoid panics.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaClient as PrismaClientRuntime } from '.prisma/client';
import { assertCriticalEntityMutationAllowed } from './criticalEntityPolicy';
import { logger } from './middleware/structuredLogging';
import { recordQueryPerformance } from './queryBudgets';
import { invalidateVaultCountAfterMutation } from './vaultCountCache';

export const QUERY_TIMEOUT_MS = parsePositiveInt(process.env.PRISMA_QUERY_TIMEOUT_MS, 5000);
const POOL_MAX = parsePositiveInt(process.env.PRISMA_POOL_MAX, 10);
const POOL_TIMEOUT_MS = parsePositiveInt(process.env.PRISMA_POOL_TIMEOUT_MS, 10000);

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = parseInt(raw || '', 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function buildDatasourceUrl(): string | undefined {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    return undefined;
  }

  // SQLite does not support connection/pool query params in the same manner.
  if (rawUrl.startsWith('file:')) {
    return rawUrl;
  }

  // schema.prisma's datasource provider is "sqlite" — its generated client
  // can only ever accept file: URLs, regardless of what DATABASE_URL holds.
  // DATABASE_URL pointing at Postgres/MySQL is for the separate raw `pg`
  // pool in database.ts (its own migrations, its own tables); overriding
  // Prisma's datasource with that URL here would fail schema validation
  // outright, so fall back to the schema-declared sqlite file instead of
  // crashing every Prisma-backed query.
  try {
    const url = new URL(rawUrl);
    if (url.protocol.startsWith('postgres') || url.protocol.startsWith('mysql')) {
      return undefined;
    }
    return rawUrl;
  } catch {
    return undefined;
  }
}

let prismaClientInstance: PrismaClient | null = null;
let queryInstrumentationAttached = false;

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
    const clientOptions: any = {
      // Optional datasource override for SQLite/file URLs.
      ...(buildDatasourceUrl()
        ? { datasources: { db: { url: buildDatasourceUrl() } } }
        : {}),
      transactionOptions: {
        maxWait: POOL_TIMEOUT_MS,
        timeout: QUERY_TIMEOUT_MS,
      },
    };

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

    // Create the Prisma Client instance with explicit options.
    // Prefer the generated runtime client (which includes all model delegates
    // such as eventOutbox) and fall back to the @prisma/client re-export.
    const PrismaClientCtor: any =
      (PrismaClientRuntime as any) || (PrismaClient as any);

    try {
      prismaClientInstance = new PrismaClientCtor(clientOptions) as any;

      // Guard against a partially-initialized client where model delegates
      // (e.g. eventOutbox) resolve to undefined under certain runtime paths.
      if (
        !prismaClientInstance ||
        typeof (prismaClientInstance as any).eventOutbox?.create !== 'function'
      ) {
        throw new Error(
          'Prisma Client initialized without eventOutbox delegate; check generated client and import path',
        );
      }

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

function attachQueryInstrumentation(client: PrismaClient): void {
  if (queryInstrumentationAttached) {
    return;
  }

  client.$use(async (params, next) => {
    assertCriticalEntityMutationAllowed(params.model, params.action);
    const startedAt = process.hrtime.bigint();

    try {
      const result = await next(params);
      invalidateVaultCountAfterMutation(params.model, params.action);
      return result;
    } finally {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const model = params.model || 'raw';
      const action = params.action || 'unknown';

      void recordQueryPerformance({
        model,
        action,
        durationMs: elapsedMs,
        source: 'prisma',
      }).catch((err) => {
        logger.log('error', 'Failed to record Prisma query performance', {
          error: err instanceof Error ? err.message : String(err),
          model,
          action,
        });
      });
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

export function getPrismaRuntimeConfig() {
  return {
    poolMax: POOL_MAX,
    poolTimeoutMs: POOL_TIMEOUT_MS,
    queryTimeoutMs: QUERY_TIMEOUT_MS,
  };
}
