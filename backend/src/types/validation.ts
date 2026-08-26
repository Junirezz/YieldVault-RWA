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

export const VaultStrategyBodySchema = z.object({
  strategyId: z.string().min(1).optional(),
  previousStrategyId: z.string().optional(),
  walletAddress: z.string().optional(),
});

export const EmptyBodySchema = z.object({}).passthrough();
