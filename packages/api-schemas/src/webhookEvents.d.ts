import { z } from "zod";
/**
 * Every event type YieldVault can deliver to a registered webhook endpoint.
 *
 * This is the *outbound webhook* catalog — the events an off-chain HTTP
 * consumer receives from the backend's delivery service
 * (`backend/src/webhookDelivery.ts`). It is intentionally narrower than the
 * on-chain Soroban contract event catalog documented in
 * `docs/WEBHOOK_INTEGRATION.md`: the vault contract emits ~28 distinct
 * ledger events (admin rotation, emergency actions, fee changes, strategy
 * bookkeeping, etc.), but only transaction-level activity is currently
 * surfaced through the webhook delivery pipeline. Consumers that need the
 * full contract event set should query Soroban RPC directly rather than
 * relying on webhooks for those events.
 *
 * Keep this list in sync with `TransactionEventType` in
 * `backend/src/webhookDelivery.ts` — that file is the source of truth for
 * what the server actually emits.
 */
export declare const WebhookEventTypeSchema: any;
export type WebhookEventType = z.infer<typeof WebhookEventTypeSchema>;
/**
 * Monotonically increasing schema version for the outbound webhook envelope.
 * Mirrors `WEBHOOK_SCHEMA_VERSION` in `backend/src/webhookDelivery.ts`.
 * Consumers should gate on `schemaVersion` for forward-compatibility rather
 * than assuming the envelope shape is fixed.
 */
export declare const WEBHOOK_SCHEMA_VERSION = 1;
/** Payload for `transaction.deposit.created`. */
export declare const TransactionDepositCreatedPayloadSchema: any;
export type TransactionDepositCreatedPayload = z.infer<typeof TransactionDepositCreatedPayloadSchema>;
/** Payload for `transaction.withdrawal.created`. */
export declare const TransactionWithdrawalCreatedPayloadSchema: any;
export type TransactionWithdrawalCreatedPayload = z.infer<typeof TransactionWithdrawalCreatedPayloadSchema>;
/** Maps each event type to its payload schema. Used to validate by discriminant. */
export declare const WebhookEventPayloadSchemas: {
    readonly "transaction.deposit.created": any;
    readonly "transaction.withdrawal.created": any;
};
/**
 * The full outbound envelope written to the wire and stored in
 * dead-letter records. Matches `WebhookEnvelope` in
 * `backend/src/webhookDelivery.ts`.
 */
export declare const WebhookEnvelopeSchema: any;
export type WebhookEnvelope = z.infer<typeof WebhookEnvelopeSchema>;
/**
 * Parses and validates a raw webhook delivery body against the envelope
 * schema, then re-validates `payload` against the schema specific to its
 * `eventType`. Prefer this over `WebhookEnvelopeSchema.parse` directly so
 * that payload drift for a specific event type is caught even if the
 * generic envelope shape still matches.
 */
export declare function parseWebhookEnvelope(data: unknown): WebhookEnvelope;
//# sourceMappingURL=webhookEvents.d.ts.map