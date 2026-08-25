import { PrismaClient } from '@prisma/client';
import { assertCriticalEntityMutationAllowed } from './criticalEntityPolicy';

const QUERY_TIMEOUT_MS = parsePositiveInt(process.env.PRISMA_QUERY_TIMEOUT_MS, 5000);
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

const prismaClient = new PrismaClient({
  ...(buildDatasourceUrl()
    ? {
        datasources: {
          db: {
            url: buildDatasourceUrl(),
          },
        },
      }
    : {}),
  transactionOptions: {
    maxWait: POOL_TIMEOUT_MS,
    timeout: QUERY_TIMEOUT_MS,
  },
});

export const prisma = prismaClient.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        assertCriticalEntityMutationAllowed(model, operation);
        return runWithTimeout(query(args), QUERY_TIMEOUT_MS, `${model}.${operation}`);
      },
    },
  },
});

function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Prisma query timed out after ${timeoutMs}ms (${operationName})`));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export function getPrismaRuntimeConfig() {
  return {
    poolMax: POOL_MAX,
    poolTimeoutMs: POOL_TIMEOUT_MS,
    queryTimeoutMs: QUERY_TIMEOUT_MS,
  };
}
