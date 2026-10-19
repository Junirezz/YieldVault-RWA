-- Issue #1617: reconcile schema.prisma with the migration history.
-- migration-safety: allow-nonconcurrent-indexes
-- migration-safety: allow-index-drop
-- SQLite does not support CONCURRENTLY.

-- The email worker polls on (status, nextRetryAt); the composite index also
-- serves status-only lookups, so the single-column status index is redundant.
CREATE INDEX "EmailQueue_status_nextRetryAt_idx" ON "EmailQueue"("status", "nextRetryAt");
DROP INDEX "EmailQueue_status_idx";

-- apiKeyAuth records last use on every authenticated request; the column was
-- only declared in a duplicate (removed) ApiKey model, never in a migration.
ALTER TABLE "ApiKey" ADD COLUMN "lastUsedAt" DATETIME;
