import crypto from 'crypto';
import { prisma } from './prisma';

export type TransactionEventType =
  | 'transaction.deposit.created'
  | 'transaction.withdrawal.created';

export const WEBHOOK_SCHEMA_VERSION = 1;

export interface TransactionEventPayload {
  transactionId: string;
  amount: string;
  asset: string;
  walletAddress: string;
  transactionHash: string;
  status: string;
  timestamp: string;
}

export type WebhookVerificationStatus = 'pending' | 'verified' | 'failed';

export interface WebhookEndpoint {
  id: string;
  url: string;
  eventTypes: TransactionEventType[];
  enabled: boolean;
  hasSecret: boolean;
  verificationStatus: WebhookVerificationStatus;
  verifiedAt?: string;
  lastVerificationError?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  deletedBy?: string;
}

interface InternalWebhookEndpoint {
  id: string;
  url: string;
  eventTypes: TransactionEventType[];
  enabled: boolean;
  secret?: string;
  secretHash?: string;
  verificationStatus: WebhookVerificationStatus;
  challengeToken?: string;
  challengeTokenHash?: string;
  challengeExpiresAt?: string;
  verifiedAt?: string;
  lastVerificationError?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  deletedBy?: string;
}

export type WebhookDeliveryStatus = 'pending' | 'delivered' | 'failed';

export interface WebhookDeliveryRecord {
  id: string;
  endpointId: string;
  endpointUrl: string;
  eventType: TransactionEventType;
  status: WebhookDeliveryStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
  lastError?: string;
}

export interface WebhookDeliveryPage {
  deliveries: WebhookDeliveryRecord[];
  nextCursor?: string;
  hasNextPage: boolean;
}

export interface WebhookDeadLetterRecord {
  id: string;
  endpointId: string;
  endpointUrl: string;
  eventType: TransactionEventType;
  payload: TransactionEventPayload;
  attempts: number;
  lastError?: string;
  originalDeliveryId?: string;
  status: 'dead-letter' | 'requeued' | 'delivered';
  createdAt: string;
  updatedAt: string;
  retriedAt?: string;
}

const deadLetters: WebhookDeadLetterRecord[] = [];
const webhookReplayCache = new Map<string, number>();

interface RegisterWebhookInput {
  url: string;
  eventTypes?: TransactionEventType[];
  enabled?: boolean;
  secret?: string;
}

interface UpdateWebhookInput {
  enabled?: boolean;
  eventTypes?: TransactionEventType[];
  secret?: string;
}

const endpoints = new Map<string, InternalWebhookEndpoint>();
const deliveries: WebhookDeliveryRecord[] = [];
let persistenceInitialized = false;

const getMaxAttempts = (): number => parseInt(process.env.WEBHOOK_MAX_ATTEMPTS || '3', 10);
const deliveryTimeoutMs = parseInt(process.env.WEBHOOK_DELIVERY_TIMEOUT_MS || '5000', 10);
const retryBaseDelayMs = parseInt(process.env.WEBHOOK_RETRY_BASE_DELAY_MS || '500', 10);
const deliveryRetention = parseInt(process.env.WEBHOOK_DELIVERY_RETENTION || '200', 10);
const jitterFactor = parseFloat(process.env.WEBHOOK_JITTER_FACTOR || '0.5');
const jitterMaxMs = parseInt(process.env.WEBHOOK_JITTER_MAX_MS || '30000', 10);

const verificationTimeoutMs = parseInt(process.env.WEBHOOK_VERIFICATION_TIMEOUT_MS || '5000', 10);
const challengeTtlMs = parseInt(process.env.WEBHOOK_CHALLENGE_TTL_SECONDS || '900', 10) * 1000;
const webhookSignatureMaxSkewMs = parseInt(process.env.WEBHOOK_SIGNATURE_MAX_SKEW_MS || '300000', 10);
const isUnverifiedDeliveryAllowed = (): boolean => {
  if (process.env.WEBHOOK_ALLOW_UNVERIFIED !== undefined) {
    return process.env.WEBHOOK_ALLOW_UNVERIFIED === 'true';
  }
  return process.env.NODE_ENV === 'test';
};

function createChallengeToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

function hashChallengeToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function probeWebhookVerification(endpoint: InternalWebhookEndpoint): Promise<boolean> {
  if (!endpoint.challengeToken) {
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), verificationTimeoutMs);

  try {
    const body = {
      type: 'webhook.verification',
      challenge: endpoint.challengeToken,
    };

    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'YieldVault-Webhook-Verification/1.0',
        'X-YieldVault-Challenge': endpoint.challengeToken,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Verification endpoint returned HTTP ${response.status}`);
    }

    const headersRecord = response.headers as unknown as {
      get?: (name: string) => string | null;
      [key: string]: unknown;
    };
    const responseChallenge =
      typeof headersRecord?.get === 'function'
        ? headersRecord.get('x-yieldvault-challenge')
        : typeof headersRecord?.['x-yieldvault-challenge'] === 'string'
          ? (headersRecord['x-yieldvault-challenge'] as string)
          : null;
    if (responseChallenge === endpoint.challengeToken) {
      return true;
    }

    const responseBody = await response.json().catch(() => null) as { challenge?: string } | null;
    return responseBody?.challenge === endpoint.challengeToken;
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifyWebhookEndpoint(id: string): Promise<WebhookEndpoint | null> {
  const existing = endpoints.get(id);
  if (!existing || existing.deletedAt) {
    return null;
  }

  if (
    existing.challengeExpiresAt &&
    Date.parse(existing.challengeExpiresAt) <= Date.now()
  ) {
    const expired: InternalWebhookEndpoint = {
      ...existing,
      verificationStatus: 'failed',
      lastVerificationError: 'Verification challenge expired',
      updatedAt: new Date().toISOString(),
    };
    endpoints.set(id, expired);
    void persistWebhookEndpoint(expired);
    return sanitizeWebhookEndpoint(expired);
  }

  try {
    const verified = await probeWebhookVerification(existing);
    if (!verified) {
      const failed: InternalWebhookEndpoint = {
        ...existing,
        verificationStatus: 'failed',
        lastVerificationError: 'Challenge response did not match',
        updatedAt: new Date().toISOString(),
      };
      endpoints.set(id, failed);
      void persistWebhookEndpoint(failed);
      return sanitizeWebhookEndpoint(failed);
    }

    const updated: InternalWebhookEndpoint = {
      ...existing,
      verificationStatus: 'verified',
      verifiedAt: new Date().toISOString(),
      enabled: true,
      challengeToken: undefined,
      lastVerificationError: undefined,
      updatedAt: new Date().toISOString(),
    };
    endpoints.set(id, updated);
    void persistWebhookEndpoint(updated);
    return sanitizeWebhookEndpoint(updated);
  } catch (error) {
    const failed: InternalWebhookEndpoint = {
      ...existing,
      verificationStatus: 'failed',
      lastVerificationError: error instanceof Error ? error.message : String(error),
      updatedAt: new Date().toISOString(),
    };
    endpoints.set(id, failed);
    void persistWebhookEndpoint(failed);
    return sanitizeWebhookEndpoint(failed);
  }
}

export function registerWebhookEndpoint(input: RegisterWebhookInput): WebhookEndpoint {
  assertValidWebhookUrl(input.url);

  const now = new Date().toISOString();
  const challengeToken = createChallengeToken();
  const endpoint: InternalWebhookEndpoint = {
    id: `wh_${crypto.randomBytes(6).toString('hex')}`,
    url: input.url,
    eventTypes: input.eventTypes && input.eventTypes.length > 0
      ? input.eventTypes
      : ['transaction.deposit.created', 'transaction.withdrawal.created'],
    enabled: input.enabled ?? isUnverifiedDeliveryAllowed(),
    secret: input.secret,
    secretHash: input.secret ? hashWebhookSecret(input.secret) : undefined,
    verificationStatus: 'pending',
    challengeToken,
    challengeTokenHash: hashChallengeToken(challengeToken),
    challengeExpiresAt: new Date(Date.now() + challengeTtlMs).toISOString(),
    createdAt: now,
    updatedAt: now,
  };

  endpoints.set(endpoint.id, endpoint);
  void persistWebhookEndpoint(endpoint);
  void verifyWebhookEndpoint(endpoint.id);
  return sanitizeWebhookEndpoint(endpoint);
}

export function updateWebhookEndpoint(id: string, input: UpdateWebhookInput): WebhookEndpoint | null {
  const existing = endpoints.get(id);
  if (!existing || existing.deletedAt) {
    return null;
  }

  if (input.eventTypes && input.eventTypes.length === 0) {
    throw new Error('eventTypes cannot be empty');
  }

  const updated: InternalWebhookEndpoint = {
    ...existing,
    enabled: input.enabled ?? existing.enabled,
    eventTypes: input.eventTypes ?? existing.eventTypes,
    secret: input.secret ?? existing.secret,
    secretHash:
      typeof input.secret === 'string'
        ? hashWebhookSecret(input.secret)
        : existing.secretHash,
    updatedAt: new Date().toISOString(),
  };

  endpoints.set(id, updated);
  void persistWebhookEndpoint(updated);
  return sanitizeWebhookEndpoint(updated);
}

export function deleteWebhookEndpoint(id: string, actor: string): WebhookEndpoint | null {
  const existing = endpoints.get(id);
  if (!existing || existing.deletedAt) {
    return null;
  }

  const updated: InternalWebhookEndpoint = {
    ...existing,
    deletedAt: new Date().toISOString(),
    deletedBy: actor,
    updatedAt: new Date().toISOString(),
  };

  endpoints.set(id, updated);
  void persistWebhookEndpoint(updated);
  return sanitizeWebhookEndpoint(updated);
}

export function restoreWebhookEndpoint(id: string, actor: string): WebhookEndpoint | null {
  const existing = endpoints.get(id);
  if (!existing || !existing.deletedAt) {
    return null;
  }

  const updated: InternalWebhookEndpoint = {
    ...existing,
    deletedAt: undefined,
    deletedBy: undefined,
    updatedAt: new Date().toISOString(),
  };

  endpoints.set(id, updated);
  void persistWebhookEndpoint(updated);
  return sanitizeWebhookEndpoint(updated);
}

export function listWebhookEndpoints(includeDeleted = false): WebhookEndpoint[] {
  return Array.from(endpoints.values())
    .filter((endpoint) => includeDeleted || !endpoint.deletedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((endpoint) => sanitizeWebhookEndpoint(endpoint));
}

export function listWebhookDeliveries(limit = 100): WebhookDeliveryRecord[] {
  return listWebhookDeliveryPage({ limit }).deliveries;
}

export function listWebhookDeliveryPage(input: { limit?: number; cursor?: string } = {}): WebhookDeliveryPage {
  const normalizedLimit = Math.max(1, Math.min(input.limit ?? 100, 500));
  const sorted = [...deliveries].sort((a, b) => {
    const createdComparison = b.createdAt.localeCompare(a.createdAt);
    if (createdComparison !== 0) {
      return createdComparison;
    }

    return b.id.localeCompare(a.id);
  });

  let startIndex = 0;
  if (input.cursor) {
    const cursor = decodeDeliveryCursor(input.cursor);
    const cursorIndex = sorted.findIndex(
      (delivery) => delivery.createdAt === cursor.createdAt && delivery.id === cursor.id,
    );

    if (cursorIndex === -1) {
      throw new Error('Invalid or expired cursor');
    }

    startIndex = cursorIndex + 1;
  }

  const pageItems = sorted.slice(startIndex, startIndex + normalizedLimit + 1);
  const hasNextPage = pageItems.length > normalizedLimit;
  const deliveriesPage = hasNextPage ? pageItems.slice(0, normalizedLimit) : pageItems;

  return {
    deliveries: deliveriesPage,
    hasNextPage,
    nextCursor: hasNextPage && deliveriesPage.length > 0 ? encodeDeliveryCursor(deliveriesPage[deliveriesPage.length - 1]) : undefined,
  };
}

export function getWebhookDeliveryMetrics() {
  let delivered = 0;
  let failed = 0;
  let pending = 0;

  for (const delivery of deliveries) {
    if (delivery.status === 'delivered') {
      delivered += 1;
    } else if (delivery.status === 'failed') {
      failed += 1;
    } else {
      pending += 1;
    }
  }

  return {
    totalEndpoints: endpoints.size,
    enabledEndpoints: Array.from(endpoints.values()).filter((endpoint) => endpoint.enabled).length,
    totalDeliveries: deliveries.length,
    delivered,
    failed,
    pending,
    maxAttempts: getMaxAttempts(),
    deliveryTimeoutMs,
  };
}

export function resetWebhookState(): void {
  endpoints.clear();
  deliveries.length = 0;
  deadLetters.length = 0;
  webhookReplayCache.clear();
  persistenceInitialized = false;
  delete process.env.WEBHOOK_ALLOW_UNVERIFIED;
  void clearPersistedWebhookEndpoints();
}

export function listWebhookDeadLetters(filters: {
  endpointId?: string;
  eventType?: TransactionEventType;
  start?: string;
  end?: string;
  limit?: number;
} = {}): WebhookDeadLetterRecord[] {
  const limit = Math.max(1, Math.min(filters.limit ?? 100, 500));
  return deadLetters
    .filter((entry) => {
      if (filters.endpointId && entry.endpointId !== filters.endpointId) {
        return false;
      }
      if (filters.eventType && entry.eventType !== filters.eventType) {
        return false;
      }
      if (filters.start && entry.createdAt < filters.start) {
        return false;
      }
      if (filters.end && entry.createdAt > filters.end) {
        return false;
      }
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export async function retryWebhookDeadLetter(id: string): Promise<WebhookDeadLetterRecord | null> {
  const entry = deadLetters.find((item) => item.id === id);
  if (!entry) {
    return null;
  }

  const endpoint = endpoints.get(entry.endpointId);
  if (!endpoint || endpoint.deletedAt) {
    entry.status = 'dead-letter';
    entry.lastError = 'Endpoint not found for dead-letter retry';
    entry.updatedAt = new Date().toISOString();
    return entry;
  }

  const now = new Date().toISOString();
  const delivery: WebhookDeliveryRecord = {
    id: `whd_${crypto.randomBytes(8).toString('hex')}`,
    endpointId: entry.endpointId,
    endpointUrl: entry.endpointUrl,
    eventType: entry.eventType,
    status: 'pending',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };

  deliveries.unshift(delivery);
  entry.status = 'requeued';
  entry.retriedAt = now;
  entry.updatedAt = now;
  entry.attempts += 1;

  await deliverWithRetry(endpoint, delivery, entry.payload, 1);

  if (delivery.status === 'delivered') {
    entry.status = 'delivered';
  } else if (delivery.status === 'failed') {
    entry.status = 'dead-letter';
    entry.lastError = delivery.lastError;
  }

  entry.updatedAt = new Date().toISOString();
  return entry;
}

async function persistWebhookDeadLetter(
  entry: WebhookDeadLetterRecord,
  envelope: { eventType: TransactionEventType; sentAt: string; payload: TransactionEventPayload },
): Promise<void> {
  try {
    await prisma.webhookDeadLetter.create({
      data: {
        id: entry.id,
        endpointId: entry.endpointId,
        endpointUrl: entry.endpointUrl,
        eventType: entry.eventType,
        payload: JSON.stringify(envelope),
        attempts: entry.attempts,
        lastError: entry.lastError ?? null,
        originalDeliveryId: entry.originalDeliveryId ?? null,
        status: entry.status,
      },
    });
  } catch {
    // Best-effort persistence for local/test environments.
  }
}

export function createWebhookSignature(secret: string, payload: unknown): string {
  return crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
}

export interface WebhookSignedEnvelope {
  schemaVersion: number;
  eventType: TransactionEventType;
  sentAt: string;
  payload: TransactionEventPayload;
  deliveryId: string;
}

function createReplayCacheKey(endpointId: string, deliveryId: string): string {
  return `${endpointId}:${deliveryId}`;
}

function pruneWebhookReplayCache(now = Date.now()): void {
  for (const [key, expiry] of webhookReplayCache.entries()) {
    if (expiry <= now) {
      webhookReplayCache.delete(key);
    }
  }
}

export function markWebhookDeliverySeen(endpointId: string, deliveryId: string, sentAt: string): boolean {
  pruneWebhookReplayCache();

  const sentAtMs = Date.parse(sentAt);
  if (Number.isNaN(sentAtMs)) {
    return false;
  }

  const now = Date.now();
  if (Math.abs(now - sentAtMs) > webhookSignatureMaxSkewMs) {
    return false;
  }

  const cacheKey = createReplayCacheKey(endpointId, deliveryId);
  if (webhookReplayCache.has(cacheKey)) {
    return false;
  }

  webhookReplayCache.set(cacheKey, sentAtMs + webhookSignatureMaxSkewMs);
  return true;
}

export function buildWebhookSignedEnvelope(
  delivery: WebhookDeliveryRecord,
  payload: TransactionEventPayload,
): WebhookSignedEnvelope {
  return {
    schemaVersion: WEBHOOK_SCHEMA_VERSION,
    eventType: delivery.eventType,
    sentAt: new Date().toISOString(),
    payload,
    deliveryId: delivery.id,
  };
}

export function verifyWebhookSignature(
  secret: string,
  payload: unknown,
  signature: string,
): boolean {
  const expected = createWebhookSignature(secret, payload);
  const providedBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

function encodeDeliveryCursor(delivery: WebhookDeliveryRecord): string {
  return Buffer.from(JSON.stringify({ createdAt: delivery.createdAt, id: delivery.id })).toString('base64url');
}

function decodeDeliveryCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const payload = JSON.parse(decoded) as { createdAt?: string; id?: string };
    if (!payload.createdAt || !payload.id) {
      throw new Error('Invalid cursor payload');
    }

    return { createdAt: payload.createdAt, id: payload.id };
  } catch {
    throw new Error('Invalid or expired cursor');
  }
}

export async function emitTransactionEvent(
  eventType: TransactionEventType,
  payload: TransactionEventPayload,
): Promise<number> {
  const activeEndpoints = Array.from(endpoints.values()).filter(
    (endpoint) =>
      !endpoint.deletedAt &&
      endpoint.enabled &&
      endpoint.eventTypes.includes(eventType) &&
      (isUnverifiedDeliveryAllowed() || endpoint.verificationStatus === 'verified'),
  );

  for (const endpoint of activeEndpoints) {
    const now = new Date().toISOString();
    const delivery: WebhookDeliveryRecord = {
      id: `whd_${crypto.randomBytes(8).toString('hex')}`,
      endpointId: endpoint.id,
      endpointUrl: endpoint.url,
      eventType,
      status: 'pending',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };

    deliveries.unshift(delivery);
    if (deliveries.length > deliveryRetention) {
      deliveries.length = deliveryRetention;
    }

    void deliverWithRetry(endpoint, delivery, payload, 1);
  }

  return activeEndpoints.length;
}

function assertValidWebhookUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Webhook url must be a valid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Webhook url protocol must be http or https');
  }
}

async function deliverWithRetry(
  endpoint: InternalWebhookEndpoint,
  delivery: WebhookDeliveryRecord,
  payload: TransactionEventPayload,
  attempt: number,
): Promise<void> {
  delivery.attempts = attempt;
  delivery.updatedAt = new Date().toISOString();

  const envelope = buildWebhookSignedEnvelope(delivery, payload);

  const body = JSON.stringify(envelope);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'YieldVault-Webhook-Delivery/1.0',
    'X-YieldVault-Event': delivery.eventType,
    'X-YieldVault-Delivery-Id': delivery.id,
  };

  if (endpoint.secret) {
    headers['X-YieldVault-Signature'] = createWebhookSignature(endpoint.secret, envelope);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, deliveryTimeoutMs);

  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Webhook returned HTTP ${response.status}`);
    }

    delivery.status = 'delivered';
    delivery.deliveredAt = new Date().toISOString();
    delivery.updatedAt = delivery.deliveredAt;
    delivery.lastError = undefined;
  } catch (error) {
    const normalized = error instanceof Error ? error.message : String(error);
    delivery.lastError = normalized;

    if (attempt < getMaxAttempts()) {
      const delayMs = calculateBackoffDelay(attempt);
      setTimeout(() => {
        void deliverWithRetry(endpoint, delivery, payload, attempt + 1);
      }, delayMs);
      return;
    }

    delivery.status = 'failed';
    delivery.updatedAt = new Date().toISOString();

    const deadLetter: WebhookDeadLetterRecord = {
      id: `whdl_${crypto.randomBytes(8).toString('hex')}`,
      endpointId: endpoint.id,
      endpointUrl: endpoint.url,
      eventType: delivery.eventType,
      payload,
      attempts: delivery.attempts,
      lastError: delivery.lastError,
      originalDeliveryId: delivery.id,
      status: 'dead-letter',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    deadLetters.unshift(deadLetter);
    void persistWebhookDeadLetter(deadLetter, envelope);
  } finally {
    clearTimeout(timeout);
  }
}

