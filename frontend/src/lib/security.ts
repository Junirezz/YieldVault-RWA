/**
 * Security utilities for XSS prevention and input validation
 */

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
 * Sanitizes a transaction hash and constructs a safe Stellar Explorer URL
 */
export function getStellarExplorerUrl(
  transactionHash: string,
  network: 'testnet' | 'mainnet' = 'testnet'
): string {
  if (!isValidTransactionHash(transactionHash)) {
    return '#';
  }
  
  const baseUrl = network === 'mainnet' 
    ? 'https://stellar.expert/explorer/public'
    : 'https://stellar.expert/explorer/testnet';
  
  return `${baseUrl}/tx/${transactionHash}`;
}

/**
 * Escapes HTML special characters for display in plain text contexts
 * Note: This is rarely needed in React since JSX auto-escapes
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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

/**
 * Allowed domains for external links
 */
export const ALLOWED_EXTERNAL_DOMAINS = [
  'stellar.expert',
  'horizon.stellar.org',
  'horizon-testnet.stellar.org',
  'stellar.org',
];

/**
 * Validates and sanitizes an external link
 */
export function sanitizeExternalLink(url: string): string {
  return sanitizeExternalUrl(url, ALLOWED_EXTERNAL_DOMAINS);
}
