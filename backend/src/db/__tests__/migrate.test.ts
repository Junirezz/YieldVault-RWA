import { runMigrations, LockClient, MIGRATION_ADVISORY_LOCK_ID } from '../migrate';

/** In-memory stand-in for Postgres advisory locks, shared across "sessions". */
function createFakeDb() {
  let holder: number | null = null;
  let nextId = 1;
  const applied = new Set<string>();
  const log: string[] = [];

  const createClient = (): LockClient => {
    const id = nextId++;
    return {
      connect: async () => {},
      end: async () => {},
      query: async (sql: string) => {
        if (sql.includes('pg_try_advisory_lock')) {
          const ok = holder === null || holder === id;
          if (ok) holder = id;
          log.push(`lock:${id}:${ok}`);
          return { rows: [{ locked: ok }] };
        }
        if (sql.includes('pg_advisory_unlock')) {
          if (holder === id) holder = null;
          log.push(`unlock:${id}`);
          return { rows: [{ pg_advisory_unlock: true }] };
        }
        throw new Error(`unexpected sql: ${sql}`);
      },
    };
  };

  // Mimics `prisma migrate deploy`: a second concurrent apply would hit P3005.
  const deploy = (runner: string, applyLog: string[]) => async () => {
    if (holder === null) throw new Error('P3005: deploy ran without the lock');
    await new Promise((r) => setImmediate(r));
    if (!applied.has('0001_init')) {
      applied.add('0001_init');
      applyLog.push(runner);
    }
  };

  return { createClient, deploy, log, isLocked: () => holder !== null };
}

describe('runMigrations advisory lock', () => {
  it('single runner acquires, deploys, and releases the lock', async () => {
    const db = createFakeDb();
    const applyLog: string[] = [];
    await runMigrations({ createClient: db.createClient, deploy: db.deploy('a', applyLog) });
    expect(applyLog).toEqual(['a']);
    expect(db.isLocked()).toBe(false);
    expect(db.log).toEqual(['lock:1:true', 'unlock:1']);
  });

  it('concurrent runners: only one applies, the other sees it applied without P3005', async () => {
    const db = createFakeDb();
    const applyLog: string[] = [];
    // The sleep lets the first runner finish, like the real 5s wait.
    const sleep = () => new Promise<void>((r) => setTimeout(r, 20));

    const results = await Promise.allSettled([
      runMigrations({ createClient: db.createClient, deploy: db.deploy('a', applyLog), sleep }),
      runMigrations({ createClient: db.createClient, deploy: db.deploy('b', applyLog), sleep }),
    ]);

    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(applyLog).toHaveLength(1);
    expect(db.isLocked()).toBe(false);
  });

  it('fails after one retry if the lock stays busy, and does not unlock a lock it never held', async () => {
    const db = createFakeDb();
    const holderClient = db.createClient();
    await holderClient.query(`SELECT pg_try_advisory_lock(${MIGRATION_ADVISORY_LOCK_ID})`);
    const sleep = jest.fn().mockResolvedValue(undefined);
    const deploy = jest.fn();

    await expect(
      runMigrations({ createClient: db.createClient, deploy, sleep, retryDelayMs: 5000 }),
    ).rejects.toThrow(/advisory lock/);

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(5000);
    expect(deploy).not.toHaveBeenCalled();
    expect(db.log.filter((l) => l.startsWith('unlock:2'))).toHaveLength(0);
    expect(db.isLocked()).toBe(true);
  });

  it('releases the lock when deploy throws', async () => {
    const db = createFakeDb();
    await expect(
      runMigrations({
        createClient: db.createClient,
        deploy: async () => {
          throw new Error('boom');
        },
      }),
    ).rejects.toThrow('boom');
    expect(db.isLocked()).toBe(false);
  });
});
