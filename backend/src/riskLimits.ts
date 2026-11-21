/**
 * @file riskLimits.ts
 * Resolves the *active* protocol risk-limit configuration for introspection
 * (Issue #1729).
 *
 * Values are read from the environment on every call rather than frozen at
 * module load, so an operator change (and a process restart that picks it up)
 * is reflected immediately and the endpoint never serves stale constants.
 * Unset or invalid values fall back to `DEFAULT_RISK_CONFIG`, which matches the
 * contract defaults in `contracts/vault/src/risk_limits.rs`.
 *
 * Environment variables (all optional):
 *   RISK_MAX_VAULT_TVL              integer base units, 0 = unlimited
 *   RISK_MAX_CONCENTRATION_BPS      0..=10000
 *   RISK_MAX_DEPLOYED_BPS           0..=10000
 *   RISK_STRESS_CONCENTRATION_BPS   0..=10000
 *   RISK_STRESS_DEPLOYED_BPS        0..=10000
 *   RISK_STRESS_MODE                "true" | "false"
 *   RISK_STRATEGY_CONCENTRATION_BPS JSON object, e.g. {"strategy-id": 2500}
 */

import {
  RISK_LIMITS_SCHEMA_VERSION,
  type RiskLimitsResponse,
} from '@yieldvault/api-schemas';
import { DEFAULT_RISK_CONFIG, type ProtocolRiskConfig } from './exposureGuardrails';
import { logger } from './middleware/structuredLogging';

type Env = Record<string, string | undefined>;

function parseBps(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 10_000) {
    logger.warn(`[riskLimits] ${name} must be an integer in 0..=10000; using default`, { value: raw });
    return fallback;
  }
  return n;
}

function parseTvl(raw: string | undefined, fallback: bigint): bigint {
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!/^\d+$/.test(raw.trim())) {
    logger.warn('[riskLimits] RISK_MAX_VAULT_TVL must be a non-negative integer; using default', {
      value: raw,
    });
    return fallback;
  }
  return BigInt(raw.trim());
}

function parsePerStrategy(raw: string | undefined): Array<{ strategyId: string; maxBps: number }> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.entries(parsed)
      .filter(
        ([, v]) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10_000,
      )
      .map(([strategyId, v]) => ({ strategyId, maxBps: v as number }))
      .sort((a, b) => a.strategyId.localeCompare(b.strategyId));
  } catch {
    logger.warn('[riskLimits] RISK_STRATEGY_CONCENTRATION_BPS is not valid JSON; ignoring');
    return [];
  }
}

const ENV_KEYS = [
  'RISK_MAX_VAULT_TVL',
  'RISK_MAX_CONCENTRATION_BPS',
  'RISK_MAX_DEPLOYED_BPS',
  'RISK_STRESS_CONCENTRATION_BPS',
  'RISK_STRESS_DEPLOYED_BPS',
  'RISK_STRESS_MODE',
  'RISK_STRATEGY_CONCENTRATION_BPS',
] as const;

/** Resolve the active risk configuration from the environment. */
export function loadActiveRiskConfig(env: Env = process.env): ProtocolRiskConfig {
  const d = DEFAULT_RISK_CONFIG;
  return {
    maxVaultTvl: parseTvl(env.RISK_MAX_VAULT_TVL, d.maxVaultTvl),
    maxConcBps: parseBps(env.RISK_MAX_CONCENTRATION_BPS, d.maxConcBps, 'RISK_MAX_CONCENTRATION_BPS'),
    maxDeployedBps: parseBps(env.RISK_MAX_DEPLOYED_BPS, d.maxDeployedBps, 'RISK_MAX_DEPLOYED_BPS'),
    stressConcBps: parseBps(
      env.RISK_STRESS_CONCENTRATION_BPS,
      d.stressConcBps,
      'RISK_STRESS_CONCENTRATION_BPS',
    ),
    stressDeployedBps: parseBps(
      env.RISK_STRESS_DEPLOYED_BPS,
      d.stressDeployedBps,
      'RISK_STRESS_DEPLOYED_BPS',
    ),
    stressMode: (env.RISK_STRESS_MODE ?? '').trim().toLowerCase() === 'true',
  };
}

/** Build the versioned API response for the active configuration. */
export function buildRiskLimitsResponse(
  env: Env = process.env,
  now: Date = new Date(),
): RiskLimitsResponse {
  const cfg = loadActiveRiskConfig(env);
  const configured = ENV_KEYS.some((k) => (env[k] ?? '').trim() !== '');
  const effectiveConc = cfg.stressMode ? Math.min(cfg.maxConcBps, cfg.stressConcBps) : cfg.maxConcBps;
  const effectiveDep = cfg.stressMode
    ? Math.min(cfg.maxDeployedBps, cfg.stressDeployedBps)
    : cfg.maxDeployedBps;

  return {
    schemaVersion: RISK_LIMITS_SCHEMA_VERSION,
    source: configured ? 'environment' : 'defaults',
    tvlCap: {
      maxVaultTvl: cfg.maxVaultTvl.toString(),
      unlimited: cfg.maxVaultTvl === 0n,
    },
    concentration: {
      maxBps: cfg.maxConcBps,
      effectiveBps: effectiveConc,
      perStrategy: parsePerStrategy(env.RISK_STRATEGY_CONCENTRATION_BPS),
    },
    deployedCapital: { maxBps: cfg.maxDeployedBps, effectiveBps: effectiveDep },
    stressMode: {
      active: cfg.stressMode,
      concentrationBps: cfg.stressConcBps,
      deployedBps: cfg.stressDeployedBps,
    },
    generatedAt: now.toISOString(),
  };
}
