import crypto from 'crypto';

export type TransactionEventType =
  | 'transaction.deposit.created'
  | 'transaction.withdrawal.created';

export interface TransactionEventPayload {
  transactionId: string;
  amount: string;
  asset: string;
  walletAddress: string;
  transactionHash: string;
  status: string;
  timestamp: string;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  eventTypes: TransactionEventType[];
  enabled: boolean;
  secret?: string;
  createdAt: string;
  updatedAt: string;
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

const endpoints = new Map<string, WebhookEndpoint>();
const deliveries: WebhookDeliveryRecord[] = [];

const maxAttempts = parseInt(process.env.WEBHOOK_MAX_ATTEMPTS || '3', 10);
const deliveryTimeoutMs = parseInt(process.env.WEBHOOK_DELIVERY_TIMEOUT_MS || '5000', 10);
const retryBaseDelayMs = parseInt(process.env.WEBHOOK_RETRY_BASE_DELAY_MS || '500', 10);
const deliveryRetention = parseInt(process.env.WEBHOOK_DELIVERY_RETENTION || '200', 10);

export function registerWebhookEndpoint(input: RegisterWebhookInput): WebhookEndpoint {
  assertValidWebhookUrl(input.url);

  const now = new Date().toISOString();
  const endpoint: WebhookEndpoint = {
    id: `wh_${crypto.randomBytes(6).toString('hex')}`,
    url: input.url,
    eventTypes: input.eventTypes && input.eventTypes.length > 0
      ? input.eventTypes
      : ['transaction.deposit.created', 'transaction.withdrawal.created'],
    enabled: input.enabled ?? true,
    secret: input.secret,
    createdAt: now,
    updatedAt: now,
  };

  endpoints.set(endpoint.id, endpoint);
  return endpoint;
}

export function updateWebhookEndpoint(id: string, input: UpdateWebhookInput): WebhookEndpoint | null {
  const existing = endpoints.get(id);
  if (!existing) {
    return null;
  }

  if (input.eventTypes && input.eventTypes.length === 0) {
    throw new Error('eventTypes cannot be empty');
  }

  const updated: WebhookEndpoint = {
    ...existing,
    enabled: input.enabled ?? existing.enabled,
    eventTypes: input.eventTypes ?? existing.eventTypes,
    secret: input.secret ?? existing.secret,
    updatedAt: new Date().toISOString(),
  };

  endpoints.set(id, updated);
  return updated;
}

export function listWebhookEndpoints(): WebhookEndpoint[] {
  return Array.from(endpoints.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function listWebhookDeliveries(limit = 100): WebhookDeliveryRecord[] {
  const normalizedLimit = Math.max(1, Math.min(limit, 500));
  return deliveries.slice(0, normalizedLimit);
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
    maxAttempts,
    deliveryTimeoutMs,
  };
}

export function resetWebhookState(): void {
  endpoints.clear();
  deliveries.length = 0;
}

export async function emitTransactionEvent(
  eventType: TransactionEventType,
  payload: TransactionEventPayload,
): Promise<number> {
  const activeEndpoints = Array.from(endpoints.values()).filter(
    (endpoint) => endpoint.enabled && endpoint.eventTypes.includes(eventType),
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
  endpoint: WebhookEndpoint,
  delivery: WebhookDeliveryRecord,
  payload: TransactionEventPayload,
  attempt: number,
): Promise<void> {
  delivery.attempts = attempt;
  delivery.updatedAt = new Date().toISOString();

  const envelope = {
    eventType: delivery.eventType,
    sentAt: new Date().toISOString(),
    payload,
  };

  const body = JSON.stringify(envelope);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'YieldVault-Webhook-Delivery/1.0',
    'X-YieldVault-Event': delivery.eventType,
    'X-YieldVault-Delivery-Id': delivery.id,
  };

  if (endpoint.secret) {
    headers['X-YieldVault-Signature'] = crypto
      .createHmac('sha256', endpoint.secret)
      .update(body)
      .digest('hex');
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

    if (attempt < maxAttempts) {
      const delayMs = calculateBackoffDelay(attempt);
      setTimeout(() => {
        void deliverWithRetry(endpoint, delivery, payload, attempt + 1);
      }, delayMs);
      return;
    }

    delivery.status = 'failed';
    delivery.updatedAt = new Date().toISOString();
  } finally {
    clearTimeout(timeout);
  }
}

function calculateBackoffDelay(attempt: number): number {
  return Math.round(retryBaseDelayMs * Math.pow(2, attempt - 1));
}
