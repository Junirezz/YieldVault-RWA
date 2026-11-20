/**
 * Transaction confirmation security thresholds.
 * These values determine when the confirmation modal highlights unusual values.
 *
 * Maintainers: Review and adjust these thresholds based on typical transaction
 * patterns and risk tolerance. All thresholds must be confirmed and documented.
 */

/**
 * Amount threshold above which a transaction is flagged as "unusual" in XLM equivalent.
 *
 * Derivation: Conservative estimate based on typical user transaction sizes.
 * - Vault minimum deposit: typically 1-100 USDC
 * - Whale deposit: 10,000+ USDC becomes suspicious without explicit confirmation
 *
 * Update: Modify based on median transaction size growth or risk appetite.
 * Monitor via transaction analytics dashboard (planned feature).
 */
export const UNUSUAL_AMOUNT_THRESHOLD = 10000; // 10,000 XLM or USDC equivalent

/**
 * Threshold for large withdrawals that trigger a 24-hour timelock.
 *
 * This must match the `LargeWithdrawalThreshold` configured in the vault
 * contract. Withdrawals above this amount are not processed immediately.
 */
export const LARGE_WITHDRAWAL_THRESHOLD = 10000;

/**
 * The duration of the withdrawal timelock in hours.
 *
 * Current contract implementation uses a fixed 86,400 second (24 hour) delay.
 */
export const WITHDRAWAL_TIMELOCK_DURATION_HOURS = 24;

/**
 * Fee multiplier above which a transaction fee is flagged as "unusual".
 *
 * Derivation: Stellar base fee is 100 stroops (0.00001 XLM).
 * Typical transaction fee: 1 base fee = 0.00001 XLM.
 * Unusual threshold: 100x base fee = 5 base fees (above typical range).
 *
 * Why 5x: Protects against fee spike attacks and misconfigured fee estimates.
 * Networks may spike fees during congestion; 5x allows room for spikes
 * without being false-positive prone.
 *
 * Update: Monitor Stellar network fee patterns and adjust if baseline changes.
 */
export const UNUSUAL_FEE_MULTIPLIER = 5;

/**
 * Known contract addresses allowed for transactions.
 * Contract addresses not in this list trigger "unknown contract" warning.
 *
 * This is a security allowlist that grows as new strategies are deployed.
 * Every new contract must be added here and released in a controlled PR.
 *
 * Format: { address: "CXXXX...", name: "Human Readable Name" }
 */
export const TRUSTED_CONTRACT_ADDRESSES: Record<string, string> = {
  // Vault contract - must be set from environment variable
  // Add deployed contracts here as new strategies launch
};

/**
 * Stellar base fee in stroops (1 XLM = 10,000,000 stroops).
 * Used to calculate UNUSUAL_FEE_MULTIPLIER threshold.
 *
 * Reference: https://developers.stellar.org/docs/learn/fundamentals/fees-and-limits
 */
export const STELLAR_BASE_FEE_STROOPS = 100; // 1 base fee in stroops

/**
 * Stellar base fee in XLM for human-readable fee comparisons.
 */
export const STELLAR_BASE_FEE_XLM = 0.00001;
