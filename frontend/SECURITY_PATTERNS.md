# Security Patterns for Safe Rendering

This document outlines security best practices for the frontend application to prevent XSS and other injection attacks.

## Core Principles

### 1. Trust React's Automatic Escaping

React automatically escapes all values rendered in JSX:

```tsx
// ✅ SAFE - React escapes the value
const userInput = '<script>alert(1)</script>';
<div>{userInput}</div>
// Renders: &lt;script&gt;alert(1)&lt;/script&gt;

// ✅ SAFE - Attributes are also escaped
<div title={userInput}>Content</div>
```

### 2. Never Use Dangerous APIs

```tsx
// ❌ NEVER DO THIS
<div dangerouslySetInnerHTML={{ __html: userInput }} />

// ❌ NEVER DO THIS
element.innerHTML = userInput;

// ❌ NEVER DO THIS
eval(userInput);
new Function(userInput)();
```

### 3. Validate External Data

Always validate data from external sources:

```typescript
import { isValidTransactionHash, isValidStellarAddress } from './lib/security';

// ✅ SAFE - Validate before using
if (isValidTransactionHash(hash)) {
  const url = getStellarExplorerUrl(hash);
}

// ✅ SAFE - Validate addresses
if (isValidStellarAddress(address)) {
  // Use address
}
```

### 4. Sanitize External URLs

```typescript
import { sanitizeExternalLink } from './lib/security';

// ✅ SAFE - Sanitize before using
const safeUrl = sanitizeExternalLink(userProvidedUrl);
<a href={safeUrl} target="_blank" rel="noopener noreferrer">Link</a>
```

## Common Patterns

### Rendering API Data

```tsx
// ✅ SAFE - TypeScript interfaces + React escaping
interface Transaction {
  id: string;
  amount: string;
  asset: string;
}

function TransactionRow({ tx }: { tx: Transaction }) {
  return (
    <tr>
      <td>{tx.id}</td>
      <td>{tx.amount}</td>
      <td>{tx.asset}</td>
    </tr>
  );
}
```

### Rendering User Input

```tsx
// ✅ SAFE - Controlled inputs
function AmountInput() {
  const [amount, setAmount] = useState('');
  
  return (
    <input
      value={amount}
      onChange={(e) => setAmount(e.target.value)}
    />
  );
}
```

### Building URLs

```tsx
import { getStellarExplorerUrl } from './lib/security';

// ✅ SAFE - Use security utilities
function TransactionLink({ hash }: { hash: string }) {
  const url = getStellarExplorerUrl(hash, 'testnet');
  
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      View Transaction
    </a>
  );
}

// ❌ UNSAFE - Direct concatenation without validation
function UnsafeLink({ hash }: { hash: string }) {
  return <a href={`https://example.com/tx/${hash}`}>Link</a>;
}
```

### Displaying Error Messages

```tsx
// ✅ SAFE - Error objects are typed
function ErrorDisplay({ error }: { error: Error }) {
  return (
    <div className="error">
      <p>{error.message}</p>
    </div>
  );
}
```

### Rendering Lists

```tsx
// ✅ SAFE - Array.map with React escaping
function AssetList({ assets }: { assets: string[] }) {
  return (
    <ul>
      {assets.map((asset, i) => (
        <li key={i}>{asset}</li>
      ))}
    </ul>
  );
}
```

## Anti-Patterns to Avoid

### ❌ String Concatenation for HTML

```tsx
// ❌ NEVER DO THIS
const html = '<div>' + userInput + '</div>';
element.innerHTML = html;

// ✅ DO THIS INSTEAD
<div>{userInput}</div>
```

### ❌ Unvalidated External URLs

```tsx
// ❌ UNSAFE
<a href={userProvidedUrl}>Link</a>

// ✅ SAFE
import { sanitizeExternalLink } from './lib/security';
<a href={sanitizeExternalLink(userProvidedUrl)}>Link</a>
```

### ❌ Dynamic Event Handlers from Strings

```tsx
// ❌ NEVER DO THIS
<button onClick={eval(userInput)}>Click</button>

// ✅ DO THIS INSTEAD
<button onClick={() => handleClick()}>Click</button>
```

### ❌ Unvalidated Data in Template Literals

```tsx
// ❌ POTENTIALLY UNSAFE
const url = `https://api.example.com/${userInput}`;

// ✅ SAFE - Validate first
import { isAlphanumericSafe } from './lib/security';
if (isAlphanumericSafe(userInput)) {
  const url = `https://api.example.com/${userInput}`;
}
```

## Security Utilities

### Available Functions

```typescript
// Transaction hash validation
isValidTransactionHash(hash: string): boolean

// Stellar address validation
isValidStellarAddress(address: string): boolean

// URL sanitization
sanitizeExternalUrl(url: string, allowedDomains: string[]): string
sanitizeExternalLink(url: string): string

// Safe URL construction
getStellarExplorerUrl(hash: string, network: 'testnet' | 'mainnet'): string

// HTML escaping (rarely needed in React)
escapeHtml(text: string): string

// Alphanumeric validation
isAlphanumericSafe(text: string): boolean

// Safe truncation
truncateSafe(text: string, maxLength: number): string
```

### Usage Examples

```typescript
import {
  isValidTransactionHash,
  getStellarExplorerUrl,
  sanitizeExternalLink,
} from './lib/security';

// Validate transaction hash
if (isValidTransactionHash(hash)) {
  const url = getStellarExplorerUrl(hash, 'testnet');
  window.open(url, '_blank');
}

// Sanitize external link
const safeUrl = sanitizeExternalLink(userUrl);
if (safeUrl !== '#') {
  // URL is safe to use
}
```

## Testing

### Run XSS Prevention Tests

```bash
npm test -- xss-prevention
```

### Run Security Utility Tests

```bash
npm test -- security.test
```

### Test Coverage

The test suite includes:
- 17+ common XSS attack vectors
- React component rendering tests
- Form input validation tests
- URL sanitization tests
- Integration tests

## ESLint Security Rules

The following ESLint rules are enforced:

```javascript
{
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-script-url': 'error',
}
```

## Content Security Policy

When deploying, add these CSP headers:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  connect-src 'self' https://horizon-testnet.stellar.org https://horizon.stellar.org;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
```

## Checklist for New Features

When adding new features, verify:

- [ ] No use of `dangerouslySetInnerHTML`
- [ ] No use of `innerHTML`, `outerHTML`, or `insertAdjacentHTML`
- [ ] No use of `eval()`, `Function()`, or `setTimeout(string)`
- [ ] External URLs are validated with `sanitizeExternalLink()`
- [ ] Transaction hashes are validated with `isValidTransactionHash()`
- [ ] User input is rendered through React JSX (automatic escaping)
- [ ] External links have `rel="noopener noreferrer"`
- [ ] Tests cover malicious input scenarios

## Resources

- [OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [React Security Best Practices](https://react.dev/learn/writing-markup-with-jsx)
- [Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [Stellar Security Guidelines](https://developers.stellar.org/docs/building-apps/security)

## Questions?

If you're unsure whether a pattern is safe, ask yourself:

1. Does this use any dangerous APIs? (`dangerouslySetInnerHTML`, `eval`, `innerHTML`)
2. Is external data validated before use?
3. Are URLs sanitized before rendering?
4. Is React's automatic escaping being bypassed?

If the answer to any of these is "yes" or "maybe", review this document or consult the security utilities.
