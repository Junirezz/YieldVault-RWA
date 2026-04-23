import NodeCache from 'node-cache';

export interface IdempotentOperationResult<T> {
  statusCode: number;
  body: T;
}

interface StoredResponse<T> extends IdempotentOperationResult<T> {
  fingerprint: string;
}

interface PendingOperation<T> {
  fingerprint: string;
  promise: Promise<StoredResponse<T>>;
}

export class IdempotencyConflictError extends Error {
  constructor(message = 'Idempotency key already used for a different request body') {
    super(message);
    this.name = 'IdempotencyConflictError';
  }
}

export class IdempotencyStore {
  private readonly completedResponses: NodeCache;

  private readonly pendingResponses = new Map<string, PendingOperation<unknown>>();

  constructor(private readonly ttlMs = 24 * 60 * 60 * 1000) {
    const ttlSeconds = Math.max(1, Math.ceil(this.ttlMs / 1000));
    this.completedResponses = new NodeCache({
      stdTTL: ttlSeconds,
      checkperiod: ttlSeconds,
    });
  }

  async execute<T>(
    key: string,
    fingerprint: string,
    operation: () => Promise<IdempotentOperationResult<T>>
  ): Promise<{ result: IdempotentOperationResult<T>; replayed: boolean }> {
    const completed = this.completedResponses.get<StoredResponse<T>>(key);

    if (completed) {
      if (completed.fingerprint !== fingerprint) {
        throw new IdempotencyConflictError();
      }

      return {
        result: {
          statusCode: completed.statusCode,
          body: completed.body,
        },
        replayed: true,
      };
    }

    const pendingOperation = this.pendingResponses.get(key) as PendingOperation<T> | undefined;
    if (pendingOperation) {
      if (pendingOperation.fingerprint !== fingerprint) {
        throw new IdempotencyConflictError();
      }

      const replayed = await pendingOperation.promise;
      return {
        result: {
          statusCode: replayed.statusCode,
          body: replayed.body,
        },
        replayed: true,
      };
    }

    const operationPromise = (async () => {
      const result = await operation();
      const stored: StoredResponse<T> = {
        ...result,
        fingerprint,
      };

      this.completedResponses.set(key, stored, this.ttlMs / 1000);
      return stored;
    })();

    this.pendingResponses.set(key, {
      fingerprint,
      promise: operationPromise,
    });

    try {
      const stored = await operationPromise;
      return {
        result: {
          statusCode: stored.statusCode,
          body: stored.body,
        },
        replayed: false,
      };
    } finally {
      this.pendingResponses.delete(key);
    }
  }

  clear(): void {
    this.completedResponses.flushAll();
    this.pendingResponses.clear();
  }
}

export const idempotencyStore = new IdempotencyStore(
  parseInt(process.env.IDEMPOTENCY_KEY_TTL_MS || '86400000', 10)
);

export function buildIdempotencyFingerprint(payload: unknown): string {
  return stableStringify(payload);
}

function stableStringify(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const serialized = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);

  return `{${serialized.join(',')}}`;
}