-- CreateEnum
CREATE TYPE "ProductMappingStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'PAUSED', 'ERROR');

-- CreateEnum
CREATE TYPE "ProductSnapshotSource" AS ENUM ('EBAY', 'SHOPIFY', 'SYNCBAY');

-- CreateEnum
CREATE TYPE "SyncConflictStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "SyncConflictResolution" AS ENUM ('KEEP_SHOPIFY', 'REALIGN_FROM_EBAY', 'IGNORE_FIELD');

-- CreateTable
CREATE TABLE "ProductMapping" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL DEFAULT 'EBAY_IT',
    "ebayItemId" TEXT NOT NULL,
    "sku" TEXT,
    "shopifyProductGid" TEXT,
    "shopifyVariantGid" TEXT,
    "status" "ProductMappingStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSyncedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSnapshot" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "mappingId" TEXT,
    "source" "ProductSnapshotSource" NOT NULL,
    "ebayItemId" TEXT,
    "shopifyProductGid" TEXT,
    "shopifyVariantGid" TEXT,
    "sku" TEXT,
    "title" TEXT,
    "priceAmount" DECIMAL(12,2),
    "currency" TEXT,
    "quantity" INTEGER,
    "productStatus" TEXT,
    "descriptionHash" TEXT,
    "imageCount" INTEGER,
    "payload" JSONB,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncConflict" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "mappingId" TEXT,
    "field" TEXT NOT NULL,
    "status" "SyncConflictStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" "SyncConflictResolution",
    "ebayValue" JSONB,
    "lastSyncBayValue" JSONB,
    "shopifyValue" JSONB,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncConflict_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductMapping_shopId_marketplaceId_ebayItemId_key" ON "ProductMapping"("shopId", "marketplaceId", "ebayItemId");

-- CreateIndex
CREATE INDEX "ProductMapping_shopId_status_idx" ON "ProductMapping"("shopId", "status");

-- CreateIndex
CREATE INDEX "ProductMapping_shopifyProductGid_idx" ON "ProductMapping"("shopifyProductGid");

-- CreateIndex
CREATE INDEX "ProductMapping_sku_idx" ON "ProductMapping"("sku");

-- CreateIndex
CREATE INDEX "ProductSnapshot_shopId_capturedAt_idx" ON "ProductSnapshot"("shopId", "capturedAt");

-- CreateIndex
CREATE INDEX "ProductSnapshot_mappingId_capturedAt_idx" ON "ProductSnapshot"("mappingId", "capturedAt");

-- CreateIndex
CREATE INDEX "ProductSnapshot_source_idx" ON "ProductSnapshot"("source");

-- CreateIndex
CREATE INDEX "SyncConflict_shopId_status_detectedAt_idx" ON "SyncConflict"("shopId", "status", "detectedAt");

-- CreateIndex
CREATE INDEX "SyncConflict_mappingId_status_idx" ON "SyncConflict"("mappingId", "status");

-- AddForeignKey
ALTER TABLE "ProductMapping" ADD CONSTRAINT "ProductMapping_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSnapshot" ADD CONSTRAINT "ProductSnapshot_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSnapshot" ADD CONSTRAINT "ProductSnapshot_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "ProductMapping"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncConflict" ADD CONSTRAINT "SyncConflict_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncConflict" ADD CONSTRAINT "SyncConflict_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "ProductMapping"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Supabase Data API defense-in-depth: app access uses server-side Prisma, not public table policies.
ALTER TABLE "ProductMapping" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SyncConflict" ENABLE ROW LEVEL SECURITY;