export function calculateBackoffDelay(attempt: number): number {
  const baseDelay = retryBaseDelayMs * Math.pow(2, attempt - 1);
  const jitterRange = Math.min(baseDelay * jitterFactor, jitterMaxMs);
  const jitter = (Math.random() * 2 - 1) * jitterRange;
  return Math.max(100, Math.round(baseDelay + jitter));
}

function sanitizeWebhookEndpoint(endpoint: InternalWebhookEndpoint): WebhookEndpoint {
  return {
    id: endpoint.id,
    url: endpoint.url,
    eventTypes: [...endpoint.eventTypes],
    enabled: endpoint.enabled,
    hasSecret: Boolean(endpoint.secretHash),
    verificationStatus: endpoint.verificationStatus,
    verifiedAt: endpoint.verifiedAt,
    lastVerificationError: endpoint.lastVerificationError,
    createdAt: endpoint.createdAt,
    updatedAt: endpoint.updatedAt,
    deletedAt: endpoint.deletedAt,
    deletedBy: endpoint.deletedBy,
  };
}

function hashWebhookSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

async function persistWebhookEndpoint(endpoint: InternalWebhookEndpoint): Promise<void> {
  try {
    await ensureWebhookPersistenceTable();
    await prisma.$executeRaw`
      INSERT INTO WebhookEndpoint (
        id,
        url,
        eventTypes,
        enabled,
        secretHash,
        createdAt,
        updatedAt,
        deletedAt,
        deletedBy
      ) VALUES (
        ${endpoint.id},
        ${endpoint.url},
        ${JSON.stringify(endpoint.eventTypes)},
        ${endpoint.enabled ? 1 : 0},
        ${endpoint.secretHash ?? null},
        ${endpoint.createdAt},
        ${endpoint.updatedAt},
        ${endpoint.deletedAt ?? null},
        ${endpoint.deletedBy ?? null}
      )
      ON CONFLICT(id) DO UPDATE SET
        url = excluded.url,
        eventTypes = excluded.eventTypes,
        enabled = excluded.enabled,
        secretHash = excluded.secretHash,
        updatedAt = excluded.updatedAt,
        deletedAt = excluded.deletedAt,
        deletedBy = excluded.deletedBy
    `;
  } catch {
    // Runtime persistence is best-effort so local development and tests still work without migrations.
  }
}

