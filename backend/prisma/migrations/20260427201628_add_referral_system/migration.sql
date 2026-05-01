-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "referralCode" TEXT;

-- CreateTable
CREATE TABLE "Referral" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "referrerAddress" TEXT NOT NULL,
    "referredAddress" TEXT NOT NULL,
    "firstDepositAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ReferralCode" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "ownerAddress" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Referral_referredAddress_key" ON "Referral"("referredAddress");

-- CreateIndex
CREATE INDEX "Referral_referrerAddress_idx" ON "Referral"("referrerAddress");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCode_code_key" ON "ReferralCode"("code");
