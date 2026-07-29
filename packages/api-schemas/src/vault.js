"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VaultOperationSchema = exports.SignedVaultWithdrawalBodySchema = exports.SignedVaultDepositBodySchema = exports.VaultWithdrawalBodySchema = exports.VaultDepositBodySchema = void 0;
const zod_1 = require("zod");
const primitives_1 = require("./primitives");
const requests_1 = require("./requests");
const signedActionFields = {
    nonce: zod_1.z.string().min(16).max(128),
    signature: zod_1.z.string().min(32).max(512),
};
const vaultOperationExtras = {
    email: zod_1.z.string().email().optional(),
    referralCode: zod_1.z.string().max(64).optional(),
    nonce: signedActionFields.nonce.optional(),
    signature: signedActionFields.signature.optional(),
};
/**
 * POST /api/v1/vault/deposits request body (shared with frontend client).
 * Accepts string or numeric amounts at the JSON boundary and normalizes to string.
 */
exports.VaultDepositBodySchema = requests_1.DepositRequestSchema.extend({
    amount: primitives_1.AmountInputSchema,
    ...vaultOperationExtras,
}).strict();
/**
 * POST /api/v1/vault/withdrawals request body (shared with frontend client).
 */
exports.VaultWithdrawalBodySchema = requests_1.WithdrawalRequestSchema.extend({
    amount: primitives_1.AmountInputSchema,
    ...vaultOperationExtras,
}).strict();
/** Vault write body when wallet nonce enforcement is strict. */
exports.SignedVaultDepositBodySchema = requests_1.DepositRequestSchema.extend({
    amount: primitives_1.AmountInputSchema,
    email: zod_1.z.string().email().optional(),
    referralCode: zod_1.z.string().max(64).optional(),
    ...signedActionFields,
}).strict();
exports.SignedVaultWithdrawalBodySchema = requests_1.WithdrawalRequestSchema.extend({
    amount: primitives_1.AmountInputSchema,
    email: zod_1.z.string().email().optional(),
    referralCode: zod_1.z.string().max(64).optional(),
    ...signedActionFields,
}).strict();
/** @deprecated Use VaultDepositBodySchema or VaultWithdrawalBodySchema */
exports.VaultOperationSchema = exports.VaultDepositBodySchema;
//# sourceMappingURL=vault.js.map