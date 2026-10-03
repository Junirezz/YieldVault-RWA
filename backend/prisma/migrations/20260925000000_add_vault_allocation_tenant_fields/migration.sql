-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "failureReason" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "latencyMs" INTEGER;
ALTER TABLE "Transaction" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "vaultId" TEXT;

-- CreateTable
CREATE TABLE "Vault" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "aum" REAL NOT NULL DEFAULT 0,
    "tvlUsd" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Strategy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Allocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaultId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "amount" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Allocation_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "Vault" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Allocation_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExposureBreach" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaultId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "attemptedAmount" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WalletTenantAssociation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletAddress" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "Vault_tenantId_idx" ON "Vault"("tenantId");

-- CreateIndex
CREATE INDEX "Vault_deletedAt_idx" ON "Vault"("deletedAt");

-- CreateIndex
CREATE INDEX "Allocation_vaultId_idx" ON "Allocation"("vaultId");

-- CreateIndex
CREATE INDEX "Allocation_strategyId_idx" ON "Allocation"("strategyId");

-- CreateIndex
CREATE INDEX "ExposureBreach_vaultId_idx" ON "ExposureBreach"("vaultId");

-- CreateIndex
CREATE INDEX "ExposureBreach_strategyId_idx" ON "ExposureBreach"("strategyId");

-- CreateIndex
CREATE INDEX "ExposureBreach_timestamp_idx" ON "ExposureBreach"("timestamp");

-- CreateIndex
CREATE INDEX "WalletTenantAssociation_walletAddress_tenantId_idx" ON "WalletTenantAssociation"("walletAddress", "tenantId");

-- CreateIndex
CREATE INDEX "WalletTenantAssociation_tenantId_idx" ON "WalletTenantAssociation"("tenantId");

-- CreateIndex
CREATE INDEX "Transaction_vaultId_tenantId_timestamp_idx" ON "Transaction"("vaultId", "tenantId", "timestamp" DESC);

