import { RiskLimitsResponseSchema } from '@yieldvault/api-schemas';
import { buildRiskLimitsResponse, loadActiveRiskConfig } from '../riskLimits';

describe('risk limits endpoint payload (#1729)', () => {
  it('returns contract defaults when nothing is configured', () => {
    const body = buildRiskLimitsResponse({}, new Date('2026-01-01T00:00:00Z'));
    expect(RiskLimitsResponseSchema.parse(body)).toEqual(body);
    expect(body.schemaVersion).toBe('v1');
    expect(body.source).toBe('defaults');
    expect(body.tvlCap).toEqual({ maxVaultTvl: '0', unlimited: true });
    expect(body.concentration.maxBps).toBe(10_000);
    expect(body.stressMode).toEqual({ active: false, concentrationBps: 5_000, deployedBps: 7_000 });
  });

  it('reflects the active configuration rather than constants', () => {
    const env = {
      RISK_MAX_VAULT_TVL: '5000000000',
      RISK_MAX_CONCENTRATION_BPS: '4000',
      RISK_MAX_DEPLOYED_BPS: '9000',
      RISK_STRATEGY_CONCENTRATION_BPS: '{"b":2500,"a":3000,"bad":99999}',
    };
    const body = buildRiskLimitsResponse(env);
    expect(body.source).toBe('environment');
    expect(body.tvlCap).toEqual({ maxVaultTvl: '5000000000', unlimited: false });
    expect(body.concentration.maxBps).toBe(4000);
    expect(body.concentration.perStrategy).toEqual([
      { strategyId: 'a', maxBps: 3000 },
      { strategyId: 'b', maxBps: 2500 },
    ]);
    // A later change is picked up on the next call.
    expect(buildRiskLimitsResponse({ ...env, RISK_MAX_CONCENTRATION_BPS: '1000' }).concentration.maxBps).toBe(1000);
  });

  it('applies the tighter stress caps as the effective limits in stress mode', () => {
    const body = buildRiskLimitsResponse({
      RISK_MAX_CONCENTRATION_BPS: '8000',
      RISK_MAX_DEPLOYED_BPS: '6000',
      RISK_STRESS_MODE: 'true',
    });
    expect(body.stressMode.active).toBe(true);
    expect(body.concentration.effectiveBps).toBe(5_000);
    expect(body.deployedCapital.effectiveBps).toBe(6_000); // min(6000, 7000)
  });

  it('ignores invalid values and falls back to defaults', () => {
    const cfg = loadActiveRiskConfig({
      RISK_MAX_VAULT_TVL: '-5',
      RISK_MAX_CONCENTRATION_BPS: '20000',
      RISK_MAX_DEPLOYED_BPS: 'abc',
    });
    expect(cfg.maxVaultTvl).toBe(0n);
    expect(cfg.maxConcBps).toBe(10_000);
    expect(cfg.maxDeployedBps).toBe(10_000);
  });
});
