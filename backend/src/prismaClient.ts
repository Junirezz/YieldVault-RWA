import { PrismaClient } from '@prisma/client';

const prismaPoolSize = parseInt(process.env.PRISMA_POOL_SIZE || process.env.DATABASE_POOL_SIZE || '10', 10);
const prismaPoolTimeoutSec = parseInt(process.env.PRISMA_POOL_TIMEOUT_SEC || '10', 10);
const prismaQueryTimeoutMs = parseInt(process.env.PRISMA_QUERY_TIMEOUT_MS || '5000', 10);
const prismaTxMaxWaitMs = parseInt(process.env.PRISMA_TX_MAX_WAIT_MS || '5000', 10);
const prismaTxTimeoutMs = parseInt(process.env.PRISMA_TX_TIMEOUT_MS || '10000', 10);

const datasourceUrl = buildDatasourceUrl(process.env.DATABASE_URL);

export const prisma = datasourceUrl
  ? new PrismaClient({
      datasources: {
        db: {
          url: datasourceUrl,
        },
      },
      transactionOptions: {
        maxWait: prismaTxMaxWaitMs,
        timeout: prismaTxTimeoutMs,
      },
    })
  : new PrismaClient({
      transactionOptions: {
        maxWait: prismaTxMaxWaitMs,
        timeout: prismaTxTimeoutMs,
      },
    });

export async function runPrismaWithTimeout<T>(
  queryFactory: () => Promise<T>,
  operationName = 'prisma.query',
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${prismaQueryTimeoutMs}ms`));
    }, prismaQueryTimeoutMs);
  });

  try {
    return await Promise.race([queryFactory(), timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export async function getPrismaHealth(): Promise<'up' | 'down'> {
  if (!process.env.DATABASE_URL) {
    return 'up';
  }

  try {
    await runPrismaWithTimeout(() => prisma.$queryRaw`SELECT 1`, 'prisma.healthcheck');
    return 'up';
  } catch {
    return 'down';
  }
}

export function getPrismaConfig() {
  return {
    prismaPoolSize,
    prismaPoolTimeoutSec,
    prismaQueryTimeoutMs,
    prismaTxMaxWaitMs,
    prismaTxTimeoutMs,
    datasourceUrlConfigured: Boolean(process.env.DATABASE_URL),
    datasourceUrlUsesPoolingParams: datasourceUrl ? isPoolingDatasource(datasourceUrl) : false,
  };
}

function buildDatasourceUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  if (url.startsWith('file:')) {
    return url;
  }

  try {
    const parsed = new URL(url);
    if (isPoolingDatasource(url)) {
      parsed.searchParams.set('connection_limit', String(prismaPoolSize));
      parsed.searchParams.set('pool_timeout', String(prismaPoolTimeoutSec));
      return parsed.toString();
    }

    return url;
  } catch {
    return url;
  }
}

function isPoolingDatasource(url: string): boolean {
  return url.startsWith('postgres://') ||
    url.startsWith('postgresql://') ||
    url.startsWith('mysql://') ||
    url.startsWith('sqlserver://');
}
