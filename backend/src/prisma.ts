import { getPrismaClient, QUERY_TIMEOUT_MS } from './prismaClient';

export { getPrismaRuntimeConfig } from './prismaClient';

// Extends the single shared client from prismaClient.ts (critical-entity
// guard, vault-count invalidation and query-budget instrumentation are
// attached there). This module only adds the per-query timeout; it must never
// construct its own PrismaClient, or a second connection pool is opened.
export const prisma = getPrismaClient().$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
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
