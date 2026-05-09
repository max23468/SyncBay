import {
  AuditEventType,
  EbayConnectionStatus,
  Prisma,
  ShopInstallationStatus,
  SyncJobStatus,
  SyncJobType,
} from "@prisma/client";

import prisma from "../db.server";

interface ShopifySessionLike {
  shop: string;
  scope?: string | null;
}

interface WebhookRecordInput {
  shopDomain: string;
  topic: string;
  resourceId?: string | null;
}

const DEFAULT_MARKETPLACE_ID = "EBAY_IT";
const DEFAULT_EBAY_ENVIRONMENT = "sandbox";
const DEFAULT_SYNC_TARGET_SECONDS = 300;

export async function getDashboardState(session: ShopifySessionLike) {
  const shop = await ensureShopForSession(session);
  const ebayConnection = await prisma.ebayConnection.findUnique({
    where: {
      shopId_marketplaceId: {
        marketplaceId: getEbayMarketplaceId(),
        shopId: shop.id,
      },
    },
  });
  const recentJobs = await prisma.syncJob.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  const recentAuditLogs = await prisma.auditLog.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  const ebayRuntime = getEbayRuntimeReadiness();

  return {
    shop: {
      domain: shop.shopDomain,
      installationStatus: shop.installationStatus,
      syncEnabled: shop.syncEnabled,
      syncTargetSeconds: shop.syncTargetSeconds,
      defaultLocationGid: shop.defaultLocationGid,
    },
    shopify: {
      connected: true,
      scopes: splitScopes(shop.shopifyScopes),
    },
    ebay: {
      environment: ebayRuntime.environment,
      marketplaceId: ebayRuntime.marketplaceId,
      oauthReady: ebayRuntime.ready,
      missingRequirements: ebayRuntime.missingRequirements,
      status: ebayConnection?.status ?? EbayConnectionStatus.NOT_CONNECTED,
      connectedAt: ebayConnection?.connectedAt?.toISOString() ?? null,
    },
    sync: {
      pendingJobs: recentJobs.filter((job) => job.status === SyncJobStatus.PENDING).length,
      lastJobs: recentJobs.map((job) => ({
        createdAt: job.createdAt.toISOString(),
        status: job.status,
        type: job.type,
      })),
    },
    audit: recentAuditLogs.map((log) => ({
      createdAt: log.createdAt.toISOString(),
      message: log.message,
      type: log.type,
    })),
  };
}

export async function ensureShopForSession(session: ShopifySessionLike) {
  return prisma.shop.upsert({
    where: { shopDomain: session.shop },
    create: {
      installationStatus: ShopInstallationStatus.INSTALLED,
      shopDomain: session.shop,
      shopifyScopes: session.scope ?? null,
      syncTargetSeconds: getSyncTargetSeconds(),
      auditLogs: {
        create: {
          message: "Shopify installazione registrata.",
          type: AuditEventType.SHOP_INSTALLED,
        },
      },
    },
    update: {
      installationStatus: ShopInstallationStatus.INSTALLED,
      shopifyScopes: session.scope ?? null,
      uninstalledAt: null,
    },
  });
}

export async function markShopUninstalled(shopDomain: string) {
  const shop = await prisma.shop.upsert({
    where: { shopDomain },
    create: {
      installationStatus: ShopInstallationStatus.UNINSTALLED,
      shopDomain,
      syncTargetSeconds: getSyncTargetSeconds(),
      uninstalledAt: new Date(),
    },
    update: {
      installationStatus: ShopInstallationStatus.UNINSTALLED,
      syncEnabled: false,
      uninstalledAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      message: "Shopify app disinstallata.",
      shopId: shop.id,
      type: AuditEventType.SHOP_UNINSTALLED,
    },
  });
}

