/**
 * Request schema validation middleware using Zod.
 *
 * Usage:
 *   router.post('/deposits', validate({ body: VaultDepositBodySchema }), handler)
 *
 * Validates req.body, req.query, and/or req.params against the provided schemas.
 * Strips unknown fields from req.body when a body schema is provided (strict mode).
 * Returns a uniform 400 response on failure.
 */

import { z, ZodError, type ZodIssue, type ZodTypeAny } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { isValidStellarAddress } from '../sanitization';

// Re-export shared vault schemas for route handlers and tests
export {
  VaultDepositBodySchema,
  VaultWithdrawalBodySchema,
  SignedVaultDepositBodySchema,
  SignedVaultWithdrawalBodySchema,
  VaultOperationSchema,
  VaultOperationResponseSchema,
} from '@yieldvault/api-schemas';

const signedActionFields = {
  nonce: z.string().min(16).max(128),
  signature: z.string().min(32).max(512),
};

/** Stellar wallet address: validated via StrKey checksum (rejects muxed/malformed). */
export const walletAddressSchema = z
  .string()
  .refine(isValidStellarAddress, { message: 'Invalid Stellar wallet address format' });

/** POST /api/v1/auth/nonce */
export const NonceRequestSchema = z
  .object({
    walletAddress: walletAddressSchema,
    action: z.enum(['login', 'deposit', 'withdrawal']),
  })
  .strict();

/** POST /api/v1/auth/login */
export const LoginSchema = z
  .object({
    walletAddress: walletAddressSchema,
    source: z.string().min(1).max(64).optional(),
    providerAlias: z.string().min(1).max(256).optional(),
    providerSource: z.string().min(1).max(64).optional(),
    nonce: z.string().min(16).max(128).optional(),
    signature: z.string().min(32).max(512).optional(),
  })
  .strict();

/** POST /api/v1/wallet-aliases/link */
export const WalletAliasLinkSchema = z
  .object({
    primaryAlias: z.string().min(1).max(256),
    primarySource: z.string().min(1).max(64),
    linkedAlias: z.string().min(1).max(256),
    linkedSource: z.string().min(1).max(64),
  })
  .strict();

/** GET /api/v1/wallet-aliases/resolve */
export const WalletAliasResolveQuerySchema = z
  .object({
    alias: z.string().min(1).max(256),
    source: z.string().min(1).max(64),
  })
  .strict();

/** POST /api/v1/auth/login when wallet nonce enforcement is strict */
export const SignedLoginSchema = z
  .object({
    walletAddress: walletAddressSchema,
    ...signedActionFields,
  })
  .strict();

/** POST /api/v1/auth/refresh */
export const RefreshSchema = z
  .object({
    refreshToken: z.string().min(1, 'refreshToken is required'),
  })
  .strict();

// ─── Webhook schemas ──────────────────────────────────────────────────────────

/** Allowed event type literals — kept in sync with TransactionEventType in webhookDelivery.ts */
export const WEBHOOK_EVENT_TYPES = [
  'transaction.deposit.created',
  'transaction.withdrawal.created',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/**
 * POST /admin/webhooks
 *
 * - url: required, validated as a well-formed http/https URL
 * - eventTypes: optional array of known event types; defaults to all if omitted
 * - enabled: optional boolean
 * - secret: optional HMAC signing secret (8–256 chars to prevent trivially weak secrets)
 */
export const WebhookRegisterSchema = z
  .object({
    url: z
      .string()
      .min(1, 'url is required')
      .max(2048, 'url must be 2048 characters or fewer')
      .refine(
        (val) => {
          try {
            const u = new URL(val);
            return u.protocol === 'http:' || u.protocol === 'https:';
          } catch {
            return false;
          }
        },
        { message: 'url must be a valid http or https URL' },
      ),
    eventTypes: z
      .array(z.enum(WEBHOOK_EVENT_TYPES))
      .min(1, 'eventTypes must contain at least one event type')
      .optional(),
    enabled: z.boolean().optional(),
    secret: z
      .string()
      .min(8, 'secret must be at least 8 characters')
      .max(256, 'secret must be 256 characters or fewer')
      .optional(),
  })
  .strict();

/**
 * PATCH /admin/webhooks/:id
 *
 * All fields optional; at least one must be present (enforced by .refine).
 * Unknown fields are rejected by .strict().
 */
export const WebhookUpdateSchema = z
  .object({
    url: z
      .string()
      .min(1)
      .max(2048)
      .refine(
        (val) => {
          try {
            const u = new URL(val);
            return u.protocol === 'http:' || u.protocol === 'https:';
          } catch {
            return false;
          }
        },
        { message: 'url must be a valid http or https URL' },
      )
      .optional(),
    eventTypes: z
      .array(z.enum(WEBHOOK_EVENT_TYPES))
      .min(1, 'eventTypes must contain at least one event type')
      .optional(),
    enabled: z.boolean().optional(),
    secret: z
      .string()
      .min(8, 'secret must be at least 8 characters')
      .max(256, 'secret must be 256 characters or fewer')
      .optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'Request body must contain at least one field to update',
  });

// ─── Middleware factory ───────────────────────────────────────────────────────

interface ValidateTargets {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

function sortIssuesDeterministically(issues: ZodIssue[]): ZodIssue[] {
  return [...issues].sort((a, b) => {
    const pathA = a.path.join('.');
    const pathB = b.path.join('.');
    if (pathA !== pathB) {
      return pathA.localeCompare(pathB);
    }
    if (a.code !== b.code) {
      return a.code.localeCompare(b.code);
    }
    return a.message.localeCompare(b.message);
  });
}

function mapIssueCode(issue: ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return 'INVALID_TYPE';
    case 'invalid_format':
      return 'INVALID_STRING';
    case 'too_small':
      return 'VALUE_TOO_SMALL';
    case 'too_big':
      return 'VALUE_TOO_BIG';
    case 'invalid_value':
      return 'INVALID_ENUM_VALUE';
    case 'unrecognized_keys':
      return 'UNRECOGNIZED_KEYS';
    case 'invalid_union':
      return 'INVALID_UNION';
    case 'custom':
      return 'CUSTOM_VALIDATION_FAILED';
    default:
      return 'INVALID_VALUE';
  }
}

function formatZodError(issues: ZodIssue[]): string {
  return issues
    .map((e) => `${e.path.length ? e.path.join('.') + ': ' : ''}${e.message}`)
    .join('; ');
}

export function validate(schemas: ValidateTargets) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query) as typeof req.query;
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as typeof req.params;
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const issues = sortIssuesDeterministically(err.issues);
        const details = issues.map((e) => ({
          code: mapIssueCode(e),
          field: e.path.join('.'),
          message: e.message,
        }));

        res.status(400).json({
          error: 'Bad Request',
          status: 400,
          code: 'VALIDATION_ERROR',
          summary: 'Request validation failed',
          message: formatZodError(issues),
          errors: details,
          details,
        });
        return;
      }
      next(err);
    }
  };
}

// Re-export z for convenience in tests
export { z };
