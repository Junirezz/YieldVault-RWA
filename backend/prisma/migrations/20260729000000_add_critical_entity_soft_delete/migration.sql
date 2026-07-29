-- Issue #1047: soft deletion and immutable lifecycle audits for critical
-- control-plane entities. Financial history remains immutable and is not
-- covered by this reversible deletion mechanism.
-- migration-safety: allow-not-null-add
-- migration-safety: allow-nonconcurrent-indexes
-- The added columns are nullable. The NOT NULL detector otherwise scans into
-- the later CREATE TABLE statement. SQLite does not support CONCURRENTLY.

-- Tenant and ApiKey existed in schema.prisma before they were represented in
-- the migration history. Establish their baseline shape on clean databases;
-- existing managed databases treat these statements as no-ops.
CREATE TABLE IF NOT EXISTS "Tenant" (
  "id"        TEXT     NOT NULL PRIMARY KEY,
  "name"      TEXT     NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_name_key" ON "Tenant"("name");
CREATE INDEX IF NOT EXISTS "Tenant_name_idx" ON "Tenant"("name");

CREATE TABLE IF NOT EXISTS "ApiKey" (
  "id"        TEXT     NOT NULL PRIMARY KEY,
  "tenantId"  TEXT     NOT NULL,
  "hashedKey" TEXT     NOT NULL,
  "role"      TEXT     NOT NULL,
  "scopes"    TEXT     NOT NULL DEFAULT '[]',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" DATETIME,
  "isActive"  BOOLEAN  NOT NULL DEFAULT true,
  CONSTRAINT "ApiKey_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ApiKey_hashedKey_key" ON "ApiKey"("hashedKey");
CREATE INDEX IF NOT EXISTS "ApiKey_tenantId_idx" ON "ApiKey"("tenantId");
CREATE INDEX IF NOT EXISTS "ApiKey_role_idx" ON "ApiKey"("role");

ALTER TABLE "Tenant" ADD COLUMN "deletedAt" DATETIME;
ALTER TABLE "Tenant" ADD COLUMN "deletedBy" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "deletionReason" TEXT;

ALTER TABLE "ApiKey" ADD COLUMN "deletedAt" DATETIME;
ALTER TABLE "ApiKey" ADD COLUMN "deletedBy" TEXT;
ALTER TABLE "ApiKey" ADD COLUMN "deletionReason" TEXT;

CREATE TABLE "CriticalEntityAuditEvent" (
  "id"         TEXT     NOT NULL PRIMARY KEY,
  "entityType" TEXT     NOT NULL,
  "entityId"   TEXT     NOT NULL,
  "action"     TEXT     NOT NULL,
  "actor"      TEXT     NOT NULL,
  "reason"     TEXT     NOT NULL,
  "metadata"   TEXT     NOT NULL DEFAULT '{}',
  "createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "Tenant_deletedAt_idx" ON "Tenant"("deletedAt");
CREATE INDEX "ApiKey_tenantId_deletedAt_idx" ON "ApiKey"("tenantId", "deletedAt");
CREATE INDEX "ApiKey_deletedAt_idx" ON "ApiKey"("deletedAt");
CREATE INDEX "CriticalEntityAuditEvent_entityType_entityId_createdAt_idx"
  ON "CriticalEntityAuditEvent"("entityType", "entityId", "createdAt");
CREATE INDEX "CriticalEntityAuditEvent_action_idx" ON "CriticalEntityAuditEvent"("action");
CREATE INDEX "CriticalEntityAuditEvent_actor_idx" ON "CriticalEntityAuditEvent"("actor");
CREATE INDEX "CriticalEntityAuditEvent_createdAt_idx" ON "CriticalEntityAuditEvent"("createdAt");
