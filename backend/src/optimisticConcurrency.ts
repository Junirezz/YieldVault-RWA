import { logger } from './middleware/structuredLogging';

export class OptimisticConcurrencyError extends Error {
  public readonly entityName: string;
  public readonly entityId: string | number;
  public readonly expectedVersion: number;

  constructor(entityName: string, entityId: string | number, expectedVersion: number) {
    super(`Optimistic concurrency conflict on ${entityName} (id=${entityId}, expectedVersion=${expectedVersion})`);
    this.name = 'OptimisticConcurrencyError';
    this.entityName = entityName;
    this.entityId = entityId;
    this.expectedVersion = expectedVersion;
    Object.setPrototypeOf(this, OptimisticConcurrencyError.prototype);
  }
}

export interface OptimisticConcurrencyOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULT_OPTIONS: Required<OptimisticConcurrencyOptions> = {
  maxRetries: 3,
  initialDelayMs: 50,
  maxDelayMs: 1000,
};

/**
  * Executes a database mutation inside an optimistic concurrency retry loop.
  * Retries automatically if an OptimisticConcurrencyError is thrown.
  */
export async function executeWithOptimisticConcurrency<T>(
  operation: (attempt: number) => Promise<T>,
  options?: OptimisticConcurrencyOptions
): Promise<T> {
  const maxRetries = options?.maxRetries ?? DEFAULT_OPTIONS.maxRetries;
  const initialDelayMs = options?.initialDelayMs ?? DEFAULT_OPTIONS.initialDelayMs;
  const maxDelayMs = options?.maxDelayMs ?? DEFAULT_OPTIONS.maxDelayMs;

  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      return await operation(attempt);
    } catch (error) {
      if (error instanceof OptimisticConcurrencyError && attempt <= maxRetries) {
        const delay = Math.min(
          initialDelayMs * Math.pow(2, attempt - 1) + Math.random() * 20,
          maxDelayMs
        );

        logger.log('warn', 'Optimistic concurrency collision detected; retrying operation', {
          entityName: error.entityName,
          entityId: error.entityId,
          expectedVersion: error.expectedVersion,
          attempt,
          maxRetries,
          delayMs: Math.round(delay),
        });

        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
}

export interface VersionedEntity {
  version: number;
  [key: string]: any;
}

/**
  * Validates an entity version before update and returns the next version number.
  */
export function assertVersionMatch<T extends VersionedEntity>(
  currentEntity: T | null | undefined,
  expectedVersion: number,
  entityName: string,
  entityId: string | number
): number {
  if (!currentEntity) {
    throw new Error(`${entityName} with id ${entityId} not found`);
  }
  if (currentEntity.version !== expectedVersion) {
    throw new OptimisticConcurrencyError(entityName, entityId, expectedVersion);
  }
  return currentEntity.version + 1;
}
