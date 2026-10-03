-- Issue #1433 — give Allocation rows an explicit target weight and make
-- (vaultId, strategyId) unique, so the per-vault invariant `sum(weight) = 100`
-- is representable and a concurrent rebalance cannot leave duplicate pairs
-- behind.
--
-- Written as additive, backfill-then-constrain steps rather than Prisma's
-- generated rebuild, so no existing row is lost and the migration stays inside
-- the repo's migration-safety policy: nothing is dropped or renamed, and every
-- ADD COLUMN carries a DEFAULT.

-- 1. Additive column. Nullable-with-default keeps canary rollouts safe: old
--    code inserting without `weight` still works and reads 0.
ALTER TABLE "Allocation" ADD COLUMN "weight" REAL NOT NULL DEFAULT 0;

-- 2. Collapse any pre-existing duplicate (vaultId, strategyId) rows: fold the
--    non-surviving rows' amounts into the oldest row of each group, then remove
--    them. Without this the unique index below cannot be created.
UPDATE "Allocation"
SET "amount" = "amount" + COALESCE((
      SELECT SUM("dup"."amount")
      FROM "Allocation" AS "dup"
      WHERE "dup"."vaultId" = "Allocation"."vaultId"
        AND "dup"."strategyId" = "Allocation"."strategyId"
        AND "dup"."id" <> "Allocation"."id"
    ), 0)
WHERE "id" = (
      SELECT MIN("m"."id")
      FROM "Allocation" AS "m"
      WHERE "m"."vaultId" = "Allocation"."vaultId"
        AND "m"."strategyId" = "Allocation"."strategyId"
    );

DELETE FROM "Allocation"
WHERE "id" NOT IN (
  SELECT MIN("id") FROM "Allocation" GROUP BY "vaultId", "strategyId"
);

-- 3. Backfill the target weight from the *current* exposure, so the
--    sum(weight) = 100 invariant holds for every pre-existing row and the first
--    rebalance after this migration is a no-op relative to reality. A vault
--    whose allocations are all zero gets weight 0 and must be rebalanced before
--    it is meaningful.
UPDATE "Allocation"
SET "weight" = CASE
      WHEN (
        SELECT COALESCE(SUM("a2"."amount"), 0)
        FROM "Allocation" AS "a2"
        WHERE "a2"."vaultId" = "Allocation"."vaultId"
      ) > 0
      THEN 100.0 * "amount" / (
        SELECT SUM("a3"."amount")
        FROM "Allocation" AS "a3"
        WHERE "a3"."vaultId" = "Allocation"."vaultId"
      )
      ELSE 0
    END;

-- 4. Constraints and read-path indices.
CREATE UNIQUE INDEX "Allocation_vaultId_strategyId_key" ON "Allocation"("vaultId", "strategyId");

CREATE INDEX "Allocation_vaultId_weight_idx" ON "Allocation"("vaultId", "weight");
