# Webhook system

Clients can subscribe to vault/transaction events instead of polling.

## Event types

Defined in `backend/src/types/webhooks.ts`:

- `transaction.deposit.created`
- `transaction.withdrawal.created`
- `vault.deposit.created`
- `vault.withdrawal.created`
- `vault.strategy.changed`

## Registration

| Endpoint | Auth | Notes |
| --- | --- | --- |
| `POST /api/v1/webhooks` | session JWT | End-user registration |
| `POST /admin/webhooks` | API key | Admin registration |
| `PATCH /admin/webhooks/:id` | API key | Update URL, events, secret, enabled |
| `POST /admin/webhooks/:id/verify` | API key | Challenge-response probe |
| `GET /api/v1/webhooks` / `GET /admin/webhooks` | session / API key | List + delivery metrics |

Body is validated with `WebhookRegisterSchema` (HTTPS URL, known event types,
optional HMAC secret ≥ 8 characters).

## Delivery and retries

`backend/src/webhookDelivery.ts` posts a signed envelope:

```
X-YieldVault-Event: vault.deposit.created
X-YieldVault-Delivery-Id: whd_…
X-YieldVault-Signature: <HMAC-SHA256 hex of JSON body>
```

Failed deliveries retry with exponential backoff + jitter
(`WEBHOOK_MAX_ATTEMPTS`, default 3). Exhausted deliveries go to the dead-letter
queue (`POST /admin/webhooks/dead-letter/:id/retry` to re-queue).

Replay-safe dedup lives in `backend/src/webhookDeduplication.ts`.

## Signature verification

Receivers compute `HMAC-SHA256(secret, raw JSON body)` and compare with
`X-YieldVault-Signature` using a timing-safe equals. YieldVault also exposes:

`POST /api/v1/webhooks/verify` `{ secret, payload, signature? }` → `{ algorithm, signature, verified }`.

## Monitoring

- Structured logs: `webhook.delivery.attempt|retry|success|failed`
- `GET /admin/webhooks/deliveries` — paginated attempt history
- `GET /admin/jobs/monitor` and the admin dashboard include
  `getWebhookDeliveryMetrics()` (totals, pending, failed, timeouts)
- `GET /admin/webhooks/deduplication/metrics`