async function clearPersistedWebhookEndpoints(): Promise<void> {
  try {
    await ensureWebhookPersistenceTable();
    await prisma.$executeRawUnsafe('DELETE FROM WebhookEndpoint');
  } catch {
    // Ignore cleanup failures in test and local environments.
  }
}

async function ensureWebhookPersistenceTable(): Promise<void> {
  if (persistenceInitialized) {
    return;
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS WebhookEndpoint (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      eventTypes TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      secretHash TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT,
      deletedBy TEXT
    )
  `);
  persistenceInitialized = true;
}

export async function initializeWebhookEndpoints(): Promise<void> {
  try {
    await ensureWebhookPersistenceTable();
    const rows = await prisma.$queryRawUnsafe<any[]>(
      'SELECT id, url, eventTypes, enabled, secretHash, createdAt, updatedAt, deletedAt, deletedBy FROM WebhookEndpoint',
    );

    for (const row of rows) {
      endpoints.set(row.id, {
        id: row.id,
        url: row.url,
        eventTypes: JSON.parse(row.eventTypes),
        enabled: row.enabled === 1 || row.enabled === true,
        secretHash: row.secretHash || undefined,
        verificationStatus: 'verified',
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        deletedAt: row.deletedAt || undefined,
        deletedBy: row.deletedBy || undefined,
      });
    }
  } catch {
    // Ignore initialization errors in test environments.
  }
}
