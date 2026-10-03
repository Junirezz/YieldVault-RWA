-- AlterTable: add name and symbol columns to Vault
-- Both default to '' temporarily so the column can be added to existing rows,
-- then the default is not enforced at the DB level (Prisma handles NOT NULL via
-- the application layer). New rows always supply name and symbol via the API.
ALTER TABLE "Vault" ADD COLUMN "name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Vault" ADD COLUMN "symbol" TEXT NOT NULL DEFAULT '';
