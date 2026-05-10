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
  webhookId?: string | null;
}

interface ShopifyLocationInput {
  id: string;
  name: string;
}

const DEFAULT_MARKETPLACE_ID = "EBAY_IT";
const DEFAULT_EBAY_ENVIRONMENT = "sandbox";
const DEFAULT_SYNC_TARGET_SECONDS = 300;
const REQUIRED_SHOPIFY_SCOPES = [
  "read_products",
  "write_products",
  "read_inventory",
  "write_inventory",
  "read_locations",
];
const SHOPIFY_WEBHOOK_TOPICS = [
  "app/uninstalled",
  "app/scopes_update",
  "products/update",
  "inventory_levels/update",
];

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
  const shopifyScopes = splitScopes(shop.shopifyScopes);
  const shopifyReadiness = getShopifyReadiness(shopifyScopes);
  const supabaseReadiness = getSupabaseReadiness();
  const vercelReadiness = getVercelReadiness();
  const complianceReadiness = getComplianceReadiness();
  const importPreview = getImportPreviewReadiness({
    ebayConnected: ebayConnection?.status === EbayConnectionStatus.CONNECTED,
    hasDefaultLocation: Boolean(shop.defaultLocationGid),
    listingReaderAvailable: false,
  });
  const readiness = [
    shopifyReadiness.summary,
    supabaseReadiness.summary,
    vercelReadiness.summary,
    ebayRuntime.summary,
    complianceReadiness.summary,
    importPreview.summary,
  ];

  return {
    readiness,
    shop: {
      domain: shop.shopDomain,
      installationStatus: shop.installationStatus,
      syncEnabled: shop.syncEnabled,
      syncTargetSeconds: shop.syncTargetSeconds,
      defaultLocationGid: shop.defaultLocationGid,
    },
    shopify: {
      connected: true,
      configuredScopes: getConfiguredShopifyScopes(),
      missingScopes: shopifyReadiness.missingScopes,
      scopes: shopifyScopes,
      webhookTopics: SHOPIFY_WEBHOOK_TOPICS,
    },
    ebay: {
      accountDeletion: complianceReadiness.accountDeletion,
      environment: ebayRuntime.environment,
      marketplaceId: ebayRuntime.marketplaceId,
      oauthEnabled: ebayRuntime.oauthEnabled,
      oauthReady: ebayRuntime.ready,
      oauthStatus: ebayRuntime.oauthStatus,
      missingRequirements: ebayRuntime.missingRequirements,
      status: ebayConnection?.status ?? EbayConnectionStatus.NOT_CONNECTED,
      connectedAt: ebayConnection?.connectedAt?.toISOString() ?? null,
    },
    supabase: supabaseReadiness,
    vercel: vercelReadiness,
    onboarding: getOnboardingReadiness(),
    importPreview,
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

export async function getImportWizardState(session: ShopifySessionLike) {
  const shop = await ensureShopForSession(session);
  const ebayConnection = await prisma.ebayConnection.findUnique({
    where: {
      shopId_marketplaceId: {
        marketplaceId: getEbayMarketplaceId(),
        shopId: shop.id,
      },
    },
  });
  const ebayConnected = ebayConnection?.status === EbayConnectionStatus.CONNECTED;
  const importPreview = getImportPreviewReadiness({
    ebayConnected,
    hasDefaultLocation: Boolean(shop.defaultLocationGid),
    listingReaderAvailable: false,
  });

  return {
    ebay: {
      marketplaceId: getEbayMarketplaceId(),
      status: ebayConnection?.status ?? EbayConnectionStatus.NOT_CONNECTED,
    },
    importPreview,
    onboarding: getOnboardingReadiness(),
    previewPlan: getImportPreviewPlan(),
    shop: {
      defaultLocationGid: shop.defaultLocationGid,
      domain: shop.shopDomain,
    },
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

export async function updateDefaultShopifyLocation(
  session: ShopifySessionLike,
  locationGid: string,
  availableLocations: ShopifyLocationInput[],
) {
  const selectedLocation = availableLocations.find(
    (location) => location.id === locationGid,
  );

  if (!selectedLocation) {
    throw new Response("Location Shopify non valida.", { status: 400 });
  }

  const shop = await ensureShopForSession(session);
  await prisma.shop.update({
    data: { defaultLocationGid: selectedLocation.id },
    where: { id: shop.id },
  });

  await prisma.auditLog.create({
    data: {
      details: {
        locationGid: selectedLocation.id,
        locationName: selectedLocation.name,
      },
      message: `Location Shopify predefinita impostata: ${selectedLocation.name}.`,
      shopId: shop.id,
      type: AuditEventType.CONNECTION_CHECK,
    },
  });

  return selectedLocation;
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
  const normalizedTopic = normalizeShopifyWebhookTopic(input.topic);
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
  const jobType = getPlaceholderJobType(normalizedTopic);
  const details = {
    provider: "shopify",
    resourceId: input.resourceId ?? null,
    topic: normalizedTopic,
    webhookId: input.webhookId ?? null,
  } satisfies Prisma.JsonObject;

  if (jobType) {
    const idempotencyKey = input.webhookId
      ? `shopify:${shop.id}:${normalizedTopic}:${input.webhookId}`
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
    { envKey: "EBAY_SCOPES", label: "scope OAuth eBay" },
    { envKey: "EBAY_OAUTH_ACCEPT_URL", label: "OAuth accept URL eBay" },
    { envKey: "EBAY_OAUTH_REJECT_URL", label: "OAuth reject URL eBay" },
    { envKey: "TOKEN_ENCRYPTION_KEY", label: "chiave cifratura token" },
  ];
  const missingRequirements = requirements
    .filter((requirement) => !hasRuntimeValue(process.env[requirement.envKey]))
    .map((requirement) => requirement.label);

  const oauthEnabled = process.env.EBAY_OAUTH_ENABLED === "true";

  return {
    environment: process.env.EBAY_ENVIRONMENT ?? DEFAULT_EBAY_ENVIRONMENT,
    marketplaceId: getEbayMarketplaceId(),
    missingRequirements,
    oauthEnabled,
    oauthStatus: oauthEnabled
      ? "Attivabile"
      : "Predisposto, OAuth non abilitato sul keyset provvisorio",
    ready: missingRequirements.length === 0,
    summary: {
      detail:
        missingRequirements.length === 0
          ? "Env OAuth presenti; test end-to-end in attesa del keyset dedicato."
          : `Mancano ${missingRequirements.length} requisiti OAuth.`,
      label: "eBay",
      status: missingRequirements.length === 0 ? "bloccato" : "da completare",
    },
  };
}

export function getAccountDeletionChallengeConfig() {
  const endpoint = process.env.EBAY_ACCOUNT_DELETION_ENDPOINT_URL;
  const verificationToken = process.env.EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN;

  return {
    endpoint,
    missingRequirements: [
      !hasRuntimeValue(endpoint) ? "endpoint account deletion eBay" : null,
      !hasRuntimeValue(verificationToken) ? "verification token account deletion eBay" : null,
    ].filter((requirement): requirement is string => Boolean(requirement)),
    notificationsEnabled:
      process.env.EBAY_ACCOUNT_DELETION_NOTIFICATIONS_ENABLED === "true",
    verificationToken,
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

function normalizeShopifyWebhookTopic(topic: string) {
  return topic.toLowerCase().replaceAll("_", "/");
}

function getEbayMarketplaceId() {
  return process.env.EBAY_MARKETPLACE_ID ?? DEFAULT_MARKETPLACE_ID;
}

function getSyncTargetSeconds() {
  const parsed = Number.parseInt(process.env.SYNC_POLL_INTERVAL_SECONDS ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_SYNC_TARGET_SECONDS;
}

function getShopifyReadiness(scopes: string[]) {
  const configuredScopes = getConfiguredShopifyScopes();
  const missingScopes = REQUIRED_SHOPIFY_SCOPES.filter(
    (scope) => !configuredScopes.includes(scope) && !scopes.includes(scope),
  );

  return {
    missingScopes,
    summary: {
      detail:
        missingScopes.length === 0
          ? "Installazione, scope minimi e webhook pilota predisposti."
          : `Mancano scope Shopify: ${missingScopes.join(", ")}.`,
      label: "Shopify",
      status: missingScopes.length === 0 ? "pronto" : "da completare",
    },
  };
}

function getSupabaseReadiness() {
  const queueProviderReady = process.env.JOB_QUEUE_PROVIDER === "supabase_queues";
  const schedulerProviderReady =
    process.env.JOB_SCHEDULER_PROVIDER === "supabase_cron";
  const storageBucket =
    process.env.SUPABASE_STORAGE_BUCKET ?? "syncbay-import-staging";

  return {
    queueProviderReady,
    schedulerProviderReady,
    storageBucket,
    summary: {
      detail:
        queueProviderReady && schedulerProviderReady
          ? "Database operativo; queue, cron e storage sono predisposti."
          : "Provider queue/cron da allineare agli env runtime.",
      label: "Supabase",
      status: queueProviderReady && schedulerProviderReady ? "pronto" : "da completare",
    },
  };
}

function getVercelReadiness() {
  const appUrl = process.env.SHOPIFY_APP_URL;
  const publicUrl = appUrl || "https://syncbay.vercel.app";
  const ready = publicUrl.startsWith("https://");

  return {
    publicUrl,
    summary: {
      detail: ready
        ? "URL HTTPS stabile per app, callback e privacy."
        : "URL pubblico HTTPS mancante.",
      label: "Vercel",
      status: ready ? "pronto" : "da completare",
    },
  };
}

function getComplianceReadiness() {
  const accountDeletion = getAccountDeletionChallengeConfig();
  const ready = accountDeletion.missingRequirements.length === 0;

  return {
    accountDeletion: {
      endpointConfigured: hasRuntimeValue(accountDeletion.endpoint),
      missingRequirements: accountDeletion.missingRequirements,
      notificationsEnabled: accountDeletion.notificationsEnabled,
    },
    summary: {
      detail: ready
        ? "Endpoint account deletion predisposto; notifiche reali non abilitate."
        : "Endpoint e verification token account deletion da completare.",
      label: "Privacy",
      status: ready ? "bloccato" : "da completare",
    },
  };
}

function getOnboardingReadiness() {
  return {
    defaults: {
      descriptionMode: "HTML pulito senza template",
      imageImport: "Tutte le immagini",
      productStatus: "draft",
    },
    steps: [
      "Collega Shopify",
      "Collega eBay.it",
      "Scegli location Shopify",
      "Conferma default import",
      "Genera preview",
    ],
  };
}

function getImportPreviewReadiness(input: {
  ebayConnected: boolean;
  hasDefaultLocation: boolean;
  listingReaderAvailable?: boolean;
}) {
  const blockers = [
    !input.ebayConnected ? "account eBay non collegato" : null,
    !input.hasDefaultLocation ? "location Shopify predefinita non confermata" : null,
    input.listingReaderAvailable === false
      ? "lettura listing eBay non ancora implementata"
      : null,
  ].filter((blocker): blocker is string => Boolean(blocker));

  return {
    blockers,
    defaults: {
      descriptionMode: "HTML pulito senza template",
      imageImport: "Tutte le immagini",
      productStatus: "draft",
    },
    summary: {
      detail:
        blockers.length === 0
          ? "Preview import pronta da costruire sui listing eBay."
          : `Preview bloccata: ${blockers.join(", ")}.`,
      label: "Import preview",
      status: blockers.length === 0 ? "pronto" : "bloccato",
    },
  };
}

function getImportPreviewPlan() {
  return {
    limits: {
      maxProducts: 2000,
      marketplace: getEbayMarketplaceId(),
    },
    steps: [
      "Leggere listing attivi eBay.it",
      "Validare SKU, varianti, immagini e disponibilità",
      "Pulire descrizioni e rimuovere template eBay",
      "Mostrare prodotti importabili, saltati ed errori",
      "Creare bozze Shopify solo dopo conferma",
    ],
  };
}

function getConfiguredShopifyScopes() {
  return splitScopes(process.env.SHOPIFY_SCOPES ?? process.env.SCOPES);
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
