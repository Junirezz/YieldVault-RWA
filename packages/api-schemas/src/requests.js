"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionQuerySchema = exports.WalletAddressSchema = exports.PortfolioQuerySchema = exports.VaultHistoryQuerySchema = exports.WithdrawalRequestSchema = exports.DepositRequestSchema = void 0;
const zod_1 = require("zod");
const primitives_1 = require("./primitives");
/**
 * Payload sent when a user deposits assets into a vault.
 */
exports.DepositRequestSchema = zod_1.z.object({
    walletAddress: primitives_1.StellarAddressSchema,
    amount: primitives_1.AmountSchema,
    asset: primitives_1.AssetCodeSchema,
    slippageBps: primitives_1.SlippageBpsSchema,
    referralCode: zod_1.z.string().optional(),
});
/**
 * Payload sent when a user redeems vault shares for underlying assets.
 */
exports.WithdrawalRequestSchema = zod_1.z.object({
    walletAddress: primitives_1.StellarAddressSchema,
    amount: primitives_1.AmountSchema,
    asset: primitives_1.AssetCodeSchema,
    destinationAddress: primitives_1.StellarAddressSchema.optional(),
    slippageBps: primitives_1.SlippageBpsSchema,
});
/**
 * Query-string parameters for the vault performance history endpoint.
 */
exports.VaultHistoryQuerySchema = zod_1.z
    .object({
    from: primitives_1.IsoDatestamp.optional(),
    to: primitives_1.IsoDatestamp.optional(),
    limit: zod_1.z
        .number()
        .int("Limit must be a whole number")
        .min(1, "Limit must be at least 1")
        .max(365, "Limit may not exceed 365 data points")
        .optional(),
})
    .refine((query) => {
    if (query.from && query.to) {
        return query.from <= query.to;
    }
    return true;
}, { message: '"from" date must not be later than "to" date', path: ["from"] });
/**
 * Query-string parameters for the portfolio holdings endpoint.
 */
exports.PortfolioQuerySchema = zod_1.z.object({
    walletAddress: primitives_1.StellarAddressSchema,
    status: zod_1.z.enum(["active", "pending", "all"]).optional().default("all"),
});
/**
 * Single-param schema used when an endpoint only needs the caller's address.
 */
exports.WalletAddressSchema = zod_1.z.object({
    walletAddress: primitives_1.StellarAddressSchema,
});
/**
 * Query-string parameters for the transaction history endpoint.
 */
exports.TransactionQuerySchema = zod_1.z.object({
    walletAddress: primitives_1.StellarAddressSchema,
    limit: zod_1.z
        .number()
        .int("Limit must be a whole number")
        .min(1, "Limit must be at least 1")
        .max(200, "Limit may not exceed 200 records")
        .optional()
        .default(50),
    order: zod_1.z.enum(["asc", "desc"]).optional().default("desc"),
    type: zod_1.z.enum(["deposit", "withdrawal", "all"]).optional().default("all"),
});
//# sourceMappingURL=requests.js.map