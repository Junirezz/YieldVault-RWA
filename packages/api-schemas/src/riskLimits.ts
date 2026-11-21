import { z } from "zod";

/** Basis points, 0..=10_000 (10_000 = 100%). */
const BpsSchema = z.number().int().min(0).max(10_000);

/** Current schema version of the risk-limits response. Bump on breaking changes. */
export const RISK_LIMITS_SCHEMA_VERSION = "v1" as const;

/**
 * Response of `GET /api/v1/vault/risk-limits`.
 *
 * Mirrors the on-chain risk configuration in
 * `contracts/vault/src/risk_limits.rs` (see docs/PROTOCOL_RISK_LIMITS.md).
 * Amounts are base-unit integer strings; `0` means unlimited.
 */
export const RiskLimitsResponseSchema = z
  .object({
    schemaVersion: z.literal(RISK_LIMITS_SCHEMA_VERSION),
    /** Where the values were resolved from. */
    source: z.enum(["environment", "defaults"]),
    tvlCap: z
      .object({
        maxVaultTvl: z.string().regex(/^\d+$/),
        unlimited: z.boolean(),
      })
      .strict(),
    concentration: z
      .object({
        /** Configured cap on any single strategy's share of TVL. */
        maxBps: BpsSchema,
        /** Cap currently enforced (min of normal and stress caps in stress mode). */
        effectiveBps: BpsSchema,
        /** Optional tighter per-strategy overrides. */
        perStrategy: z
          .array(z.object({ strategyId: z.string(), maxBps: BpsSchema }).strict())
          .default([]),
      })
      .strict(),
    deployedCapital: z
      .object({
        maxBps: BpsSchema,
        effectiveBps: BpsSchema,
      })
      .strict(),
    stressMode: z
      .object({
        active: z.boolean(),
        concentrationBps: BpsSchema,
        deployedBps: BpsSchema,
      })
      .strict(),
    generatedAt: z.string(),
  })
  .strict();

export type RiskLimitsResponse = z.infer<typeof RiskLimitsResponseSchema>;
