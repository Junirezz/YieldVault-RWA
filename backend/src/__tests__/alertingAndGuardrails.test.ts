/**
 * Tests for alerting.ts and exposureGuardrails.ts (Issue #1373).
 *
 * Key focus: the Logger interface used by both modules must include `error`
 * and `warn`.  These tests inject a mock that only exposes those four methods,
 * so TypeScript would reject the mock at compile-time if either method were
 * missing from the interface.
 */

import { createAlertingService } from '../alerting';
import type { AlertChannel, AlertEvent, AlertingService } from '../alerting';
import type { Logger } from '../middleware/structuredLogging';
import { createExposureGuardrails, DEFAULT_RISK_CONFIG } from '../exposureGuardrails';
import type { ProtocolRiskConfig } from '../exposureGuardrails';

// ─── Shared mock factory ──────────────────────────────────────────────────────

/** Returns a Logger mock that satisfies the full interface (all four methods). */
function makeMockLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

// ─── alerting.ts ─────────────────────────────────────────────────────────────

describe('alerting — Logger interface', () => {
  it('Logger interface must include warn and error (compile-time check)', () => {
    // If Logger were missing warn/error, TypeScript would fail here.
    const log: Logger = makeMockLogger();
    const svc = createAlertingService([], log);
    expect(svc).toBeDefined();
  });
});

describe('alerting — raise()', () => {
  let log: jest.Mocked<Logger>;
  let channel: jest.Mocked<AlertChannel>;
  let svc: AlertingService;

  beforeEach(() => {
    log = makeMockLogger();
    channel = { send: jest.fn().mockResolvedValue(undefined) };
    svc = createAlertingService([channel], log);
  });

  it('calls logger.error for critical severity', async () => {
    await svc.raise({ name: 'tvl_breach', severity: 'critical', value: 1_000, threshold: 500 });
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('Critical'),
      expect.objectContaining({ alertName: 'tvl_breach', severity: 'critical' }),
    );
  });

  it('calls logger.warn for warning severity', async () => {
    await svc.raise({ name: 'conc_warning', severity: 'warning', value: 80, threshold: 100 });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Warning'),
      expect.objectContaining({ alertName: 'conc_warning', severity: 'warning' }),
    );
  });

  it('delivers the event to every registered channel', async () => {
    const channel2: jest.Mocked<AlertChannel> = { send: jest.fn().mockResolvedValue(undefined) };
    const svc2 = createAlertingService([channel, channel2], log);
    const event: AlertEvent = { name: 'test', severity: 'warning', value: 1, threshold: 2 };
    await svc2.raise(event);
    expect(channel.send).toHaveBeenCalledWith(event);
    expect(channel2.send).toHaveBeenCalledWith(event);
  });

  it('logs a channel delivery failure with logger.error and does not throw', async () => {
    channel.send.mockRejectedValueOnce(new Error('network timeout'));
    await expect(
      svc.raise({ name: 'net_fail', severity: 'warning', value: 1, threshold: 10 }),
    ).resolves.toBeUndefined();
    // First call: the warn for the alert itself; second call: the error for delivery failure
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('delivery failed'),
      expect.objectContaining({ alertName: 'net_fail', error: 'network timeout' }),
    );
  });

  it('passes metadata fields through to the logger', async () => {
    await svc.raise({
      name: 'meta_test',
      severity: 'critical',
      value: 999,
      threshold: 100,
      metadata: { vaultId: 'vault-1' },
    });
    expect(log.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ vaultId: 'vault-1' }),
    );
  });
});

