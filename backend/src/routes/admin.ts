/**
 * Remaining /admin/* operational endpoints.
 *
 * Extracted from src/index.ts (issue #1545); mounted by the composition root
 * in the same position the routes were registered, so behaviour is unchanged.
 */
import { Router, Request, Response } from 'express';
import { API_KEY_AUDIT_ACTIONS, getApiKeyFingerprintFromHash, getApiKeyFingerprintFromValue, isApiKeyHash, listApiKeyAuditEvents, recordApiKeyAuditEvent, resolveApiKeyAuditActor } from '../apiKeyAudit';
import { AllowlistWalletBodySchema, ApiKeyRegisterSchema, ApiKeyRevokeSchema, ApiKeyRotateSchema, ApyBackfillBodySchema, AuditLogQuerySchema, CacheInvalidateSchema, CreateVaultBodySchema, DeadLetterIdsSchema, DeadLetterProcessSchema, DeadLetterResolveSchema, EventReplayBodySchema, FeatureFlagOverrideSchema, GovernanceSnapshotExportSchema, IdParamSchema, ImpersonationSessionBodySchema, MaintenanceToggleSchema, MaintenanceWindowBodySchema, ScopedTokenCreateSchema, WindowIdParamSchema, WithdrawalLimitOverrideSchema, validate } from '../middleware/validate';
import { DateRangeParseError, parseUtcDateRange } from '../dateRange';
import { type DeadLetterStatus, type JobName, bulkDiscardDeadLetters, bulkRetryDeadLetters, discardDeadLetter, getDeadLetterRecord, getJobHealthStatus, getJobMetrics, listDeadLetters, processDeadLetterQueue, resolveDeadLetter, retryDeadLetter } from '../jobGovernance';
import { type ImpersonationSessionRecord, endImpersonationSession, listImpersonationSessions, resolveImpersonationSessionContext, startImpersonationSession, validateImpersonationSession } from '../impersonationSessionService';
import { TRANSACTION_PAGINATION_CONFIG, buildPortfolioHoldingsResponse, buildVaultHistoryResponse } from '../listEndpoints';
import { type WithdrawalSagaStatus, withdrawalRecoveryCoordinator } from '../withdrawalRecovery';
import { addAddress, allowlistSize, listAddresses, removeAddress } from '../middleware/allowlist';
import { backfillApySnapshots } from '../apySnapshot';
import { buildReferralCodeErrorBody, buildReferralStatsErrorBody, buildReferralStatsNotFoundBody } from '../referralEndpoints';
import { buildVaultSummaryResponseFromDb, isDryRunRequest, paginateByLimit, parseLimited, resolveActingAdminAddress, sendStandardListEnvelope } from './shared';
import { cancelMaintenanceWindow, listMaintenanceWindows, scheduleMaintenanceWindow } from '../maintenanceWindow';
import { countAuditLogs, getAuditLogMetrics, getAuditLogs } from '../auditLog';
import { createPaginatedResponse, createPaginationEnvelope, encodeCursor } from '../pagination';
import { emailQueueService } from '../emailQueue';
import { exportGovernanceSnapshots, listGovernanceSnapshots } from '../governanceSnapshotExport';
import { featureFlags } from '../featureFlags';
import { generateAdminReceipt, getAdminReceipt, listAdminReceipts, verifyReceiptSignature } from '../adminReceipt';
import { getApiKeyMetadata, hasRequiredApiKeyRole, normalizeApiKeyRole, registerApiKey, restoreApiKey, revokeApiKey, rotateApiKey, validateApiKey } from '../middleware/apiKeyAuth';
import { getCacheStats, invalidateCache } from '../middleware/cache';
import { getIdempotencyRetentionMetrics, pruneStaleIdempotencyRecords } from '../idempotencyRetention';
import { getMaintenanceModeState, logMaintenanceTransition, updateMaintenanceModeState } from '../maintenanceMode';
import { getPrismaClient } from '../prismaClient';
import { getPrismaRuntimeConfig, prisma } from '../prisma';
import { getRedisCacheHealth, redisCacheClient } from '../redisCache';
import { getWebhookDeliveryMetrics } from '../webhookDelivery';
import { idempotencyStore } from '../idempotency';
import { listAdminConfigChanges, recordAdminConfigChange } from '../adminConfigChangeAudit';
import { listWithdrawalLimitAuditEntries, setWithdrawalLimitOverride } from '../middleware/withdrawalDailyLimit';
import { logger } from '../middleware/structuredLogging';
import { normalizeWalletAddress } from '../walletUtils';
import { recordAdminAuditLog } from '../adminAudit';
import { referralService } from '../referralService';
import { register } from '../metrics';
import { scopedAdminTokenStore } from '../scopedAdminTokens';
import { walletAliasMappingService } from '../walletAliasService';
import { writeAheadAuditLog } from '../writeAheadAuditLog';

function countInclusiveDays(start: string, end: string): number {
  const startMs = Date.parse(start + 'T00:00:00.000Z');
  const endMs = Date.parse(end + 'T00:00:00.000Z');
  return Math.floor((endMs - startMs) / 86400000) + 1;
}

async function buildReferralStatsSnapshot(wallet: string) {
  const normalizedWallet = normalizeWalletAddress(wallet);

  try {
    const stats = await referralService.getReferralStats(normalizedWallet);

    if (!stats) {
      // Must be the exact envelope GET /api/v1/referrals/:wallet returns, not
      // a hand-rolled stand-in — admin impersonation is compared against that
      // endpoint field-for-field by the governance contract test.
      return {
        statusCode: 404,
        body: buildReferralStatsNotFoundBody(),
      };
    }

    return {
      statusCode: 200,
      body: stats,
    };
  } catch (error) {
    // Same reasoning as the 404 above. The route reports a failed lookup as a
    // 500 with the canonical envelope; letting the rejection escape instead
    // would 500 the entire impersonation response with a different message, so
    // one broken sub-resource would take the whole snapshot with it (#1319).
    logger.log('error', 'Error building referral stats snapshot', {
      error: error instanceof Error ? error.message : String(error),
      wallet: normalizedWallet,
    });
    return {
      statusCode: 500,
      body: buildReferralStatsErrorBody(),
    };
  }
}

async function buildReferralCodeSnapshot(wallet: string) {
  const normalizedWallet = normalizeWalletAddress(wallet);

  try {
    const code = await referralService.getOrCreateReferralCode(normalizedWallet);
    return {
      statusCode: 200,
      body: { code },
    };
  } catch (error) {
    logger.log('error', 'Error building referral code snapshot', {
      error: error instanceof Error ? error.message : String(error),
      wallet: normalizedWallet,
    });
    return {
      statusCode: 500,
      body: buildReferralCodeErrorBody(),
    };
  }
}

async function buildWalletTransactionsSnapshot(wallet: string) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  const prisma = getPrismaClient();
  // Shared with GET /api/v1/transactions so the proxy can never drift to a
  // different page size than the endpoint it stands in for (#1322).
  const limit = TRANSACTION_PAGINATION_CONFIG.defaultLimit ?? 20;
  const where = { user: normalizedWallet };
  const [total, transactions] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit + 1,
    }),
  ]);
  const hasNextPage = transactions.length > limit;
  const data = hasNextPage ? transactions.slice(0, limit) : transactions;

  return createPaginatedResponse(
    data,
    createPaginationEnvelope({
      count: data.length,
      limit,
      total,
      hasNextPage,
      hasPrevPage: false,
      nextCursor: hasNextPage && data.length > 0 ? encodeCursor(data[data.length - 1].id) : null,
    }),
  );
}

async function buildImpersonatedVaultState(wallet: string) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  return {
    walletAddress: normalizedWallet,
    // Impersonation must show an admin exactly what the wallet's own
    // dashboard would show, so read the same DB-backed summary
    // GET /api/v1/vault/summary serves.
    summary: await buildVaultSummaryResponseFromDb(),
    transactions: await buildWalletTransactionsSnapshot(normalizedWallet),
    portfolioHoldings: buildPortfolioHoldingsResponse({ walletAddress: normalizedWallet }),
    vaultHistory: buildVaultHistoryResponse({}),
    referralStats: await buildReferralStatsSnapshot(normalizedWallet),
    referralCode: await buildReferralCodeSnapshot(normalizedWallet),
  };
}

function getPrismaConfig() {
  const config = getPrismaRuntimeConfig();
  return {
    prismaPoolSize: config.poolMax,
    prismaQueryTimeoutMs: config.queryTimeoutMs,
    prismaPoolTimeoutMs: config.poolTimeoutMs,
  };
}

// ─── Withdrawal Partial-Failure Recovery Endpoints (Issue #954) ──────────────

const WITHDRAWAL_SAGA_STATUSES: readonly WithdrawalSagaStatus[] = [
  'in_progress',
  'completed',
  'awaiting_retry',
  'compensated',
  'needs_manual_intervention',
  'failed',
];

function parseSagaStatus(value: unknown): WithdrawalSagaStatus | undefined {
  return typeof value === 'string' &&
    (WITHDRAWAL_SAGA_STATUSES as readonly string[]).includes(value)
    ? (value as WithdrawalSagaStatus)
    : undefined;
}

const router = Router();

// â”€â”€â”€ Admin Routes (with API key authentication) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * POST /admin/apy/backfill - backfill missing APY snapshots for a date range
 * Body: { start: "YYYY-MM-DD", end: "YYYY-MM-DD" }
 * Requires API key authentication.
 */
