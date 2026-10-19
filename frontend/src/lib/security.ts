/**
 * Security utilities for XSS prevention and input validation
 */
import { networkConfig, stellarExplorerBaseUrls } from "../config/network";

/**
 * Validates Stellar transaction hash format
 * Transaction hashes are 64-character hexadecimal strings
 */
export function isValidTransactionHash(hash: string): boolean {
  const TRANSACTION_HASH_REGEX = /^[a-f0-9]{64}$/i;
  return TRANSACTION_HASH_REGEX.test(hash);
}

/**
 * Validates Stellar address format
 * Addresses are 56-character strings starting with 'G'
 */
export function isValidStellarAddress(address: string): boolean {
  const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;
  return STELLAR_ADDRESS_REGEX.test(address);
}

/**
 * Sanitizes external URLs to prevent open redirect and XSS
 * Only allows URLs from specified domains
 */
export function sanitizeExternalUrl(
  url: string,
  allowedDomains: string[]
): string {
  try {
    const parsed = new URL(url);
    
    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return '#';
    }
    
    // Check if domain is in allowlist
    if (!allowedDomains.includes(parsed.hostname)) {
      return '#';
    }
    
    return parsed.toString();
  } catch {
    // Invalid URL
    return '#';
  }
}

/**
 * Sanitizes a transaction hash and constructs a safe Stellar Explorer URL.
 * Explorer base URLs come from the network config so a self-hosted explorer
 * only needs a single `VITE_STELLAR_EXPLORER_URL` override.
 */
export function getStellarExplorerUrl(
  transactionHash: string,
  network: 'testnet' | 'mainnet' = 'testnet'
): string {
  if (!isValidTransactionHash(transactionHash)) {
    return '#';
  }

  return `${stellarExplorerBaseUrls[network]}/tx/${transactionHash}`;
}

/**
 * Escapes HTML special characters for display in plain text contexts
 * Note: This is rarely needed in React since JSX auto-escapes
 */
export function escapeHtml(text: string): string {
  // Simple HTML escaping without relying on DOM APIs.
  // Replaces &, <, >, ", and ' with their HTML entity equivalents.
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Validates that a string contains only alphanumeric characters and common symbols
 * Useful for validating asset codes, symbols, etc.
 */
export function isAlphanumericSafe(text: string): boolean {
  const SAFE_ALPHANUMERIC_REGEX = /^[a-zA-Z0-9\s\-_.]+$/;
  return SAFE_ALPHANUMERIC_REGEX.test(text);
}

/**
 * Truncates a string safely without breaking HTML entities
 */
export function truncateSafe(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength) + '...';
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Allowed domains for external links. The configured Horizon and explorer hosts
 * are included so overriding them through `VITE_` variables does not silently
 * break outbound links (both defaults are already listed).
 */
export const ALLOWED_EXTERNAL_DOMAINS: string[] = [
  ...new Set(
    [
      'stellar.expert',
      'horizon.stellar.org',
      'horizon-testnet.stellar.org',
      'stellar.org',
      hostnameOf(networkConfig.explorerUrl),
      hostnameOf(networkConfig.horizonUrl),
    ].filter((domain): domain is string => domain !== null),
  ),
];

/**
 * Validates and sanitizes an external link
 */
export function sanitizeExternalLink(url: string): string {
  return sanitizeExternalUrl(url, ALLOWED_EXTERNAL_DOMAINS);
}
