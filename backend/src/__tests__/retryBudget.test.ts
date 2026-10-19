jest.mock('../middleware/structuredLogging', () => ({
  logger: { log: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { RetryBudgetService } from '../retryBudget';

const config = { maxRetries: 3, windowMs: 60_000, minSuccessRate: 0, failureThreshold: 10 };

describe('RetryBudgetService', () => {
  afterEach(() => jest.useRealTimers());

  it('allows retries on a fresh budget', () => {
    const budget = new RetryBudgetService(config);
    expect(budget.canRetry()).toBe(true);
    expect(budget.getStats()).toMatchObject({ remainingRetries: 3, totalAttempts: 0, successRate: 1 });
  });

  it('blocks retries once maxRetries failures are recorded', () => {
    const budget = new RetryBudgetService(config);
    budget.recordAttempt(false);
    budget.recordAttempt(false);
    expect(budget.canRetry()).toBe(true);
    budget.recordAttempt(false);
    expect(budget.canRetry()).toBe(false);
    expect(budget.getStats().remainingRetries).toBe(0);
  });

  it('blocks on consecutive failures and resets them on success', () => {
    const budget = new RetryBudgetService({ ...config, maxRetries: 100, failureThreshold: 2, minSuccessRate: 0 });
    budget.recordAttempt(false);
    budget.recordAttempt(false);
    expect(budget.canRetry()).toBe(false);
    budget.recordAttempt(true);
    expect(budget.getStats().consecutiveFailures).toBe(0);
    expect(budget.canRetry()).toBe(true);
  });

  it('blocks when the success rate drops below the minimum', () => {
    const budget = new RetryBudgetService({ ...config, maxRetries: 100, minSuccessRate: 0.5 });
    budget.recordAttempt(true);
    budget.recordAttempt(false);
    budget.recordAttempt(false);
    expect(budget.canRetry()).toBe(false);
  });

  it('forgets attempts that fall outside the window and supports reset()', () => {
    jest.useFakeTimers();
    const budget = new RetryBudgetService(config);
    budget.recordAttempt(false);
    budget.recordAttempt(false);
    budget.recordAttempt(false);
    expect(budget.canRetry()).toBe(false);

    jest.advanceTimersByTime(config.windowMs + 1);
    expect(budget.getStats().totalAttempts).toBe(0);

    budget.recordAttempt(false);
    budget.reset();
    expect(budget.getStats()).toMatchObject({ totalAttempts: 0, consecutiveFailures: 0 });
  });
});
