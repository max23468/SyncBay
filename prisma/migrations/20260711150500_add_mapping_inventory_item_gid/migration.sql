ALTER TABLE "ProductMapping"
ADD COLUMN "shopifyInventoryItemGid" TEXT;

CREATE UNIQUE INDEX "ProductMapping_shopId_shopifyInventoryItemGid_key"
ON "ProductMapping"("shopId", "shopifyInventoryItemGid");
