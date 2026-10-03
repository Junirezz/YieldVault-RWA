-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "WebhookEndpoint" ADD COLUMN "tenantId" TEXT;

-- CreateTable
CREATE TABLE "SessionAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletAddress" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" TEXT,
    "correlationId" TEXT,
    "traceId" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "SessionAuditLog_walletAddress_timestamp_idx" ON "SessionAuditLog"("walletAddress", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "SessionAuditLog_eventType_idx" ON "SessionAuditLog"("eventType");

-- CreateIndex
CREATE INDEX "SessionAuditLog_timestamp_idx" ON "SessionAuditLog"("timestamp" DESC);

-- CreateIndex
CREATE INDEX "Transaction_tenantId_idx" ON "Transaction"("tenantId");

-- CreateIndex
CREATE INDEX "Transaction_deletedAt_idx" ON "Transaction"("deletedAt");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_tenantId_idx" ON "WebhookEndpoint"("tenantId");
