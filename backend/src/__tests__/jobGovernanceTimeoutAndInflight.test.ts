import { runJobWithRetry, JOB_POLICIES, jobGovernanceStore } from '../jobGovernance';
import { startPositionReconciliationScheduler } from '../positionReconciliationJob';
import { dumpDatabase } from '../dbBackupJob';
import child_process from 'child_process';
import { EventEmitter } from 'events';

describe('Issue #1614 — Job timeouts, in-flight guards, and pg_dump timeout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('JOB_POLICIES has timeoutMs on all policies', () => {
    for (const [name, policy] of Object.entries(JOB_POLICIES)) {
      expect(policy.timeoutMs).toBeDefined();
      expect(typeof policy.timeoutMs).toBe('number');
      expect(policy.timeoutMs!).toBeGreaterThan(0);
    }
  });

  it('races a never-resolving task and dead-letters it with timeout reason', async () => {
    const originalPolicy = { ...JOB_POLICIES.priceRefresh };
    // Set a very short timeoutMs and maxAttempts = 1 for test speed
    JOB_POLICIES.priceRefresh.timeoutMs = 50;
    JOB_POLICIES.priceRefresh.maxAttempts = 1;

    const neverResolvingTask = () => new Promise<void>(() => {});

    let errorThrown: any;
    try {
      await runJobWithRetry('priceRefresh', neverResolvingTask, {
        sleep: async () => {},
      });
    } catch (err) {
      errorThrown = err;
    }

    expect(errorThrown).toBeDefined();
    expect(errorThrown.message).toMatch(/timed out after 50ms/);

    const deadLetters = jobGovernanceStore.listDeadLetters({ jobName: 'priceRefresh' });
    expect(deadLetters.records.length).toBeGreaterThan(0);
    expect(deadLetters.records[deadLetters.records.length - 1].error).toMatch(/timed out after 50ms/);

    // Restore policy
    JOB_POLICIES.priceRefresh = originalPolicy;
  });

  it('interval scheduler skips a tick while previous run is in flight', async () => {
    jest.useFakeTimers();

    process.env.POSITION_RECONCILIATION_ENABLED = 'true';
    process.env.POSITION_RECONCILIATION_INTERVAL_MS = '1000';

    let jobExecutionCount = 0;
    let resolveFirstRun: () => void = () => {};
    const firstRunPromise = new Promise<void>((resolve) => {
      resolveFirstRun = resolve;
    });

    const stop = startPositionReconciliationScheduler();

    // Advance by interval
    jest.advanceTimersByTime(1000);
    // Advance again by interval while first run is still pending
    jest.advanceTimersByTime(1000);

    // Stop scheduler and clean up timers
    stop();
    resolveFirstRun();
    jest.useRealTimers();
  });

  it('kills pg_dump child process if it times out', async () => {
    const originalTimeout = process.env.PG_DUMP_TIMEOUT_MS;
    const originalDbUrl = process.env.DATABASE_URL;
    process.env.PG_DUMP_TIMEOUT_MS = '50';
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/testdb';

    const mockChild: any = new EventEmitter();
    mockChild.stdout = new EventEmitter();
    mockChild.stdout.pipe = jest.fn();
    mockChild.stderr = new EventEmitter();
    mockChild.kill = jest.fn();

    jest.spyOn(child_process, 'spawn').mockReturnValue(mockChild);

    let errorThrown: any;
    try {
      await dumpDatabase();
    } catch (err) {
      errorThrown = err;
    }

    expect(errorThrown).toBeDefined();
    expect(errorThrown.message).toMatch(/pg_dump timed out after 50ms/);
    expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL');

    process.env.PG_DUMP_TIMEOUT_MS = originalTimeout;
    process.env.DATABASE_URL = originalDbUrl;
    (child_process.spawn as jest.Mock).mockRestore();
  });
});
