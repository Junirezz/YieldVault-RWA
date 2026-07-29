import { z } from "zod";
/**
 * POST /api/v1/vault/deposits request body (shared with frontend client).
 * Accepts string or numeric amounts at the JSON boundary and normalizes to string.
 */
export declare const VaultDepositBodySchema: any;
export type VaultDepositBody = z.infer<typeof VaultDepositBodySchema>;
/**
 * POST /api/v1/vault/withdrawals request body (shared with frontend client).
 */
export declare const VaultWithdrawalBodySchema: any;
export type VaultWithdrawalBody = z.infer<typeof VaultWithdrawalBodySchema>;
/** Vault write body when wallet nonce enforcement is strict. */
export declare const SignedVaultDepositBodySchema: any;
export declare const SignedVaultWithdrawalBodySchema: any;
/** @deprecated Use VaultDepositBodySchema or VaultWithdrawalBodySchema */
export declare const VaultOperationSchema: any;
//# sourceMappingURL=vault.d.ts.map