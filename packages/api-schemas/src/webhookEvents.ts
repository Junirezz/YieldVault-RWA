import { z } from "zod";
import { AssetCodeSchema, StellarAddressSchema } from "./primitives";

/**
 * Every event type YieldVault can deliver to a registered webhook endpoint.
 *
 * This is the *outbound webhook* catalog — the events an off-chain HTTP
 * consumer receives from the backend's delivery service
 * (`backend/src/webhookDelivery.ts`). It is intentionally narrower than the
 * on-chain Soroban contract event catalog documented in
 * `docs/WEBHOOK_INTEGRATION.md`: the vault contract emits many distinct
 * ledger events (admin rotation, emergency actions, fee changes, strategy
 * bookkeeping, etc.), while webhooks surface the operational deposit,
 * withdrawal, and strategy-change events consumers need for off-chain
 * automation.
 *
 * Keep this list in sync with `TransactionEventType` in
 * `backend/src/webhookDelivery.ts` — that file is the source of truth for
 * what the server actually emits.
 */
export const WebhookEventTypeSchema = z.enum([
  "transaction.deposit.created",
  "transaction.withdrawal.created",
  "vault.deposit.created",
  "vault.withdrawal.created",
  "vault.strategy.changed",
]);

export type WebhookEventType = z.infer<typeof WebhookEventTypeSchema>;

/**
 * Monotonically increasing schema version for the outbound webhook envelope.
 * Mirrors `WEBHOOK_SCHEMA_VERSION` in `backend/src/webhookDelivery.ts`.
 * Consumers should gate on `schemaVersion` for forward-compatibility rather
 * than assuming the envelope shape is fixed.
 */
export const WEBHOOK_SCHEMA_VERSION = 1;

/**
 * Payload shared by every current transaction event. Both
 * `transaction.deposit.created` and `transaction.withdrawal.created` use
 * this same shape today; they are kept as separate schemas below so each
 * event type can diverge independently as new fields are added.
 */
const BaseTransactionEventPayloadSchema = z
  .object({
    transactionId: z.string().min(1),
    amount: z.string().min(1),
    asset: AssetCodeSchema,
    walletAddress: StellarAddressSchema,
    transactionHash: z.string().min(1),
    status: z.string().min(1),
    timestamp: z.iso.datetime(),
  })
  .strict();

const VaultEventPayloadSchema = BaseTransactionEventPayloadSchema.extend({
  vaultId: z.string().min(1),
});

const VaultStrategyChangedPayloadSchema = z
  .object({
    transactionId: z.string().min(1),
    amount: z.string().min(1),
    asset: AssetCodeSchema,
    walletAddress: z.string().min(1),
    transactionHash: z.string().min(1),
    status: z.string().min(1),
    timestamp: z.iso.datetime(),
    vaultId: z.string().min(1),
    strategyId: z.string().min(1),
    previousStrategyId: z.string().min(1).optional(),
  })
  .strict();

/** Payload for `transaction.deposit.created`. */
export const TransactionDepositCreatedPayloadSchema =
  BaseTransactionEventPayloadSchema;
export type TransactionDepositCreatedPayload = z.infer<
  typeof TransactionDepositCreatedPayloadSchema
>;

/** Payload for `transaction.withdrawal.created`. */
export const TransactionWithdrawalCreatedPayloadSchema =
  BaseTransactionEventPayloadSchema;
export type TransactionWithdrawalCreatedPayload = z.infer<
  typeof TransactionWithdrawalCreatedPayloadSchema
>;

/** Maps each event type to its payload schema. Used to validate by discriminant. */
export const WebhookEventPayloadSchemas = {
  "transaction.deposit.created": TransactionDepositCreatedPayloadSchema,
  "transaction.withdrawal.created": TransactionWithdrawalCreatedPayloadSchema,
  "vault.deposit.created": VaultEventPayloadSchema,
  "vault.withdrawal.created": VaultEventPayloadSchema,
  "vault.strategy.changed": VaultStrategyChangedPayloadSchema,
} as const satisfies Record<WebhookEventType, z.ZodTypeAny>;

/**
 * The full outbound envelope written to the wire and stored in
 * dead-letter records. Matches `WebhookEnvelope` in
 * `backend/src/webhookDelivery.ts`.
 */
export const WebhookEnvelopeSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    eventType: WebhookEventTypeSchema,
    sentAt: z.iso.datetime(),
    payload: z.union([
      BaseTransactionEventPayloadSchema,
      VaultEventPayloadSchema,
      VaultStrategyChangedPayloadSchema,
    ]),
  })
  .strict();

export type WebhookEnvelope = z.infer<typeof WebhookEnvelopeSchema>;

/**
 * Parses and validates a raw webhook delivery body against the envelope
 * schema, then re-validates `payload` against the schema specific to its
 * `eventType`. Prefer this over `WebhookEnvelopeSchema.parse` directly so
 * that payload drift for a specific event type is caught even if the
 * generic envelope shape still matches.
 */
export function parseWebhookEnvelope(data: unknown): WebhookEnvelope {
  const envelope = WebhookEnvelopeSchema.parse(data);
  const payloadSchema =
    WebhookEventPayloadSchemas[envelope.eventType as WebhookEventType];
  payloadSchema.parse(envelope.payload);
  return envelope;
}
