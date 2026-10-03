/**
 * Unit tests for yield accrual scheduler (Issue #1450)
 * Verifies that scheduling uses setTimeout without drift accumulation
 */
import { msUntilNextHour, runYieldAccrualJob, resetYieldAccrualSchedulerForTests } from '../yieldAccrualJob';

describe('Yield Accrual Job Scheduler (Issue #1450)', () => {
  // ─── Helper to mock Date.now() ────────────────────────────────────────────

  let originalDateNow: typeof Date.now;

  beforeEach(() => {
    originalDateNow = Date.now;
    jest.clearAllMocks();
  });

  afterEach(() => {
    Date.now = originalDateNow;
    resetYieldAccrualSchedulerForTests();
  });

  // ─── Tests ────────────────────────────────────────────────────────────────

  describe('msUntilNextHour', () => {
    it('returns correct ms when called at 12:00:30', () => {
      // 12:00:30 UTC = 43200000 + 30000 = 43230000
      const now = 43230000;
      const result = msUntilNextHour(now);

      // Next hour is 13:00:00 UTC = 46800000
      const expected = 46800000 - 43230000; // 3570000 ms = 59m 30s
      expect(result).toBe(expected);
    });

    it('returns correct ms when called at 12:59:00', () => {
      // 12:59:00 UTC = 43200000 + 3540000 = 46740000
      const now = 46740000;
      const result = msUntilNextHour(now);

      // Next hour is 13:00:00 UTC = 46800000
      const expected = 46800000 - 46740000; // 60000 ms = 1m
      expect(result).toBe(expected);
    });

    it('returns ~0 when called at exactly 13:00:00', () => {
      // Exactly 13:00:00 UTC = 46800000
      const now = 46800000;
      const result = msUntilNextHour(now);

      // Next hour is 14:00:00 UTC = 50400000
      const expected = 50400000 - 46800000; // 3600000 ms = 1 hour
      expect(result).toBe(expected);
    });

    it('returns correct ms at midnight', () => {
      // Midnight UTC = 0
      const now = 0;
      const result = msUntilNextHour(now);

      // Next hour is 01:00:00 UTC = 3600000
      const expected = 3600000;
      expect(result).toBe(expected);
    });

    it('handles 1 millisecond before hour boundary', () => {
      // 12:59:59.999 UTC = 46799999
      const now = 46799999;
      const result = msUntilNextHour(now);

      // Next hour is 13:00:00 UTC = 46800000
      const expected = 46800000 - 46799999; // 1 ms
      expect(result).toBe(expected);
    });

    it('returns exactly 1 hour for any time after hour boundary', () => {
      // Test multiple times throughout the hour
      for (let minute = 0; minute < 60; minute++) {
        const secondIntoHour = minute * 60;
        const now = 43200000 + secondIntoHour * 1000; // 12:00:XX UTC
        const result = msUntilNextHour(now);
        const nextHourBoundary = 46800000; // 13:00:00 UTC
        const expected = nextHourBoundary - now;

        expect(result).toBe(expected);
        expect(result).toBeLessThanOrEqual(3600000);
        expect(result).toBeGreaterThan(0);
      }
    });

    it('provides consistent scheduling across hour boundaries', () => {
      // Verify that scheduling at end of hour and beginning of next hour work correctly
      const endOfHour = 46799500; // 12:59:59.5 UTC
      const resultAtEnd = msUntilNextHour(endOfHour);

      const startOfNextHour = 46800000; // 13:00:00 UTC
      const resultAtStart = msUntilNextHour(startOfNextHour);

      // At end of hour, should be ~500ms
      expect(resultAtEnd).toBe(500);

      // At start of hour, should be ~3600000ms (1 hour)
      expect(resultAtStart).toBe(3600000);
    });
  });

  describe('runYieldAccrualJob', () => {
    it('computes correct window boundaries', async () => {
      // Set time to 12:00:30
      const fixedTime = 43230000;
      Date.now = jest.fn(() => fixedTime);

      const result = await runYieldAccrualJob();

      // Window should be [12:00:00, 13:00:00)
      expect(result.window.startTime).toBe('1970-01-01T12:00:00.000Z');
      expect(result.window.endTime).toBe('1970-01-01T13:00:00.000Z');
    });

    it('computes correct window at different times', async () => {
      // Set time to 23:45:15
      const fixedTime = 85515000; // 23:45:15 UTC
      Date.now = jest.fn(() => fixedTime);

      const result = await runYieldAccrualJob();

      // Window should be [23:00:00, 00:00:00) next day
      expect(result.window.startTime).toBe('1970-01-01T23:00:00.000Z');
      expect(result.window.endTime).toBe('1970-01-02T00:00:00.000Z');
    });

    it('records accrual metadata', async () => {
      const result = await runYieldAccrualJob();

      expect(result).toHaveProperty('vaultsProcessed');
      expect(result).toHaveProperty('totalYieldAccrued');
      expect(result).toHaveProperty('durationMs');
      expect(result).toHaveProperty('window');
      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('No Drift Accumulation', () => {
    it('scheduler advances by exactly 1 hour each cycle', () => {
      // Simulate multiple scheduler cycles
      const times: number[] = [];

      // Cycle 1: Start at 12:00:30
      let now = 43230000;
      times.push(now + msUntilNextHour(now));

      // Cycle 2: Start at result of cycle 1 (should be 13:00:00)
      now = times[0];
      times.push(now + msUntilNextHour(now));

      // Cycle 3
      now = times[1];
      times.push(now + msUntilNextHour(now));

      // Verify all run times are exactly 1 hour apart
      expect(times[0]).toBe(46800000); // 13:00:00
      expect(times[1]).toBe(50400000); // 14:00:00
      expect(times[2]).toBe(54000000); // 15:00:00

      // Verify no drift
      expect(times[1] - times[0]).toBe(3600000); // Exactly 1 hour
      expect(times[2] - times[1]).toBe(3600000); // Exactly 1 hour
    });

    it('maintains schedule even with simulated job delays', () => {
      // Simulate job taking 500ms to execute
      let now = 43230000;
      const jobDurationMs = 500;

      // Cycle 1: Job scheduled at 13:00:00, runs for 500ms
      let nextRun = now + msUntilNextHour(now);
      expect(nextRun).toBe(46800000); // 13:00:00

      now = nextRun + jobDurationMs; // 13:00:00.5
      nextRun = now + msUntilNextHour(now);
      expect(nextRun).toBe(50400000); // 14:00:00 (not 14:00:00.5)

      // Cycle 2: Should still be exactly 1 hour later
      now = nextRun + jobDurationMs; // 14:00:00.5
      nextRun = now + msUntilNextHour(now);
      expect(nextRun).toBe(54000000); // 15:00:00

      // Verify no drift accumulated
      expect(nextRun - 50400000).toBe(3600000); // Exactly 1 hour from previous run
    });

    it('recovers from large scheduling delays', () => {
      // Simulate event loop being blocked for 10 seconds
      let now = 43230000;

      // Original schedule: run at 13:00:00
      let nextRunTime = now + msUntilNextHour(now); // 46800000
      expect(nextRunTime).toBe(46800000);

      // Job runs 10 seconds late
      const delayMs = 10000;
      now = nextRunTime + delayMs; // 13:00:10

      // Next run should still be at 14:00:00, not 14:00:10
      nextRunTime = now + msUntilNextHour(now);
      expect(nextRunTime).toBe(50400000); // 14:00:00 exactly

      // Verify schedule recovered
      expect(nextRunTime - (46800000 + delayMs)).toBe(3600000 - delayMs); // Still ~1 hour from actual run time
    });
  });

  describe('Edge Cases', () => {
    it('handles millisecond precision', () => {
      const now = 43230123; // 12:00:30.123
      const result = msUntilNextHour(now);
      const nextHour = 46800000;

      expect(result).toBe(nextHour - now);
      expect(result).toBe(3569877);
    });

    it('works with large timestamps', () => {
      // Far future timestamp
      const now = 9999999999000; // ~Year 287396
      const result = msUntilNextHour(now);

      // Result should always be positive and <= 3600000
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(3600000);
    });

    it('returns max value of 3600000 (1 hour)', () => {
      // At exactly the hour boundary, next run is 1 hour away
      const now = 46800000;
      const result = msUntilNextHour(now);

      expect(result).toBe(3600000);
    });
  });
});
