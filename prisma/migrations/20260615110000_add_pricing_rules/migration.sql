CREATE TYPE "PriceRoundingMode" AS ENUM ('CENTS', 'WHOLE_EURO');

CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "roundingMode" "PriceRoundingMode" NOT NULL DEFAULT 'CENTS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PricingRule_discountPercent_check" CHECK ("discountPercent" >= 0 AND "discountPercent" <= 90)
);

CREATE UNIQUE INDEX "PricingRule_shopId_key" ON "PricingRule"("shopId");

CREATE INDEX "PricingRule_shopId_idx" ON "PricingRule"("shopId");

ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Supabase Data API defense-in-depth: app access uses server-side Prisma, not public table policies.
ALTER TABLE "PricingRule" ENABLE ROW LEVEL SECURITY;

