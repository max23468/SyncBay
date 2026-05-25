-- CreateEnum
CREATE TYPE "EbayAccountDeletionRequestStatus" AS ENUM ('PROCESSING', 'PROCESSED', 'NO_MATCH', 'FAILED');

-- AlterEnum
ALTER TYPE "AuditEventType" ADD VALUE 'EBAY_ACCOUNT_DELETION_RECEIVED';
ALTER TYPE "AuditEventType" ADD VALUE 'EBAY_ACCOUNT_DELETION_PROCESSED';

-- CreateTable
CREATE TABLE "EbayAccountDeletionRequest" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "hashedUserId" TEXT NOT NULL,
    "status" "EbayAccountDeletionRequestStatus" NOT NULL DEFAULT 'PROCESSING',
    "matchedShopCount" INTEGER NOT NULL DEFAULT 0,
    "signatureKeyId" TEXT,
    "publishAttemptCount" INTEGER,
    "eventDate" TIMESTAMP(3),
    "publishDate" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EbayAccountDeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EbayAccountDeletionRequest_notificationId_key" ON "EbayAccountDeletionRequest"("notificationId");

-- CreateIndex
CREATE INDEX "EbayAccountDeletionRequest_hashedUserId_receivedAt_idx" ON "EbayAccountDeletionRequest"("hashedUserId", "receivedAt");

-- CreateIndex
CREATE INDEX "EbayAccountDeletionRequest_status_receivedAt_idx" ON "EbayAccountDeletionRequest"("status", "receivedAt");

-- Supabase Data API defense-in-depth: app access uses server-side Prisma, not public table policies.
ALTER TABLE "EbayAccountDeletionRequest" ENABLE ROW LEVEL SECURITY;