router.post('/admin/apy/backfill', validateApiKey, validate({ body: ApyBackfillBodySchema }), async (req: Request, res: Response) => {
  const { start, end } = req.body;
  if (!start || !end || typeof start !== 'string' || typeof end !== 'string') {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: '`start` and `end` (YYYY-MM-DD) are required',
    });
    return;
  }

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(start) || !datePattern.test(end)) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: '`start` and `end` must be in YYYY-MM-DD format',
    });
    return;
  }

  if (end < start) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: '`end` must be >= `start`',
    });
    return;
  }

  const actor = resolveActingAdminAddress(req);
  const jobStart = Date.now();

  try {
    if (isDryRunRequest(req)) {
      void recordAdminAuditLog(req, 'apy.backfill.dry_run', 200, {
        start,
        end,
        actor,
        estimatedDates: countInclusiveDays(start, end),
      });

      res.status(200).json({
        dryRun: true,
        message: 'APY backfill dry-run preview',
        start,
        end,
        estimatedDates: countInclusiveDays(start, end),
        wouldCreateSnapshots: true,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const result = await backfillApySnapshots(start, end);
    const durationMs = Date.now() - jobStart;

    const receipt = await generateAdminReceipt({
      action: 'apy.backfill',
      actor,
      input: { start, end },
      resultingState: {
        created: result.created,
        skipped: result.skipped,
        durationMs,
      },
    });

    void recordAdminAuditLog(req, 'apy.backfill', 200, {
      start,
      end,
      created: result.created,
      skipped: result.skipped,
      durationMs,
      actor,
      receiptId: receipt.id,
    });

    res.status(200).json({
      message: 'APY backfill completed',
      start,
      end,
      created: result.created,
      skipped: result.skipped,
      dates: result.dates,
      durationMs,
      timestamp: new Date().toISOString(),
      receipt,
    });
  } catch (err) {
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

/**
 * GET /admin/maintenance - get current maintenance mode state
 * Requires API key authentication.
 */
router.get('/admin/maintenance', validateApiKey, (_req: Request, res: Response) => {
  res.status(200).json({
    maintenance: getMaintenanceModeState(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /admin/maintenance - enable or disable maintenance mode
 * Body: { enabled: boolean, reason?: string, retryAfterSeconds?: number }
 * Requires API key authentication.
 */
router.post('/admin/maintenance', validateApiKey, validate({ body: MaintenanceToggleSchema }), async (req: Request, res: Response) => {
  const { enabled, reason, retryAfterSeconds } = req.body;
  if (typeof enabled !== 'boolean') {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: '`enabled` (boolean) is required',
    });
    return;
  }

  const actor = resolveActingAdminAddress(req);
  const previous = getMaintenanceModeState();
  const dryRun = isDryRunRequest(req);
  const preview = {
    enabled: enabled ?? previous.enabled,
    reason:
      reason === undefined
        ? previous.reason
        : typeof reason === 'string'
          ? reason.trim() || undefined
          : undefined,
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
    retryAfterSeconds: retryAfterSeconds ?? previous.retryAfterSeconds,
  };

  if (dryRun) {
    void recordAdminAuditLog(req, 'maintenance.toggle.dry_run', 200, {
      enabled: preview.enabled,
      previousEnabled: previous.enabled,
      reason: preview.reason,
      actor,
    });

    res.status(200).json({
      dryRun: true,
      message: `Maintenance mode would be ${preview.enabled ? 'enabled' : 'disabled'}`,
      previous,
      maintenance: preview,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const next = updateMaintenanceModeState({ enabled, reason, retryAfterSeconds, actor });

  await recordAdminConfigChange({
    configType: 'maintenance',
    action: 'toggle',
    actor,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
    preChangeSnapshot: previous as unknown as Record<string, unknown>,
    postChangeSnapshot: next as unknown as Record<string, unknown>,
    metadata: { receiptId: '' },
  });

  const receipt = await generateAdminReceipt({
    action: 'maintenance.toggle',
    actor,
    input: { enabled, reason, retryAfterSeconds },
    resultingState: {
      enabled: next.enabled,
      reason: next.reason,
      retryAfterSeconds: next.retryAfterSeconds,
      previousEnabled: previous.enabled,
    },
  });

  logMaintenanceTransition({
    enabled: next.enabled,
    actor,
    reason: next.reason,
    retryAfterSeconds: next.retryAfterSeconds,
    previousEnabled: previous.enabled,
  });

  void recordAdminAuditLog(req, 'maintenance.toggle', 200, {
    enabled: next.enabled,
    previousEnabled: previous.enabled,
    reason: next.reason,
    actor,
    receiptId: receipt.id,
  });

  res.status(200).json({
    message: `Maintenance mode ${next.enabled ? 'enabled' : 'disabled'}`,
    maintenance: next,
    timestamp: new Date().toISOString(),
    receipt,
  });
});

/**
 * GET /admin/maintenance/windows - list scheduled maintenance windows
 */
router.get('/admin/maintenance/windows', validateApiKey, (_req: Request, res: Response) => {
  res.status(200).json({
    windows: listMaintenanceWindows(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /admin/maintenance/windows - schedule a maintenance window
 * Body: { title: string, reason?: string, startsAt: string, endsAt: string }
 */
router.post('/admin/maintenance/windows', validateApiKey, validate({ body: MaintenanceWindowBodySchema }), (req: Request, res: Response) => {
  const { title, reason, startsAt, endsAt } = req.body;
  if (typeof title !== 'string' || !title.trim()) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: '`title` (string) is required',
    });
    return;
  }
  if (typeof startsAt !== 'string' || typeof endsAt !== 'string') {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: '`startsAt` and `endsAt` (ISO strings) are required',
    });
    return;
  }

  try {
    const actor = resolveActingAdminAddress(req);
    const window = scheduleMaintenanceWindow({
      title,
      reason: typeof reason === 'string' ? reason : undefined,
      startsAt,
      endsAt,
      actor,
    });
    res.status(201).json({ window, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * DELETE /admin/maintenance/windows/:windowId - cancel a scheduled window
 */
router.delete('/admin/maintenance/windows/:windowId', validateApiKey, validate({ params: WindowIdParamSchema }), (req: Request, res: Response) => {
  const cancelled = cancelMaintenanceWindow(req.params.windowId);
  if (!cancelled) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'Maintenance window not found',
    });
    return;
  }
  res.status(200).json({
    cancelled: true,
    windowId: req.params.windowId,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/config-changes - List admin configuration changes
 * Requires API key authentication
 */
router.get('/admin/config-changes', validateApiKey, async (req: Request, res: Response) => {
  const { configType, actor, start, end, limit } = req.query;
  const configChanges = await listAdminConfigChanges({
    configType: typeof configType === 'string' ? configType : undefined,
    actor: typeof actor === 'string' ? actor : undefined,
    start: typeof start === 'string' ? start : undefined,
    end: typeof end === 'string' ? end : undefined,
    limit: typeof limit === 'string' ? parseInt(limit, 10) : 100,
  });

  res.json({
    data: configChanges,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/feature-flags/overrides - List active feature flag overrides
 * Requires API key authentication
 */
router.get('/admin/feature-flags/overrides', validateApiKey, async (_req: Request, res: Response) => {
  const overrides = await featureFlags.listActiveOverrides();
  res.json({
    data: overrides,
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /admin/feature-flags/overrides - Create a new feature flag override
 * Requires API key authentication
 * Body: {
 *   flagName: string,
 *   enabled: boolean,
 *   scopeType: "wallet" | "environment",
 *   scopeValue?: string,
 *   expiresAt: string (ISO 8601)
 * }
 */
router.post('/admin/feature-flags/overrides', validateApiKey, validate({ body: FeatureFlagOverrideSchema }), async (req: Request, res: Response) => {
  const { flagName, enabled, scopeType, scopeValue, expiresAt } = req.body;

  if (!flagName || typeof flagName !== 'string') {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: '`flagName` (string) is required'
    });
    return;
  }

  if (typeof enabled !== 'boolean') {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: '`enabled` (boolean) is required'
    });
    return;
  }

  if (!scopeType || !['wallet', 'environment'].includes(scopeType)) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: '`scopeType` must be "wallet" or "environment"'
    });
    return;
  }

  if (scopeType === 'wallet' && (!scopeValue || typeof scopeValue !== 'string')) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: '`scopeValue` (string) is required for wallet scope'
    });
    return;
  }

  if (scopeType === 'environment' && (!scopeValue || typeof scopeValue !== 'string')) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: '`scopeValue` (string) is required for environment scope'
    });
    return;
  }

  if (!expiresAt || typeof expiresAt !== 'string') {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: '`expiresAt` (ISO 8601 string) is required'
    });
    return;
  }

  const expiresAtDate = new Date(expiresAt);
  if (isNaN(expiresAtDate.getTime()) || expiresAtDate <= new Date()) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: '`expiresAt` must be a valid future date in ISO 8601 format'
    });
    return;
  }

  const actor = resolveActingAdminAddress(req);
  const override = await featureFlags.createOverride(
    flagName,
    enabled,
    scopeType as 'wallet' | 'environment',
    scopeValue,
    expiresAtDate,
    actor
  );

  res.status(201).json({
    message: 'Feature flag override created successfully',
    data: override,
    timestamp: new Date().toISOString(),
  });
});

/**
 * DELETE /admin/feature-flags/overrides/:id - Delete a feature flag override
 * Requires API key authentication
 */
router.delete('/admin/feature-flags/overrides/:id', validateApiKey, async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'Override ID is required'
    });
    return;
  }

  try {
    await featureFlags.deleteOverride(id);
    res.status(200).json({
      message: 'Feature flag override deleted successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'Feature flag override not found'
    });
  }
});

/**
 * GET /admin/cache/stats - Get cache statistics including hit rate (R8) and Redis status
 * Requires API key authentication
 */
router.get('/admin/cache/stats', validateApiKey, async (_req: Request, res: Response) => {
  const stats = getCacheStats();
  // Compute hit rate from Prometheus counters by reading the registry metrics text
  let hitRate: number | null = null;
  try {
    const metricsText = await register.metrics();
    const hitMatch = metricsText.match(/^cache_hit_count(?:\{[^}]*\})?\s+([\d.]+)/m);
    const missMatch = metricsText.match(/^cache_miss_count(?:\{[^}]*\})?\s+([\d.]+)/m);
    // Sum all label combinations
    const hitTotal = hitMatch
      ? metricsText
          .split('\n')
          .filter((l) => l.startsWith('cache_hit_count'))
          .reduce((acc, l) => {
            const m = l.match(/\s+([\d.]+)$/);
            return acc + (m ? parseFloat(m[1]) : 0);
          }, 0)
      : 0;
    const missTotal = missMatch
      ? metricsText
          .split('\n')
          .filter((l) => l.startsWith('cache_miss_count'))
          .reduce((acc, l) => {
            const m = l.match(/\s+([\d.]+)$/);
            return acc + (m ? parseFloat(m[1]) : 0);
          }, 0)
      : 0;
    const total = hitTotal + missTotal;
    hitRate = total > 0 ? parseFloat((hitTotal / total).toFixed(4)) : null;
  } catch {
    hitRate = null;
  }

  const redisHealth = await getRedisCacheHealth();

  res.json({
    entryCount: stats.size,
    entries: stats.entries,
    hitRate,
    redis: {
      configured: redisCacheClient.isConfigured,
      ready: redisCacheClient.isReady,
      health: redisHealth,
    },
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/cache/redis-status - Detailed Redis cache connection and health status
 * Requires API key authentication
 */
router.get('/admin/cache/redis-status', validateApiKey, async (_req: Request, res: Response) => {
  const redisHealth = await getRedisCacheHealth();
  const pingResponse = await redisCacheClient.ping();

  res.json({
    configured: redisCacheClient.isConfigured,
    ready: redisCacheClient.isReady,
    health: redisHealth,
    ping: pingResponse,
    fallbackActive: redisCacheClient.isConfigured && !redisCacheClient.isReady,
    timestamp: new Date().toISOString(),
  });
});

/**
 * DELETE /admin/cache - Clear entire cache or by regex pattern (R8)
 * ?pattern=<regex> removes only matching entries
 * Requires API key authentication
 */
router.delete('/admin/cache', validateApiKey, (req: Request, res: Response) => {
  const pattern = typeof req.query.pattern === 'string' ? req.query.pattern : undefined;

  if (pattern !== undefined) {
    if (pattern.trim() === '') {
      res.status(400).json({
        error: 'Bad Request',
        status: 400,
        message: 'pattern query parameter must not be empty; omit it to clear the entire cache',
      });
      return;
    }
    try {
      new RegExp(pattern);
    } catch (e) {
      res.status(400).json({
        error: 'Bad Request',
        status: 400,
        message: `Invalid regex pattern "${pattern}": ${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }
  }

  const removed = invalidateCache(pattern);
  res.json({
    removed,
    pattern: pattern ?? null,
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /admin/cache/invalidate - Invalidate cache by pattern (legacy endpoint)
 * Requires API key authentication
 */
router.post('/admin/cache/invalidate', validateApiKey, validate({ body: CacheInvalidateSchema }), (req: Request, res: Response) => {
  const { pattern } = req.body;
  if (isDryRunRequest(req)) {
    res.json({
      dryRun: true,
      message: 'Cache invalidation dry-run preview',
      pattern,
      wouldInvalidate: true,
      stats: getCacheStats(),
      timestamp: new Date().toISOString(),
    });
    return;
  }

  invalidateCache(pattern);
  res.json({
    message: 'Cache invalidated',
    pattern,
    stats: getCacheStats(),
  });
});

/**
 * POST /admin/events/replay - Manual admin endpoint to replay events for a specific ledger range
 * Requires API key authentication
 */
router.post('/admin/events/replay', validateApiKey, validate({ body: EventReplayBodySchema }), async (req: Request, res: Response) => {
  try {
    const { fromLedger, toLedger } = req.body;
    
    if (fromLedger === undefined || toLedger === undefined) {
      res.status(400).json({
        error: 'Bad Request',
        status: 400,
        message: 'fromLedger and toLedger are required in request body',
      });
      return;
    }
    
    if (typeof fromLedger !== 'number' || typeof toLedger !== 'number') {
      res.status(400).json({
        error: 'Bad Request',
        status: 400,
        message: 'fromLedger and toLedger must be numbers',
      });
      return;
    }
    
    // Validate ledger range
    if (fromLedger < 0 || toLedger < 0 || fromLedger > toLedger) {
      res.status(400).json({
        error: 'Bad Request',
        status: 400,
        message: 'fromLedger must be >= 0, toLedger must be >= 0, and fromLedger must be <= toLedger',
      });
      return;
    }

    const actor = resolveActingAdminAddress(req);
    if (isDryRunRequest(req)) {
      void recordAdminAuditLog(req, 'events.replay.manual.dry_run', 200, {
        fromLedger,
        toLedger,
        ledgerCount: toLedger - fromLedger + 1,
        actor,
        timestamp: new Date().toISOString(),
      });

      res.status(200).json({
        dryRun: true,
        message: 'Event replay dry-run preview',
        fromLedger,
        toLedger,
        ledgerCount: toLedger - fromLedger + 1,
        wouldReplay: true,
        timestamp: new Date().toISOString(),
      });
      return;
    }
    
    // Import the replay function
    const { replayEventsForRange } = await import('../eventPollingService');
    
    const startTime = Date.now();
    const result = await replayEventsForRange(fromLedger, toLedger);
    const duration = Date.now() - startTime;

    const receipt = await generateAdminReceipt({
      action: 'events.replay.manual',
      actor,
      input: { fromLedger, toLedger },
      resultingState: {
        processedCount: result.processedCount,
        duplicateCount: result.duplicateCount,
        durationMs: duration,
      },
    });
    
    // Record replay job metadata
    void recordAdminAuditLog(req, 'events.replay.manual', 200, {
      fromLedger,
      toLedger,
      processedCount: result.processedCount,
      duplicateCount: result.duplicateCount,
      durationMs: duration,
      timestamp: new Date().toISOString(),
      receiptId: receipt.id,
    });
    
    res.status(200).json({
      message: 'Event replay completed successfully',
      fromLedger,
      toLedger,
      processedCount: result.processedCount,
      duplicateCount: result.duplicateCount,
      durationMs: duration,
      timestamp: new Date().toISOString(),
      receipt,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    
    // Record failed replay attempt
    void recordAdminAuditLog(req, 'events.replay.manual.failed', 500, {
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
    
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: errorMessage,
    });
  }
});

/**
 * POST /admin/withdrawal-limits/override
 * Grants a temporary admin override for a wallet's daily withdrawal limit.
 * Requires super-admin API key.
 */
router.post('/admin/withdrawal-limits/override', validateApiKey, validate({ body: WithdrawalLimitOverrideSchema }), async (req: Request, res: Response) => {
  const walletAddress = typeof req.body?.walletAddress === 'string' ? req.body.walletAddress.trim() : '';
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  const ttlSeconds =
    typeof req.body?.ttlSeconds === 'number' && req.body.ttlSeconds > 0
      ? req.body.ttlSeconds
      : 3600;

  if (!walletAddress || !reason) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'walletAddress and reason are required',
    });
    return;
  }

  if (!hasRequiredApiKeyRole(req, 'super-admin')) {
    res.status(403).json({
      error: 'Forbidden',
      status: 403,
      message: 'Super-admin role is required to override withdrawal limits',
    });
    return;
  }

  const actor = resolveActingAdminAddress(req);
  const override = setWithdrawalLimitOverride(walletAddress, reason, actor, ttlSeconds);

  await recordAdminAuditLog(req, 'withdrawal.limit.override.grant', 201, {
    walletAddress: override.wallet,
    reason: override.reason,
    expiresAt: override.expiresAt,
    actor,
  });

  res.status(201).json({ override });
});

/**
 * GET /admin/withdrawal-limits/audit
 * Lists recent blocked and overridden withdrawal attempts.
 */
router.get('/admin/withdrawal-limits/audit', validateApiKey, (req: Request, res: Response) => {
  const limit = parseLimited(req.query.limit, 50, 1, 200);
  const windowed = listWithdrawalLimitAuditEntries(limit + 1);
  const { data, hasNextPage } = paginateByLimit(windowed, limit);

  sendStandardListEnvelope(res, {
    data,
    limit,
    hasNextPage,
    extras: { entries: data },
  });
});

/**
 * GET /admin/emails/queue
 * Lists queued outbound emails, optionally filtered by status.
 */
router.get('/admin/emails/queue', validateApiKey, async (req: Request, res: Response) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const emails = await emailQueueService.getEmailQueue(status);

  res.status(200).json({
    emails,
    count: emails.length,
  });
});

/**
 * POST /admin/emails/replay/:id
 * Requeues a failed/dead-letter email for another send attempt.
 */
router.post('/admin/emails/replay/:id', validateApiKey, async (req: Request, res: Response) => {
  try {
    const email = await emailQueueService.replayEmail(req.params.id);
    res.status(200).json({
      message: 'Email requeued successfully',
      email,
    });
  } catch {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'Email queue item not found',
    });
  }
});

// â”€â”€â”€ Allowlist Admin Endpoints (Issue #375) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * POST /admin/allowlist/add
 * Adds a wallet address to the private beta allowlist.
 * Requires API key authentication.
 * Body: { "walletAddress": "G..." }
 */
router.post('/admin/allowlist/add', validateApiKey, validate({ body: AllowlistWalletBodySchema }), async (req: Request, res: Response) => {
  const { walletAddress } = req.body;
  const added = addAddress(walletAddress);
  const actor = resolveActingAdminAddress(req);

  const receipt = await generateAdminReceipt({
    action: 'allowlist.add',
    actor,
    input: { walletAddress },
    resultingState: {
      added,
      totalCount: allowlistSize(),
    },
  });

  void recordAdminAuditLog(req, 'allowlist.add', added ? 201 : 200, {
    walletAddress,
    added,
    actor,
    receiptId: receipt.id,
  });

  res.status(added ? 201 : 200).json({
    message: added ? 'Wallet added to allowlist' : 'Wallet already in allowlist',
    walletAddress: walletAddress.trim().toUpperCase(),
    count: allowlistSize(),
    receipt,
  });
});

/**
 * DELETE /admin/allowlist/remove
 * Removes a wallet address from the private beta allowlist.
 * Requires API key authentication.
 * Body: { "walletAddress": "G..." }
 */
router.delete('/admin/allowlist/remove', validateApiKey, validate({ body: AllowlistWalletBodySchema }), async (req: Request, res: Response) => {
  const { walletAddress } = req.body;
  const removed = removeAddress(walletAddress);
  if (!removed) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'Wallet address not found in allowlist',
    });
    return;
  }

  const actor = resolveActingAdminAddress(req);
  const receipt = await generateAdminReceipt({
    action: 'allowlist.remove',
    actor,
    input: { walletAddress },
    resultingState: {
      removed: true,
      totalCount: allowlistSize(),
    },
  });

  void recordAdminAuditLog(req, 'allowlist.remove', 200, {
    walletAddress,
    actor,
    receiptId: receipt.id,
  });

  res.json({
    message: 'Wallet removed from allowlist',
    walletAddress: walletAddress.trim().toUpperCase(),
    count: allowlistSize(),
    receipt,
  });
});

/**
 * GET /admin/allowlist
 * Lists all wallet addresses on the allowlist.
 * Requires API key authentication.
 */
router.get('/admin/allowlist', validateApiKey, (_req: Request, res: Response) => {
  res.json({
    addresses: listAddresses(),
    count: allowlistSize(),
    enabled: process.env.ALLOWLIST_ENABLED !== 'false',
  });
});

/**
 * GET /admin/wallet-aliases
 * Lists persisted wallet alias identity groups.
 * Requires API key authentication.
 */
router.get('/admin/wallet-aliases', validateApiKey, async (_req: Request, res: Response) => {
  const groups = await walletAliasMappingService.listIdentityLinks();
  res.json({
    groups,
    count: groups.length,
  });
});

/**
 * DELETE /admin/wallet-aliases/:canonicalId
 * Deletes a canonical wallet alias group and all linked aliases.
 * Requires API key authentication.
 */
router.delete('/admin/wallet-aliases/:canonicalId', validateApiKey, async (req: Request, res: Response) => {
  const { canonicalId } = req.params;
  const existing = await walletAliasMappingService.getIdentityLinks(canonicalId);

  if (!existing) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'Canonical identity not found',
    });
    return;
  }

  const deleted = await walletAliasMappingService.deleteIdentityGroup(canonicalId);
  if (!deleted) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'Canonical identity not found',
    });
    return;
  }

  const actor = resolveActingAdminAddress(req);
  void recordAdminAuditLog(req, 'wallet-alias.delete', 200, {
    actor,
    canonicalId,
    aliases: existing.aliases,
    sources: existing.sources,
  });

  res.status(200).json({
    message: 'Wallet alias group deleted',
    canonicalId,
    aliasesDeleted: existing.aliases.length,
    sources: existing.sources,
  });
});

/**
 * POST /admin/impersonate/sessions - start a time-bounded impersonation session
 * Requires super-admin API key.
 */
router.post('/admin/impersonate/sessions', validateApiKey, validate({ body: ImpersonationSessionBodySchema }), async (req: Request, res: Response) => {
  const actingAdminAddress = resolveActingAdminAddress(req);
  const { actor, apiKeyHash, ipAddress, userAgent } = resolveImpersonationSessionContext(req);
  const targetWallet = typeof req.body?.targetWallet === 'string' ? req.body.targetWallet.trim() : '';
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';

  req.adminAuditActor = actingAdminAddress;
  req.adminAuditMetadata = {
    actingAdminAddress,
    adminRole: req.authApiKeyRole || 'admin',
    targetWallet: targetWallet || 'unknown',
    impersonation: true,
  };

  if (!targetWallet || !reason) {
    req.adminAuditAction = 'admin.impersonate.session.invalid';
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'targetWallet and reason are required',
    });
    return;
  }

  if (!hasRequiredApiKeyRole(req, 'super-admin')) {
    req.adminAuditAction = 'admin.impersonate.session.denied';
    res.status(403).json({
      error: 'Forbidden',
      status: 403,
      message: 'Super-admin role is required for impersonation sessions',
    });
    return;
  }

  try {
    const session = await startImpersonationSession({
      actor: actingAdminAddress,
      apiKeyHash,
      targetWallet,
      reason,
      ipAddress,
      userAgent,
    });

    req.adminAuditAction = 'admin.impersonate.session.started';
    req.adminAuditMetadata = {
      ...req.adminAuditMetadata,
      sessionId: session.id,
      expiresAt: session.expiresAt,
    };

    res.status(201).json({ session });
  } catch (error) {
    req.adminAuditAction = 'admin.impersonate.session.failed';
    req.adminAuditMetadata = {
      ...req.adminAuditMetadata,
      error: error instanceof Error ? error.message : String(error),
    };
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: 'Failed to start impersonation session',
    });
  }
});

/**
 * GET /admin/impersonate/sessions - list active and historical impersonation sessions
 * Requires super-admin API key.
 */
router.get('/admin/impersonate/sessions', validateApiKey, async (req: Request, res: Response) => {
  const actingAdminAddress = resolveActingAdminAddress(req);

  req.adminAuditActor = actingAdminAddress;
  req.adminAuditMetadata = {
    actingAdminAddress,
    adminRole: req.authApiKeyRole || 'admin',
    impersonation: true,
  };

  if (!hasRequiredApiKeyRole(req, 'super-admin')) {
    req.adminAuditAction = 'admin.impersonate.session.list.denied';
    res.status(403).json({
      error: 'Forbidden',
      status: 403,
      message: 'Super-admin role is required to list impersonation sessions',
    });
    return;
  }

  const statusRaw = typeof req.query.status === 'string' ? req.query.status : 'all';
  const status =
    statusRaw === 'active' || statusRaw === 'ended' || statusRaw === 'expired' ? statusRaw : 'all';
  const actor = typeof req.query.actor === 'string' ? req.query.actor : undefined;
  const targetWallet = typeof req.query.targetWallet === 'string' ? req.query.targetWallet : undefined;
  const limit = parseLimited(req.query.limit, 50, 1, 200);

  try {
    const sessions = await listImpersonationSessions({
      status,
      actor,
      targetWallet,
      limit: limit + 1,
    });
    const { data, hasNextPage } = paginateByLimit(sessions, limit);

    req.adminAuditAction = 'admin.impersonate.session.list';
    sendStandardListEnvelope(res, {
      data,
      limit,
      hasNextPage,
      extras: {
        sessions: data,
        count: data.length,
      },
    });
  } catch (error) {
    req.adminAuditAction = 'admin.impersonate.session.list.failed';
    req.adminAuditMetadata = {
      ...req.adminAuditMetadata,
      error: error instanceof Error ? error.message : String(error),
    };
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: 'Failed to list impersonation sessions',
    });
  }
});

/**
 * DELETE /admin/impersonate/sessions/:id - end an active impersonation session
 * Requires super-admin API key.
 */
router.delete('/admin/impersonate/sessions/:id', validateApiKey, async (req: Request, res: Response) => {
  const actingAdminAddress = resolveActingAdminAddress(req);
  const sessionId = String(req.params.id || '').trim();

  req.adminAuditActor = actingAdminAddress;
  req.adminAuditMetadata = {
    actingAdminAddress,
    adminRole: req.authApiKeyRole || 'admin',
    sessionId: sessionId || 'unknown',
    impersonation: true,
  };

  if (!sessionId) {
    req.adminAuditAction = 'admin.impersonate.session.end.invalid';
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'session id is required',
    });
    return;
  }

  if (!hasRequiredApiKeyRole(req, 'super-admin')) {
    req.adminAuditAction = 'admin.impersonate.session.end.denied';
    res.status(403).json({
      error: 'Forbidden',
      status: 403,
      message: 'Super-admin role is required to end impersonation sessions',
    });
    return;
  }

  try {
    const session = await endImpersonationSession(sessionId, actingAdminAddress);
    if (!session) {
      req.adminAuditAction = 'admin.impersonate.session.end.not_found';
      res.status(404).json({
        error: 'Not Found',
        status: 404,
        message: 'Impersonation session not found or already expired',
      });
      return;
    }

    req.adminAuditAction = 'admin.impersonate.session.ended';
    res.status(200).json({ session });
  } catch (error) {
    req.adminAuditAction = 'admin.impersonate.session.end.failed';
    req.adminAuditMetadata = {
      ...req.adminAuditMetadata,
      error: error instanceof Error ? error.message : String(error),
    };
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: 'Failed to end impersonation session',
    });
  }
});

/**
 * GET /admin/impersonate/:wallet - inspect vault state as a specific wallet
 * Requires super-admin API key and a valid non-expired impersonation session.
 */
router.get('/admin/impersonate/:wallet', validateApiKey, async (req: Request, res: Response) => {
  const wallet = String(req.params.wallet || '').trim();
  const actingAdminAddress = resolveActingAdminAddress(req);
  const sessionId = String(req.get('x-impersonation-session-id') || '').trim();

  req.adminAuditActor = actingAdminAddress;
  req.adminAuditMetadata = {
    actingAdminAddress,
    adminRole: req.authApiKeyRole || 'admin',
    targetWallet: wallet || 'unknown',
    sessionId: sessionId || undefined,
    impersonation: true,
  };

  if (!wallet) {
    req.adminAuditAction = 'admin.impersonate.invalid';
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'wallet path parameter is required',
    });
    return;
  }

  if (!hasRequiredApiKeyRole(req, 'super-admin')) {
    req.adminAuditAction = 'admin.impersonate.denied';
    res.status(403).json({
      error: 'Forbidden',
      status: 403,
      message: 'Super-admin role is required for impersonation',
    });
    return;
  }

  if (!sessionId && process.env.IMPERSONATION_SESSION_STORAGE) {
    req.adminAuditAction = 'admin.impersonate.session.required';
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'x-impersonation-session-id header is required',
    });
    return;
  }

  try {
    let activeSession: ImpersonationSessionRecord | undefined;

    if (sessionId) {
      const validation = await validateImpersonationSession(sessionId, wallet, actingAdminAddress);
      if (!validation.ok) {
        const statusCode = validation.reason === 'not_found' ? 404 : 403;
        req.adminAuditAction =
          validation.reason === 'expired'
            ? 'admin.impersonate.session.expired'
            : validation.reason === 'ended'
              ? 'admin.impersonate.session.ended'
              : validation.reason === 'wallet_mismatch'
                ? 'admin.impersonate.session.wallet_mismatch'
                : validation.reason === 'actor_mismatch'
                  ? 'admin.impersonate.session.actor_mismatch'
                  : 'admin.impersonate.session.invalid';
        req.adminAuditMetadata = {
          ...req.adminAuditMetadata,
          validationReason: validation.reason,
        };
        res.status(statusCode).json({
          error: statusCode === 404 ? 'Not Found' : 'Forbidden',
          status: statusCode,
          message:
            validation.reason === 'expired'
              ? 'Impersonation session has expired'
              : validation.reason === 'ended'
                ? 'Impersonation session has ended'
                : validation.reason === 'wallet_mismatch'
                  ? 'Session wallet does not match target wallet'
                  : validation.reason === 'actor_mismatch'
                    ? 'Session actor does not match requesting admin'
                    : 'Impersonation session is invalid',
        });
        return;
      }
      activeSession = validation.session;
    }

    req.adminAuditAction = 'admin.impersonate';

    const vaultState = await buildImpersonatedVaultState(wallet);
    res.status(200).json({
      ...vaultState,
      impersonationSession: activeSession
        ? {
            id: activeSession.id,
            reason: activeSession.reason,
            startedAt: activeSession.startedAt,
            expiresAt: activeSession.expiresAt,
          }
        : undefined,
    });
  } catch (error) {
    req.adminAuditAction = 'admin.impersonate.failed';
    req.adminAuditMetadata = {
      ...req.adminAuditMetadata,
      error: error instanceof Error ? error.message : String(error),
    };
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: 'Failed to build impersonated vault state',
    });
  }
});

router.get('/admin/receipts', validateApiKey, async (req: Request, res: Response) => {
  const action = typeof req.query.action === 'string' ? req.query.action : undefined;
  const actor = typeof req.query.actor === 'string' ? req.query.actor : undefined;
  const limit = parseLimited(req.query.limit, 50, 1, 200);

  try {
    const receipts = await listAdminReceipts({ action, actor, limit: limit + 1 });
    const { data, hasNextPage } = paginateByLimit(receipts, limit);

    sendStandardListEnvelope(res, {
      data,
      limit,
      hasNextPage,
      extras: {
        receipts: data,
        count: data.length,
      },
    });
  } catch (err) {
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

/**
 * GET /admin/receipts/:id
 * Retrieves a specific admin action receipt.
 * Requires API key authentication.
 */
router.get('/admin/receipts/:id', validateApiKey, async (req: Request, res: Response) => {
  try {
    const receipt = await getAdminReceipt(req.params.id);
    if (!receipt) {
      res.status(404).json({ error: 'Receipt not found' });
      return;
    }
    res.json(receipt);
  } catch (err) {
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

/**
 * GET /admin/receipts/:id/verify
 * Verifies the integrity of an admin action receipt.
 * Requires API key authentication.
 */
router.get('/admin/receipts/:id/verify', validateApiKey, async (req: Request, res: Response) => {
  try {
    const receipt = await getAdminReceipt(req.params.id);
    if (!receipt) {
      res.status(404).json({ error: 'Receipt not found' });
      return;
    }

    const isValid = verifyReceiptSignature(receipt);
    res.json({
      id: receipt.id,
      isValid,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

/**
 * POST /admin/api-keys/register - Register a new API key
 * Requires API key authentication (for boostrapping, requires special permission)
 */
router.post('/admin/api-keys/register', validateApiKey, validate({ body: ApiKeyRegisterSchema }), async (req: Request, res: Response) => {
  const { key, role: requestedRole } = req.body;
  if (!key || typeof key !== 'string' || !key.trim()) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'Missing key in request body',
    });
    return;
  }

  const role = normalizeApiKeyRole(requestedRole) || 'admin';
  if (role === 'super-admin' && !hasRequiredApiKeyRole(req, 'super-admin')) {
    res.status(403).json({
      error: 'Forbidden',
      status: 403,
      message: 'Super-admin role is required to register super-admin API keys',
    });
    return;
  }

  const normalizedKey = key.trim();
  const hash = registerApiKey(normalizedKey, { role });

  try {
    await recordApiKeyAuditEvent({
      actor: resolveApiKeyAuditActor(req),
      action: API_KEY_AUDIT_ACTIONS.created,
      keyFingerprint: getApiKeyFingerprintFromHash(hash),
    });

    res.json({
      message: 'API key registered',
      hash,
      fingerprint: getApiKeyFingerprintFromHash(hash),
      role,
      created: new Date().toISOString(),
    });
  } catch (error) {
    revokeApiKey(hash);
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: error instanceof Error ? error.message : 'Failed to persist API key audit event',
    });
  }
});

/**
 * POST /admin/api-keys/rotate - Rotate an API key
 * Body: { oldHash: string, newKey: string }
 * Requires API key authentication.
 */
router.post('/admin/api-keys/rotate', validateApiKey, validate({ body: ApiKeyRotateSchema }), async (req: Request, res: Response) => {
  const { oldHash, newKey } = req.body || {};
  if (!isApiKeyHash(oldHash)) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'oldHash must be a valid SHA-256 API key hash',
    });
    return;
  }

  if (typeof newKey !== 'string' || !newKey.trim()) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'newKey is required',
    });
    return;
  }

  const previousMetadata = getApiKeyMetadata(oldHash);
  if (!previousMetadata) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'API key not found',
    });
    return;
  }

  const normalizedNewKey = newKey.trim();
  const newHash = rotateApiKey(oldHash, normalizedNewKey);
  if (!newHash) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'API key not found',
    });
    return;
  }

  try {
    await recordApiKeyAuditEvent({
      actor: resolveApiKeyAuditActor(req),
      action: API_KEY_AUDIT_ACTIONS.rotated,
      keyFingerprint: getApiKeyFingerprintFromValue(normalizedNewKey),
    });

    res.status(200).json({
      message: 'API key rotated',
      oldFingerprint: getApiKeyFingerprintFromHash(oldHash),
      newHash,
      newFingerprint: getApiKeyFingerprintFromHash(newHash),
      rotatedAt: new Date().toISOString(),
    });
  } catch (error) {
    revokeApiKey(newHash);
    restoreApiKey(oldHash);
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: error instanceof Error ? error.message : 'Failed to persist API key audit event',
    });
  }
});

/**
 * POST /admin/api-keys/revoke - Revoke an API key
 * Body: { hash: string }
 * Requires API key authentication.
 */
router.post('/admin/api-keys/revoke', validateApiKey, validate({ body: ApiKeyRevokeSchema }), async (req: Request, res: Response) => {
  const { hash } = req.body || {};
  if (!isApiKeyHash(hash)) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'hash must be a valid SHA-256 API key hash',
    });
    return;
  }

  const previousMetadata = getApiKeyMetadata(hash);
  if (!previousMetadata) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'API key not found',
    });
    return;
  }

  revokeApiKey(hash);

  try {
    await recordApiKeyAuditEvent({
      actor: resolveApiKeyAuditActor(req),
      action: API_KEY_AUDIT_ACTIONS.revoked,
      keyFingerprint: getApiKeyFingerprintFromHash(hash),
    });

    res.status(200).json({
      message: 'API key revoked',
      fingerprint: getApiKeyFingerprintFromHash(hash),
      revokedAt: new Date().toISOString(),
    });
  } catch (error) {
    restoreApiKey(hash);
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: error instanceof Error ? error.message : 'Failed to persist API key audit event',
    });
  }
});

/**
 * GET /admin/api-keys/audit-events - list API key lifecycle audit events
 * Supports ?action=created|rotated|revoked&from=<ISO or YYYY-MM-DD>&to=<ISO or YYYY-MM-DD>&limit=N
 */
router.get('/admin/api-keys/audit-events', validateApiKey, async (req: Request, res: Response) => {
  const rawAction = typeof req.query.action === 'string' ? req.query.action : undefined;
  const action =
    rawAction === API_KEY_AUDIT_ACTIONS.created ||
    rawAction === API_KEY_AUDIT_ACTIONS.rotated ||
    rawAction === API_KEY_AUDIT_ACTIONS.revoked
      ? rawAction
      : undefined;

  if (rawAction && !action) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'action must be one of: created, rotated, revoked',
    });
    return;
  }

  try {
    const range = parseUtcDateRange({
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined,
    });
    const limit = parseLimited(req.query.limit, 50, 1, 200);
    const events = await listApiKeyAuditEvents({
      action,
      start: range.start,
      end: range.end,
      limit: limit + 1,
    });
    const { data, hasNextPage } = paginateByLimit(events, limit);

    sendStandardListEnvelope(res, {
      data,
      limit,
      hasNextPage,
      extras: {
        events: data,
        meta: {
          count: data.length,
          limit,
          filters: {
            action: action || null,
            from: range.start || null,
            to: range.end || null,
          },
          timestamp: new Date().toISOString(),
        },
      },
    });
  } catch (error) {
    if (error instanceof DateRangeParseError) {
      res.status(error.status).json({
        error: 'Bad Request',
        status: error.status,
        message: error.message,
      });
      return;
    }

    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: error instanceof Error ? error.message : 'Failed to read API key audit events',
    });
  }
});

/**
 * GET /admin/audit/logs - list admin activity logs
 */
router.get('/admin/audit/logs', validateApiKey, validate({ query: AuditLogQuerySchema }), (req: Request, res: Response) => {
  const statusCode = req.query.statusCode ? parseInt(String(req.query.statusCode), 10) : undefined;
  const limit = parseLimited(req.query.limit, 100, 1, 500);
  const page = parseLimited(req.query.page, 1, 1, 1000000);
  const offset = (page - 1) * limit;
  const filters = {
    actor: req.query.actor ? String(req.query.actor) : undefined,
    action: req.query.action ? String(req.query.action) : undefined,
    path: req.query.path ? String(req.query.path) : undefined,
    statusCode,
    from: req.query.from ? String(req.query.from) : undefined,
    to: req.query.to ? String(req.query.to) : undefined,
  };

  const logs = getAuditLogs({ ...filters, limit: limit + 1, offset });
  const { data, hasNextPage } = paginateByLimit(logs, limit);

  sendStandardListEnvelope(res, {
    data,
    limit,
    hasNextPage,
    extras: {
      logs: data,
      page,
      total: countAuditLogs(filters),
      metrics: getAuditLogMetrics(),
    },
  });
});

/**
 * GET /admin/audit-logs - list admin audit entries (Issue #253)
 */
router.get('/admin/audit-logs', validateApiKey, validate({ query: AuditLogQuerySchema }), async (req: Request, res: Response) => {
  const limit = parseLimited(req.query.limit, 50, 1, 200);
  const page = parseLimited(req.query.page, 1, 1, 1000000);
  const offset = (page - 1) * limit;
  const statusValue = req.query.statusCode ?? req.query.status;
  const statusCode = statusValue
    ? parseLimited(statusValue, 0, 100, 599)
    : undefined;
  const filters = {
    action: typeof req.query.action === 'string'
      ? req.query.action
      : typeof req.query.type === 'string' ? req.query.type : undefined,
    actor: typeof req.query.actor === 'string' ? req.query.actor : undefined,
    path: typeof req.query.path === 'string' ? req.query.path : undefined,
    statusCode,
    from: typeof req.query.from === 'string' ? req.query.from : undefined,
    to: typeof req.query.to === 'string' ? req.query.to : undefined,
  };

  const rows = getAuditLogs({ ...filters, limit: limit + 1, offset });
  const { data, hasNextPage } = paginateByLimit(rows, limit);

  void recordAdminAuditLog(req, 'audit-logs.read', 200, {
    limit,
    returned: data.length,
  });

  sendStandardListEnvelope(res, {
    data,
    limit,
    hasNextPage,
    extras: {
      meta: {
        count: data.length,
        total: countAuditLogs(filters),
        page,
        limit,
        timestamp: new Date().toISOString(),
      },
    },
  });
});

/**
 * GET /admin/prisma/config - operational prisma runtime settings (Issue #254)
 */
router.get('/admin/prisma/config', validateApiKey, (_req: Request, res: Response) => {
  res.status(200).json({
    config: getPrismaConfig(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/jobs/monitor - structured JSON for background jobs/webhook workers
 */
router.get('/admin/jobs/monitor', validateApiKey, (_req: Request, res: Response) => {
  res.status(200).json({
    jobHealth: getJobHealthStatus(),
    jobs: getJobMetrics(),
    webhooks: getWebhookDeliveryMetrics(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/jobs/metrics - JSON metrics dashboard for background jobs (Issue #255)
 */
router.get('/admin/jobs/metrics', validateApiKey, (req: Request, res: Response) => {
  const metrics = getJobMetrics();
  const summary = {
    totalDeadLetters: metrics.totalDeadLetters,
    recurringFailureJobs: Object.keys(metrics.recurringFailures),
    jobHealth: getJobHealthStatus(),
    activeJobs: Object.values(metrics.runtime).filter((job) => job.inFlight > 0).length,
  };

  void recordAdminAuditLog(req, 'jobs.metrics.read', 200);

  res.json({
    summary,
    metrics,
    prisma: getPrismaRuntimeConfig(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/governance/snapshots - list historical governance snapshots
 */
router.get('/admin/governance/snapshots', validateApiKey, async (req: Request, res: Response) => {
  const limit = parseLimited(req.query.limit, 50, 1, 500);
  const offset = parseLimited(req.query.offset, 0, 0, 10_000);
  const type = typeof req.query.type === 'string' ? req.query.type : undefined;
  const start = typeof req.query.start === 'string' ? req.query.start : undefined;
  const end = typeof req.query.end === 'string' ? req.query.end : undefined;

  const result = await listGovernanceSnapshots({
    type: type as 'reconciliation' | 'config-change' | 'export-manifest' | undefined,
    start,
    end,
    limit,
    offset,
  });

  res.status(200).json({
    data: result.data,
    total: result.total,
    limit,
    offset,
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /admin/governance/snapshots/export - export historical governance snapshots
 */
router.post('/admin/governance/snapshots/export', validateApiKey, validate({ body: GovernanceSnapshotExportSchema }), async (req: Request, res: Response) => {
  const requester = resolveActingAdminAddress(req);
  const types = Array.isArray(req.body?.types)
    ? (req.body.types as string[])
    : undefined;
  const start = typeof req.body?.start === 'string' ? req.body.start : undefined;
  const end = typeof req.body?.end === 'string' ? req.body.end : undefined;
  const limit = parseLimited(req.body?.limit, 500, 1, 5000);

  const { manifest, rows } = await exportGovernanceSnapshots({
    requester,
    types: types as ('reconciliation' | 'config-change' | 'export-manifest')[] | undefined,
    start,
    end,
    limit,
  });

  res.status(201).json({
    message: 'Governance snapshot export generated',
    rowCount: rows.length,
    manifest,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/jobs/dashboard - comprehensive HTML dashboard for operators to monitor jobs and DLQ
 */
router.get('/admin/jobs/dashboard', validateApiKey, async (_req: Request, res: Response) => {
  const jobMetrics = getJobMetrics();
  const webhookMetrics = getWebhookDeliveryMetrics();
  const dlqRecords = listDeadLetters({ status: 'dead-letter', limit: 10 });

  const jobsByStatus = {
    'dead-letter': dlqRecords.records.filter((r) => r.status === 'dead-letter').length,
    'requeued': dlqRecords.records.filter((r) => r.status === 'requeued').length,
    'resolved': dlqRecords.records.filter((r) => r.status === 'resolved').length,
    'discarded': dlqRecords.records.filter((r) => r.status === 'discarded').length,
  };

  const recurringFailures = Object.entries(jobMetrics.recurringFailures || {})
    .map(([jobName, count]) => `${jobName} (${count} failures)`)
    .join(', ') || 'None';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>YieldVault Job Dashboard</title>
        <style>
          * { box-sizing: border-box; }
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif; 
            margin: 0; 
            padding: 2rem; 
            background: #f6f8fa; 
            color: #0f172a; 
          }
          .container { max-width: 1400px; margin: 0 auto; }
          h1 { margin: 0 0 1.5rem 0; font-size: 2rem; }
          h2 { margin: 2rem 0 1rem 0; font-size: 1.3rem; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.5rem; }
          .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
          .card { 
            background: #ffffff; 
            border: 1px solid #dbe3ec; 
            border-radius: 10px; 
            padding: 1.25rem; 
            box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
            transition: box-shadow 0.2s;
          }
          .card:hover { box-shadow: 0 4px 12px rgba(15, 23, 42, 0.15); }
          .card.status-up { border-left: 4px solid #22c55e; }
          .card.status-degraded { border-left: 4px solid #f59e0b; }
          .card.status-down { border-left: 4px solid #ef4444; }
          .label { color: #64748b; font-size: 0.875rem; margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.5px; }
          .value { font-size: 2rem; font-weight: 700; }
          .subvalue { color: #64748b; font-size: 0.9rem; margin-top: 0.25rem; }
          .status-badge {
            display: inline-block;
            padding: 0.25rem 0.75rem;
            border-radius: 20px;
            font-size: 0.875rem;
            font-weight: 600;
          }
          .status-up { background: #d1fae5; color: #065f46; }
          .status-degraded { background: #fef3c7; color: #92400e; }
          .status-down { background: #fee2e2; color: #991b1b; }
          .table-section { background: #ffffff; border: 1px solid #dbe3ec; border-radius: 10px; padding: 1.5rem; margin-bottom: 2rem; }
          table { width: 100%; border-collapse: collapse; }
          th { text-align: left; padding: 0.75rem; border-bottom: 2px solid #e2e8f0; font-weight: 600; color: #64748b; }
          td { padding: 0.75rem; border-bottom: 1px solid #f1f5f9; }
          tr:hover { background: #f9fafb; }
          pre { 
            background: #1e293b; 
            color: #e2e8f0; 
            padding: 1rem; 
            border-radius: 8px; 
            overflow: auto; 
            font-size: 0.875rem;
            line-height: 1.5;
          }
          .alert { 
            padding: 1rem; 
            border-radius: 8px; 
            margin-bottom: 1rem; 
          }
          .alert-warning { background: #fef3c7; border: 1px solid #fcd34d; color: #92400e; }
          .alert-info { background: #dbeafe; border: 1px solid #93c5fd; color: #1e40af; }
          .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
          a { color: #0066cc; text-decoration: none; }
          a:hover { text-decoration: underline; }
          button { 
            padding: 0.5rem 1rem; 
            border: 1px solid #dbe3ec; 
            background: #ffffff; 
            border-radius: 6px; 
            cursor: pointer; 
            font-size: 0.875rem;
          }
          button:hover { background: #f1f5f9; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🎯 Background Job Monitoring Dashboard</h1>
          
          <div class="grid">
            <div class="card status-${getJobHealthStatus() === 'up' ? 'up' : 'degraded'}">
              <div class="label">Overall Health</div>
              <div class="value"><span class="status-badge status-${getJobHealthStatus() === 'up' ? 'up' : 'degraded'}">${getJobHealthStatus().toUpperCase()}</span></div>
            </div>
            <div class="card">
              <div class="label">Dead-Letter Records</div>
              <div class="value">${jobMetrics.totalDeadLetters}</div>
              <div class="subvalue">${dlqRecords.total} total (pending: ${jobsByStatus['dead-letter']})</div>
            </div>
            <div class="card">
              <div class="label">Webhook Endpoints</div>
              <div class="value">${webhookMetrics.totalEndpoints}</div>
              <div class="subvalue">Failed: ${webhookMetrics.failed}</div>
            </div>
            <div class="card">
              <div class="label">Recurring Failures</div>
              <div class="value">${Object.keys(jobMetrics.recurringFailures || {}).length}</div>
              <div class="subvalue" style="font-size: 0.8rem;">${recurringFailures}</div>
            </div>
          </div>

          ${jobMetrics.totalDeadLetters > 0 ? `
            <div class="alert alert-warning">
              ⚠️ <strong>${jobMetrics.totalDeadLetters} dead-letter records pending</strong>. 
              Review and retry failed jobs or mark them as resolved.
            </div>
          ` : ''}

          <h2>📊 Job Runtime Metrics</h2>
          <div class="table-section">
            <table>
              <thead>
                <tr>
                  <th>Job Name</th>
                  <th>Total Runs</th>
                  <th>Successful</th>
                  <th>Failed</th>
                  <th>In Flight</th>
                  <th>Avg Duration (ms)</th>
                  <th>Last Run</th>
                </tr>
              </thead>
              <tbody>
                ${Object.entries(jobMetrics.runtime || {})
                  .map(([jobName, metrics]) => `
                    <tr>
                      <td><strong>${jobName}</strong></td>
                      <td>${metrics.totalRuns}</td>
                      <td style="color: #16a34a;">${metrics.successfulRuns}</td>
                      <td style="color: ${metrics.failedRuns > 0 ? '#dc2626' : '#64748b'};">${metrics.failedRuns}</td>
                      <td>${metrics.inFlight}</td>
                      <td>${metrics.averageDurationMs}</td>
                      <td>${metrics.lastRunAt ? new Date(metrics.lastRunAt).toLocaleString() : 'Never'}</td>
                    </tr>
                  `)
                  .join('')}
              </tbody>
            </table>
          </div>

          <h2>🔄 Recent Dead-Letter Records</h2>
          <div class="table-section">
            ${dlqRecords.records.length > 0 ? `
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Job</th>
                    <th>Status</th>
                    <th>Attempts</th>
                    <th>Error</th>
                    <th>Failed At</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${dlqRecords.records.slice(0, 10).map((record) => `
                    <tr>
                      <td><code style="font-size: 0.8rem;">${record.id}</code></td>
                      <td>${record.jobName}</td>
                      <td><span class="status-badge ${record.status === 'dead-letter' ? 'status-down' : record.status === 'requeued' ? 'status-up' : 'status-degraded'}">${record.status}</span></td>
                      <td>${record.attempts}</td>
                      <td style="max-width: 300px; overflow: auto;"><code style="font-size: 0.75rem;">${record.error}</code></td>
                      <td>${new Date(record.failedAt).toLocaleString()}</td>
                      <td class="actions">
                        <a href="/admin/jobs/dead-letters/${record.id}">View</a> | 
                        <a href="/admin/jobs/dead-letters/${record.id}/retry">Retry</a>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            ` : `
              <p style="color: #64748b; text-align: center; padding: 2rem;">No dead-letter records (great job!)</p>
            `}
          </div>

          <h2>📡 API Endpoints</h2>
          <div class="table-section">
            <p style="margin-top: 0;">Use these endpoints to manage dead-letter queue records:</p>
            <table style="font-size: 0.9rem;">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Endpoint</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>GET</strong></td>
                  <td><code>/admin/jobs/dead-letters</code></td>
                  <td>List all dead-letter records with optional filters</td>
                </tr>
                <tr>
                  <td><strong>GET</strong></td>
                  <td><code>/admin/jobs/dead-letters/:id</code></td>
                  <td>Retrieve a specific dead-letter record</td>
                </tr>
                <tr>
                  <td><strong>POST</strong></td>
                  <td><code>/admin/jobs/dead-letters/:id/retry</code></td>
                  <td>Retry a failed job (supports ?dryRun=true)</td>
                </tr>
                <tr>
                  <td><strong>POST</strong></td>
                  <td><code>/admin/jobs/dead-letters/:id/resolve</code></td>
                  <td>Mark a job as manually resolved with notes</td>
                </tr>
                <tr>
                  <td><strong>DELETE</strong></td>
                  <td><code>/admin/jobs/dead-letters/:id</code></td>
                  <td>Discard a dead-letter record</td>
                </tr>
                <tr>
                  <td><strong>POST</strong></td>
                  <td><code>/admin/jobs/dead-letters/bulk-retry</code></td>
                  <td>Bulk retry multiple records (body: {ids: []})</td>
                </tr>
                <tr>
                  <td><strong>POST</strong></td>
                  <td><code>/admin/jobs/dead-letters/bulk-discard</code></td>
                  <td>Bulk discard multiple records (body: {ids: []})</td>
                </tr>
                <tr>
                  <td><strong>POST</strong></td>
                  <td><code>/admin/jobs/dead-letters/process</code></td>
                  <td>Trigger batch processing worker (body: {batchSize?: 10})</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h2>📋 Full Metrics JSON</h2>
          <details>
            <summary style="cursor: pointer; font-weight: 600; padding: 0.5rem; margin-bottom: 0.5rem;">Click to expand full metrics</summary>
            <pre>${JSON.stringify(jobMetrics, null, 2)}</pre>
          </details>

          <hr style="margin: 2rem 0; border: none; border-top: 1px solid #e2e8f0;" />
          <p style="color: #64748b; font-size: 0.875rem;">
            Last updated: ${new Date().toISOString()} | 
            <a href="/admin/jobs/metrics">JSON API</a>
          </p>
        </div>
      </body>
    </html>
  `);
});

// ─── Dead-Letter Queue Admin Endpoints ─────────────────────────────────────

/**
 * GET /admin/jobs/metrics
 * Returns background job runtime and governance metrics.
 */
router.get('/admin/jobs/metrics', validateApiKey, (_req: Request, res: Response) => {
  const metrics = getJobMetrics();
  const health = getJobHealthStatus();

  res.status(200).json({
    summary: { health },
    metrics,
    prisma: getPrismaConfig(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/jobs/dead-letters
 * Lists dead-letter queue records with optional filtering (jobName, status, limit, offset).
 * Requires API key authentication.
 */
router.get('/admin/jobs/dead-letters', validateApiKey, (req: Request, res: Response) => {
  const jobName = typeof req.query.jobName === 'string' ? (req.query.jobName as JobName) : undefined;
  const status = typeof req.query.status === 'string' ? (req.query.status as DeadLetterStatus) : undefined;
  const limit = parseLimited(req.query.limit, 50, 1, 500);
  const offset = parseLimited(req.query.offset, 0, 0, 10000);

  const { records, total } = listDeadLetters({ jobName, status, limit, offset });

  res.status(200).json({
    data: records,
    total,
    limit,
    offset,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/jobs/dead-letters/:id
 * Retrieves a single dead-letter record by ID.
 * Requires API key authentication.
 */
router.get('/admin/jobs/dead-letters/:id', validateApiKey, (req: Request, res: Response) => {
  const record = getDeadLetterRecord(req.params.id);
  if (!record) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'Dead-letter record not found',
    });
    return;
  }

  res.status(200).json({
    record,
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /admin/jobs/dead-letters/:id/retry
 * Retries a single dead-letter queue entry.
 * Supports dryRun flag.
 * Requires API key authentication.
 */
router.post('/admin/jobs/dead-letters/:id/retry', validateApiKey, async (req: Request, res: Response) => {
  const record = getDeadLetterRecord(req.params.id);
  if (!record) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'Dead-letter record not found',
    });
    return;
  }

  const actor = resolveActingAdminAddress(req);

  if (isDryRunRequest(req)) {
    void recordAdminAuditLog(req, 'jobs.dlq.retry.dry_run', 200, {
      id: req.params.id,
      jobName: record.jobName,
      actor,
    });

    res.status(200).json({
      dryRun: true,
      message: `Dead-letter record '${req.params.id}' (${record.jobName}) would be retried`,
      record,
      wouldRetry: true,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const outcome = await retryDeadLetter(req.params.id);
  void recordAdminAuditLog(req, 'jobs.dlq.retry', outcome.success ? 200 : 500, {
    id: req.params.id,
    jobName: record.jobName,
    success: outcome.success,
    actor,
    error: outcome.error,
  });

  if (!outcome.success) {
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: outcome.error || 'Failed to retry dead-letter record',
      record: outcome.record,
    });
    return;
  }

  res.status(200).json({
    message: 'Dead-letter record retried successfully',
    result: outcome.result,
    record: outcome.record,
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /admin/jobs/dead-letters/:id/resolve
 * Marks a dead-letter entry as manually resolved.
 * Body: { notes?: string }
 * Requires API key authentication.
 */
router.post('/admin/jobs/dead-letters/:id/resolve', validateApiKey, validate({ params: IdParamSchema, body: DeadLetterResolveSchema }), async (req: Request, res: Response) => {
  const actor = resolveActingAdminAddress(req);
  const notes = typeof req.body?.notes === 'string' ? req.body.notes : undefined;

  const record = resolveDeadLetter(req.params.id, actor, notes);
  if (!record) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'Dead-letter record not found',
    });
    return;
  }

  void recordAdminAuditLog(req, 'jobs.dlq.resolve', 200, {
    id: req.params.id,
    jobName: record.jobName,
    actor,
    notes,
  });

  res.status(200).json({
    message: 'Dead-letter record resolved successfully',
    record,
    timestamp: new Date().toISOString(),
  });
});

/**
 * DELETE /admin/jobs/dead-letters/:id
 * Discards a dead-letter record from the queue.
 * Requires API key authentication.
 */
router.delete('/admin/jobs/dead-letters/:id', validateApiKey, (req: Request, res: Response) => {
  const actor = resolveActingAdminAddress(req);

  if (isDryRunRequest(req)) {
    const existing = getDeadLetterRecord(req.params.id);
    res.status(existing ? 200 : 404).json({
      dryRun: true,
      message: existing
        ? `Dead-letter record '${req.params.id}' would be discarded`
        : `Dead-letter record '${req.params.id}' not found`,
      id: req.params.id,
      wouldDiscard: Boolean(existing),
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const record = discardDeadLetter(req.params.id, actor);
  if (!record) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'Dead-letter record not found',
    });
    return;
  }

  void recordAdminAuditLog(req, 'jobs.dlq.discard', 200, {
    id: req.params.id,
    jobName: record.jobName,
    actor,
  });

  res.status(200).json({
    message: 'Dead-letter record discarded successfully',
    record,
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /admin/jobs/dead-letters/bulk-retry
 * Bulk retries multiple dead-letter records.
 * Body: { ids: string[] }
 * Requires API key authentication.
 */
router.post('/admin/jobs/dead-letters/bulk-retry', validateApiKey, validate({ body: DeadLetterIdsSchema }), async (req: Request, res: Response) => {
  const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : [];

  if (ids.length === 0) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: '`ids` array must not be empty',
    });
    return;
  }

  const actor = resolveActingAdminAddress(req);

  if (isDryRunRequest(req)) {
    res.status(200).json({
      dryRun: true,
      message: `Bulk retry preview for ${ids.length} dead-letter records`,
      ids,
      wouldRetryCount: ids.length,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const summary = await bulkRetryDeadLetters(ids);

  void recordAdminAuditLog(req, 'jobs.dlq.bulk_retry', 200, {
    requestedCount: ids.length,
    retried: summary.retried,
    failed: summary.failed,
    actor,
  });

  res.status(200).json({
    message: 'Bulk retry completed',
    retried: summary.retried,
    failed: summary.failed,
    results: summary.results,
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /admin/jobs/dead-letters/bulk-discard
 * Bulk discards multiple dead-letter records.
 * Body: { ids: string[] }
 * Requires API key authentication.
 */
router.post('/admin/jobs/dead-letters/bulk-discard', validateApiKey, validate({ body: DeadLetterIdsSchema }), (req: Request, res: Response) => {
  const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : [];

  if (ids.length === 0) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: '`ids` array must not be empty',
    });
    return;
  }

  const actor = resolveActingAdminAddress(req);

  if (isDryRunRequest(req)) {
    res.status(200).json({
      dryRun: true,
      message: `Bulk discard preview for ${ids.length} dead-letter records`,
      ids,
      wouldDiscardCount: ids.length,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const summary = bulkDiscardDeadLetters(ids);

  void recordAdminAuditLog(req, 'jobs.dlq.bulk_discard', 200, {
    requestedCount: ids.length,
    discardedCount: summary.discarded,
    actor,
  });

  res.status(200).json({
    message: 'Bulk discard completed',
    discardedCount: summary.discarded,
    ids: summary.ids,
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /admin/jobs/dead-letters/process
 * Triggers batch processing worker for dead-letter records.
 * Body: { batchSize?: number }
 * Requires API key authentication.
 */
router.post('/admin/jobs/dead-letters/process', validateApiKey, validate({ body: DeadLetterProcessSchema }), async (req: Request, res: Response) => {
  const batchSize = typeof req.body?.batchSize === 'number' && req.body.batchSize > 0 ? req.body.batchSize : 10;
  const actor = resolveActingAdminAddress(req);

  if (isDryRunRequest(req)) {
    res.status(200).json({
      dryRun: true,
      message: `DLQ processor dry-run preview for batchSize ${batchSize}`,
      batchSize,
      wouldProcess: true,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const summary = await processDeadLetterQueue(batchSize);

  void recordAdminAuditLog(req, 'jobs.dlq.process', 200, {
    batchSize,
    processed: summary.processed,
    succeeded: summary.succeeded,
    failed: summary.failed,
    actor,
  });

  res.status(200).json({
    message: 'DLQ queue processing batch completed',
    batchSize,
    processed: summary.processed,
    succeeded: summary.succeeded,
    failed: summary.failed,
    timestamp: new Date().toISOString(),
  });
});

// â”€â”€â”€ Idempotency Admin Endpoints (Issues #457 & #466) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * GET /admin/idempotency/keys
 * Lists idempotency keys with metadata.
 * Optional query param: ?prefix=<string> to filter keys by prefix.
 * Requires API key authentication.
 */
router.get('/admin/idempotency/keys', validateApiKey, (req: Request, res: Response) => {
  const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : undefined;
  const keys = idempotencyStore.inspectKeys(prefix);
  res.status(200).json({
    keys,
    count: keys.length,
    metrics: idempotencyStore.getMetrics(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * DELETE /admin/idempotency/keys/:key
 * Removes a single idempotency key from the store.
 * Requires API key authentication.
 */
router.delete('/admin/idempotency/keys/:key', validateApiKey, (req: Request, res: Response) => {
  const key = decodeURIComponent(req.params.key);
  if (isDryRunRequest(req)) {
    const exists = idempotencyStore.inspectKeys().some((entry) => entry.key === key);
    res.status(exists ? 200 : 404).json({
      dryRun: true,
      message: exists
        ? `Idempotency key '${key}' would be deleted`
        : `Idempotency key '${key}' not found`,
      key,
      wouldDelete: exists,
      metrics: idempotencyStore.getMetrics(),
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const deleted = idempotencyStore.deleteKey(key);
  if (!deleted) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: `Idempotency key '${key}' not found`,
    });
    return;
  }
  res.status(200).json({
    message: `Idempotency key '${key}' deleted`,
    metrics: idempotencyStore.getMetrics(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/idempotency/retention/metrics
 * Returns idempotency retention policy and sweep metrics.
 */
router.get('/admin/idempotency/retention/metrics', validateApiKey, (_req: Request, res: Response) => {
  res.status(200).json({
    metrics: getIdempotencyRetentionMetrics(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /admin/idempotency/retention/cleanup
 * Runs a retention sweep for stale idempotency records.
 */
router.post('/admin/idempotency/retention/cleanup', validateApiKey, async (req: Request, res: Response) => {
  const dryRun = isDryRunRequest(req);
  const result = await pruneStaleIdempotencyRecords(dryRun);
  res.status(200).json({
    ...result,
    metrics: getIdempotencyRetentionMetrics(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * DELETE /admin/idempotency/keys
 * Flushes the entire idempotency store.
 * Requires super-admin API key.
 */
router.delete('/admin/idempotency/keys', validateApiKey, (req: Request, res: Response) => {
  if (!hasRequiredApiKeyRole(req, 'super-admin')) {
    res.status(403).json({
      error: 'Forbidden',
      status: 403,
      message: 'Super-admin role is required to flush the idempotency store',
    });
    return;
  }
  if (isDryRunRequest(req)) {
    const keys = idempotencyStore.inspectKeys();
    res.status(200).json({
      dryRun: true,
      message: 'Idempotency store flush dry-run preview',
      wouldFlush: true,
      keyCount: keys.length,
      metrics: idempotencyStore.getMetrics(),
      timestamp: new Date().toISOString(),
    });
    return;
  }

  idempotencyStore.clear();
  res.status(200).json({
    message: 'Idempotency store flushed',
    metrics: idempotencyStore.getMetrics(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/idempotency/metrics
 * Returns hit/conflict/eviction counters for the idempotency store.
 * Requires API key authentication.
 */
router.get('/admin/idempotency/metrics', validateApiKey, (_req: Request, res: Response) => {
  res.status(200).json({
    metrics: idempotencyStore.getMetrics(),
    timestamp: new Date().toISOString(),
  });
});

// â”€â”€â”€ Wallet Activity Heatmap Endpoint (Issue #712) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * GET /admin/analytics/wallet-activity/heatmap
 *
 * Returns aggregated wallet activity counts bucketed by calendar date for use
 * in admin analytics dashboards.  Raw wallet records are never exposed; only
 * the per-bucket counts and the summary statistics are returned.
 *
 * Query parameters:
 *   from        ISO-8601 date or datetime (inclusive).  Defaults to 30 days ago.
 *   to          ISO-8601 date or datetime (inclusive).  Defaults to today.
 *   granularity day | week | month.  Defaults to day.
 *   walletAddress  Optional address to scope results to a single wallet.
 *
 * Requires API key authentication.
 */
router.get('/admin/analytics/wallet-activity/heatmap', validateApiKey, async (req: Request, res: Response) => {
  const granularity =
    req.query.granularity === 'week' || req.query.granularity === 'month'
      ? (req.query.granularity as 'week' | 'month')
      : 'day';

  let rangeStart: string;
  let rangeEnd: string;

  try {
    const parsed = parseUtcDateRange({
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined,
    });
    const defaultStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const defaultEnd = new Date().toISOString().slice(0, 10);
    rangeStart = parsed.start ?? defaultStart;
    rangeEnd = parsed.end ?? defaultEnd;
  } catch (error) {
    if (error instanceof DateRangeParseError) {
      res.status(error.status).json({
        error: 'Bad Request',
        status: error.status,
        message: error.message,
      });
      return;
    }
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: error instanceof Error ? error.message : 'Failed to parse date range',
    });
    return;
  }

  const walletAddress =
    typeof req.query.walletAddress === 'string' && req.query.walletAddress.trim()
      ? normalizeWalletAddress(req.query.walletAddress.trim())
      : undefined;

  try {
    const where: Record<string, unknown> = {
      timestamp: {
        gte: new Date(rangeStart + 'T00:00:00.000Z'),
        lte: new Date(rangeEnd + 'T23:59:59.999Z'),
      },
    };

    if (walletAddress) {
      where.user = walletAddress;
    }

    const transactions = await prisma.transaction.findMany({
      where: where as any,
      select: { timestamp: true },
      orderBy: { timestamp: 'asc' },
    });

    const bucketKey = (date: Date, g: 'day' | 'week' | 'month'): string => {
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, '0');
      const d = String(date.getUTCDate()).padStart(2, '0');
      if (g === 'month') return `${y}-${m}`;
      if (g === 'week') {
        const dayOfWeek = date.getUTCDay();
        const mondayOffset = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek) * 86400000;
        const monday = new Date(date.getTime() + mondayOffset);
        const wy = monday.getUTCFullYear();
        const wm = String(monday.getUTCMonth() + 1).padStart(2, '0');
        const wd = String(monday.getUTCDate()).padStart(2, '0');
        return `${wy}-${wm}-${wd}`;
      }
      return `${y}-${m}-${d}`;
    };

    const buckets = new Map<string, number>();
    for (const tx of transactions) {
      const key = bucketKey(new Date(tx.timestamp), granularity);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }

    const heatmap = Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, count]) => ({ bucket, count }));

    const totalActivity = heatmap.reduce((sum, b) => sum + b.count, 0);
    const peakBucket = heatmap.reduce(
      (max, b) => (b.count > (max?.count ?? -1) ? b : max),
      null as { bucket: string; count: number } | null,
    );

    res.status(200).json({
      heatmap,
      summary: {
        totalActivity,
        bucketCount: heatmap.length,
        granularity,
        rangeStart,
        rangeEnd,
        walletAddress: walletAddress ?? null,
        peakBucket: peakBucket ?? null,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: error instanceof Error ? error.message : 'Failed to aggregate wallet activity',
    });
  }
});

// â”€â”€â”€ Write-Ahead Audit Log Endpoints (Issue #707) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/**
 * GET /admin/wal/entries
 * Lists write-ahead audit log entries with optional filters.
 */
router.get('/admin/wal/entries', validateApiKey, async (req: Request, res: Response) => {
  const configType = typeof req.query.configType === 'string' ? req.query.configType : undefined;
  const actor = typeof req.query.actor === 'string' ? req.query.actor : undefined;
  const status = typeof req.query.status === 'string' ? req.query.status as 'pending' | 'committed' | 'rolled_back' : undefined;
  const limit = parseLimited(req.query.limit, 50, 1, 200);

  try {
    const entries = await writeAheadAuditLog.list({ configType, actor, status, limit });
    const metrics = await writeAheadAuditLog.getMetrics();

    res.status(200).json({
      entries,
      count: entries.length,
      metrics,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: error instanceof Error ? error.message : 'Failed to list write-ahead audit log entries',
    });
  }
});

/**
 * GET /admin/wal/entries/:id
 * Returns a specific write-ahead audit log entry.
 */
router.get('/admin/wal/entries/:id', validateApiKey, async (req: Request, res: Response) => {
  try {
    const entry = await writeAheadAuditLog.getEntry(req.params.id);
    if (!entry) {
      res.status(404).json({
        error: 'Not Found',
        status: 404,
        message: 'Write-ahead audit log entry not found',
      });
      return;
    }
    res.status(200).json({ entry });
  } catch (error) {
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: error instanceof Error ? error.message : 'Failed to fetch write-ahead audit log entry',
    });
  }
});

/**
 * GET /admin/wal/metrics
 * Returns metrics for the write-ahead audit log.
 */
router.get('/admin/wal/metrics', validateApiKey, async (_req: Request, res: Response) => {
  try {
    const metrics = await writeAheadAuditLog.getMetrics();
    res.status(200).json({
      metrics,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: error instanceof Error ? error.message : 'Failed to fetch write-ahead audit log metrics',
    });
  }
});

/**
 * GET /admin/wal/pending
 * Returns currently pending (uncommitted) write-ahead entries.
 */
router.get('/admin/wal/pending', validateApiKey, async (_req: Request, res: Response) => {
  try {
    const pending = await writeAheadAuditLog.getPendingEntries();
    res.status(200).json({
      entries: pending,
      count: pending.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: error instanceof Error ? error.message : 'Failed to fetch pending write-ahead audit log entries',
    });
  }
});

// ─── Scoped Admin Token Endpoints (Issue #723 / #858) ───────────────────────
// All endpoints are async – store operations now hit Prisma for cluster-wide durability.

/**
 * GET /admin/scoped-tokens/permissions
 * Returns the list of valid permissions for scoped tokens.
 * Must be registered before /:keyId routes to avoid shadowing.
 */
router.get('/admin/scoped-tokens/permissions', validateApiKey, (_req: Request, res: Response) => {
  res.status(200).json({
    permissions: scopedAdminTokenStore.getValidPermissions(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /admin/scoped-tokens
 * Creates a new permission-scoped admin token.
 * Requires super-admin API key.
 * Returns the plaintext secret once; it is never stored.
 */
router.post('/admin/scoped-tokens', validateApiKey, validate({ body: ScopedTokenCreateSchema }), async (req: Request, res: Response) => {
  if (!hasRequiredApiKeyRole(req, 'super-admin')) {
    res.status(403).json({ error: 'Forbidden', status: 403, message: 'Super-admin role is required to create scoped tokens' });
    return;
  }
  const { label, permissions, expiresInSeconds } = req.body;
  if (typeof label !== 'string' || !label.trim()) {
    res.status(400).json({ error: 'Bad Request', status: 400, message: '`label` (string) is required' });
    return;
  }
  if (!Array.isArray(permissions) || permissions.length === 0) {
    res.status(400).json({ error: 'Bad Request', status: 400, message: '`permissions` (non-empty array) is required' });
    return;
  }
  const actor = resolveActingAdminAddress(req);
  try {
    const { token, secret } = await scopedAdminTokenStore.create({
      label: label.trim(),
      permissions,
      expiresInSeconds: typeof expiresInSeconds === 'number' && expiresInSeconds > 0 ? expiresInSeconds : undefined,
      createdBy: actor,
    });
    void recordAdminAuditLog(req, 'scoped-token.created', 201, { keyId: token.keyId, label: token.label, permissions: token.permissions, actor });
    res.status(201).json({ message: 'Scoped admin token created', keyId: token.keyId, secret, label: token.label, permissions: token.permissions, expiresAt: token.expiresAt, createdAt: token.createdAt });
  } catch (error) {
    res.status(400).json({ error: 'Bad Request', status: 400, message: error instanceof Error ? error.message : 'Failed to create scoped token' });
  }
});

/**
 * GET /admin/scoped-tokens
 * Lists all scoped admin tokens (without secrets).
 * Requires admin or super-admin API key.
 */
router.get('/admin/scoped-tokens', validateApiKey, async (req: Request, res: Response) => {
  const includeRevoked = req.query.includeRevoked === 'true';
  const tokens = await scopedAdminTokenStore.list({ includeRevoked });
  const sanitized = tokens.map(({ hashedSecret: _hs, ...rest }) => rest);
  res.status(200).json({ tokens: sanitized, count: sanitized.length, timestamp: new Date().toISOString() });
});

/**
 * GET /admin/scoped-tokens/:keyId
 * Returns a single token record (without secret).
 * Requires admin or super-admin API key.
 */
router.get('/admin/scoped-tokens/:keyId', validateApiKey, async (req: Request, res: Response) => {
  const token = await scopedAdminTokenStore.get(req.params.keyId);
  if (!token) {
    res.status(404).json({ error: 'Not Found', status: 404, message: 'Scoped token not found' });
    return;
  }
  const { hashedSecret: _hs, ...sanitized } = token;
  res.status(200).json({ token: sanitized });
});

/**
 * GET /admin/scoped-tokens/:keyId/rotations
 * Returns the immutable rotation history for a token (fingerprints only, no old secrets).
 * Requires admin or super-admin API key.
 */
router.get('/admin/scoped-tokens/:keyId/rotations', validateApiKey, async (req: Request, res: Response) => {
  const token = await scopedAdminTokenStore.get(req.params.keyId);
  if (!token) {
    res.status(404).json({ error: 'Not Found', status: 404, message: 'Scoped token not found' });
    return;
  }
  const events = await scopedAdminTokenStore.listRotationEvents(req.params.keyId);
  res.status(200).json({ keyId: req.params.keyId, rotations: events, count: events.length, timestamp: new Date().toISOString() });
});

/**
 * POST /admin/scoped-tokens/:keyId/rotate
 * Rotates the secret and writes an immutable audit event row.
 * Requires super-admin API key.
 */
router.post('/admin/scoped-tokens/:keyId/rotate', validateApiKey, async (req: Request, res: Response) => {
  if (!hasRequiredApiKeyRole(req, 'super-admin')) {
    res.status(403).json({ error: 'Forbidden', status: 403, message: 'Super-admin role is required to rotate scoped tokens' });
    return;
  }
  const actor = resolveActingAdminAddress(req);
  const result = await scopedAdminTokenStore.rotate(req.params.keyId, { rotatedBy: actor });
  if (!result) {
    res.status(404).json({ error: 'Not Found', status: 404, message: 'Scoped token not found or already revoked' });
    return;
  }
  void recordAdminAuditLog(req, 'scoped-token.rotated', 200, { keyId: result.keyId, rotatedAt: result.rotatedAt, actor });
  res.status(200).json({ message: 'Scoped token rotated', keyId: result.keyId, newSecret: result.newSecret, rotatedAt: result.rotatedAt });
});

/**
 * POST /admin/scoped-tokens/:keyId/revoke
 * Revokes a scoped admin token cluster-wide.
 * Requires super-admin API key.
 */
router.post('/admin/scoped-tokens/:keyId/revoke', validateApiKey, async (req: Request, res: Response) => {
  if (!hasRequiredApiKeyRole(req, 'super-admin')) {
    res.status(403).json({ error: 'Forbidden', status: 403, message: 'Super-admin role is required to revoke scoped tokens' });
    return;
  }
  const actor = resolveActingAdminAddress(req);
  const revoked = await scopedAdminTokenStore.revoke(req.params.keyId, { revokedBy: actor });
  if (!revoked) {
    res.status(404).json({ error: 'Not Found', status: 404, message: 'Scoped token not found or already revoked' });
    return;
  }
  void recordAdminAuditLog(req, 'scoped-token.revoked', 200, { keyId: req.params.keyId, actor });
  res.status(200).json({ message: 'Scoped token revoked', keyId: req.params.keyId, timestamp: new Date().toISOString() });
});

/**
 * GET /admin/withdrawals/recovery
 * Lists journalled withdrawal sagas with optional filters. Use
 * `?requiresManualIntervention=true` for the operator work queue.
 */
router.get('/admin/withdrawals/recovery', validateApiKey, (req: Request, res: Response) => {
  const requiresManualIntervention =
    req.query.requiresManualIntervention === undefined
      ? undefined
      : req.query.requiresManualIntervention === 'true';

  const sagas = withdrawalRecoveryCoordinator.list({
    status: parseSagaStatus(req.query.status),
    walletAddress:
      typeof req.query.walletAddress === 'string' ? req.query.walletAddress : undefined,
    withdrawalId:
      typeof req.query.withdrawalId === 'string' ? req.query.withdrawalId : undefined,
    requiresManualIntervention,
    limit: parseLimited(req.query.limit, 50, 1, 200),
  });

  res.status(200).json({
    sagas,
    count: sagas.length,
    metrics: withdrawalRecoveryCoordinator.getMetrics(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/withdrawals/recovery/metrics
 * Aggregate recovery counters for dashboards and alert rules.
 */
router.get('/admin/withdrawals/recovery/metrics', validateApiKey, (_req: Request, res: Response) => {
  res.status(200).json({
    metrics: withdrawalRecoveryCoordinator.getMetrics(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/withdrawals/recovery/:sagaId
 * Returns the full step journal for one withdrawal saga.
 */
router.get('/admin/withdrawals/recovery/:sagaId', validateApiKey, (req: Request, res: Response) => {
  const saga = withdrawalRecoveryCoordinator.get(req.params.sagaId);
  if (!saga) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'Withdrawal recovery saga not found',
    });
    return;
  }
  res.status(200).json({ saga });
});

/**
 * POST /admin/withdrawals/recovery/:sagaId/resume
 * Replays the saga from its journal. Completed steps are skipped, so no side
 * effect is repeated. `force: true` also resumes sagas parked for an operator.
 */
router.post(
  '/admin/withdrawals/recovery/:sagaId/resume',
  validateApiKey,
  async (req: Request, res: Response) => {
    const force = req.body?.force === true;
    const outcome = await withdrawalRecoveryCoordinator.resume(req.params.sagaId, { force });

    if (!outcome) {
      res.status(404).json({
        error: 'Not Found',
        status: 404,
        message: 'Withdrawal recovery saga not found',
      });
      return;
    }

    void recordAdminAuditLog(req, 'withdrawal-recovery.resumed', 200, {
      sagaId: outcome.saga.id,
      withdrawalId: outcome.saga.withdrawalId,
      status: outcome.status,
      forced: force,
      actor: resolveActingAdminAddress(req),
    });

    res.status(200).json({
      message: 'Withdrawal recovery pass completed',
      status: outcome.status,
      completed: outcome.completed,
      partial: outcome.partial,
      saga: outcome.saga,
    });
  },
);

/**
 * POST /admin/withdrawals/recovery/:sagaId/resolve
 * Closes out a parked saga after an operator reconciled it by hand.
 */
router.post(
  '/admin/withdrawals/recovery/:sagaId/resolve',
  validateApiKey,
  (req: Request, res: Response) => {
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!note) {
      res.status(400).json({
        error: 'Bad Request',
        status: 400,
        message: 'A "note" describing the manual resolution is required',
      });
      return;
    }

    const outcome = req.body?.outcome;
    if (outcome !== undefined && !['completed', 'compensated', 'failed'].includes(outcome)) {
      res.status(400).json({
        error: 'Bad Request',
        status: 400,
        message: 'outcome must be one of: completed, compensated, failed',
      });
      return;
    }

    const actor = resolveActingAdminAddress(req);
    const saga = withdrawalRecoveryCoordinator.resolveManually(
      req.params.sagaId,
      actor,
      note,
      outcome,
    );

    if (!saga) {
      res.status(404).json({
        error: 'Not Found',
        status: 404,
        message: 'Withdrawal recovery saga not found',
      });
      return;
    }

    void recordAdminAuditLog(req, 'withdrawal-recovery.resolved', 200, {
      sagaId: saga.id,
      withdrawalId: saga.withdrawalId,
      outcome: saga.status,
      actor,
    });

    res.status(200).json({ message: 'Withdrawal saga resolved', saga });
  },
);

/**
 * POST /admin/withdrawals/recovery/sweep
 * Runs one recovery sweep immediately instead of waiting for the interval.
 */
router.post('/admin/withdrawals/recovery/sweep', validateApiKey, async (req: Request, res: Response) => {
  const result = await withdrawalRecoveryCoordinator.sweep();
  void recordAdminAuditLog(req, 'withdrawal-recovery.swept', 200, {
    resumed: result.resumed.length,
    stale: result.stale.length,
    actor: resolveActingAdminAddress(req),
  });
  res.status(200).json({
    message: 'Withdrawal recovery sweep completed',
    resumed: result.resumed,
    staleResumed: result.stale,
    metrics: withdrawalRecoveryCoordinator.getMetrics(),
    timestamp: new Date().toISOString(),
  });
});

// ─── Vault management ────────────────────────────────────────────────────────

/**
 * POST /admin/vaults
 *
 * Creates a new vault for a tenant.
 *
 * Body: { name: string, symbol: string, tenantId: string }
 *
 * Validation is handled entirely by CreateVaultBodySchema (which trims
 * whitespace before checking min/max lengths), so no manual trim() calls
 * are needed in this handler. A whitespace-only name like " " fails schema
 * validation and returns 400 before any DB write is attempted.
 */
router.post(
  '/admin/vaults',
  validateApiKey,
  validate({ body: CreateVaultBodySchema }),
  async (req: Request, res: Response) => {
    const { name, symbol, tenantId } = req.body as {
      name: string;
      symbol: string;
      tenantId: string;
    };

    const prismaClient = getPrismaClient();
    const vault = await prismaClient.vault.create({
      data: { name, symbol, tenantId },
    });

    void recordAdminAuditLog(req, 'vault.created', 201, {
      vaultId: vault.id,
      name: vault.name,
      symbol: vault.symbol,
      tenantId: vault.tenantId,
      actor: resolveActingAdminAddress(req),
    });

    res.status(201).json({
      vault: {
        id: vault.id,
        name: vault.name,
        symbol: vault.symbol,
        tenantId: vault.tenantId,
        aum: vault.aum,
        createdAt: vault.createdAt.toISOString(),
      },
      timestamp: new Date().toISOString(),
    });
  },
);

export default router;