describe('alerting — evaluate()', () => {
  let log: jest.Mocked<Logger>;
  let svc: AlertingService;

  beforeEach(() => {
    log = makeMockLogger();
    svc = createAlertingService([], log);
  });

  it('does not alert when value is below warn ratio', async () => {
    await svc.evaluate('check', 50, 100, { warnRatio: 0.8 });
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('fires warning when value is at warn ratio threshold', async () => {
    await svc.evaluate('check', 80, 100, { warnRatio: 0.8, critRatio: 1.0 });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();
  });

  it('fires critical when value equals threshold', async () => {
    await svc.evaluate('check', 100, 100, { warnRatio: 0.8, critRatio: 1.0 });
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('fires critical when value exceeds threshold', async () => {
    await svc.evaluate('check', 150, 100, { critRatio: 1.0 });
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('uses default warn ratio of 0.8 and crit ratio of 1.0', async () => {
    // 79 < 80 (0.8 * 100) — no alert
    await svc.evaluate('check', 79, 100);
    expect(log.warn).not.toHaveBeenCalled();
    // 80 >= 80 — warning
    await svc.evaluate('check', 80, 100);
    expect(log.warn).toHaveBeenCalledTimes(1);
    // 100 >= 100 — critical
    await svc.evaluate('check', 100, 100);
    expect(log.error).toHaveBeenCalledTimes(1);
  });
});

// ─── exposureGuardrails.ts ────────────────────────────────────────────────────

describe('exposureGuardrails — Logger interface', () => {
  it('Logger interface must include warn and error (compile-time check)', () => {
    const log: Logger = makeMockLogger();
    const g = createExposureGuardrails(DEFAULT_RISK_CONFIG, log);
    expect(g).toBeDefined();
  });
});

describe('exposureGuardrails — checkDeposit()', () => {
  let log: jest.Mocked<Logger>;

  function makeGuardrails(cfg?: Partial<ProtocolRiskConfig>) {
    return createExposureGuardrails({ ...DEFAULT_RISK_CONFIG, ...cfg }, log);
  }

  beforeEach(() => {
    log = makeMockLogger();
  });

  it('allows deposit when TVL cap is unlimited (0)', () => {
    const g = makeGuardrails({ maxVaultTvl: 0n });
    const result = g.checkDeposit({ currentTvl: 1_000_000n, depositAmount: 999_999_999n });
    expect(result.outcome).toBe('ok');
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('allows deposit that stays within the cap', () => {
    const g = makeGuardrails({ maxVaultTvl: 1_000_000n });
    const result = g.checkDeposit({ currentTvl: 500_000n, depositAmount: 499_999n });
    expect(result.outcome).toBe('ok');
  });

  it('allows deposit that lands exactly on the cap', () => {
    const g = makeGuardrails({ maxVaultTvl: 1_000_000n });
    const result = g.checkDeposit({ currentTvl: 500_000n, depositAmount: 500_000n });
    expect(result.outcome).toBe('ok');
  });

  it('rejects deposit that would exceed TVL cap', () => {
    const g = makeGuardrails({ maxVaultTvl: 1_000_000n });
    const result = g.checkDeposit({ currentTvl: 900_000n, depositAmount: 200_000n });
    expect(result.outcome).toBe('rejected');
    expect(result.reason).toBeDefined();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('TVL cap exceeded'),
      expect.any(Object),
    );
  });
});

describe('exposureGuardrails — checkInvest()', () => {
  let log: jest.Mocked<Logger>;

  function makeGuardrails(cfg?: Partial<ProtocolRiskConfig>) {
    return createExposureGuardrails({ ...DEFAULT_RISK_CONFIG, ...cfg }, log);
  }

  beforeEach(() => {
    log = makeMockLogger();
  });

  it('rejects when TVL is zero', () => {
    const g = makeGuardrails();
    const result = g.checkInvest({
      totalTvl: 0n,
      currentStrategyAmount: 0n,
      investAmount: 100n,
      totalDeployedAmount: 0n,
    });
    expect(result.outcome).toBe('rejected');
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('allows invest within concentration and deployed caps', () => {
    // TVL = 1_000_000; strategy gets 300_000 (30%); deployed total = 300_000 (30%)
    const g = makeGuardrails({ maxConcBps: 5_000, maxDeployedBps: 5_000 });
    const result = g.checkInvest({
      totalTvl: 1_000_000n,
      currentStrategyAmount: 0n,
      investAmount: 300_000n,
      totalDeployedAmount: 0n,
    });
    expect(result.outcome).toBe('ok');
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('rejects when concentration cap is exceeded', () => {
    // Cap 5_000 bps = 50%.  Investing 600_000 of 1_000_000 TVL = 60%.
    const g = makeGuardrails({ maxConcBps: 5_000, maxDeployedBps: 10_000 });
    const result = g.checkInvest({
      totalTvl: 1_000_000n,
      currentStrategyAmount: 0n,
      investAmount: 600_000n,
      totalDeployedAmount: 0n,
    });
    expect(result.outcome).toBe('rejected');
    expect(result.reason).toMatch(/concentration/i);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('rejects when deployed capital cap is exceeded', () => {
    // Conc cap fine; deployed cap 5_000 bps = 50%.  Deploying 600_000 = 60%.
    const g = makeGuardrails({ maxConcBps: 10_000, maxDeployedBps: 5_000 });
    const result = g.checkInvest({
      totalTvl: 1_000_000n,
      currentStrategyAmount: 0n,
      investAmount: 600_000n,
      totalDeployedAmount: 0n,
    });
    expect(result.outcome).toBe('rejected');
    expect(result.reason).toMatch(/deployed capital/i);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  describe('stress mode', () => {
    it('isStressMode returns true when configured', () => {
      const g = makeGuardrails({ stressMode: true });
      expect(g.isStressMode).toBe(true);
    });

    it('applies tighter stress caps when stressMode is true', () => {
      // Normal conc cap: 100% (10_000 bps).  Stress cap: 30% (3_000 bps).
      // Invest 400_000 / 1_000_000 TVL = 40% → rejected under stress.
      const g = makeGuardrails({
        maxConcBps: 10_000,
        maxDeployedBps: 10_000,
        stressConcBps: 3_000,
        stressDeployedBps: 10_000,
        stressMode: true,
      });
      const result = g.checkInvest({
        totalTvl: 1_000_000n,
        currentStrategyAmount: 0n,
        investAmount: 400_000n,
        totalDeployedAmount: 0n,
      });
      expect(result.outcome).toBe('rejected');
      expect(result.reason).toMatch(/stress-mode/);
    });

    it('allows the same invest when stress mode is off', () => {
      const g = makeGuardrails({
        maxConcBps: 10_000,
        maxDeployedBps: 10_000,
        stressConcBps: 3_000,
        stressDeployedBps: 10_000,
        stressMode: false,
      });
      const result = g.checkInvest({
        totalTvl: 1_000_000n,
        currentStrategyAmount: 0n,
        investAmount: 400_000n,
        totalDeployedAmount: 0n,
      });
      expect(result.outcome).toBe('ok');
    });

    it('uses the tighter of normal and stress deployed caps', () => {
      // stressDeployedBps (70%) is tighter than maxDeployedBps (100%).
      // Invest 800_000 / 1_000_000 = 80% → rejected.
      const g = makeGuardrails({
        maxConcBps: 10_000,
        maxDeployedBps: 10_000,
        stressConcBps: 10_000,
        stressDeployedBps: 7_000,
        stressMode: true,
      });
      const result = g.checkInvest({
        totalTvl: 1_000_000n,
        currentStrategyAmount: 0n,
        investAmount: 800_000n,
        totalDeployedAmount: 0n,
      });
      expect(result.outcome).toBe('rejected');
      expect(result.reason).toMatch(/deployed capital/i);
    });
  });
});
