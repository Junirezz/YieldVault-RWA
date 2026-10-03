/**
 * Zod request schemas used by the validation middleware.
 *
 * Route handlers should run `validate({ body, query, params })` rather than
 * parsing `req.body` / `req.query` by hand. See backend/docs/REQUEST_VALIDATION.md.
 */

import { z } from 'zod';
import { WEBHOOK_EVENT_TYPES } from './webhooks';
import { isValidStellarAddress } from '../sanitization';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

const isoDateTime = z.string().min(1, 'must be an ISO-8601 timestamp');

export const stellarWalletAddressField = z
  .string()
  .min(1, 'walletAddress is required')
  .refine(isValidStellarAddress, { message: 'Invalid Stellar wallet address format' });

export const walletAddressField = z.string().trim().min(1, 'walletAddress is required');

export const PaginationQuerySchema = z
  .object({
    limit: z.string().regex(/^\d+$/, 'limit must be a positive integer').optional(),
    cursor: z.string().optional(),
    page: z.string().regex(/^\d+$/, 'page must be a positive integer').optional(),
    sortBy: z.string().optional(),
    sortOrder: z.string().optional(),
    dryRun: z.enum(['true', 'false', '1', '0']).optional(),
  })
  .passthrough();

export const TransactionListQuerySchema = PaginationQuerySchema.extend({
  type: z.string().optional(),
  status: z.string().optional(),
  walletAddress: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
}).passthrough();

export const AuditLogQuerySchema = PaginationQuerySchema.extend({
  actor: z.string().optional(),
  action: z.string().optional(),
  type: z.string().optional(),
  path: z.string().optional(),
  status: z.string().regex(/^\d+$/, 'status must be an HTTP status code').optional(),
  statusCode: z.string().regex(/^\d+$/, 'statusCode must be an HTTP status code').optional(),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
}).passthrough();

export const WebhookListQuerySchema = PaginationQuerySchema.extend({
  includeDeleted: z.enum(['true', 'false']).optional(),
  endpointId: z.string().optional(),
  eventType: z.enum(WEBHOOK_EVENT_TYPES).optional(),
  start: z.string().optional(),
  end: z.string().optional(),
}).passthrough();

export const IdParamSchema = z.object({
  id: z.string().min(1, 'id is required'),
});

export const WindowIdParamSchema = z.object({
  windowId: z.string().min(1, 'windowId is required'),
});

export const ApyBackfillBodySchema = z
  .object({
    start: isoDate,
    end: isoDate,
    dryRun: z.boolean().optional(),
  })
  .refine((value) => value.end >= value.start, {
    message: '`end` must be >= `start`',
    path: ['end'],
  });

export const MaintenanceToggleSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().max(500).optional(),
  retryAfterSeconds: z.number().int().min(0).max(86400).optional(),
  dryRun: z.boolean().optional(),
});

export const MaintenanceWindowBodySchema = z.object({
  title: z.string().trim().min(1, '`title` (string) is required'),
  reason: z.string().optional(),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
});

export const FeatureFlagOverrideSchema = z
  .object({
    flagName: z.string().min(1, '`flagName` (string) is required'),
    enabled: z.boolean(),
    scopeType: z.enum(['wallet', 'environment']),
    scopeValue: z.string().min(1).optional(),
    expiresAt: z.string().optional(),
  })
  .refine((value) => Boolean(value.scopeValue), {
    message: '`scopeValue` (string) is required',
    path: ['scopeValue'],
  });

export const CacheInvalidateSchema = z.object({
  pattern: z.string().optional(),
  dryRun: z.boolean().optional(),
});

export const EventReplayBodySchema = z.object({
  fromLedger: z.coerce.number().int(),
  toLedger: z.coerce.number().int(),
});

export const WithdrawalLimitOverrideSchema = z.object({
  walletAddress: walletAddressField,
  reason: z.string().trim().min(1, 'reason is required'),
  ttlSeconds: z.number().int().positive().optional(),
});

export const AllowlistWalletBodySchema = z.object({
  walletAddress: walletAddressField,
});

export const ImpersonationSessionBodySchema = z.object({
  targetWallet: walletAddressField,
  reason: z.string().trim().min(1, 'reason is required'),
});

export const ApiKeyRegisterSchema = z.object({
  key: z.string().trim().min(1, 'Missing key in request body'),
  role: z.string().optional(),
});

export const ApiKeyRotateSchema = z.object({
  oldHash: z.string().min(1, 'oldHash is required'),
  newKey: z.string().trim().min(1, 'newKey is required'),
});

export const ApiKeyRevokeSchema = z.object({
  hash: z.string().min(1, 'hash is required'),
});

