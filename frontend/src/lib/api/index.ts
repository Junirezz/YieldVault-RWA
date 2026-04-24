export {
  ApiError,
  isApiError,
  isRetryableStatus,
  normalizeApiError,
  type ApiErrorCode,
  type ApiErrorMetadata,
} from "./error";
export {
  ApiClient,
  createApiClient,
  type ApiRequestContext,
  type ApiRequestOptions,
  type ApiResponseContext,
  type RetryOptions,
} from "./client";
export {
  emitApiTelemetry,
  subscribeToApiTelemetry,
  type ApiTelemetryEvent,
} from "./telemetry";
export { useApiTelemetry } from "./useApiTelemetry";
export {
  ValidationError,
  isValidationError,
  validate,
  validateAsync,
  type ValidationErrorCode,
  type ValidationErrorDetail,
  type ValidationErrorShape,
} from "./validation";
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
  type DepositRequest,
  type WithdrawalRequest,
  type VaultHistoryQuery,
  type PortfolioQuery,
  type WalletAddressParam,
  type TransactionQuery,
  type TransactionQueryInput,
} from "./schemas";
