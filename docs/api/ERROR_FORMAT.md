# API Error Format

This document defines the **canonical error shapes** returned by the YieldVault
API client layer. All errors — whether from the network, an HTTP status, or
client-side request validation — conform to one of the two shapes below.

---

## 1. `ApiError` — Network & HTTP errors

Thrown by the `ApiClient` for any transport-level or HTTP-level failure.

### Shape

```ts
interface ApiErrorShape {
  code: ApiErrorCode;       // Machine-readable discriminant
  message: string;          // Developer-facing explanation
  userMessage: string;      // Safe to display in the UI
  retryable: boolean;       // Whether an automatic retry is appropriate
  status?: number;          // HTTP status code (if applicable)
  statusText?: string;      // HTTP status text
  url?: string;             // The URL that was requested
  method?: string;          // HTTP method (GET, POST, …)
  traceId?: string;         // x-trace-id header echoed from server
  correlationId?: string;   // X-Correlation-ID for distributed tracing
  details?: unknown;        // Raw response body (if parseable)
}
```

### Error Codes

| `code`             | When raised                                             | `retryable` |
|--------------------|---------------------------------------------------------|-------------|
| `NETWORK_ERROR`    | `fetch()` throws a `TypeError` (no connectivity, DNS)  | `true`      |
| `TIMEOUT`          | Request exceeds the configured timeout                  | `true`      |
| `ABORTED`          | Caller aborted the request via `AbortController`        | `false`     |
| `HTTP_ERROR`       | Server returned a non-2xx status code                   | see below   |
| `INVALID_RESPONSE` | Response body could not be parsed (malformed JSON)      | `false`     |
| `UNKNOWN_ERROR`    | Any other unclassified error                            | `false`     |

> **Retryable HTTP statuses:** `408`, `425`, `429`, `500`, `502`, `503`, `504`

### Example

```json
{
  "code": "HTTP_ERROR",
  "message": "Request failed with status 422.",
  "userMessage": "We could not complete that request. Please review your input and try again.",
  "retryable": false,
  "status": 422,
  "statusText": "Unprocessable Entity",
  "url": "https://api.yieldvault.io/v1/deposit",
  "method": "POST",
  "traceId": "abc123",
  "correlationId": "a87ff679-a2f3-461d-a2bf-3af783c070a3",
  "details": { "error": "Insufficient balance" }
}
```

---

## 2. `ValidationError` — Client-side request validation

Thrown by `validate()` / `validateAsync()` **before** any network call is made,
when the caller supplies an invalid request payload or query parameter bag.

### Shape

```ts
interface ValidationErrorShape {
  code: "VALIDATION_ERROR";    // Always this literal
  message: string;             // Developer-facing summary
  userMessage: string;         // Safe to show in UI
  details: ValidationErrorDetail[];
}

interface ValidationErrorDetail {
  field: string;       // Dot-path to the offending field (e.g. "amount")
  message: string;     // Constraint violation description
  received?: string;   // Sanitized received value (scalar only)
}
```

### Example

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Validation failed [DepositRequest]: Amount must be greater than zero",
  "userMessage": "Invalid value for \"amount\": Amount must be greater than zero.",
  "details": [
    {
      "field": "amount",
      "message": "Amount must be greater than zero",
      "received": "0"
    }
  ]
}
```

---

## 3. Unified error handling pattern

Both error classes are exported from `src/lib/api` and can be narrowed with
the provided type guards:

```ts
import {
  isApiError,
  isValidationError,
  validate,
  DepositRequestSchema,
} from "@/lib/api";

async function submitDeposit(raw: unknown) {
  // 1. Validate before sending — throws ValidationError on bad input
  const payload = validate(DepositRequestSchema, raw, "DepositRequest");

  try {
    // 2. Call the API — throws ApiError on network / HTTP failure
    return await depositApi.post("/v1/deposit", { body: payload });
  } catch (err) {
    if (isValidationError(err)) {
      // Show err.userMessage in a form field
      console.error("Validation:", err.toJSON());
    } else if (isApiError(err)) {
      // Show err.userMessage in a toast / banner
      console.error("API:", err.code, err.status, err.correlationId);
    }
    throw err;
  }
}
```

---

## 4. Validated request schemas

| Schema                  | Covers                                              |
|-------------------------|-----------------------------------------------------|
| `DepositRequestSchema`  | Vault deposit: address, amount, asset, slippage     |
| `WithdrawalRequestSchema` | Vault withdrawal: address, shares, asset, dest    |
| `VaultHistoryQuerySchema` | History date range and item limit                 |
| `PortfolioQuerySchema`  | Holdings fetch with wallet address + status filter  |
| `TransactionQuerySchema`| Transaction history with limit, order, type filter  |
| `WalletAddressSchema`   | Simple wallet-address-only param bags               |

All schemas are exported from `src/lib/api` and built on the shared primitives
`StellarAddressSchema` and `AmountSchema`.

---

## 5. Sensitive field policy

- **Wallet addresses** are logged as-is (public keys, not secrets).
- **Amounts** are logged as-is (non-sensitive numeric values).
- **Private keys / mnemonics** must never appear in request payloads and are
  not modelled in any schema.
- The `received` field on `ValidationErrorDetail` is never populated for object
  or array values — only scalars — to prevent inadvertent secret leakage.
