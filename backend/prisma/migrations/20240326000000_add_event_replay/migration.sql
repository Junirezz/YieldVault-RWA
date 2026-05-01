-- CreateTable
CREATE TABLE "EventCursor" (
    "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
    "lastLedgerSeq" INTEGER NOT NULL,
    "lastProcessedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProcessedEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ledgerSeq" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "processedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "ProcessedEvent_ledgerSeq_idx" ON "ProcessedEvent"("ledgerSeq");

-- CreateIndex
CREATE INDEX "ProcessedEvent_txHash_idx" ON "ProcessedEvent"("txHash");
