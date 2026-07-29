import { z } from "zod";
/**
 * Payload sent when a user deposits assets into a vault.
 */
export declare const DepositRequestSchema: any;
export type DepositRequest = z.infer<typeof DepositRequestSchema>;
/**
 * Payload sent when a user redeems vault shares for underlying assets.
 */
export declare const WithdrawalRequestSchema: any;
export type WithdrawalRequest = z.infer<typeof WithdrawalRequestSchema>;
/**
 * Query-string parameters for the vault performance history endpoint.
 */
export declare const VaultHistoryQuerySchema: any;
export type VaultHistoryQuery = z.infer<typeof VaultHistoryQuerySchema>;
/**
 * Query-string parameters for the portfolio holdings endpoint.
 */
export declare const PortfolioQuerySchema: any;
export type PortfolioQuery = z.infer<typeof PortfolioQuerySchema>;
/**
 * Single-param schema used when an endpoint only needs the caller's address.
 */
export declare const WalletAddressSchema: any;
export type WalletAddressParam = z.infer<typeof WalletAddressSchema>;
/**
 * Query-string parameters for the transaction history endpoint.
 */
export declare const TransactionQuerySchema: any;
export type TransactionQuery = z.infer<typeof TransactionQuerySchema>;
export type TransactionQueryInput = z.input<typeof TransactionQuerySchema>;
//# sourceMappingURL=requests.d.ts.map