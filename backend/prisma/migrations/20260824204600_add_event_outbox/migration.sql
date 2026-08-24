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

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BulkExportJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "format" TEXT NOT NULL,
    "generatedBy" TEXT NOT NULL,
    "filters" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "artifactId" TEXT,
    "errorMessage" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME
);
INSERT INTO "new_BulkExportJob" ("artifactId", "completedAt", "createdAt", "errorMessage", "errorRows", "filters", "format", "generatedBy", "id", "processedRows", "status", "totalRows", "updatedAt") SELECT "artifactId", "completedAt", "createdAt", "errorMessage", "errorRows", "filters", "format", "generatedBy", "id", "processedRows", "status", "totalRows", "updatedAt" FROM "BulkExportJob";
DROP TABLE "BulkExportJob";
ALTER TABLE "new_BulkExportJob" RENAME TO "BulkExportJob";
CREATE INDEX "BulkExportJob_status_idx" ON "BulkExportJob"("status");
CREATE INDEX "BulkExportJob_createdAt_idx" ON "BulkExportJob"("createdAt");
CREATE INDEX "BulkExportJob_generatedBy_idx" ON "BulkExportJob"("generatedBy");
CREATE TABLE "new_VaultState" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "totalAssets" TEXT NOT NULL,
    "totalShares" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_VaultState" ("id", "totalAssets", "totalShares", "updatedAt") SELECT "id", "totalAssets", "totalShares", "updatedAt" FROM "VaultState";
DROP TABLE "VaultState";
ALTER TABLE "new_VaultState" RENAME TO "VaultState";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

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
