/**
 * Webhook verification and admin webhook management endpoints.
 *
 * Extracted from src/index.ts (issue #1545); mounted by the composition root
 * in the same position the routes were registered, so behaviour is unchanged.
 */
import { Router, Request, Response } from 'express';
import { IdParamSchema, PaginationQuerySchema, WebhookListQuerySchema, WebhookRegisterSchema, WebhookUpdateSchema, WebhookVerifyBodySchema, validate } from '../middleware/validate';
import { assertWebhookParameterUpdate } from '../middleware/rbac';
import { createWebhookSignature, deleteWebhookEndpoint, getWebhookDeliveryMetrics, listWebhookDeadLetters, listWebhookDeliveryPage, listWebhookEndpoints, registerWebhookEndpoint, restoreWebhookEndpoint, retryWebhookDeadLetter, updateWebhookEndpoint, verifyWebhookEndpoint, verifyWebhookSignature } from '../webhookDelivery';
import { hasRequiredApiKeyRole, validateApiKey } from '../middleware/apiKeyAuth';
import { isDryRunRequest, paginateByLimit, parseLimited, resolveActingAdminAddress, sendStandardListEnvelope } from './shared';
import { recordAdminAuditLog } from '../adminAudit';
import { requireAuth } from '../auth';
import { webhookDeduplicationStore } from '../webhookDeduplication';

const router = Router();

/** Routes mounted on the `/api/v1` router (`apiV1WebhookRoutes`). */
export const apiV1WebhookRoutes = Router();

/**
 * POST /api/v1/webhooks — authenticated clients register an HTTPS callback
 * instead of polling for transaction/vault events.
 */
apiV1WebhookRoutes.post('/webhooks', requireAuth, validate({ body: WebhookRegisterSchema }), (req: Request, res: Response) => {
  try {
    const { url, eventTypes, enabled, secret } = req.body;
    const endpoint = registerWebhookEndpoint({
      url,
      eventTypes,
      enabled: enabled ?? true,
      secret,
    });
    res.status(201).json({
      message: 'Webhook endpoint registered',
      endpoint,
    });
  } catch (error) {
    res.status(422).json({
      error: 'Unprocessable Entity',
      status: 422,
      message: error instanceof Error ? error.message : 'Invalid webhook configuration',
    });
  }
});

apiV1WebhookRoutes.get('/webhooks', requireAuth, validate({ query: PaginationQuerySchema }), (req: Request, res: Response) => {
  const includeDeleted = req.query.includeDeleted === 'true';
  const endpoints = listWebhookEndpoints(includeDeleted);
  res.status(200).json({
    endpoints,
    metrics: getWebhookDeliveryMetrics(),
  });
});

// /webhooks/verify â†’ /api/v1/webhooks/verify
router.post('/webhooks/verify', validate({ body: WebhookVerifyBodySchema }), (req: Request, res: Response) => {
  const { secret, payload, signature } = req.body || {};
  if (typeof secret !== 'string' || !secret.trim()) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'secret is required and must be a non-empty string',
    });
    return;
  }

  if (typeof payload === 'undefined') {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'payload is required',
    });
    return;
  }

  const computedSignature = createWebhookSignature(secret, payload);
  const verified =
    typeof signature === 'string' && signature.length > 0
      ? verifyWebhookSignature(secret, payload, signature)
      : null;

  res.status(200).json({
    algorithm: 'HMAC-SHA256',
    signature: computedSignature,
    verified,
  });
});

/**
 * POST /admin/webhooks - register webhook endpoint for transaction events
 */
router.post('/admin/webhooks', validateApiKey, validate({ body: WebhookRegisterSchema }), (req: Request, res: Response) => {
  const { url, eventTypes, enabled, secret } = req.body;

  const endpoint = registerWebhookEndpoint({
    url,
    eventTypes,
    enabled: enabled ?? true,
    secret,
  });

  res.status(201).json({
    message: 'Webhook endpoint registered',
    endpoint,
  });
});

/**
 * POST /admin/webhooks/:id/verify - run challenge-response verification for an endpoint
 */
router.post('/admin/webhooks/:id/verify', validateApiKey, validate({ params: IdParamSchema }), async (req: Request, res: Response) => {
  try {
    const endpoint = await verifyWebhookEndpoint(req.params.id);
    if (!endpoint) {
      res.status(404).json({
        error: 'Not Found',
        status: 404,
        message: 'Webhook endpoint not found',
      });
      return;
    }

    await recordAdminAuditLog(req, 'webhook.verify', endpoint.verificationStatus === 'verified' ? 200 : 422, {
      endpointId: endpoint.id,
      verificationStatus: endpoint.verificationStatus,
      lastVerificationError: endpoint.lastVerificationError,
    });

    res.status(endpoint.verificationStatus === 'verified' ? 200 : 422).json({
      message:
        endpoint.verificationStatus === 'verified'
          ? 'Webhook endpoint verified'
          : 'Webhook endpoint verification failed',
      endpoint,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: error instanceof Error ? error.message : 'Failed to verify webhook endpoint',
    });
  }
});

