/**
 * Server error response mapper for vault operations.
 * 
 * Maps API error responses from the backend to form field errors.
 * Handles field-level validation errors and general errors.
 * 
 * Server error response format:
 * {
 *   code: string;
 *   message: string;
 *   details?: {
 *     field?: string;
 *     [key: string]: unknown;
 *   };
 * }
 */

export interface ServerErrorResponse {
  code?: string;
  message: string;
  details?: ServerErrorDetail | ServerErrorDetail[];
}

interface ServerErrorDetail {
  field?: string;
  message?: string;
  [key: string]: unknown;
}

export interface MappedFieldError {
  fieldName: string;
  message: string;
}

export interface MappedServerError {
  fieldErrors: MappedFieldError[];
  generalError: string | null;
}

export type TransactionErrorKind =
  | "walletRejected"
  | "walletPermission"
  | "network"
  | "insufficientFunds"
  | "contractState"
  | "validation"
  | "unknown";

export interface MappedTransactionError {
  kind: TransactionErrorKind;
  retryable: boolean;
  technicalCode?: string;
  supportReference?: string;
}

/** Classify wallet/RPC/contract failures without exposing raw provider text. */
export function mapTransactionError(error: unknown): MappedTransactionError {
  const apiError = error && typeof error === "object"
    ? error as { code?: string; serverCode?: string; serverError?: string; message?: string; retryable?: boolean; correlationId?: string; traceId?: string }
    : undefined;
  const raw = [apiError?.serverCode, apiError?.serverError, apiError?.message]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const technicalCode = apiError?.serverCode || apiError?.code;
  const supportReference = apiError?.correlationId || apiError?.traceId;
  const result = (kind: TransactionErrorKind, retryable: boolean): MappedTransactionError => ({
    kind,
    retryable,
    technicalCode,
    supportReference,
  });

  if (/reject|denied|cancel|declin/.test(raw)) return result("walletRejected", true);
  if (/permission|unauthori[sz]|not allowed|wallet.*(locked|disconnected)/.test(raw)) {
    return result("walletPermission", true);
  }
  if (/insufficient|not enough|balance|funds|liquidity/.test(raw)) {
    return result("insufficientFunds", false);
  }
  if (/network|timeout|rpc|service unavailable|fetch failed|gateway/.test(raw)) {
    return result("network", true);
  }
  if (/validation|invalid input|invalid amount/.test(raw)) {
    return result("validation", false);
  }
  if (/validation|invalid|paused|cap|timelock|cooldown|simulation|contract|restore/.test(raw)) {
    return result("contractState", false);
  }
  if (apiError?.code === "AUTH_ERROR" || apiError?.code === "ABORTED") {
    return result("walletPermission", false);
  }
  if (apiError?.retryable === true) return result("network", true);
  return result("unknown", false);
}

/**
 * Map a server error response to form field errors.
 * 
 * @param error - The error from the server API
 * @returns Object containing mapped field errors and general error message
 * 
 * @example
 * const error = {
 *   code: 'VALIDATION_ERROR',
 *   message: 'Validation failed',
 *   details: { field: 'amount', message: 'Amount exceeds vault cap' }
 * };
 * const mapped = mapServerError(error);
 * // mapped.fieldErrors[0] = { fieldName: 'amount', message: 'Amount exceeds vault cap' }
 */
export function mapServerError(
  error: unknown,
): MappedServerError {
  const fieldErrors: MappedFieldError[] = [];
  let generalError: string | null = null;

  // Handle ServerErrorResponse
  if (error && typeof error === "object") {
    const err = error as ServerErrorResponse;

    const details = Array.isArray(err.details)
      ? err.details
      : err.details
        ? [err.details]
        : [];

    // Validation responses may contain several field-level failures.
    for (const detail of details) {
      if (typeof detail.field !== "string" || !detail.field) {
        continue;
      }
      const fieldMessage =
        typeof detail.message === "string" ? detail.message : err.message;
      fieldErrors.push({
        fieldName: detail.field,
        message: sanitizeErrorMessage(fieldMessage),
      });
    }

    if (fieldErrors.length === 0 && err.message) {
      // General error message
      generalError = sanitizeErrorMessage(err.message);
    } else if (err.message) {
      generalError = null;
    }

    if (fieldErrors.length === 0 && !generalError) {
      generalError = "An error occurred. Please try again.";
    }

    return { fieldErrors, generalError };
  }

  // Handle plain Error objects
  if (error instanceof Error) {
    generalError = sanitizeErrorMessage(error.message);
    return { fieldErrors, generalError };
  }

  // Fallback for unknown error types
  generalError = "An error occurred. Please try again.";
  return { fieldErrors, generalError };
}

/**
 * Sanitize error messages to prevent exposing sensitive information.
 * Removes stack traces, internal field names, and database constraint names.
 * 
 * @param message - The raw error message from the server
 * @returns Sanitized user-friendly error message
 */
function sanitizeErrorMessage(message: string): string {
  if (!message || typeof message !== "string") {
    return "An error occurred. Please try again.";
  }

  // Remove stack traces (lines containing "at " or file paths)
  let sanitized = message.replace(/\s+at\s+.*$/gm, "");

  // Remove database constraint information
  sanitized = sanitized.replace(
    /(?:constraint|unique|foreign key|check constraint).*?(?:\n|$)/gi,
    "",
  );

  // Remove internal field reference patterns (e.g., "db.users.email")
  sanitized = sanitized.replace(/\b[a-z_]+\.[a-z_]+\.[a-z_]+\b/gi, "");

  // Trim and limit length
  sanitized = sanitized.trim();
  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 197) + "...";
  }

  return sanitized || "An error occurred. Please try again.";
}
