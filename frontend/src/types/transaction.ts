/**
 * Security-focused transaction confirmation types.
 * Used for pre-sign risk assessment and user review before wallet signing.
 */

/**
 * Summary of transaction details for explicit user confirmation.
 * Every field is available at sign-initiation time to prevent async delays.
 *
 * Security Properties:
 * - All values are human-readable strings (formatted)
 * - Contract address is full address, never truncated
 * - Unusual values are flagged as booleans for UI highlighting
 * - No values are mutated after creation
 */
export interface TransactionSummary {
  /** Formatted amount with asset symbol (e.g., "100.00 USDC") */
  amount: string;

  /** Asset code and issuer info, or human-readable name if available */
  asset: string;

  /** Network name: "Mainnet", "Testnet", or "Futurenet" */
  network: string;

  /** Formatted network fee in XLM (e.g., "0.000200") */
  estimatedFee: string;

  /** Full contract address being invoked */
  contractAddress: string;

  /** Human-readable contract name from allowlist, or null if unknown */
  contractName: string | null;

  /** Action type: 'deposit' | 'withdraw' | other transaction types */
  actionType: 'deposit' | 'withdraw' | string;

  /** True if amount exceeds UNUSUAL_AMOUNT_THRESHOLD */
  isUnusualAmount: boolean;

  /** True if fee exceeds UNUSUAL_FEE_MULTIPLIER * base fee */
  isUnusualFee: boolean;

  /** True if contractName is null (contract not in allowlist) */
  isUnknownContract: boolean;

  /** True if the withdrawal amount triggers a contract-enforced timelock */
  requiresTimelock: boolean;

  /** The duration of the timelock in hours (e.g., 24) if requiresTimelock is true */
  timelockDurationHours: number | null;
}
