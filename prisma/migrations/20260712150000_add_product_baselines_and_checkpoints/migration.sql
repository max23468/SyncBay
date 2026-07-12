CREATE TYPE "MaintenanceRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "ProductSyncBaseline" (
  "mappingId" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "shopifyProductGid" TEXT,
  "shopifyVariantGid" TEXT,
  "shopifyInventoryItemGid" TEXT,
  "title" TEXT,
  "descriptionHash" TEXT,
  "priceAmount" DECIMAL(12,2),
  "compareAtPriceAmount" DECIMAL(12,2),
  "currency" TEXT,
  "quantity" INTEGER,
  "productStatus" TEXT,
  "imageCount" INTEGER,
  "productFacets" JSONB,
  "lastWriterJobId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductSyncBaseline_pkey" PRIMARY KEY ("mappingId")
);

CREATE TABLE "ProductSnapshotCheckpoint" (
  "id" TEXT NOT NULL,
  "mappingId" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "source" "ProductSnapshotSource" NOT NULL,
  "checkpointWeek" DATE NOT NULL,
  "sourceSnapshotId" TEXT NOT NULL,
  "isComplete" BOOLEAN NOT NULL DEFAULT true,
  "payloadBytes" INTEGER NOT NULL DEFAULT 0,
  "title" TEXT,
  "descriptionHash" TEXT,
  "priceAmount" DECIMAL(12,2),
  "quantity" INTEGER,
  "productStatus" TEXT,
  "imageCount" INTEGER,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductSnapshotCheckpoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MaintenanceRun" (
  "key" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "status" "MaintenanceRunStatus" NOT NULL,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "result" JSONB,
  "errorCode" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MaintenanceRun_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "ProductSyncBaseline" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductSnapshotCheckpoint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MaintenanceRun" ENABLE ROW LEVEL SECURITY;

CREATE INDEX "ProductSyncBaseline_shopId_updatedAt_idx" ON "ProductSyncBaseline"("shopId", "updatedAt");
CREATE UNIQUE INDEX "ProductSnapshotCheckpoint_mappingId_source_checkpointWeek_key" ON "ProductSnapshotCheckpoint"("mappingId", "source", "checkpointWeek");
CREATE INDEX "ProductSnapshotCheckpoint_shopId_checkpointWeek_idx" ON "ProductSnapshotCheckpoint"("shopId", "checkpointWeek");

ALTER TABLE "ProductSyncBaseline" ADD CONSTRAINT "ProductSyncBaseline_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "ProductMapping"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductSyncBaseline" ADD CONSTRAINT "ProductSyncBaseline_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductSnapshotCheckpoint" ADD CONSTRAINT "ProductSnapshotCheckpoint_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "ProductMapping"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductSnapshotCheckpoint" ADD CONSTRAINT "ProductSnapshotCheckpoint_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
