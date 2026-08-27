# Prisma migration workflow

Schema changes for the YieldVault API are version-controlled under
`backend/prisma/migrations`. Do not edit the live database by hand.

## Layout

```
backend/prisma/
  schema.prisma          # source of truth
  migrations/
    0_init/              # baseline of the existing schema
    <timestamp>_<name>/
      migration.sql
    migration_lock.toml
  rollbacks/             # optional down SQL, named after the forward migration
```

Legacy SQL scripts (non-Prisma) live in `backend/migrations/` and are applied
with `npm run db:migrate` against Postgres.

## Everyday commands

Run from `backend/`:

| Script | Purpose |
| --- | --- |
| `npm run prisma:generate` | Regenerate the Prisma client |
| `npm run prisma:schema-check` | Validate the schema and fail if committed migrations do not produce it |
| `npm run prisma:migrate -- --name add_foo` | Create a migration from `schema.prisma` (dev) |
| `npm run prisma:deploy` | Apply pending migrations (CI / prod) |
| `npm run prisma:status` | Show applied vs pending |
| `npm run prisma:rollback -- --name <migration>` | Apply down SQL and mark rolled back |
| `npm run check:migrations:canary` | Reject unsafe canary-breaking SQL |

Create a change:

1. Edit `backend/prisma/schema.prisma`.
2. `npm run prisma:migrate -- --name describe_the_change`.
3. Review the generated `migration.sql`.
4. Add a matching file in `prisma/rollbacks/<migration_folder>.sql` if the
   change is reversible.
5. Commit schema, migration, and rollback together.

The backend governance workflow runs `prisma:schema-check` on every pull
request that changes the backend or migration workflow. The check validates
`schema.prisma`, then compares the final state represented by
`prisma/migrations` with the schema datamodel. A non-zero result means the
schema was changed without a matching migration, a migration was edited after
being applied, or a migration folder is incomplete. Do not bypass this check
by editing generated or deployed database state; create and commit the proper
forward migration instead.

Existing schema is already captured by `0_init` plus follow-up migrations.
New environments run `prisma:deploy` (SQLite/dev) or `db:migrate` (Postgres).

## Testing

- `backend/src/__tests__/prismaMigrationWorkflow.test.ts` asserts every
  migration folder has `migration.sql` and that rollback files parse.
- `backend/src/__tests__/canaryMigrationCheck.test.ts` covers unsafe SQL
  detection.
- CI runs `node scripts/check-migrations.js` and `npm run check:migrations:canary`.

## Rollback procedures

Prisma does not generate automatic down migrations. Rollback is explicit:

1. **Expand/contract (preferred):** ship a new forward migration that restores
   compatibility (re-add a column, backfill, then drop the new one later).
2. **Documented down SQL:**
   ```bash
   cd backend
   npm run prisma:rollback -- --name 20260530020000_add_webhook_verification
   ```
   The script applies `prisma/rollbacks/<name>.sql` inside a transaction, then
   runs `prisma migrate resolve --rolled-back <name>` so the migration can be
   re-applied later.
3. **Failed deploy (never applied):** `npx prisma migrate resolve --rolled-back <name>`
   without running SQL.
4. **Restore from backup** if the change is destructive (`DROP TABLE`, data
   rewrite). See `docs/runbooks/rollback-and-hotfix.md`.

Never `DROP` or `TRUNCATE` in a canary window. Follow
`docs/CANARY_MIGRATION_STRATEGY.md`.

## Drift recovery

When CI reports schema drift:

1. Run `npm run prisma:schema-check` from `backend/` and inspect the diff.
2. If `schema.prisma` is ahead, create a named migration with
  `npm run prisma:migrate -- --name <description>` and commit its
  `migration.sql`.
3. If a committed migration was edited after deployment, restore its original
  SQL and create a new corrective migration. Never rewrite an applied
  migration to make the check pass.
4. Check the target with `npm run prisma:status`. For a failed deployment,
  resolve the migration only after confirming whether any SQL was applied.
5. Use the documented rollback SQL or restore a verified backup for destructive
  changes, then deploy the corrective forward migration and rerun the checks.

For an unapplied migration, use:

```bash
npx prisma migrate resolve --schema prisma/schema.prisma --rolled-back <name>
```

For an applied migration with a rollback file, use
`npm run prisma:rollback -- --name <name>` and follow the script output. Take a
backup and coordinate production recovery before running destructive rollback
SQL.
