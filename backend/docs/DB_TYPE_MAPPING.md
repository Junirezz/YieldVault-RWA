# Dev / prod column type mapping

Development and tests run Prisma against SQLite (`prisma/schema.prisma`,
`file:./dev.db`). Production storage is PostgreSQL, created by the raw SQL
migrations in `migrations/*.sql`. SQLite has no exact decimal, JSON or
timezone-aware timestamp type, so those columns use different types on each
side:

| PostgreSQL (prod)            | Prisma / SQLite (dev) | Encoding rule |
|------------------------------|-----------------------|---------------|
| `NUMERIC(38, 18)`            | `String`              | Plain decimal string, at most 20 integer and 18 fractional digits. Parse and do arithmetic with `NumericDecimal` and write with `toNumeric38_18` (`src/numericColumns.ts`); plain `Decimal` keeps only 20 significant digits and rounds silently. |
| `NUMERIC(12, 6)`             | `String`              | Plain decimal string. |
| `JSONB`                      | `String`              | `JSON.stringify` on write, `JSON.parse` on read. |
| `TIMESTAMPTZ`, `DATE`        | `DateTime`            | Always UTC. |

The column-by-column mapping lives in `prisma/postgres-type-mapping.json`.
Every PostgreSQL `NUMERIC` / `JSONB` / `TIMESTAMPTZ` / `DATE` column must be
listed there, either with the Prisma field that mirrors it or `null` when it
has no dev counterpart.

## Drift check

```bash
npm run db:check-types
```

`scripts/check-type-mapping.js` parses the schema, the migrations and the
mapping (no database needed) and fails when:

- a new `NUMERIC` / `JSONB` / `TIMESTAMPTZ` / `DATE` column is not in the mapping,
- a mapped column or Prisma field no longer exists,
- a mapped Prisma field's type differs from the mapping for its PostgreSQL type
  (for example an amount changed to `Float`).

It runs in the Backend Governance workflow next to `db:check-drift`, which
checks the applied PostgreSQL migrations themselves.
