CREATE TYPE "DescriptionRuleMode" AS ENUM ('CLEAN_HTML', 'FULL_HTML', 'TEXT_ONLY');

CREATE TABLE "DescriptionRule" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "mode" "DescriptionRuleMode" NOT NULL DEFAULT 'CLEAN_HTML',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DescriptionRule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DescriptionRule_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DescriptionRule_shopId_key" ON "DescriptionRule"("shopId");

CREATE INDEX "DescriptionRule_shopId_idx" ON "DescriptionRule"("shopId");

ALTER TABLE "DescriptionRule" ENABLE ROW LEVEL SECURITY;
