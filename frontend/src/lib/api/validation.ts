/**
 * @file validation.ts
 * Request validation layer for the YieldVault API client.
 *
 * Every outbound mutation (deposit, withdrawal) and every incoming query
 * parameter must pass through a Zod schema before the request is dispatched.
 * On failure a `ValidationError` is thrown — consistent with `ApiError` so
 * callers can use the same error-handling path.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Consistent error shape — mirrors ApiError for a uniform handler experience
// ---------------------------------------------------------------------------

export type ValidationErrorCode = "VALIDATION_ERROR";

export interface ValidationErrorDetail {
  /** The dot-path of the offending field (e.g. "amount", "walletAddress"). */
  field: string;
  /** Human-readable description of the constraint that was violated. */
  message: string;
  /** The raw received value advertised by Zod, sanitized for safe logging. */
  received?: string;
}

export interface ValidationErrorShape {
  /** Discriminant — always "VALIDATION_ERROR". */
  code: ValidationErrorCode;
  /** Short developer-facing message. */
  message: string;
  /** User-safe message suitable for display in UI toasts / alerts. */
  userMessage: string;
  /** Per-field detail list. */
  details: ValidationErrorDetail[];
}

export class ValidationError extends Error {
  readonly code: ValidationErrorCode = "VALIDATION_ERROR";
  readonly userMessage: string;
  readonly details: ValidationErrorDetail[];

  constructor(shape: Omit<ValidationErrorShape, "code">) {
    super(shape.message);
    this.name = "ValidationError";
    this.userMessage = shape.userMessage;
    this.details = shape.details;
  }

  /** Serialise to the canonical wire shape. */
  toJSON(): ValidationErrorShape {
    return {
      code: this.code,
      message: this.message,
      userMessage: this.userMessage,
      details: this.details,
    };
  }
}

export function isValidationError(err: unknown): err is ValidationError {
  return err instanceof ValidationError;
}

// ---------------------------------------------------------------------------
// Zod → ValidationError bridge
// Zod v4 uses `error.issues` (array of $ZodIssue), each with .path / .message
// ---------------------------------------------------------------------------

/**
 * Run a Zod schema against an input value.
 * Throws `ValidationError` on failure, returns the parsed (type-safe)
 * output on success.
 *
 * @param schema  - Any Zod schema.
 * @param input   - Raw, unvalidated input from the caller.
 * @param context - Optional label added to the error message (e.g. "DepositRequest").
 */
export function validate<T>(
  schema: z.ZodType<T>,
  input: unknown,
  context?: string,
): T {
  const result = schema.safeParse(input);
  if (result.success) {
    return result.data;
  }

  // Zod v4: result.error is a ZodError with .issues[]
  const issues = result.error.issues;

  const details: ValidationErrorDetail[] = issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : "(root)",
    message: issue.message,
    received: extractReceived(issue),
  }));

  const label = context ? ` [${context}]` : "";
  throw new ValidationError({
    message: `Validation failed${label}: ${issues[0]?.message ?? "invalid input"}`,
    userMessage: buildUserMessage(details),
    details,
  });
}

/**
 * Async variant — returns a Promise, useful in async call chains.
 */
export async function validateAsync<T>(
  schema: z.ZodType<T>,
  input: unknown,
  context?: string,
): Promise<T> {
  return validate(schema, input, context);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildUserMessage(details: ValidationErrorDetail[]): string {
  if (details.length === 1) {
    const d = details[0];
    return `Invalid value for "${d.field}": ${d.message}.`;
  }
  const fieldList = details
    .slice(0, 3)
    .map((d) => d.field)
    .join(", ");
  const extra = details.length > 3 ? ` and ${details.length - 3} more` : "";
  return `Please fix the following fields: ${fieldList}${extra}.`;
}

/**
 * Best-effort extraction of the received value from a Zod v4 issue.
 * Zod v4 places `input` on the issue (not `received`).
 * We only surface scalar types; complex values become their typeof string.
 */
function extractReceived(issue: z.core.$ZodIssue): string | undefined {
  try {
    const raw = (issue as { input?: unknown }).input;
    if (raw === undefined) return undefined;
    if (
      typeof raw === "string" ||
      typeof raw === "number" ||
      typeof raw === "boolean"
    ) {
      return String(raw);
    }
    return typeof raw;
  } catch {
    return undefined;
  }
}
