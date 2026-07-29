# Critical Entity Soft Deletion and Audit Trail

Issue #1047 protects critical control-plane records from accidental,
unaudited hard deletion.

## Scope

The audited lifecycle service covers:

- `Tenant`
- persisted `ApiKey`

Existing `WebhookEndpoint` deletion remains a soft delete with
`deletedAt`/`deletedBy` and admin audit logging. `ScopedAdminToken` uses
revocation rather than deletion. Generic Prisma hard deletes are blocked
outside tests for all four entity types and for `CriticalEntityAuditEvent`.

Financial records (`Transaction`, vault state, share-price snapshots, and
reconciliation history) are deliberately excluded. They remain immutable and
follow the regulatory retention policy rather than a reversible application
delete workflow.

## Invariants

1. Delete and restore operations require a non-empty actor and reason.
2. State changes and `CriticalEntityAuditEvent` creation occur in one database
   transaction.
3. Conditional `updateMany` predicates make retries idempotent and prevent two
   concurrent requests from producing duplicate lifecycle events.
4. Deleting a tenant atomically disables and soft-deletes all of its active API
   keys.
5. Restoring a tenant does not restore credentials. Each API key requires a
   separate audited restore after the tenant is active.
6. Authentication rejects keys whose key record or parent tenant is deleted.
7. Audit metadata never includes plaintext credentials or stored key hashes.
8. Audit rows are append-only. Generic Prisma `delete`/`deleteMany` operations
   against protected models throw outside the test environment.

Raw SQL bypasses Prisma safeguards and must not be used for lifecycle changes.
Retention cleanup that eventually hard-deletes records must use a dedicated,
reviewed maintenance path after the documented grace period.

## Service API

Use `src/criticalEntityLifecycle.ts`:

```ts
await softDeleteTenant('tenant-id', {
  actor: 'admin@example.com',
  reason: 'Customer account closed',
});

await restoreTenant('tenant-id', {
  actor: 'security-admin@example.com',
  reason: 'Closure reversed after verification',
});

await softDeleteApiKey('api-key-id', {
  actor: 'security-admin@example.com',
  reason: 'Credential compromised',
});
```

The result status is one of:

- `changed`
- `not_found`
- `already_deleted`
- `not_deleted`
- `parent_deleted`

Treat statuses other than `changed` as no-op outcomes; they never create a
duplicate audit event.

## Audit review

`listCriticalEntityAuditTrail` supports entity type, entity ID, and action
filters. Results are newest-first and capped at 500 records per call.

An audit record contains:

- entity type and ID
- `soft_delete` or `restore`
- attributable actor
- required reason
- non-sensitive operation metadata
- database-generated timestamp

Retain `CriticalEntityAuditEvent` records for seven years with other security
audit data. They must not be changed or removed through application CRUD.

## Deployment

1. Back up the database.
2. Apply migration
   `20260729000000_add_critical_entity_soft_delete`.
3. Confirm the new nullable columns and audit table exist.
4. Delete a non-production API key through the lifecycle service.
5. Verify authentication fails immediately.
6. Verify exactly one `CriticalEntityAuditEvent` exists.
7. Restore the key and verify a second audit event is appended.

Rollback should restore application code first. The nullable columns and audit
table are backward-compatible and should be retained until their data has been
archived and a separate destructive migration is approved.
