import { logger } from './middleware/structuredLogging';

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
 * Mock database pool for demonstration purposes.
 * In a real application, this would be replaced by a real database driver (e.g., pg).
 */
class MockDatabasePool implements IDatabasePool {
  private name: string;
  private failNext: boolean = false;

  constructor(name: string) {
    this.name = name;
  }

  async query<T = any>(text: string, params?: any[]): Promise<{ rows: T[] }> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error(`Database error in ${this.name}`);
    }
    
    logger.log('info', `Executing query on ${this.name}`, { text, params });
    
    // Simulate query execution
    return { rows: [] };
  }

  async end(): Promise<void> {
    logger.log('info', `Closing ${this.name} pool`);
  }

  async isHealthy(): Promise<boolean> {
    return !this.failNext;
  }

  /**
   * Method for testing failover logic.
   */
  setFailNext(fail: boolean): void {
    this.failNext = fail;
  }
}

/**
 * DatabaseManager handles routing queries between a primary write database
 * and a read-only replica, with automatic failover to primary for reads.
 */
export class DatabaseManager {
  private primaryPool: IDatabasePool;
  private replicaPool: IDatabasePool;

  constructor(primaryPool?: IDatabasePool, replicaPool?: IDatabasePool) {
    // In a real app, these URLs would come from process.env
    const primaryUrl = process.env.DATABASE_URL || 'postgres://localhost:5432/primary';
    const replicaUrl = process.env.DATABASE_REPLICA_URL || 'postgres://localhost:5432/replica';

    this.primaryPool = primaryPool || new MockDatabasePool('primary');
    this.replicaPool = replicaPool || new MockDatabasePool('replica');

    logger.log('info', 'DatabaseManager initialized', {
      primaryConfigured: !!process.env.DATABASE_URL,
      replicaConfigured: !!process.env.DATABASE_REPLICA_URL,
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
        return await this.replicaPool.query<T>(text, params);
      } catch (error) {
        logger.log('warn', 'Read replica query failed, failing over to primary', {
          error: error instanceof Error ? error.message : String(error),
          text,
        });
        // Fallback to primary
        return await this.primaryPool.query<T>(text, params);
      }
    }

    // Write queries always go to primary
    return await this.primaryPool.query<T>(text, params);
  }

  /**
   * Simple check to see if a query is a read operation.
   */
  private isReadQuery(text: string): boolean {
    const trimmed = text.trim().toLowerCase();
    return trimmed.startsWith('select') || trimmed.startsWith('with');
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
    await Promise.all([
      this.primaryPool.end(),
      this.replicaPool.end(),
    ]);
  }
}

// Export a singleton instance
export const db = new DatabaseManager();
