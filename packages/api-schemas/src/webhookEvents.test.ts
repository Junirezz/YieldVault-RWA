import { describe, expect, it } from "vitest";
import {
  TransactionDepositCreatedPayloadSchema,
  TransactionWithdrawalCreatedPayloadSchema,
  WEBHOOK_SCHEMA_VERSION,
  WebhookEnvelopeSchema,
  WebhookEventPayloadSchemas,
  WebhookEventTypeSchema,
  parseWebhookEnvelope,
} from "./index";

const VALID_ADDRESS = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const validPayload = {
  transactionId: "tx_123",
  amount: "125.00",
  asset: "USDC",
  walletAddress: VALID_ADDRESS,
  transactionHash: "abc123",
  status: "pending",
  timestamp: "2026-05-26T00:00:00.000Z",
};

describe("WebhookEventTypeSchema", () => {
  it("accepts every currently-emitted event type", () => {
    expect(WebhookEventTypeSchema.safeParse("transaction.deposit.created").success).toBe(true);
    expect(WebhookEventTypeSchema.safeParse("transaction.withdrawal.created").success).toBe(true);
    expect(WebhookEventTypeSchema.safeParse("vault.deposit.created").success).toBe(true);
    expect(WebhookEventTypeSchema.safeParse("vault.withdrawal.created").success).toBe(true);
    expect(WebhookEventTypeSchema.safeParse("vault.strategy.changed").success).toBe(true);
  });

  it("rejects event types the backend does not emit", () => {
    expect(WebhookEventTypeSchema.safeParse("transaction.deposit.confirmed").success).toBe(false);
    expect(WebhookEventTypeSchema.safeParse("deposit").success).toBe(false);
  });

  it("has exactly one payload schema registered per event type", () => {
    const eventTypes = WebhookEventTypeSchema.options;
    expect(Object.keys(WebhookEventPayloadSchemas).sort()).toEqual([...eventTypes].sort());
  });
});

describe("transaction event payload schemas", () => {
  it("accepts a well-formed deposit payload", () => {
    expect(TransactionDepositCreatedPayloadSchema.safeParse(validPayload).success).toBe(true);
  });

  it("accepts a well-formed withdrawal payload", () => {
    expect(TransactionWithdrawalCreatedPayloadSchema.safeParse(validPayload).success).toBe(true);
  });

  it("rejects a payload missing a required field", () => {
    const { transactionId, ...withoutId } = validPayload;
    expect(TransactionDepositCreatedPayloadSchema.safeParse(withoutId).success).toBe(false);
  });

  it("rejects a payload with an invalid wallet address", () => {
    const result = TransactionDepositCreatedPayloadSchema.safeParse({
      ...validPayload,
      walletAddress: "not-a-stellar-address",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown extra fields (strict envelope)", () => {
    const result = TransactionDepositCreatedPayloadSchema.safeParse({
      ...validPayload,
      unexpectedField: "surprise",
    });
    expect(result.success).toBe(false);
  });
});

describe("WebhookEnvelopeSchema", () => {
  it("matches the exact envelope shape produced by backend/src/webhookDelivery.ts", () => {
    const envelope = {
      schemaVersion: WEBHOOK_SCHEMA_VERSION,
      eventType: "transaction.deposit.created",
      sentAt: "2026-05-26T00:00:00.000Z",
      payload: validPayload,
    };

    const result = WebhookEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(true);
  });

  it("rejects an envelope whose payload doesn't match its own generic shape", () => {
    const result = WebhookEnvelopeSchema.safeParse({
      schemaVersion: WEBHOOK_SCHEMA_VERSION,
      eventType: "transaction.deposit.created",
      sentAt: "2026-05-26T00:00:00.000Z",
      payload: { transactionId: "tx_123" },
    });
    expect(result.success).toBe(false);
  });
});

describe("parseWebhookEnvelope", () => {
  it("validates the envelope and its event-specific payload together", () => {
    const envelope = parseWebhookEnvelope({
      schemaVersion: WEBHOOK_SCHEMA_VERSION,
      eventType: "transaction.withdrawal.created",
      sentAt: "2026-05-26T00:00:00.000Z",
      payload: validPayload,
    });

    expect(envelope.eventType).toBe("transaction.withdrawal.created");
  });

  it("validates vault deposit payloads with vault identity", () => {
    const envelope = parseWebhookEnvelope({
      schemaVersion: WEBHOOK_SCHEMA_VERSION,
      eventType: "vault.deposit.created",
      sentAt: "2026-05-26T00:00:00.000Z",
      payload: {
        ...validPayload,
        vaultId: "primary",
      },
    });

    expect(envelope.eventType).toBe("vault.deposit.created");
  });

  it("validates vault strategy change payloads", () => {
    const envelope = parseWebhookEnvelope({
      schemaVersion: WEBHOOK_SCHEMA_VERSION,
      eventType: "vault.strategy.changed",
      sentAt: "2026-05-26T00:00:00.000Z",
      payload: {
        ...validPayload,
        walletAddress: "unknown",
        asset: "RWA",
        vaultId: "primary",
        strategyId: "conservative",
        previousStrategyId: "balanced",
      },
    });

    expect(envelope.eventType).toBe("vault.strategy.changed");
  });

  it("throws for an envelope with an unrecognized eventType", () => {
    expect(() =>
      parseWebhookEnvelope({
        schemaVersion: WEBHOOK_SCHEMA_VERSION,
        eventType: "transaction.deposit.confirmed",
        sentAt: "2026-05-26T00:00:00.000Z",
        payload: validPayload,
      }),
    ).toThrow();
  });
});
