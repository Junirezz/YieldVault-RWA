import { execFile } from 'child_process';
import { promisify } from 'util';
import { Client } from 'pg';
import { logger } from '../middleware/structuredLogging';

const execFileAsync = promisify(execFile);

export const MIGRATION_ADVISORY_LOCK_ID = 727727;
export const MIGRATION_LOCK_RETRY_DELAY_MS = 5000;

export interface LockClient {
  connect(): Promise<unknown>;
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
}

export interface MigrateOptions {
  /** Creates the dedicated connection that holds the session-level lock. */
  createClient?: () => LockClient;
  /** Runs `prisma migrate deploy`. */
  deploy?: () => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  retryDelayMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function defaultCreateClient(): LockClient {
  return new Client({ connectionString: process.env.DATABASE_URL });
}

async function defaultDeploy(): Promise<void> {
  const { stdout } = await execFileAsync(
    'npx',
    ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
    { env: process.env },
  );
  if (stdout) {
    logger.log('info', 'prisma migrate deploy output', { output: stdout.trim() });
  }
}

async function tryAcquire(client: LockClient): Promise<boolean> {
  const result = await client.query(
    `SELECT pg_try_advisory_lock(${MIGRATION_ADVISORY_LOCK_ID}) AS locked`,
  );
  return result.rows[0]?.locked === true;
}

/**
 * Applies pending migrations while holding a Postgres advisory lock so that
 * concurrent deploys serialize instead of racing (which surfaces as P3005 or
 * out-of-order application). A runner that gets the lock second finds nothing
 * left to apply, since `migrate deploy` is idempotent.
 */
export async function runMigrations(options: MigrateOptions = {}): Promise<void> {
  const createClient = options.createClient ?? defaultCreateClient;
  const deploy = options.deploy ?? defaultDeploy;
  const sleep = options.sleep ?? defaultSleep;
  const retryDelayMs = options.retryDelayMs ?? MIGRATION_LOCK_RETRY_DELAY_MS;

  // Advisory locks are session-scoped, so lock and unlock must share one connection.
  const client = createClient();
  await client.connect();

  let acquired = false;
  try {
    acquired = await tryAcquire(client);
    if (!acquired) {
      logger.log('warn', 'Migration lock busy; retrying', { retryDelayMs });
      await sleep(retryDelayMs);
      acquired = await tryAcquire(client);
    }
    if (!acquired) {
      throw new Error(
        `Could not acquire migration advisory lock ${MIGRATION_ADVISORY_LOCK_ID} after retry`,
      );
    }

    logger.log('info', 'migration_lock_acquired', {
      metric: 'migration_lock_acquired',
      lockId: MIGRATION_ADVISORY_LOCK_ID,
    });

    await deploy();
  } finally {
    try {
      if (acquired) {
        await client.query(`SELECT pg_advisory_unlock(${MIGRATION_ADVISORY_LOCK_ID})`);
      }
    } finally {
      await client.end();
    }
  }
}

if (require.main === module) {
  runMigrations().catch((err) => {
    logger.log('error', 'Database migration failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
}
