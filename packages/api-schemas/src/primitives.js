"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SlippageBpsSchema = exports.IsoDatestamp = exports.AssetCodeSchema = exports.ShareCountSchema = exports.AmountInputSchema = exports.AmountSchema = exports.StellarAddressSchema = void 0;
const zod_1 = require("zod");
/**
 * Stellar / Soroban public key: G... base-32 address, 56 characters.
 * Validates format only — not an on-chain account existence check.
 */
exports.StellarAddressSchema = zod_1.z
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
exports.AmountSchema = zod_1.z
    .string()
    .trim()
    .min(1, { message: "Amount is required" })
    .regex(/^\d+(\.\d{1,7})?$/, {
    message: "Amount must be a positive number with up to 7 decimal places",
})
    .refine((value) => parseFloat(value) > 0, {
    message: "Amount must be greater than zero",
});
/**
 * API boundary amount: accepts canonical string amounts or legacy numeric JSON.
 * Normalizes to a string so frontend and backend share one wire format.
 */
exports.AmountInputSchema = zod_1.z
    .union([
    exports.AmountSchema,
    zod_1.z
        .number({ error: "Amount is required" })
        .positive("Amount must be greater than zero")
        .finite("Amount must be a finite number"),
])
    .transform((value) => (typeof value === "number" ? String(value) : value));
/** Positive integer share count (UI / portfolio display). */
exports.ShareCountSchema = zod_1.z
    .number({ error: "Share count is required" })
    .int("Share count must be a whole number")
    .positive("Share count must be greater than zero")
    .max(1000000000, "Share count exceeds maximum allowed value");
/** Supported asset codes. Extend as new assets are on-boarded. */
exports.AssetCodeSchema = zod_1.z.enum(["XLM", "USDC", "yUSDC", "RWA"], {
    error: "Asset must be one of: XLM, USDC, yUSDC, RWA",
});
/** ISO 8601 date string (YYYY-MM-DD). */
exports.IsoDatestamp = zod_1.z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: "Date must be in YYYY-MM-DD format",
});
/** Optional slippage tolerance in basis points (0–500). */
exports.SlippageBpsSchema = zod_1.z
    .number()
    .int("Slippage must be a whole number of basis points")
    .min(0, "Slippage cannot be negative")
    .max(500, "Slippage tolerance may not exceed 500 bps (5%)")
    .optional();
//# sourceMappingURL=primitives.js.map