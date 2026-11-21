/**
 * @file schemas.ts
 * Re-exports shared API schemas from @yieldvault/api-schemas.
 *
 * Import the schema you need and pass it to `validate()` from ./validation
 * before calling any API function.
 *
 * Naming convention: <Entity><Action>Schema  (e.g. DepositRequestSchema)
 */

export {
  StellarAddressSchema,
  AmountSchema,
  ShareCountSchema,
  AssetCodeSchema,
  IsoDatestamp,
  DepositRequestSchema,
  WithdrawalRequestSchema,
  VaultHistoryQuerySchema,
  PortfolioQuerySchema,
  WalletAddressSchema,
  TransactionQuerySchema,
  PUBLIC_FEATURE_FLAG_KEYS,
  PublicConfigSchema,
  type DepositRequest,
  type WithdrawalRequest,
  type VaultHistoryQuery,
  type PortfolioQuery,
  type WalletAddressParam,
  type TransactionQuery,
  type TransactionQueryInput,
  type PublicFeatureFlagKey,
  type PublicConfig,
} from "@yieldvault/api-schemas";
