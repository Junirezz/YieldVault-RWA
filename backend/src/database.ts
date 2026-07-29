import { logger } from './middleware/structuredLogging';
import { Pool, PoolConfig } from 'pg';
import { recordQueryPerformance } from './queryBudgets';

/**
 * Interface for a database pool.
 * This can be implemented by pg.Pool or a mock for testing.
 */
export interface IDatabasePool {
  query<T = any>(text: string, params?: any[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
  isHealthy(): Promise<boolean>;
}

/**
 * PostgreSQL-backed pool used by the application at runtime.
 */
export class PostgresDatabasePool implements IDatabasePool {
  private readonly pool: Pool;

  constructor(connectionString: string, name: string) {
    const config: PoolConfig = {
      connectionString,
      max: parsePositiveInt(process.env.DATABASE_POOL_SIZE, 10),
      connectionTimeoutMillis: parsePositiveInt(
        process.env.DATABASE_CONNECTION_TIMEOUT_MS,
        5000
      ),
      idleTimeoutMillis: parsePositiveInt(process.env.DATABASE_IDLE_TIMEOUT_MS, 30000),
      application_name: `yieldvault-backend-${name}`,
    };

    this.pool = new Pool(config);
    this.pool.on('error', (error) => {
      logger.log('error', `Unexpected PostgreSQL ${name} pool error`, {
        error: error.message,
      });
    });
  }

  async query<T = any>(text: string, params?: any[]): Promise<{ rows: T[] }> {
    const result = await this.pool.query(text, params);
    return { rows: result.rows as T[] };
  }

  async end(): Promise<void> {
    await this.pool.end();
  }

  async isHealthy(): Promise<boolean> {
    await this.pool.query('SELECT 1');
    return true;
  }
}

/**
 * DatabaseManager handles routing queries between a primary write database
 * and a read-only replica, with automatic failover to primary for reads.
 */
export class DatabaseManager {
  private primaryPool: IDatabasePool;
  private replicaPool: IDatabasePool;
  private poolsAreShared: boolean;

  constructor(primaryPool?: IDatabasePool, replicaPool?: IDatabasePool) {
    if (primaryPool) {
      this.primaryPool = primaryPool;
      this.replicaPool = replicaPool || primaryPool;
    } else {
      const primaryUrl = requireDatabaseUrl();
      this.primaryPool = new PostgresDatabasePool(primaryUrl, 'primary');
      this.replicaPool = process.env.DATABASE_REPLICA_URL
        ? new PostgresDatabasePool(process.env.DATABASE_REPLICA_URL, 'replica')
        : this.primaryPool;
    }
    this.poolsAreShared = this.primaryPool === this.replicaPool;

    logger.log('info', 'DatabaseManager initialized', {
      primaryConfigured: !!process.env.DATABASE_URL,
      replicaConfigured: !!process.env.DATABASE_REPLICA_URL,
      replicaUsesPrimary: this.poolsAreShared,
    });
  }

  /**
   * Executes a database query.
   * SELECT queries are routed to the read replica with failover to primary.
   * All other queries (INSERT, UPDATE, DELETE, etc.) are routed to primary.
   */
  async query<T = any>(text: string, params?: any[]): Promise<{ rows: T[] }> {
    const isReadQuery = this.isReadQuery(text);

    if (isReadQuery) {
      try {
        return await this.executeWithBudget(this.replicaPool, 'raw_replica', text, params);
      } catch (error) {
        logger.log('warn', 'Read replica query failed, failing over to primary', {
          error: error instanceof Error ? error.message : String(error),
          action: classifySqlAction(text),
        });
        // Fallback to primary
        return await this.executeWithBudget(this.primaryPool, 'raw_primary', text, params);
      }
    }

    // Write queries always go to primary
    return await this.executeWithBudget(this.primaryPool, 'raw_primary', text, params);
  }

  /**
   * Forces a query to the read replica exclusively without failover to primary.
   * Intended for heavy analytics / reporting queries where replica staleness is acceptable.
   * Throws if the replica is unreachable.
   */
  async queryReplica<T = any>(text: string, params?: any[]): Promise<{ rows: T[] }> {
    return await this.executeWithBudget(this.replicaPool, 'raw_replica', text, params);
  }

  /**
   * Forces a query to the primary database, bypassing any replica routing.
   * Useful for reads that require the latest committed data (e.g. after a write).
   */
  async queryPrimary<T = any>(text: string, params?: any[]): Promise<{ rows: T[] }> {
    return await this.executeWithBudget(this.primaryPool, 'raw_primary', text, params);
  }

  /**
   * Returns true if the replica pool is configured and healthy.
   */
  async isReplicaHealthy(): Promise<boolean> {
    return await this.replicaPool.isHealthy();
  }

  /**
   * Returns the total count estimated from the replica for large tables,
   * which is useful for analytics dashboards where exact counts are not critical.
   */
  async estimatedCount(table: string): Promise<number> {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
      throw new Error(`Invalid table name: ${table}`);
    }

    const result = await this.queryReplica<{ count: number }>(
      `SELECT COUNT(*) as count FROM "${table}"`
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  /**
   * Simple check to see if a query is a read operation.
   */
  private isReadQuery(text: string): boolean {
    const trimmed = text.trim().toLowerCase();
    return trimmed.startsWith('select') || trimmed.startsWith('with');
  }

  private async executeWithBudget<T>(
    pool: IDatabasePool,
    model: 'raw_primary' | 'raw_replica',
    text: string,
    params?: any[],
  ): Promise<{ rows: T[] }> {
    const startedAt = process.hrtime.bigint();
    let failed = false;
    try {
      return await pool.query<T>(text, params);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      void recordQueryPerformance({
        model,
        action: classifySqlAction(text),
        durationMs,
        source: 'postgres',
        failed,
      }).catch((error) => {
        if (process.env.NODE_ENV !== 'test') {
          logger.log('error', 'Failed to record PostgreSQL query performance', {
            model,
            action: classifySqlAction(text),
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    }
  }

  /**
   * Checks the health of both database pools.
   */
  async getHealth(): Promise<{ primary: string; replica: string }> {
    const [primaryHealthy, replicaHealthy] = await Promise.all([
      this.primaryPool.isHealthy().catch(() => false),
      this.replicaPool.isHealthy().catch(() => false),
    ]);

    return {
      primary: primaryHealthy ? 'up' : 'down',
      replica: replicaHealthy ? 'up' : 'down',
    };
  }

  /**
   * Closes all database connections.
   */
  async shutdown(): Promise<void> {
    if (this.poolsAreShared) {
      await this.primaryPool.end();
      return;
    }

    await Promise.all([this.primaryPool.end(), this.replicaPool.end()]);
  }
}

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    return databaseUrl;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required in production');
  }

  return 'postgres://postgres:postgres@localhost:5432/yieldvault';
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function classifySqlAction(text: string): string {
  const withoutLeadingComments = text
    .replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/u, '')
    .trimStart();
  return withoutLeadingComments.match(/^([A-Za-z]+)/)?.[1]?.toLowerCase() || 'unknown';
}

// Export a singleton instance
export const db = new DatabaseManager();
