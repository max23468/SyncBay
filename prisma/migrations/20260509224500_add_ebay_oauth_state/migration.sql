-- CreateTable
CREATE TABLE "EbayOAuthState" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "returnTo" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EbayOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EbayOAuthState_stateHash_key" ON "EbayOAuthState"("stateHash");

-- CreateIndex
CREATE INDEX "EbayOAuthState_shopId_expiresAt_idx" ON "EbayOAuthState"("shopId", "expiresAt");

-- AddForeignKey
ALTER TABLE "EbayOAuthState" ADD CONSTRAINT "EbayOAuthState_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Supabase Data API defense-in-depth: app access uses server-side Prisma, not public table policies.
ALTER TABLE "EbayOAuthState" ENABLE ROW LEVEL SECURITY;
