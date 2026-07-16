-- ADR 0011: i listing eBay inattivi restano OUT_OF_STOCK; lo stato mapping
-- ARCHIVED non viene più scritto e il backfill una tantum ha già migrato le
-- righe storiche (0 righe ARCHIVED verificate il 2026-07-16).
UPDATE "ProductMapping" SET "status" = 'OUT_OF_STOCK' WHERE "status" = 'ARCHIVED';

ALTER TYPE "ProductMappingStatus" RENAME TO "ProductMappingStatus_old";
CREATE TYPE "ProductMappingStatus" AS ENUM ('ACTIVE', 'OUT_OF_STOCK', 'PAUSED', 'ERROR');
ALTER TABLE "ProductMapping" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ProductMapping"
  ALTER COLUMN "status" TYPE "ProductMappingStatus"
  USING ("status"::text::"ProductMappingStatus");
ALTER TABLE "ProductMapping" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
DROP TYPE "ProductMappingStatus_old";
