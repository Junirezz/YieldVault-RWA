-- Example rollback for additive webhook verification columns.
-- Apply with: npm run prisma:rollback -- --name 20260530020000_add_webhook_verification
--
-- Prefer expand/contract (add a new forward migration) in production canaries.

-- migration-safety: canary-safe
-- This file is documentation/sample only; destructive drops are listed as comments.

-- ALTER TABLE "WebhookEndpoint" DROP COLUMN "verificationStatus";
-- ALTER TABLE "WebhookEndpoint" DROP COLUMN "verifiedAt";
-- ALTER TABLE "WebhookEndpoint" DROP COLUMN "lastVerificationError";

SELECT 1;