export const WebhookVerifyBodySchema = z.object({
  secret: z.string().trim().min(1, 'secret is required and must be a non-empty string'),
  payload: z.unknown(),
  signature: z.string().optional(),
});

export const BulkExportBodySchema = z.object({
  format: z.enum(['csv', 'json']),
  filters: z.record(z.string(), z.unknown()).optional(),
});

export const TransactionBackfillBodySchema = z.object({
  startLedger: z.coerce.number().int(),
  endLedger: z.coerce.number().int(),
  batchSize: z.coerce.number().int().positive().optional(),
  dryRun: z.boolean().optional(),
  rpcUrl: z.string().optional(),
  contractId: z.string().optional(),
});

export const GovernanceSnapshotExportSchema = z.object({
  types: z.array(z.string()).optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  limit: z.number().int().min(1).max(5000).optional(),
});

export const ReportExportBodySchema = z.object({
  reportType: z.string().optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
});

export const ChecksumVerifyBodySchema = z.object({
  checksum: z.string().optional(),
}).passthrough();

export const DeadLetterResolveSchema = z.object({
  notes: z.string().optional(),
});

export const DeadLetterIdsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, '`ids` array must not be empty'),
});

export const DeadLetterProcessSchema = z.object({
  batchSize: z.number().int().positive().optional(),
});

export const ScopedTokenCreateSchema = z.object({
  label: z.string().trim().min(1, '`label` (string) is required'),
  permissions: z.array(z.string()).min(1, '`permissions` (non-empty array) is required'),
  expiresInSeconds: z.number().int().positive().optional(),
});

/**
 * Validates and normalises the `weights` map on a strategy request.
 *
 * Two modes are accepted:
 *
 * **Basis-point mode** – every value is a non-negative integer and at least one
 * value is > 1.  The sum must equal 10 000 exactly.
 *
 *   { vaultA: 3333, vaultB: 3333, vaultC: 3334 }   ✓
 *
 * **Float mode** – values are in the [0, 1] range.  The sum must be within
 * 1 × 10⁻⁹ of 1.0 to accommodate 0.333 + 0.333 + 0.334 = 0.999999…
 * The schema output normalises floats to integer bps so the Soroban contract
 * always receives whole numbers that sum to exactly 10 000.
 *
 *   { vaultA: 0.333, vaultB: 0.333, vaultC: 0.334 }  ✓  →  3330 / 3330 / 3340
 */
const _weightsRawSchema = z.record(z.string().min(1), z.number().nonnegative());

function _validateAndNormalizeBps(
  raw: Record<string, number>,
): { ok: true; data: Record<string, number> } | { ok: false; message: string } {
  const entries = Object.entries(raw);
  if (entries.length === 0) {
    return { ok: false, message: 'weights must contain at least one entry' };
  }

  const values = entries.map(([, v]) => v);
  const allIntegers = values.every((v) => Number.isInteger(v));
  const anyAboveOne = values.some((v) => v > 1);
  const isBpsMode = allIntegers && anyAboveOne;

  if (isBpsMode) {
    const sum = values.reduce((acc, v) => acc + v, 0);
    if (sum !== 10_000) {
      return { ok: false, message: `weights in basis-point mode must sum to 10000, got ${sum}` };
    }
    return { ok: true, data: raw };
  }

  // Float mode: all values must be in [0, 1]
  if (values.some((v) => v > 1)) {
    return { ok: false, message: 'weights in float mode must be between 0 and 1' };
  }

  const sum = values.reduce((acc, v) => acc + v, 0);
  if (Math.abs(sum - 1) >= 1e-9) {
    return { ok: false, message: `weights in float mode must sum to 1, got ${sum}` };
  }

  // Normalise to bps; last entry absorbs any rounding remainder
  const bps: Record<string, number> = {};
  let allocated = 0;
  for (let i = 0; i < entries.length - 1; i++) {
    const [key, v] = entries[i];
    const rounded = Math.round(v * 10_000);
    bps[key] = rounded;
    allocated += rounded;
  }
  const [lastKey] = entries[entries.length - 1];
  bps[lastKey] = 10_000 - allocated;

  return { ok: true, data: bps };
}

export const VaultStrategyBodySchema = z
  .object({
    strategyId: z.string().min(1).optional(),
    previousStrategyId: z.string().optional(),
    walletAddress: z.string().optional(),
    weights: _weightsRawSchema.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.weights === undefined) return;
    const result = _validateAndNormalizeBps(val.weights);
    if (!result.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.message, path: ['weights'] });
    }
  })
  .transform((val) => {
    if (val.weights === undefined) return val;
    const result = _validateAndNormalizeBps(val.weights);
    return { ...val, weights: result.ok ? result.data : val.weights };
  });

export const EmptyBodySchema = z.object({}).passthrough();
