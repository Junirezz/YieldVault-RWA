-- Persist wallet alias identity groups so provider aliases survive process restarts.

CREATE TABLE "WalletCanonicalIdentity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "WalletAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonicalId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "aliasKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WalletAlias_canonicalId_fkey" FOREIGN KEY ("canonicalId") REFERENCES "WalletCanonicalIdentity" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "WalletAliasSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "displayName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "WalletCanonicalIdentity_createdAt_idx" ON "WalletCanonicalIdentity"("createdAt");

CREATE UNIQUE INDEX "WalletAlias_aliasKey_key" ON "WalletAlias"("aliasKey");
CREATE INDEX "WalletAlias_canonicalId_idx" ON "WalletAlias"("canonicalId");
CREATE INDEX "WalletAlias_source_idx" ON "WalletAlias"("source");
CREATE INDEX "WalletAlias_createdAt_idx" ON "WalletAlias"("createdAt");

CREATE UNIQUE INDEX "WalletAliasSource_source_key" ON "WalletAliasSource"("source");
CREATE INDEX "WalletAliasSource_source_idx" ON "WalletAliasSource"("source");
CREATE INDEX "WalletAliasSource_createdAt_idx" ON "WalletAliasSource"("createdAt");