export async function updateShopifyScopes(shopDomain: string, scopes: string[]) {
  const shop = await prisma.shop.upsert({
    where: { shopDomain },
    create: {
      installationStatus: ShopInstallationStatus.INSTALLED,
      shopDomain,
      shopifyScopes: scopes.join(","),
      syncTargetSeconds: getSyncTargetSeconds(),
    },
    update: {
      shopifyScopes: scopes.join(","),
    },
  });

  await prisma.auditLog.create({
    data: {
      message: "Scope Shopify aggiornati.",
      shopId: shop.id,
      type: AuditEventType.SHOPIFY_SCOPES_UPDATED,
    },
  });
}

export async function recordShopifyWebhookPlaceholder(input: WebhookRecordInput) {
  const shop = await prisma.shop.upsert({
    where: { shopDomain: input.shopDomain },
    create: {
      installationStatus: ShopInstallationStatus.INSTALLED,
      shopDomain: input.shopDomain,
      syncTargetSeconds: getSyncTargetSeconds(),
    },
    update: {
      installationStatus: ShopInstallationStatus.INSTALLED,
    },
  });
  const jobType = getPlaceholderJobType(input.topic);
  const details = {
    provider: "shopify",
    resourceId: input.resourceId ?? null,
    topic: input.topic,
  } satisfies Prisma.JsonObject;

  if (jobType) {
    const idempotencyKey = input.resourceId
      ? `shopify:${shop.id}:${input.topic}:${input.resourceId}`
      : null;
    const jobData = {
      idempotencyKey,
      payload: details,
      shopId: shop.id,
      status: SyncJobStatus.PENDING,
      type: jobType,
    };

    if (idempotencyKey) {
      await prisma.syncJob.upsert({
        where: { idempotencyKey },
        create: jobData,
        update: {},
      });
    } else {
      await prisma.syncJob.create({ data: jobData });
    }
  }

  await prisma.auditLog.create({
    data: {
      details,
      message: "Webhook Shopify ricevuto e tracciato.",
      shopId: shop.id,
      type: AuditEventType.SHOPIFY_WEBHOOK_RECEIVED,
    },
  });
}

export function getEbayRuntimeReadiness() {
  const requirements = [
    { envKey: "EBAY_CLIENT_ID", label: "Client ID eBay" },
    { envKey: "EBAY_CLIENT_SECRET", label: "Client secret eBay" },
    { envKey: "EBAY_RU_NAME", label: "RuName eBay" },
    { envKey: "EBAY_OAUTH_ACCEPT_URL", label: "OAuth accept URL eBay" },
    { envKey: "EBAY_OAUTH_REJECT_URL", label: "OAuth reject URL eBay" },
    { envKey: "TOKEN_ENCRYPTION_KEY", label: "chiave cifratura token" },
  ];
  const missingRequirements = requirements
    .filter((requirement) => !hasRuntimeValue(process.env[requirement.envKey]))
    .map((requirement) => requirement.label);

  return {
    environment: process.env.EBAY_ENVIRONMENT ?? DEFAULT_EBAY_ENVIRONMENT,
    marketplaceId: getEbayMarketplaceId(),
    missingRequirements,
    ready: missingRequirements.length === 0,
  };
}

export function extractWebhookResourceId(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  return getStringField(record, "admin_graphql_api_id") ?? getStringField(record, "id");
}

function getPlaceholderJobType(topic: string) {
  if (topic === "orders/paid") return SyncJobType.UPDATE_EBAY_STOCK;
  if (topic === "products/update") return SyncJobType.DETECT_SHOPIFY_CHANGES;
  if (topic === "inventory_levels/update") return SyncJobType.DETECT_SHOPIFY_CHANGES;

  return null;
}

function getEbayMarketplaceId() {
  return process.env.EBAY_MARKETPLACE_ID ?? DEFAULT_MARKETPLACE_ID;
}

function getSyncTargetSeconds() {
  const parsed = Number.parseInt(process.env.SYNC_POLL_INTERVAL_SECONDS ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_SYNC_TARGET_SECONDS;
}

function splitScopes(scopes?: string | null) {
  return scopes
    ? scopes
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean)
    : [];
}

function hasRuntimeValue(value: string | undefined) {
  return Boolean(value && value.trim().length > 0);
}

function getStringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);

  return null;
}
