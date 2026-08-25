-- CreateTable
CREATE TABLE "AdminConfigChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "configType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "preChangeSnapshot" TEXT NOT NULL,
    "postChangeSnapshot" TEXT NOT NULL,
    "metadata" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "FeatureFlagOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "flagName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeValue" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "actor" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "EventOutbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventType" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "lockedAt" DATETIME,
    "lockedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "relayedAt" DATETIME
);

-- AlterTable: add optimistic-concurrency version column.
-- A plain ADD COLUMN with a constant DEFAULT is fully supported by SQLite
-- and preserves the existing table (and its indexes) in place, unlike
-- Prisma's default drop-and-rebuild diff for SQLite.
ALTER TABLE "BulkExportJob" ADD COLUMN "version" INTEGER DEFAULT 1 NOT NULL;

-- AlterTable: add optimistic-concurrency version column (see above).
ALTER TABLE "VaultState" ADD COLUMN "version" INTEGER DEFAULT 1 NOT NULL;

-- CreateIndex
CREATE INDEX "AdminConfigChange_configType_idx" ON "AdminConfigChange"("configType");

-- CreateIndex
CREATE INDEX "AdminConfigChange_createdAt_idx" ON "AdminConfigChange"("createdAt");

-- CreateIndex
CREATE INDEX "AdminConfigChange_actor_idx" ON "AdminConfigChange"("actor");

-- CreateIndex
CREATE INDEX "FeatureFlagOverride_flagName_idx" ON "FeatureFlagOverride"("flagName");

-- CreateIndex
CREATE INDEX "FeatureFlagOverride_scopeType_scopeValue_idx" ON "FeatureFlagOverride"("scopeType", "scopeValue");

-- CreateIndex
CREATE INDEX "FeatureFlagOverride_expiresAt_idx" ON "FeatureFlagOverride"("expiresAt");

-- CreateIndex
CREATE INDEX "FeatureFlagOverride_actor_idx" ON "FeatureFlagOverride"("actor");

-- CreateIndex
CREATE INDEX "EventOutbox_status_idx" ON "EventOutbox"("status");

-- CreateIndex
CREATE INDEX "EventOutbox_status_createdAt_idx" ON "EventOutbox"("status", "createdAt");

-- CreateIndex
CREATE INDEX "EventOutbox_aggregateType_aggregateId_idx" ON "EventOutbox"("aggregateType", "aggregateId");

-- CreateIndex
CREATE INDEX "EventOutbox_lockedAt_idx" ON "EventOutbox"("lockedAt");

-- CreateIndex
CREATE INDEX "EventOutbox_createdAt_idx" ON "EventOutbox"("createdAt");
