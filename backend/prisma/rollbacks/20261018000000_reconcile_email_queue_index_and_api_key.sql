-- Rollback for 20261018000000_reconcile_email_queue_index_and_api_key (#1617).
-- Apply with: npm run prisma:rollback -- --name 20261018000000_reconcile_email_queue_index_and_api_key

-- migration-safety: canary-safe

CREATE INDEX IF NOT EXISTS "EmailQueue_status_idx" ON "EmailQueue"("status");
DROP INDEX IF EXISTS "EmailQueue_status_nextRetryAt_idx";
ALTER TABLE "ApiKey" DROP COLUMN "lastUsedAt";
