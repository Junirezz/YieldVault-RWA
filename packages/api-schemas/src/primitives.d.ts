/**
 * Stellar / Soroban public key: G... base-32 address, 56 characters.
 * Validates format only — not an on-chain account existence check.
 */
export declare const StellarAddressSchema: any;
/**
 * Positive decimal amount represented as a string (preserves precision).
 * Allows up to 7 decimal places to match Stellar's stroop precision.
 */
export declare const AmountSchema: any;
/**
 * API boundary amount: accepts canonical string amounts or legacy numeric JSON.
 * Normalizes to a string so frontend and backend share one wire format.
 */
export declare const AmountInputSchema: any;
/** Positive integer share count (UI / portfolio display). */
export declare const ShareCountSchema: any;
/** Supported asset codes. Extend as new assets are on-boarded. */
export declare const AssetCodeSchema: any;
/** ISO 8601 date string (YYYY-MM-DD). */
export declare const IsoDatestamp: any;
/** Optional slippage tolerance in basis points (0–500). */
export declare const SlippageBpsSchema: any;
//# sourceMappingURL=primitives.d.ts.map