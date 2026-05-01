/**
 * @file schemas.ts
 * Zod schemas for every request payload / query-parameter bag that the
 * YieldVault API client dispatches.
 *
 * Import the schema you need and pass it to `validate()` from ./validation
 * before calling any API function.
 *
 * Naming convention: <Entity><Action>Schema  (e.g. DepositRequestSchema)
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/**
 * Stellar / Soroban public key: G... base-32 address, 56 characters.
 * Validates format only — not an on-chain account existence check.
 */
export const StellarAddressSchema = z
  .string()
  .trim()
  .min(1, { message: "Wallet address is required" })
  .regex(/^G[A-Z2-7]{55}$/, {
    message: "Must be a valid Stellar public key (starts with G, 56 chars)",
  });

/**
 * Positive decimal amount represented as a string (preserves precision).
 * Allows up to 7 decimal places to match Stellar's stroop precision.
 */
export const AmountSchema = z
  .string()
  .trim()
  .min(1, { message: "Amount is required" })
  .regex(/^\d+(\.\d{1,7})?$/, {
    message: "Amount must be a positive number with up to 7 decimal places",
  })
  .refine((v) => parseFloat(v) > 0, {
    message: "Amount must be greater than zero",
  });

/** Positive integer share count. */
export const ShareCountSchema = z
  .number({ error: "Share count is required" })
  .int("Share count must be a whole number")
  .positive("Share count must be greater than zero")
  .max(1_000_000_000, "Share count exceeds maximum allowed value");

/** Supported asset codes. Extend as new assets are on-boarded. */
export const AssetCodeSchema = z.enum(["XLM", "USDC", "yUSDC", "RWA"] as const, {
  error: "Asset must be one of: XLM, USDC, yUSDC, RWA",
});

/** ISO 8601 date string (YYYY-MM-DD). */
export const IsoDatestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: "Date must be in YYYY-MM-DD format",
  });

// ---------------------------------------------------------------------------
// Deposit request
// ---------------------------------------------------------------------------

/**
 * Payload sent when a user deposits assets into a vault.
 */
export const DepositRequestSchema = z.object({
  walletAddress: StellarAddressSchema,
  amount: AmountSchema,
  asset: AssetCodeSchema,
  /** Optional slippage tolerance in basis points (0–500). */
  slippageBps: z
    .number()
    .int("Slippage must be a whole number of basis points")
    .min(0, "Slippage cannot be negative")
    .max(500, "Slippage tolerance may not exceed 500 bps (5%)")
    .optional(),
  /** Optional referral code for tracking referrals. */
  referralCode: z.string().optional(),
});

export type DepositRequest = z.infer<typeof DepositRequestSchema>;

// ---------------------------------------------------------------------------
// Withdrawal request
// ---------------------------------------------------------------------------

/**
 * Payload sent when a user redeems vault shares for underlying assets.
 */
export const WithdrawalRequestSchema = z.object({
  walletAddress: StellarAddressSchema,
  shares: ShareCountSchema,
  asset: AssetCodeSchema,
  /** Optional destination override; defaults to walletAddress. */
  destinationAddress: StellarAddressSchema.optional(),
  slippageBps: z
    .number()
    .int("Slippage must be a whole number of basis points")
    .min(0, "Slippage cannot be negative")
    .max(500, "Slippage tolerance may not exceed 500 bps (5%)")
    .optional(),
});

export type WithdrawalRequest = z.infer<typeof WithdrawalRequestSchema>;

// ---------------------------------------------------------------------------
// Vault history query parameters
// ---------------------------------------------------------------------------

/**
 * Query-string parameters for the vault performance history endpoint.
 */
export const VaultHistoryQuerySchema = z.object({
  from: IsoDatestamp.optional(),
  to: IsoDatestamp.optional(),
  /** Maximum number of data points to return (1–365). */
  limit: z
    .number()
    .int("Limit must be a whole number")
    .min(1, "Limit must be at least 1")
    .max(365, "Limit may not exceed 365 data points")
    .optional(),
}).refine(
  (q) => {
    if (q.from && q.to) {
      return q.from <= q.to;
    }
    return true;
  },
  { message: "\"from\" date must not be later than \"to\" date", path: ["from"] },
);

export type VaultHistoryQuery = z.infer<typeof VaultHistoryQuerySchema>;

// ---------------------------------------------------------------------------
// Portfolio holdings query parameters
// ---------------------------------------------------------------------------

/**
 * Query-string parameters for the portfolio holdings endpoint.
 */
export const PortfolioQuerySchema = z.object({
  walletAddress: StellarAddressSchema,
  status: z.enum(["active", "pending", "all"]).optional().default("all"),
});

export type PortfolioQuery = z.infer<typeof PortfolioQuerySchema>;

// ---------------------------------------------------------------------------
// Wallet address lookup
// ---------------------------------------------------------------------------

/**
 * Single-param schema used when an endpoint only needs the caller's address.
 */
export const WalletAddressSchema = z.object({
  walletAddress: StellarAddressSchema,
});

export type WalletAddressParam = z.infer<typeof WalletAddressSchema>;

// ---------------------------------------------------------------------------
// Transaction list query parameters
// ---------------------------------------------------------------------------

/**
 * Query-string parameters for the transaction history endpoint.
 */
export const TransactionQuerySchema = z.object({
  walletAddress: StellarAddressSchema,
  /** Maximum number of records to return (1–200). */
  limit: z
    .number()
    .int("Limit must be a whole number")
    .min(1, "Limit must be at least 1")
    .max(200, "Limit may not exceed 200 records")
    .optional()
    .default(50),
  order: z.enum(["asc", "desc"]).optional().default("desc"),
  type: z.enum(["deposit", "withdrawal", "all"]).optional().default("all"),
});

export type TransactionQuery = z.infer<typeof TransactionQuerySchema>;
export type TransactionQueryInput = z.input<typeof TransactionQuerySchema>;
