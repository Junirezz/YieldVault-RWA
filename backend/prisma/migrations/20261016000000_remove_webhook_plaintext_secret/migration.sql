-- migration-safety: allow-webhook-secret-drop
ALTER TABLE "WebhookEndpoint" DROP COLUMN "secret";