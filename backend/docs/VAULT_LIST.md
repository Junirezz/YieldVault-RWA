# Vault listing and count caching

`GET /api/v1/vaults` (also `/api/vaults` and `/vaults`) lists the existing
Prisma `Vault` records. Send `Authorization: ApiKey <key>`. Non-admin keys
are restricted to their authenticated tenant; admin and super-admin keys may
optionally filter by `tenantId` or list all tenants. Soft-deleted records are
excluded from both rows and totals.

The response uses the existing `{ data, pagination, timestamp }` envelope.
`limit` defaults to 20 and is capped at 100; `page` starts at 1. Sorting accepts
`createdAt` (default), `updatedAt`, `id`, or `aum`, and `sortOrder=asc|desc`
(default `desc`). An ID tie-breaker keeps offset pages deterministic.
Cursor pagination is not supported on this endpoint.

Only `pagination.total` is cached. Page rows always execute `findMany`.
`X-Cache: MISS` indicates a new count query; `HIT` indicates reuse of the
same normalized filter hash, including effective tenant and deletion filters.
Changing pagination or sort options reuses the same total. Zero totals are
cached too. Responses use `Cache-Control: no-store` to avoid sharing API-key
responses through an HTTP cache.

The count cache uses the optional-Redis deployment's in-memory LRU option:
500 filter entries per backend process, each valid for five seconds after
the query completes. Concurrent requests for the same filter share one count
query; failures are evicted. Successful Vault create/update/delete operations
(including bulk variants and upsert) on either application Prisma client call
`triggerCacheInvalidation` and clear all filter totals. Updates include soft
deletion and tenant changes. In-flight counts invalidated by a write are retried.

This cache is process-local: writes from another worker, raw SQL, or an external
client are reflected when the five-second TTL expires. Prisma mutation hooks
run after a successful statement; callers using explicit transactions should
also call `triggerCacheInvalidation('vault.update')` after commit, since reads
can refill the cache before a long transaction commits.
