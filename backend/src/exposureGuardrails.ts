/**
 * @file exposureGuardrails.ts
 * Backend enforcement of protocol risk limits (Issue #1173).
 *
 * This module mirrors the hard-cap logic in `contracts/vault/src/risk_limits.rs`
 * at the API layer so out-of-bounds deposits or invest calls are rejected before
 * they reach the Soroban RPC — saving gas and giving callers a structured error
 * rather than an opaque contract failure.
 *
 * Exposure is evaluated against the limits described in
 * `docs/PROTOCOL_RISK_LIMITS.md`:
 *   - Max vault TVL (absolute cap, 0 = unlimited)
 *   - Max strategy concentration (bps of TVL)
 *   - Max deployed capital (bps of TVL)
 *   - Stress-mode tighter caps (StrConc / StrDep)
 *
 * Reads that do not mutate (all public helpers here) are deliberately left
 * outside any transaction — see the note in `services/allocation.ts`.
 *
 * Issue #1373 — the Logger type injected into `createExposureGuardrails` must
 * include `error` and `warn`.  The `Logger` interface exported from
 * `middleware/structuredLogging` satisfies that requirement.
 */

import type { Logger } from './middleware/structuredLogging';
import { logger as defaultLogger } from './middleware/structuredLogging';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Basis points (1 bps = 0.01%).  10_000 bps = 100%. */
export type Bps = number;

/**
 * Snapshot of the current protocol risk configuration.
 * Zero values indicate "unlimited" for numeric caps.
 */
export interface ProtocolRiskConfig {
  /** Hard cap on total vault TVL in USDC-equivalent base units.  0 = unlimited. */
  maxVaultTvl: bigint;
  /** Max concentration of any single strategy, in bps. */
  maxConcBps: Bps;
  /** Max share of TVL that may be deployed (invested out of idle), in bps. */
  maxDeployedBps: Bps;
  /** Stress-mode concentration cap (applies when stressMode is true). */
  stressConcBps: Bps;
  /** Stress-mode deployed capital cap. */
  stressDeployedBps: Bps;
  /** When true, the tighter stress caps are applied. */
  stressMode: boolean;
}

export const DEFAULT_RISK_CONFIG: Readonly<ProtocolRiskConfig> = Object.freeze({
  maxVaultTvl: 0n,          // unlimited
  maxConcBps: 10_000,       // 100%
  maxDeployedBps: 10_000,   // 100%
  stressConcBps: 5_000,     // 50%
  stressDeployedBps: 7_000, // 70%
  stressMode: false,
});

/** Context supplied when checking a deposit. */
export interface DepositCheckInput {
  currentTvl: bigint;
  depositAmount: bigint;
}

/** Context supplied when checking a strategy invest / rebalance. */
export interface InvestCheckInput {
  totalTvl: bigint;
  /** Amount already allocated to the target strategy before this invest. */
  currentStrategyAmount: bigint;
  /** Additional amount to invest into the strategy. */
  investAmount: bigint;
  /** Total capital currently deployed across all strategies. */
  totalDeployedAmount: bigint;
}

export type GuardrailOutcome = 'ok' | 'rejected';

export interface GuardrailResult {
  outcome: GuardrailOutcome;
  reason?: string;
}

/** Public surface of the exposure guardrails service. */
export interface ExposureGuardrails {
  /** Returns `ok` when the deposit fits within the TVL cap. */
  checkDeposit(input: DepositCheckInput): GuardrailResult;
  /** Returns `ok` when the invest operation satisfies concentration + deployed caps. */
  checkInvest(input: InvestCheckInput): GuardrailResult;
  /** True when stress-mode caps are currently active. */
  readonly isStressMode: boolean;
}

// ─── Implementation ───────────────────────────────────────────────────────────

function bpsOf(amount: bigint, total: bigint): Bps {
  if (total === 0n) return 0;
  // Convert to integer bps: (amount * 10_000) / total, rounded down.
  return Number((amount * 10_000n) / total);
}

class ExposureGuardrailsImpl implements ExposureGuardrails {
  private readonly log: Logger;
  private readonly cfg: ProtocolRiskConfig;

  constructor(log: Logger, cfg: ProtocolRiskConfig) {
    this.log = log;
    this.cfg = cfg;
  }

  get isStressMode(): boolean {
    return this.cfg.stressMode;
  }

