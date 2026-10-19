'use strict';
/**
 * Static dev/prod type drift check (issue #1546).
 *
 * The dev database is Prisma on SQLite (`prisma/schema.prisma`), production
 * storage is PostgreSQL (`migrations/*.sql`). SQLite has no NUMERIC, JSONB or
 * TIMESTAMPTZ, so those columns are stored as Prisma `String` / `DateTime`.
 * `prisma/postgres-type-mapping.json` records that mapping; this check fails
 * when either side changes without the mapping being updated:
 *
 *   - a NUMERIC / JSONB / TIMESTAMPTZ / DATE column is not listed,
 *   - a listed column or Prisma field no longer exists,
 *   - a mapped Prisma field's type differs from the mapping for its Postgres type.
 *
 * Needs no database, so it runs in CI next to `db:check-drift`.
 */
const fs = require('fs');
const path = require('path');

const backendRoot = path.resolve(__dirname, '..');
const DIVERGENT_TYPE = /^(NUMERIC|JSONB|TIMESTAMPTZ|DATE)\b/;

/** Returns `{ "table.column": "PGTYPE" }` for every CREATE TABLE column. */
function parsePostgresColumns(sql) {
  const columns = {};
  const tablePattern = /CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)\s*\(([\s\S]*?)\n\);/gi;
  for (const [, table, body] of sql.matchAll(tablePattern)) {
    for (const line of body.split('\n')) {
      const match = line.trim().match(/^(\w+)\s+([A-Z]+(?:\s*\(\s*\d+\s*(?:,\s*\d+\s*)?\))?)/);
      if (!match || /^(PRIMARY|UNIQUE|CHECK|CONSTRAINT|FOREIGN)$/i.test(match[1])) continue;
      columns[`${table}.${match[1]}`] = match[2].replace(/\s+/g, '').toUpperCase();
    }
  }
  return columns;
}

/** Returns `{ "Model.field": "Type" }` (optional `?` / list `[]` stripped). */
function parsePrismaFields(schema) {
  const fields = {};
  for (const [, model, body] of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    for (const line of body.split('\n')) {
      const match = line.trim().match(/^(\w+)\s+(\w+)(\?|\[\])?/);
      if (match) fields[`${model}.${match[1]}`] = match[2];
    }
  }
  return fields;
}

function checkTypeMapping({ sql, schema, mapping }) {
  const columns = parsePostgresColumns(sql);
  const fields = parsePrismaFields(schema);
  const errors = [];

  for (const [column, pgType] of Object.entries(columns)) {
    if (DIVERGENT_TYPE.test(pgType) && !(column in mapping.columns)) {
      errors.push(`${column} (${pgType}) is not listed in postgres-type-mapping.json`);
    }
  }

  for (const [column, field] of Object.entries(mapping.columns)) {
    const pgType = columns[column];
    if (!pgType) {
      errors.push(`${column} is mapped but not defined in migrations/*.sql`);
      continue;
    }
    if (field === null) continue;
    const expected = mapping.typeMap[pgType];
    if (!expected) {
      errors.push(`${column}: no typeMap entry for ${pgType}`);
    } else if (!fields[field]) {
      errors.push(`${column}: Prisma field ${field} does not exist`);
    } else if (fields[field] !== expected) {
      errors.push(`${column} (${pgType}) maps to ${field} which is ${fields[field]}, expected ${expected}`);
    }
  }

  return errors;
}

function loadSources(root = backendRoot) {
  const migrationsDir = path.join(root, 'migrations');
  const sql = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
    .join('\n');
  return {
    sql,
    schema: fs.readFileSync(path.join(root, 'prisma', 'schema.prisma'), 'utf8'),
    mapping: JSON.parse(
      fs.readFileSync(path.join(root, 'prisma', 'postgres-type-mapping.json'), 'utf8'),
    ),
  };
}

if (require.main === module) {
  const errors = checkTypeMapping(loadSources());
  if (errors.length > 0) {
    console.error(`Dev/prod type drift detected:\n- ${errors.join('\n- ')}`);
    process.exit(1);
  }
  console.log('Prisma (SQLite) and PostgreSQL column types match postgres-type-mapping.json');
}

module.exports = { checkTypeMapping, loadSources, parsePostgresColumns, parsePrismaFields };
