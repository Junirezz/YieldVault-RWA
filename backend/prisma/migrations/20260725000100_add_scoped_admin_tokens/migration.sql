-- Migration: Add ScopedAdminToken and ScopedAdminTokenRotationEvent tables
-- Issue #858: Prisma storage layer for scoped admin tokens with rotation audit trail

CREATE TABLE "ScopedAdminToken" (
  "id"           TEXT      NOT NULL PRIMARY KEY,
  "keyId"        TEXT      NOT NULL UNIQUE,
  "hashedSecret" TEXT      NOT NULL,
  "permissions"  TEXT      NOT NULL,
  "label"        TEXT      NOT NULL,
  "createdBy"    TEXT      NOT NULL,
  "revoked"      BOOLEAN   NOT NULL DEFAULT false,
  "revokedBy"    TEXT,
  "revokedAt"    DATETIME,
  "expiresAt"    DATETIME,
  "createdAt"    DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rotatedAt"    DATETIME
);

CREATE INDEX "ScopedAdminToken_keyId_idx"    ON "ScopedAdminToken"("keyId");
CREATE INDEX "ScopedAdminToken_revoked_idx"  ON "ScopedAdminToken"("revoked");
CREATE INDEX "ScopedAdminToken_createdAt_idx" ON "ScopedAdminToken"("createdAt");
CREATE INDEX "ScopedAdminToken_expiresAt_idx" ON "ScopedAdminToken"("expiresAt");
CREATE INDEX "ScopedAdminToken_createdBy_idx" ON "ScopedAdminToken"("createdBy");

CREATE TABLE "ScopedAdminTokenRotationEvent" (
  "id"           TEXT      NOT NULL PRIMARY KEY,
  "keyId"        TEXT      NOT NULL,
  "keyFingerprint" TEXT    NOT NULL,
  "rotatedBy"    TEXT      NOT NULL,
  "rotatedAt"    DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScopedAdminTokenRotationEvent_keyId_fkey"
    FOREIGN KEY ("keyId") REFERENCES "ScopedAdminToken"("keyId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ScopedAdminTokenRotationEvent_keyId_idx"    ON "ScopedAdminTokenRotationEvent"("keyId");
CREATE INDEX "ScopedAdminTokenRotationEvent_rotatedAt_idx" ON "ScopedAdminTokenRotationEvent"("rotatedAt");
CREATE INDEX "ScopedAdminTokenRotationEvent_rotatedBy_idx" ON "ScopedAdminTokenRotationEvent"("rotatedBy");