  checkDeposit(input: DepositCheckInput): GuardrailResult {
    const { currentTvl, depositAmount } = input;
    const { maxVaultTvl } = this.cfg;

    // maxVaultTvl === 0n means unlimited
    if (maxVaultTvl === 0n) {
      this.log.debug('[exposureGuardrails] TVL cap is unlimited, deposit allowed', {
        currentTvl: currentTvl.toString(),
        depositAmount: depositAmount.toString(),
      });
      return { outcome: 'ok' };
    }

    const projected = currentTvl + depositAmount;

    if (projected > maxVaultTvl) {
      const reason =
        `Deposit of ${depositAmount} would push TVL to ${projected}, ` +
        `exceeding the max cap of ${maxVaultTvl}`;
      this.log.warn('[exposureGuardrails] Deposit rejected: TVL cap exceeded', {
        currentTvl: currentTvl.toString(),
        depositAmount: depositAmount.toString(),
        projected: projected.toString(),
        maxVaultTvl: maxVaultTvl.toString(),
      });
      return { outcome: 'rejected', reason };
    }

    this.log.debug('[exposureGuardrails] Deposit allowed', {
      currentTvl: currentTvl.toString(),
      depositAmount: depositAmount.toString(),
      projected: projected.toString(),
      maxVaultTvl: maxVaultTvl.toString(),
    });
    return { outcome: 'ok' };
  }

  checkInvest(input: InvestCheckInput): GuardrailResult {
    const { totalTvl, currentStrategyAmount, investAmount, totalDeployedAmount } = input;
    const { maxConcBps, maxDeployedBps, stressConcBps, stressDeployedBps, stressMode } = this.cfg;

    const effectiveConcBps = stressMode
      ? Math.min(maxConcBps, stressConcBps)
      : maxConcBps;
    const effectiveDeployedBps = stressMode
      ? Math.min(maxDeployedBps, stressDeployedBps)
      : maxDeployedBps;

    if (totalTvl === 0n) {
      this.log.warn('[exposureGuardrails] Invest check called with zero TVL; rejecting', {
        investAmount: investAmount.toString(),
      });
      return { outcome: 'rejected', reason: 'TVL is zero; cannot evaluate concentration' };
    }

    // Concentration check
    const projectedStrategyAmount = currentStrategyAmount + investAmount;
    const projectedConcBps = bpsOf(projectedStrategyAmount, totalTvl);

    if (projectedConcBps > effectiveConcBps) {
      const reason =
        `Strategy concentration would reach ${projectedConcBps} bps, ` +
        `exceeding the ${stressMode ? 'stress-mode ' : ''}cap of ${effectiveConcBps} bps`;
      this.log.warn('[exposureGuardrails] Invest rejected: concentration cap exceeded', {
        projectedConcBps,
        effectiveConcBps,
        stressMode,
        totalTvl: totalTvl.toString(),
        investAmount: investAmount.toString(),
      });
      return { outcome: 'rejected', reason };
    }

    // Deployed capital check
    const projectedDeployedAmount = totalDeployedAmount + investAmount;
    const projectedDeployedBps = bpsOf(projectedDeployedAmount, totalTvl);

    if (projectedDeployedBps > effectiveDeployedBps) {
      const reason =
        `Deployed capital would reach ${projectedDeployedBps} bps, ` +
        `exceeding the ${stressMode ? 'stress-mode ' : ''}cap of ${effectiveDeployedBps} bps`;
      this.log.warn('[exposureGuardrails] Invest rejected: deployed capital cap exceeded', {
        projectedDeployedBps,
        effectiveDeployedBps,
        stressMode,
        totalTvl: totalTvl.toString(),
        investAmount: investAmount.toString(),
      });
      return { outcome: 'rejected', reason };
    }

    this.log.debug('[exposureGuardrails] Invest allowed', {
      projectedConcBps,
      projectedDeployedBps,
      stressMode,
    });
    return { outcome: 'ok' };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create an exposure guardrails evaluator.
 *
 * @param cfg - Risk configuration.  Defaults to `DEFAULT_RISK_CONFIG`.
 * @param log - Logger instance.  Defaults to the shared structured logger.
 *              Must expose `error` and `warn` (see issue #1373).
 */
export function createExposureGuardrails(
  cfg: ProtocolRiskConfig = DEFAULT_RISK_CONFIG,
  log: Logger = defaultLogger,
): ExposureGuardrails {
  return new ExposureGuardrailsImpl(log, cfg);
}
