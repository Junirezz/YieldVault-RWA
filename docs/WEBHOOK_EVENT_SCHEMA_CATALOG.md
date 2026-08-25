# Webhook Event Schema Catalog

This is the authoritative, machine-readable catalog of every event
YieldVault's **HTTP webhook delivery service** can send to a registered
webhook endpoint, and the exact shape of each one.

It is generated directly from the Zod schemas in
[`packages/api-schemas/src/webhookEvents.ts`](../packages/api-schemas/src/webhookEvents.ts),
which mirror the `TransactionEventType` / `WebhookEnvelope` types the
backend actually uses in
[`backend/src/webhookDelivery.ts`](../backend/src/webhookDelivery.ts). A
test in `packages/api-schemas/scripts/generate-webhook-json-schema.test.ts`
fails CI if the committed JSON files below ever drift from that source of
truth.

> **Not the same thing as the on-chain contract event catalog.** The vault
> Soroban contract emits a much larger set of ledger events (admin
> rotation, emergency actions, fee changes, strategy bookkeeping, etc. —
> see the [Event Catalog](./WEBHOOK_INTEGRATION.md#event-catalog) section
> of the integration guide). The HTTP webhook pipeline surfaces the
> operational deposit, withdrawal, and strategy-change events listed below.
> If you need the full contract event set, consume it from Soroban RPC
> directly.

## Where the machine-readable files live

```
docs/schemas/webhooks/
├── catalog.json                                       # index of every event type + its schema file
├── envelope.schema.json                                # the outer JSON envelope every delivery uses
├── transaction.deposit.created.payload.schema.json     # payload shape for this event type
├── transaction.withdrawal.created.payload.schema.json  # payload shape for this event type
├── vault.deposit.created.payload.schema.json           # vault deposit payload with vaultId
├── vault.withdrawal.created.payload.schema.json        # vault withdrawal payload with vaultId
└── vault.strategy.changed.payload.schema.json          # strategy selection payload
```

Each `*.schema.json` file is a standard [JSON Schema (2020-12
draft)](https://json-schema.org/draft/2020-12/schema) document. Validate
an incoming delivery in any language with a JSON Schema library — you are
not required to use TypeScript or this repo's `zod` schemas to consume
webhooks.

## Regenerating

If you change `packages/api-schemas/src/webhookEvents.ts` (e.g. to add a
new event type or a new payload field), regenerate the catalog:

```bash
cd packages/api-schemas
npm run schemas:generate
```

This overwrites the files under `docs/schemas/webhooks/` from the current
Zod schemas. Commit the resulting diff along with your source change —
`generate-webhook-json-schema.test.ts` will fail otherwise.

## Current event types

| Event type                        | Emitted when                                                      | Schema version |
| ---------------------------------- | ------------------------------------------------------------------- | --------------- |
| `transaction.deposit.created`      | A deposit transaction is submitted (status starts as `"pending"`)   | 1               |
| `transaction.withdrawal.created`   | A withdrawal transaction is submitted (status starts as `"pending"`) | 1               |
| `vault.deposit.created`            | A vault deposit is accepted into the outbox                         | 1               |
| `vault.withdrawal.created`         | A vault withdrawal is accepted into the outbox                      | 1               |
| `vault.strategy.changed`           | The v2 strategy selection preview endpoint accepts a strategy change | 1               |

The top-level envelope's `schemaVersion` field (currently `1`) increments
whenever the envelope shape changes in a **breaking** way. Consumers
should check `schemaVersion` and handle unknown/newer versions
defensively rather than assuming the shape is fixed forever.

## Envelope shape

Every delivery body is:

```json
{
  "schemaVersion": 1,
  "eventType": "transaction.deposit.created",
  "sentAt": "2026-05-26T00:00:00.000Z",
  "payload": { "...": "see payload schema for this eventType" }
}
```

See [`envelope.schema.json`](./schemas/webhooks/envelope.schema.json) for
the full JSON Schema.

## Payload shape (transaction events)

```json
{
  "transactionId": "tx_123",
  "amount": "125.00",
  "asset": "USDC",
  "walletAddress": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "transactionHash": "abc123",
  "status": "pending",
  "timestamp": "2026-05-26T00:00:00.000Z"
}
```

| Field             | Type   | Notes                                                             |
| ----------------- | ------ | ------------------------------------------------------------------ |
| `transactionId`   | string | Internal transaction identifier, non-empty                        |
| `amount`          | string | Decimal amount as a string, to preserve precision                 |
| `asset`           | string | One of the configured asset codes (e.g. `XLM`, `USDC`, `yUSDC`, `RWA`) |
| `walletAddress`   | string | Stellar public key: `G...`, 56 characters                          |
| `transactionHash` | string | Non-empty                                                          |
| `status`          | string | Non-empty (currently always `"pending"` at emission time)          |
| `timestamp`       | string | ISO 8601 datetime                                                  |

Both transaction event types share this exact payload shape today. They're kept as
separate schemas in code (`TransactionDepositCreatedPayloadSchema`,
`TransactionWithdrawalCreatedPayloadSchema`) so each can evolve
independently without affecting the other — don't assume they'll always
be identical.

## Payload shape (vault events)

`vault.deposit.created` and `vault.withdrawal.created` use the transaction
payload fields plus a required `vaultId`:

```json
{
  "transactionId": "tx_123",
  "amount": "125.00",
  "asset": "USDC",
  "walletAddress": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "transactionHash": "abc123",
  "status": "pending",
  "timestamp": "2026-05-26T00:00:00.000Z",
  "vaultId": "primary"
}
```

`vault.strategy.changed` includes the same delivery correlation fields,
the target `vaultId`, the new `strategyId`, and an optional
`previousStrategyId` when the caller supplies one.

Delivery bodies are also signed; see
[`WEBHOOK_SIGNATURES.md`](../backend/docs/WEBHOOK_SIGNATURES.md) for the
`X-YieldVault-Signature` HMAC verification contract, and the [Signature
Verification](./WEBHOOK_INTEGRATION.md#signature-verification) section of
the integration guide for retry/reliability behavior.

## Validating a delivery (any language)

```ts
// TypeScript / JavaScript, using this repo's schemas directly
import { parseWebhookEnvelope } from "@yieldvault/api-schemas";

const envelope = parseWebhookEnvelope(JSON.parse(rawBody));
// Throws if the envelope or its event-specific payload doesn't match.
```

```python
# Any language, using the plain JSON Schema files — no dependency on this repo's code
import json
import jsonschema

envelope_schema = json.load(open("docs/schemas/webhooks/envelope.schema.json"))
jsonschema.validate(instance=received_body, schema=envelope_schema)
```
