/* eslint-disable no-script-url */
import { describe, test, expect } from 'vitest';
import {
  isValidTransactionHash,
  isValidStellarAddress,
  sanitizeExternalUrl,
  getStellarExplorerUrl,
  escapeHtml,
  isAlphanumericSafe,
  truncateSafe,
  sanitizeExternalLink,
} from './security';

describe('isValidTransactionHash', () => {
  test('accepts valid 64-character hex strings', () => {
    const validHashes = [
      'a'.repeat(64),
      'f'.repeat(64),
      '0123456789abcdef'.repeat(4),
      'ABCDEF0123456789'.repeat(4),
    ];

    validHashes.forEach(hash => {
      expect(isValidTransactionHash(hash)).toBe(true);
    });
  });

  test('rejects invalid transaction hashes', () => {
    const invalidHashes = [
      'short',
      'a'.repeat(63), // too short
      'a'.repeat(65), // too long
      'g'.repeat(64), // invalid hex character
      'javascript:alert(1)',
      '<script>alert(1)</script>',
      '../../etc/passwd',
      '',
    ];

    invalidHashes.forEach(hash => {
      expect(isValidTransactionHash(hash)).toBe(false);
    });
  });
});

describe('isValidStellarAddress', () => {
  test('accepts valid Stellar addresses', () => {
    const validAddresses = [
      'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
      'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    ];

    validAddresses.forEach(address => {
      expect(isValidStellarAddress(address)).toBe(true);
    });
  });

  test('rejects invalid Stellar addresses', () => {
    const invalidAddresses = [
      'ABRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H', // wrong prefix
      'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2', // too short
      'javascript:alert(1)',
      '<script>alert(1)</script>',
      '',
    ];

    invalidAddresses.forEach(address => {
      expect(isValidStellarAddress(address)).toBe(false);
    });
  });
});

describe('sanitizeExternalUrl', () => {
  const allowedDomains = ['example.com', 'trusted.org'];

  test('allows URLs from allowed domains', () => {
    expect(sanitizeExternalUrl('https://example.com/path', allowedDomains))
      .toBe('https://example.com/path');
    expect(sanitizeExternalUrl('http://trusted.org', allowedDomains))
      .toBe('http://trusted.org/');
  });

  test('blocks URLs from disallowed domains', () => {
    expect(sanitizeExternalUrl('https://evil.com', allowedDomains))
      .toBe('#');
    expect(sanitizeExternalUrl('https://malicious.net', allowedDomains))
      .toBe('#');
  });

  test('blocks dangerous protocols', () => {
    const dangerousUrls = [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ];

    dangerousUrls.forEach(url => {
      expect(sanitizeExternalUrl(url, allowedDomains)).toBe('#');
    });
  });

  test('handles malformed URLs', () => {
    const malformedUrls = [
      'not a url',
      '://invalid',
      'http://',
      '',
    ];

    malformedUrls.forEach(url => {
      expect(sanitizeExternalUrl(url, allowedDomains)).toBe('#');
    });
  });
});

describe('getStellarExplorerUrl', () => {
  const validHash = 'a'.repeat(64);

  test('generates valid testnet URLs', () => {
    const url = getStellarExplorerUrl(validHash, 'testnet');
    expect(url).toBe(`https://stellar.expert/explorer/testnet/tx/${validHash}`);
  });

  test('generates valid mainnet URLs', () => {
    const url = getStellarExplorerUrl(validHash, 'mainnet');
    expect(url).toBe(`https://stellar.expert/explorer/public/tx/${validHash}`);
  });

  test('returns # for invalid transaction hashes', () => {
    const invalidHashes = [
      'short',
      'javascript:alert(1)',
      '<script>alert(1)</script>',
      '',
    ];

    invalidHashes.forEach(hash => {
      expect(getStellarExplorerUrl(hash)).toBe('#');
    });
  });
});

describe('escapeHtml', () => {
  test('escapes HTML special characters', () => {
    expect(escapeHtml('<script>alert(1)</script>'))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(escapeHtml('<img src=x onerror=alert(1)>'))
      .toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(escapeHtml('Test & "quotes"'))
      .toBe('Test &amp; "quotes"');
  });

  test('preserves safe text', () => {
    expect(escapeHtml('Hello, World!')).toBe('Hello, World!');
    expect(escapeHtml('123 ABC xyz')).toBe('123 ABC xyz');
  });

  test('handles empty strings', () => {
    expect(escapeHtml('')).toBe('');
  });
});

describe('isAlphanumericSafe', () => {
  test('accepts safe alphanumeric strings', () => {
    const safeStrings = [
      'USDC',
      'Bitcoin-BTC',
      'Asset_123',
      'Test Token',
      'ABC.DEF',
    ];

    safeStrings.forEach(str => {
      expect(isAlphanumericSafe(str)).toBe(true);
    });
  });

  test('rejects strings with special characters', () => {
    const unsafeStrings = [
      '<script>',
      'test@example.com',
      'hello<world',
      'test&test',
      'a=b',
    ];

    unsafeStrings.forEach(str => {
      expect(isAlphanumericSafe(str)).toBe(false);
    });
  });
});

describe('truncateSafe', () => {
  test('truncates long strings', () => {
    expect(truncateSafe('Hello, World!', 5)).toBe('Hello...');
    expect(truncateSafe('A'.repeat(100), 10)).toBe('A'.repeat(10) + '...');
  });

  test('preserves short strings', () => {
    expect(truncateSafe('Short', 10)).toBe('Short');
    expect(truncateSafe('Test', 4)).toBe('Test');
  });

  test('handles edge cases', () => {
    expect(truncateSafe('', 5)).toBe('');
    expect(truncateSafe('A', 0)).toBe('...');
  });
});

describe('sanitizeExternalLink', () => {
  test('allows Stellar-related domains', () => {
    const stellarUrls = [
      'https://stellar.expert/explorer/testnet/tx/abc',
      'https://horizon.stellar.org/accounts/G123',
      'https://horizon-testnet.stellar.org/operations',
      'https://stellar.org/about',
    ];

    stellarUrls.forEach(url => {
      expect(sanitizeExternalLink(url)).not.toBe('#');
    });
  });

  test('blocks non-Stellar domains', () => {
    const externalUrls = [
      'https://evil.com',
      'https://phishing-site.net',
      'http://malicious.org',
    ];

    externalUrls.forEach(url => {
      expect(sanitizeExternalLink(url)).toBe('#');
    });
  });
});

describe('XSS Attack Vectors', () => {
  const XSS_PAYLOADS = [
    '<script>alert("XSS")</script>',
    '<img src=x onerror=alert("XSS")>',
    '<svg onload=alert("XSS")>',
    'javascript:alert("XSS")',
    '<iframe src="javascript:alert(\'XSS\')">',
    '<body onload=alert("XSS")>',
    '"><script>alert(String.fromCharCode(88,83,83))</script>',
    '<img src="x" onerror="eval(atob(\'YWxlcnQoJ1hTUycpOw==\'))">',
    '<svg><script>alert(1)</script></svg>',
    '<input onfocus=alert(1) autofocus>',
    '<details open ontoggle=alert(1)>',
  ];

  test('escapeHtml neutralizes all XSS payloads', () => {
    XSS_PAYLOADS.forEach(payload => {
      const escaped = escapeHtml(payload);
      expect(escaped).not.toContain('<script');
      if (payload.includes('<')) {
        expect(escaped).toContain('&lt;');
      }
    });
  });

  test('transaction hash validation rejects XSS attempts', () => {
    XSS_PAYLOADS.forEach(payload => {
      expect(isValidTransactionHash(payload)).toBe(false);
    });
  });

  test('address validation rejects XSS attempts', () => {
    XSS_PAYLOADS.forEach(payload => {
      expect(isValidStellarAddress(payload)).toBe(false);
    });
  });

  test('URL sanitization blocks XSS attempts', () => {
    XSS_PAYLOADS.forEach(payload => {
      expect(sanitizeExternalLink(payload)).toBe('#');
    });
  });
});
