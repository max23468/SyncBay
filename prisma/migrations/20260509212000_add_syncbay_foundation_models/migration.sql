-- CreateEnum
CREATE TYPE "ShopInstallationStatus" AS ENUM ('INSTALLED', 'UNINSTALLED', 'RECONNECT_REQUIRED');

-- CreateEnum
CREATE TYPE "EbayConnectionStatus" AS ENUM ('NOT_CONNECTED', 'CONNECTED', 'EXPIRED', 'REVOKED', 'RECONNECT_REQUIRED');

-- CreateEnum
CREATE TYPE "SyncJobType" AS ENUM ('IMPORT_CATALOG', 'SYNC_INCREMENTAL', 'UPDATE_EBAY_STOCK', 'DETECT_SHOPIFY_CHANGES', 'ARCHIVE_INACTIVE_LISTING', 'RECONCILE_CATALOG', 'CLEANUP_STAGING');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'RETRYING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AuditEventType" AS ENUM ('SHOP_INSTALLED', 'SHOP_UNINSTALLED', 'SHOPIFY_SCOPES_UPDATED', 'SHOPIFY_WEBHOOK_RECEIVED', 'EBAY_CONNECT_STARTED', 'EBAY_CONNECTED', 'EBAY_DISCONNECTED', 'EBAY_REFRESH_FAILED', 'SYNC_JOB_CREATED', 'SYNC_JOB_FAILED', 'SYNC_JOB_SUCCEEDED', 'CONNECTION_CHECK');

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "installationStatus" "ShopInstallationStatus" NOT NULL DEFAULT 'INSTALLED',
    "shopifyScopes" TEXT,
    "defaultLocationGid" TEXT,
    "syncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "syncTargetSeconds" INTEGER NOT NULL DEFAULT 300,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EbayConnection" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL DEFAULT 'EBAY_IT',
    "environment" TEXT NOT NULL DEFAULT 'sandbox',
    "status" "EbayConnectionStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
    "ebayUserId" TEXT,
    "encryptedAccessToken" TEXT,
    "encryptedRefreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT,
    "connectedAt" TIMESTAMP(3),
    "lastRefreshAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EbayConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "type" "SyncJobType" NOT NULL,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'PENDING',
    "providerJobId" TEXT,
    "idempotencyKey" TEXT,
    "payload" JSONB,
    "result" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "shopId" TEXT,
    "type" "AuditEventType" NOT NULL,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");

-- CreateIndex
CREATE INDEX "EbayConnection_status_idx" ON "EbayConnection"("status");

-- CreateIndex
CREATE UNIQUE INDEX "EbayConnection_shopId_marketplaceId_key" ON "EbayConnection"("shopId", "marketplaceId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncJob_idempotencyKey_key" ON "SyncJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SyncJob_shopId_status_runAfter_idx" ON "SyncJob"("shopId", "status", "runAfter");

-- CreateIndex
CREATE INDEX "SyncJob_type_status_idx" ON "SyncJob"("type", "status");

-- CreateIndex
CREATE INDEX "AuditLog_shopId_createdAt_idx" ON "AuditLog"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_type_createdAt_idx" ON "AuditLog"("type", "createdAt");

-- AddForeignKey
ALTER TABLE "EbayConnection" ADD CONSTRAINT "EbayConnection_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Supabase Data API defense-in-depth: app access uses server-side Prisma, not public table policies.
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Shop" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EbayConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SyncJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
