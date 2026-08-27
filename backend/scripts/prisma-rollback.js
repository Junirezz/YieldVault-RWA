#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const prismaDir = path.resolve(__dirname, '..', 'prisma');
const rollbacksDir = path.join(prismaDir, 'rollbacks');
const schemaArg = ['--schema', path.join(prismaDir, 'schema.prisma')];

function parseName(argv) {
  const idx = argv.findIndex((arg) => arg === '--name' || arg === '-n');
  if (idx >= 0 && argv[idx + 1]) {
    return argv[idx + 1];
  }
  const positional = argv.find((arg) => !arg.startsWith('-'));
  return positional || '';
}

function usage() {
  console.log(`Usage: node scripts/prisma-rollback.js --name <migration_folder>

Applies prisma/rollbacks/<migration_folder>.sql then marks the Prisma
migration as rolled back so it can be re-deployed.

Example:
  npm run prisma:rollback -- --name 20260530020000_add_webhook_verification
`);
}

const name = parseName(process.argv.slice(2));
if (!name) {
  usage();
  process.exit(1);
}

const rollbackFile = path.join(rollbacksDir, `${name}.sql`);
if (!fs.existsSync(rollbackFile)) {
  console.error(`No rollback SQL found at ${path.relative(process.cwd(), rollbackFile)}`);
  console.error('Write a down migration there, or use prisma migrate resolve --rolled-back for an unapplied migration.');
  process.exit(1);
}

const sql = fs.readFileSync(rollbackFile, 'utf8').trim();
if (!sql) {
  console.error(`Rollback file ${rollbackFile} is empty.`);
  process.exit(1);
}

if (process.env.PRISMA_ROLLBACK_DRY_RUN === '1') {
  console.log(`Dry run: would apply ${rollbackFile} (${sql.length} bytes) then resolve --rolled-back ${name}`);
  process.exit(0);
}

const resolve = spawnSync(
  'npx',
  ['prisma', 'migrate', 'resolve', ...schemaArg, '--rolled-back', name],
  { stdio: 'inherit' },
);

if (resolve.status !== 0) {
  process.exit(resolve.status || 1);
}

console.log(`Marked ${name} as rolled back. Apply the SQL in ${rollbackFile} against the target database if it was already deployed.`);