/**
 * PATCH /admin/webhooks/:id - update webhook endpoint
 */
router.patch('/admin/webhooks/:id', validateApiKey, validate({ params: IdParamSchema, body: WebhookUpdateSchema }), (req: Request, res: Response) => {
  if (!assertWebhookParameterUpdate(req, res)) {
    return;
  }

  const endpoint = updateWebhookEndpoint(req.params.id, req.body || {});
  if (!endpoint) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'Webhook endpoint not found',
    });
    return;
  }

  res.status(200).json({
    message: 'Webhook endpoint updated',
    endpoint,
  });
});

/**
 * GET /admin/webhooks - list webhook endpoints
 */
router.get('/admin/webhooks', validateApiKey, validate({ query: PaginationQuerySchema }), (req: Request, res: Response) => {
  const includeDeleted = req.query.includeDeleted === 'true';
  const limit = parseLimited(req.query.limit, 100, 1, 500);
  const allEndpoints = listWebhookEndpoints(includeDeleted);
  const windowed = allEndpoints.slice(0, limit + 1);
  const { data, hasNextPage } = paginateByLimit(windowed, limit);

  sendStandardListEnvelope(res, {
    data,
    limit,
    hasNextPage,
    total: allEndpoints.length,
    extras: {
      endpoints: data,
      metrics: getWebhookDeliveryMetrics(),
    },
  });
});

/**
 * DELETE /admin/webhooks/:id - soft delete webhook endpoint
 */
router.delete('/admin/webhooks/:id', validateApiKey, validate({ params: IdParamSchema }), async (req: Request, res: Response) => {
  const actor = resolveActingAdminAddress(req);
  const endpoint = deleteWebhookEndpoint(req.params.id, actor);

  if (!endpoint) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'Webhook endpoint not found or already deleted',
    });
    return;
  }

  void recordAdminAuditLog(req, 'webhook.delete', 200, {
    endpointId: endpoint.id,
    url: endpoint.url,
    actor,
  });

  res.status(200).json({
    message: 'Webhook endpoint soft-deleted',
    endpoint,
  });
});

/**
 * POST /admin/webhooks/:id/restore - restore soft-deleted webhook endpoint
 */
router.post('/admin/webhooks/:id/restore', validateApiKey, validate({ params: IdParamSchema }), async (req: Request, res: Response) => {
  const actor = resolveActingAdminAddress(req);
  const endpoint = restoreWebhookEndpoint(req.params.id, actor);

  if (!endpoint) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: 'Webhook endpoint not found or not deleted',
    });
    return;
  }

  void recordAdminAuditLog(req, 'webhook.restore', 200, {
    endpointId: endpoint.id,
    url: endpoint.url,
    actor,
  });

  res.status(200).json({
    message: 'Webhook endpoint restored',
    endpoint,
  });
});

/**
 * GET /admin/webhooks/dead-letter - list permanently failed webhook deliveries
 */
router.get('/admin/webhooks/dead-letter', validateApiKey, validate({ query: WebhookListQuerySchema }), (req: Request, res: Response) => {
  const endpointId = typeof req.query.endpointId === 'string' ? req.query.endpointId : undefined;
  const eventType = typeof req.query.eventType === 'string' ? req.query.eventType : undefined;
  const start = typeof req.query.start === 'string' ? req.query.start : undefined;
  const end = typeof req.query.end === 'string' ? req.query.end : undefined;
  const limit = parseLimited(req.query.limit, 100, 1, 500);

  const rows = listWebhookDeadLetters({
    endpointId,
    eventType: eventType as any,
    start,
    end,
    limit: limit + 1,
  });
  const { data, hasNextPage } = paginateByLimit(rows, limit);

  sendStandardListEnvelope(res, {
    data,
    limit,
    hasNextPage,
    extras: {
      deadLetters: data,
    },
  });
});

/**
 * POST /admin/webhooks/dead-letter/:id/retry - re-queue a dead-letter delivery
 */
router.post('/admin/webhooks/dead-letter/:id/retry', validateApiKey, async (req: Request, res: Response) => {
  try {
    const entry = await retryWebhookDeadLetter(req.params.id);
    if (!entry) {
      res.status(404).json({
        error: 'Not Found',
        status: 404,
        message: 'Dead-letter entry not found',
      });
      return;
    }

    res.status(200).json({
      message: 'Dead-letter entry re-queued for delivery',
      deadLetter: entry,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Internal Server Error',
      status: 500,
      message: error instanceof Error ? error.message : 'Failed to retry dead-letter entry',
    });
  }
});

/**
 * GET /admin/webhooks/deliveries - list recent webhook delivery attempts
 * Supports cursor-based pagination: ?limit=N&cursor=<opaque>
 */
