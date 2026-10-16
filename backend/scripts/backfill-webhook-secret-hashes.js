'use strict';

const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const columns = await prisma.$queryRawUnsafe('PRAGMA table_info("WebhookEndpoint")');
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has('secret') || !columnNames.has('secretHash')) return;

  const endpoints = await prisma.$queryRawUnsafe(
    'SELECT id, secret FROM "WebhookEndpoint" WHERE secret IS NOT NULL AND secretHash IS NULL',
  );

  for (const endpoint of endpoints) {
    const secretHash = crypto.createHash('sha256').update(endpoint.secret).digest('hex');
    await prisma.$executeRawUnsafe(
      'UPDATE "WebhookEndpoint" SET secretHash = ? WHERE id = ?',
      secretHash,
      endpoint.id,
    );
  }
}

main()
  .catch((error) => {
    console.error('Webhook secret hash backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });