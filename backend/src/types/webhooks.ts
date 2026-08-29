/**
 * Canonical webhook event types emitted by YieldVault.
 * Keep this list in sync with delivery, validation, and OpenAPI docs.
 */

export const WEBHOOK_EVENT_TYPES = [
  'transaction.deposit.created',
  'transaction.withdrawal.created',
  'vault.deposit.created',
  'vault.withdrawal.created',
  'vault.strategy.changed',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export const WEBHOOK_SIGNATURE_ALGORITHM = 'HMAC-SHA256';

export const WEBHOOK_HEADERS = {
  signature: 'X-YieldVault-Signature',
  event: 'X-YieldVault-Event',
  deliveryId: 'X-YieldVault-Delivery-Id',
  challenge: 'X-YieldVault-Challenge',
} as const;
