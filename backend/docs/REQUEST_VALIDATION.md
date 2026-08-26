# Request validation (Zod)

YieldVault validates incoming HTTP data with Zod before handlers run. Invalid
payloads never reach business logic.

## Middleware

`backend/src/middleware/validate.ts` exports `validate({ body, query, params })`.

```ts
router.post('/admin/maintenance', validateApiKey, validate({ body: MaintenanceToggleSchema }), handler);
```

On failure the middleware returns **400** with:

| Field | Meaning |
| --- | --- |
| `error` | Always `Bad Request` |
| `status` | `400` |
| `code` | `VALIDATION_ERROR` |
| `message` | Human-readable summary of all issues |
| `details[]` | `{ code, field, message }` per issue |
| `retryable` | `false` |

Unknown body fields are stripped unless the schema uses `.strict()` (auth and
webhook register/update reject unknown keys).

## Schema locations

| File | Contents |
| --- | --- |
| `backend/src/types/validation.ts` | Admin/list/body/query schemas |
| `backend/src/types/webhooks.ts` | Webhook event type literals |
| `backend/src/middleware/validate.ts` | Auth, alias, webhook register schemas + middleware |
| `packages/api-schemas` | Shared vault deposit/withdrawal contracts |

## Common rules

- **Stellar addresses** on login/nonce: checksummed `G…` public keys.
- **Pagination query**: optional `limit`, `cursor`, `page`, `sortBy`, `sortOrder`.
- **Webhook URLs**: `http` or `https` only; secrets 8–256 characters.
- **Dates**: `YYYY-MM-DD` for APY backfill; ISO-8601 for maintenance windows.
- **IDs**: path params such as `:id` must be non-empty strings.

## Adding a new endpoint

1. Define a Zod schema in `backend/src/types/validation.ts`.
2. Attach `validate({ body })` and/or `validate({ query, params })` on the route.
3. Add a case to `backend/src/__tests__/validation.test.ts` or
   `requestValidation.test.ts`.
4. Document the fields in this file if they are public API.