router.get('/admin/webhooks/deliveries', validateApiKey, validate({ query: PaginationQuerySchema }), (req: Request, res: Response) => {
  const limit = parseLimited(req.query.limit, 100, 1, 500);
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

  try {
    const page = listWebhookDeliveryPage({ limit, cursor });
    sendStandardListEnvelope(res, {
      data: page.deliveries,
      limit,
      hasNextPage: page.hasNextPage,
      hasPrevPage: Boolean(cursor),
      nextCursor: page.nextCursor,
      extras: {
        deliveries: page.deliveries,
        nextCursor: page.nextCursor,
        hasNextPage: page.hasNextPage,
        metrics: getWebhookDeliveryMetrics(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Invalid or expired cursor')) {
      res.status(400).json({
        error: 'Bad Request',
        status: 400,
        message: 'Invalid or expired cursor. Start a new page without a cursor.',
      });
      return;
    }
    res.status(500).json({ error: 'Internal Server Error', status: 500, message });
  }
});

/**
 * POST /api/v1/webhooks/verify - verify webhook secret/signature pairing before go-live
 */
router.post('/api/v1/webhooks/verify', validate({ body: WebhookVerifyBodySchema }), (req: Request, res: Response) => {
  const { secret, payload, signature } = req.body || {};
  if (typeof secret !== 'string' || !secret.trim()) {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'secret is required and must be a non-empty string',
    });
    return;
  }

  if (typeof payload === 'undefined') {
    res.status(400).json({
      error: 'Bad Request',
      status: 400,
      message: 'payload is required',
    });
    return;
  }

  const computedSignature = createWebhookSignature(secret, payload);
  const verified =
    typeof signature === 'string' && signature.length > 0
      ? verifyWebhookSignature(secret, payload, signature)
      : null;

  res.status(200).json({
    algorithm: 'HMAC-SHA256',
    signature: computedSignature,
    verified,
  });
});

// â”€â”€â”€ Webhook Deduplication Admin Endpoints (Issue #710) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * GET /admin/webhooks/deduplication/metrics
 * Returns observability counters for the webhook replay-safe deduplication store.
 * Requires API key authentication.
 */
router.get('/admin/webhooks/deduplication/metrics', validateApiKey, (_req: Request, res: Response) => {
  res.status(200).json({
    metrics: webhookDeduplicationStore.getMetrics(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/webhooks/deduplication/entries
 * Lists active event fingerprints held in the deduplication store.
 * Optional ?prefix=<string> filters by event id prefix.
 * Requires API key authentication.
 */
router.get('/admin/webhooks/deduplication/entries', validateApiKey, (req: Request, res: Response) => {
  const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : undefined;
  const entries = webhookDeduplicationStore.inspect(prefix);
  res.status(200).json({
    entries,
    count: entries.length,
    metrics: webhookDeduplicationStore.getMetrics(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * DELETE /admin/webhooks/deduplication/:eventId
 * Removes a single event fingerprint from the deduplication store.
 * Requires API key authentication.
 */
router.delete('/admin/webhooks/deduplication/:eventId', validateApiKey, (req: Request, res: Response) => {
  const eventId = decodeURIComponent(req.params.eventId);

  if (isDryRunRequest(req)) {
    const exists = webhookDeduplicationStore.has(eventId);
    res.status(exists ? 200 : 404).json({
      dryRun: true,
      message: exists
        ? `Deduplication entry '${eventId}' would be removed`
        : `Deduplication entry '${eventId}' not found`,
      eventId,
      wouldDelete: exists,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const removed = webhookDeduplicationStore.remove(eventId);
  if (!removed) {
    res.status(404).json({
      error: 'Not Found',
      status: 404,
      message: `Deduplication entry '${eventId}' not found`,
    });
    return;
  }

  void recordAdminAuditLog(req, 'webhook.dedup.entry.removed', 200, { eventId });

  res.status(200).json({
    message: `Deduplication entry '${eventId}' removed`,
    metrics: webhookDeduplicationStore.getMetrics(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * DELETE /admin/webhooks/deduplication
 * Flushes the entire webhook deduplication store.
 * Requires super-admin API key.
 */
router.delete('/admin/webhooks/deduplication', validateApiKey, (req: Request, res: Response) => {
  if (!hasRequiredApiKeyRole(req, 'super-admin')) {
    res.status(403).json({
      error: 'Forbidden',
      status: 403,
      message: 'Super-admin role is required to flush the webhook deduplication store',
    });
    return;
  }

  const metrics = webhookDeduplicationStore.getMetrics();

  if (isDryRunRequest(req)) {
    res.status(200).json({
      dryRun: true,
      message: 'Webhook deduplication store flush dry-run preview',
      wouldFlush: true,
      activeFingerprints: metrics.activeFingerprints,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  webhookDeduplicationStore.flush();

  void recordAdminAuditLog(req, 'webhook.dedup.store.flushed', 200, {
    flushedCount: metrics.activeFingerprints,
  });

  res.status(200).json({
    message: 'Webhook deduplication store flushed',
    metrics: webhookDeduplicationStore.getMetrics(),
    timestamp: new Date().toISOString(),
  });
});

export default router;
