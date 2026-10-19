-- CreateTable JobDeadLetter
CREATE TABLE "JobDeadLetter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobName" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "error" TEXT NOT NULL,
    "payload" TEXT,
    "failedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'dead-letter',
    "retriedAt" DATETIME,
    "resolvedAt" DATETIME,
    "resolvedBy" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex JobDeadLetter_jobName_idx
CREATE INDEX "JobDeadLetter_jobName_idx" ON "JobDeadLetter"("jobName");

-- CreateIndex JobDeadLetter_status_idx
CREATE INDEX "JobDeadLetter_status_idx" ON "JobDeadLetter"("status");

-- CreateIndex JobDeadLetter_createdAt_idx
CREATE INDEX "JobDeadLetter_createdAt_idx" ON "JobDeadLetter"("createdAt");

-- CreateIndex JobDeadLetter_failedAt_idx
CREATE INDEX "JobDeadLetter_failedAt_idx" ON "JobDeadLetter"("failedAt");

-- CreateIndex JobDeadLetter_jobName_status_idx
CREATE INDEX "JobDeadLetter_jobName_status_idx" ON "JobDeadLetter"("jobName", "status");
