"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseWebhookEnvelope = exports.WebhookEnvelopeSchema = exports.WebhookEventPayloadSchemas = exports.TransactionWithdrawalCreatedPayloadSchema = exports.TransactionDepositCreatedPayloadSchema = exports.WEBHOOK_SCHEMA_VERSION = exports.WebhookEventTypeSchema = void 0;
const zod_1 = require("zod");
const primitives_1 = require("./primitives");
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
exports.WebhookEventTypeSchema = zod_1.z.enum([
    "transaction.deposit.created",
    "transaction.withdrawal.created",
]);
/**
 * Monotonically increasing schema version for the outbound webhook envelope.
 * Mirrors `WEBHOOK_SCHEMA_VERSION` in `backend/src/webhookDelivery.ts`.
 * Consumers should gate on `schemaVersion` for forward-compatibility rather
 * than assuming the envelope shape is fixed.
 */
exports.WEBHOOK_SCHEMA_VERSION = 1;
/**
 * Payload shared by every current transaction event. Both
 * `transaction.deposit.created` and `transaction.withdrawal.created` use
 * this same shape today; they are kept as separate schemas below so each
 * event type can diverge independently as new fields are added.
 */
const BaseTransactionEventPayloadSchema = zod_1.z
    .object({
    transactionId: zod_1.z.string().min(1),
    amount: zod_1.z.string().min(1),
    asset: primitives_1.AssetCodeSchema,
    walletAddress: primitives_1.StellarAddressSchema,
    transactionHash: zod_1.z.string().min(1),
    status: zod_1.z.string().min(1),
    timestamp: zod_1.z.iso.datetime(),
})
    .strict();
/** Payload for `transaction.deposit.created`. */
exports.TransactionDepositCreatedPayloadSchema = BaseTransactionEventPayloadSchema;
/** Payload for `transaction.withdrawal.created`. */
exports.TransactionWithdrawalCreatedPayloadSchema = BaseTransactionEventPayloadSchema;
/** Maps each event type to its payload schema. Used to validate by discriminant. */
exports.WebhookEventPayloadSchemas = {
    "transaction.deposit.created": exports.TransactionDepositCreatedPayloadSchema,
    "transaction.withdrawal.created": exports.TransactionWithdrawalCreatedPayloadSchema,
};
/**
 * The full outbound envelope written to the wire and stored in
 * dead-letter records. Matches `WebhookEnvelope` in
 * `backend/src/webhookDelivery.ts`.
 */
exports.WebhookEnvelopeSchema = zod_1.z
    .object({
    schemaVersion: zod_1.z.number().int().positive(),
    eventType: exports.WebhookEventTypeSchema,
    sentAt: zod_1.z.iso.datetime(),
    payload: BaseTransactionEventPayloadSchema,
})
    .strict();
/**
 * Parses and validates a raw webhook delivery body against the envelope
 * schema, then re-validates `payload` against the schema specific to its
 * `eventType`. Prefer this over `WebhookEnvelopeSchema.parse` directly so
 * that payload drift for a specific event type is caught even if the
 * generic envelope shape still matches.
 */
function parseWebhookEnvelope(data) {
    const envelope = exports.WebhookEnvelopeSchema.parse(data);
    const payloadSchema = exports.WebhookEventPayloadSchemas[envelope.eventType];
    payloadSchema.parse(envelope.payload);
    return envelope;
}
exports.parseWebhookEnvelope = parseWebhookEnvelope;
//# sourceMappingURL=webhookEvents.js.map