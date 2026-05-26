import {
  AuditEventType,
  EbayConnectionStatus,
  Prisma,
  ShopInstallationStatus,
  SyncJobStatus,
  SyncJobType,
} from "@prisma/client";

import prisma from "../db.server";
import { getEbayLiveImportPreview } from "./ebay-inventory-preview.server";
import {
  getImportPreviewValidationRules,
  getMockImportPreview,
} from "./import-preview.server";
import { getDraftImportReadiness } from "./shopify-draft-import.server";

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
  fulfillsOnlineOrders: boolean;
  id: string;
  isActive: boolean;
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
  "write_locations",
];
const SHOPIFY_WEBHOOK_TOPICS = [
  "app/uninstalled",
  "app/scopes_update",
  "products/update",
  "inventory_levels/update",
];

export async function getDashboardState(session: ShopifySessionLike) {
  const shop = await ensureShopForSession(session);
  const [
    ebayConnection,
    recentJobs,
    recentImportJobs,
    recentAuditLogs,
    mappingCount,
    snapshotCount,
  ] = await Promise.all([
    prisma.ebayConnection.findUnique({
      where: {
        shopId_marketplaceId: {
          marketplaceId: getEbayMarketplaceId(),
          shopId: shop.id,
        },
      },
    }),
    prisma.syncJob.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.syncJob.findMany({
      where: { shopId: shop.id, type: SyncJobType.IMPORT_CATALOG },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.auditLog.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.productMapping.count({
      where: { marketplaceId: getEbayMarketplaceId(), shopId: shop.id },
    }),
    prisma.productSnapshot.count({
      where: { shopId: shop.id },
    }),
  ]);
  const ebayRuntime = getEbayRuntimeReadiness();
  const shopifyScopes = splitScopes(shop.shopifyScopes);
  const shopifyReadiness = getShopifyReadiness(shopifyScopes);
  const supabaseReadiness = getSupabaseReadiness();
  const vercelReadiness = getVercelReadiness();
  const complianceReadiness = getComplianceReadiness();
  const importPreview = getImportPreviewReadiness({
    ebayConnected: ebayConnection?.status === EbayConnectionStatus.CONNECTED,
    hasDefaultLocation: Boolean(shop.defaultLocationGid),
    listingReaderAvailable: true,
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
      missingConfiguredScopes: shopifyReadiness.missingConfiguredScopes,
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
    imports: {
      mappingCount,
      recentJobs: recentImportJobs.map(formatImportJobSummary),
      snapshotCount,
    },
    sync: {
      failedJobs: recentJobs.flatMap((job) =>
        job.status === SyncJobStatus.FAILED
          ? [
              {
                createdAt: job.createdAt.toISOString(),
                errorCode: job.errorCode,
                errorMessage: job.errorMessage,
                type: job.type,
              },
            ]
          : [],
      ),
      jobsByStatus: summarizeJobsByStatus(recentJobs),
      jobsByType: summarizeJobsByType(recentJobs),
      pendingJobs: recentJobs.filter(
        (job) => job.status === SyncJobStatus.PENDING,
      ).length,
      lastJobs: recentJobs.map((job) => ({
        attempts: job.attempts,
        createdAt: job.createdAt.toISOString(),
        errorMessage: job.errorMessage,
        id: job.id,
        runAfter: job.runAfter.toISOString(),
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

export async function requestSyncJobRetry(
  session: ShopifySessionLike,
  jobId: string,
) {
  const shop = await ensureShopForSession(session);
  const job = await prisma.syncJob.findFirst({
    where: {
      id: jobId,
      shopId: shop.id,
    },
  });

  if (!job) {
    throw new Response("Job SyncBay non trovato per questo shop.", {
      status: 404,
    });
  }

  if (!canRequestRetry(job.status)) {
    throw new Response("Questo job non è in uno stato riprogrammabile.", {
      status: 400,
    });
  }

  const now = new Date();
  const details = {
    jobId: job.id,
    previousRunAfter: job.runAfter.toISOString(),
    previousStatus: job.status,
    requestedAt: now.toISOString(),
    type: job.type,
  } satisfies Prisma.JsonObject;

  await prisma.$transaction([
    prisma.syncJob.update({
      data: {
        errorCode: null,
        errorMessage: null,
        finishedAt: null,
        runAfter: now,
        status: SyncJobStatus.PENDING,
      },
      where: { id: job.id },
    }),
    prisma.auditLog.create({
      data: {
        details,
        message: "Retry job richiesto dalla dashboard.",
        shopId: shop.id,
        type: AuditEventType.SYNC_JOB_CREATED,
      },
    }),
  ]);

  return {
    message:
      "Job rimesso in coda. Il runner automatico lo prenderà in carico quando sarà collegato; per l'import draft puoi rieseguire subito dalla preview.",
    status: "queued" as const,
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
  const ebayConnected =
    ebayConnection?.status === EbayConnectionStatus.CONNECTED;
  const preview =
    ebayConnected && ebayConnection
      ? await getEbayLiveImportPreview(ebayConnection)
      : getMockImportPreviewState();
  const importPreview = getImportPreviewReadiness({
    ebayConnected,
    hasDefaultLocation: Boolean(shop.defaultLocationGid),
    listingReaderAvailable: true,
    listingReaderError: preview.errorMessage,
  });
  const previewResult = preview.previewResult;

  return {
    draftImport: getDraftImportReadiness({
      hasDefaultLocation: Boolean(shop.defaultLocationGid),
      previewResult,
    }),
    ebay: {
      marketplaceId: getEbayMarketplaceId(),
      status: ebayConnection?.status ?? EbayConnectionStatus.NOT_CONNECTED,
    },
    importPreview,
    onboarding: getOnboardingReadiness(),
    previewPlan: getImportPreviewPlan(),
    previewResult,
    previewSource: {
      coverageNote: preview.coverageNote,
      errorMessage: preview.errorMessage,
      readCount: preview.readCount,
      readCounts: preview.readCounts,
      source: preview.source,
      totalAvailable: preview.totalAvailable,
    },
    runtimePhases: getRuntimePhaseReadiness({
      ebayConnected,
      hasDefaultLocation: Boolean(shop.defaultLocationGid),
    }),
    shop: {
      defaultLocationGid: shop.defaultLocationGid,
      domain: shop.shopDomain,
    },
    validationRules: getImportPreviewValidationRules(),
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
    (location) =>
      location.id === locationGid &&
      location.isActive &&
      location.fulfillsOnlineOrders,
  );

  if (!selectedLocation) {
    throw new Response(
      "Scegli una location Shopify attiva e abilitata agli ordini online.",
      { status: 400 },
    );
  }

  const shop = await ensureShopForSession(session);
  await prisma.$transaction([
    prisma.shop.update({
      data: { defaultLocationGid: selectedLocation.id },
      where: { id: shop.id },
    }),
    prisma.auditLog.create({
      data: {
        details: {
          locationGid: selectedLocation.id,
          locationName: selectedLocation.name,
        },
        message: `Location Shopify predefinita impostata: ${selectedLocation.name}.`,
        shopId: shop.id,
        type: AuditEventType.CONNECTION_CHECK,
      },
    }),
  ]);

  return selectedLocation;
}

export async function recordShopifyLocationRenamed(
  session: ShopifySessionLike,
  input: {
    locationGid: string;
    locationName: string;
    previousLocationName: string;
  },
) {
  const shop = await ensureShopForSession(session);

  await prisma.auditLog.create({
    data: {
      details: {
        locationGid: input.locationGid,
        locationName: input.locationName,
        previousLocationName: input.previousLocationName,
      },
      message: `Location Shopify rinominata: ${input.locationName}.`,
      shopId: shop.id,
      type: AuditEventType.CONNECTION_CHECK,
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

export async function updateShopifyScopes(
  shopDomain: string,
  scopes: string[],
) {
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

export async function recordShopifyWebhookPlaceholder(
  input: WebhookRecordInput,
) {
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

    const jobOperation = idempotencyKey
      ? prisma.syncJob.upsert({
          where: { idempotencyKey },
          create: jobData,
          update: {},
        })
      : prisma.syncJob.create({ data: jobData });

    await prisma.$transaction([
      jobOperation,
      prisma.auditLog.create({
        data: {
          details,
          message: "Webhook Shopify ricevuto e tracciato.",
          shopId: shop.id,
          type: AuditEventType.SHOPIFY_WEBHOOK_RECEIVED,
        },
      }),
    ]);
    return;
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
  const missingRequirements = requirements.flatMap((requirement) =>
    hasRuntimeValue(process.env[requirement.envKey]) ? [] : [requirement.label],
  );

  const oauthEnabled = process.env.EBAY_OAUTH_ENABLED === "true";

  return {
    environment: process.env.EBAY_ENVIRONMENT ?? DEFAULT_EBAY_ENVIRONMENT,
    marketplaceId: getEbayMarketplaceId(),
    missingRequirements,
    oauthEnabled,
    oauthStatus: oauthEnabled
      ? "Attivabile"
      : "Predisposto, ma disabilitato da flag runtime",
    ready: missingRequirements.length === 0,
    summary: {
      detail:
        missingRequirements.length === 0
          ? oauthEnabled
            ? "Env OAuth presenti; pronto per test end-to-end."
            : "Env OAuth presenti; abilita il flag runtime per testare."
          : `Mancano ${missingRequirements.length} requisiti OAuth.`,
      label: "eBay",
      status:
        missingRequirements.length === 0 && oauthEnabled
          ? "pronto"
          : "da completare",
    },
  };
}

export function getAccountDeletionChallengeConfig() {
  const endpoint = process.env.EBAY_ACCOUNT_DELETION_ENDPOINT_URL;
  const verificationToken =
    process.env.EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN;

  return {
    endpoint,
    missingRequirements: [
      !hasRuntimeValue(endpoint) ? "endpoint account deletion eBay" : null,
      !hasRuntimeValue(verificationToken)
        ? "verification token account deletion eBay"
        : null,
    ].filter((requirement): requirement is string => Boolean(requirement)),
    notificationsEnabled:
      process.env.EBAY_ACCOUNT_DELETION_NOTIFICATIONS_ENABLED === "true",
    verificationToken,
  };
}

export function getAccountDeletionPostConfig() {
  const challengeConfig = getAccountDeletionChallengeConfig();
  const postRequirements = [
    { envKey: "EBAY_CLIENT_ID", label: "Client ID eBay" },
    { envKey: "EBAY_CLIENT_SECRET", label: "Client secret eBay" },
    { envKey: "TOKEN_ENCRYPTION_KEY", label: "chiave cifratura token" },
  ].flatMap((requirement) =>
    hasRuntimeValue(process.env[requirement.envKey]) ? [] : [requirement.label],
  );

  return {
    ...challengeConfig,
    missingRequirements: [
      ...challengeConfig.missingRequirements,
      ...postRequirements,
    ],
  };
}

export function extractWebhookResourceId(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  return (
    getStringField(record, "admin_graphql_api_id") ??
    getStringField(record, "id")
  );
}

function getPlaceholderJobType(topic: string) {
  if (topic === "orders/paid") return SyncJobType.UPDATE_EBAY_STOCK;
  if (topic === "products/update") return SyncJobType.DETECT_SHOPIFY_CHANGES;
  if (topic === "inventory_levels/update")
    return SyncJobType.DETECT_SHOPIFY_CHANGES;

  return null;
}

function normalizeShopifyWebhookTopic(topic: string) {
  return topic.toLowerCase().replaceAll("_", "/");
}

function getEbayMarketplaceId() {
  return process.env.EBAY_MARKETPLACE_ID ?? DEFAULT_MARKETPLACE_ID;
}

function getSyncTargetSeconds() {
  const parsed = Number.parseInt(
    process.env.SYNC_POLL_INTERVAL_SECONDS ?? "",
    10,
  );
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_SYNC_TARGET_SECONDS;
}

function getShopifyReadiness(scopes: string[]) {
  const configuredScopes = getConfiguredShopifyScopes();
  const missingScopes = REQUIRED_SHOPIFY_SCOPES.filter(
    (scope) => !hasEffectiveShopifyScope(scopes, scope),
  );
  const missingConfiguredScopes = REQUIRED_SHOPIFY_SCOPES.filter(
    (scope) => !hasEffectiveShopifyScope(configuredScopes, scope),
  );
  const ready =
    missingScopes.length === 0 && missingConfiguredScopes.length === 0;

  return {
    missingConfiguredScopes,
    missingScopes,
    summary: {
      detail: getShopifyReadinessDetail({
        missingConfiguredScopes,
        missingScopes,
      }),
      label: "Shopify",
      status: ready ? "pronto" : "da completare",
    },
  };
}

function getSupabaseReadiness() {
  const queueProviderReady =
    process.env.JOB_QUEUE_PROVIDER === "supabase_queues";
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
      status:
        queueProviderReady && schedulerProviderReady
          ? "pronto"
          : "da completare",
    },
  };
}

function getVercelReadiness() {
  const publicUrl = process.env.SHOPIFY_APP_URL?.trim() || null;
  const ready = Boolean(publicUrl?.startsWith("https://"));

  return {
    publicUrl,
    summary: {
      detail: ready
        ? "URL HTTPS stabile per app, callback e privacy."
        : "SHOPIFY_APP_URL HTTPS mancante nel runtime.",
      label: "Vercel",
      status: ready ? "pronto" : "da completare",
    },
  };
}

function getShopifyReadinessDetail(input: {
  missingConfiguredScopes: string[];
  missingScopes: string[];
}) {
  if (input.missingScopes.length > 0) {
    return `Scope non concessi dalla sessione Shopify: ${input.missingScopes.join(", ")}.`;
  }

  if (input.missingConfiguredScopes.length > 0) {
    return `Scope mancanti nella configurazione app: ${input.missingConfiguredScopes.join(", ")}.`;
  }

  return "Installazione, scope minimi concessi e webhook pilota predisposti.";
}

function getComplianceReadiness() {
  const accountDeletion = getAccountDeletionPostConfig();
  const ready = accountDeletion.missingRequirements.length === 0;

  return {
    accountDeletion: {
      endpointConfigured: hasRuntimeValue(accountDeletion.endpoint),
      missingRequirements: accountDeletion.missingRequirements,
      notificationsEnabled: accountDeletion.notificationsEnabled,
    },
    summary: {
      detail: ready
        ? accountDeletion.notificationsEnabled
          ? "Endpoint account deletion pronto con POST verificato e cleanup dati."
          : "Endpoint account deletion pronto; abilita il flag quando vuoi ricevere notifiche reali."
        : "Endpoint e verification token account deletion da completare.",
      label: "Privacy",
      status:
        ready && accountDeletion.notificationsEnabled
          ? "pronto"
          : "da completare",
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

function getMockImportPreviewState() {
  const previewResult = getMockImportPreview();

  return {
    coverageNote:
      "Preview dimostrativa locale: usa dati fittizi finché eBay non è collegato.",
    errorMessage: null,
    previewResult,
    readCount: previewResult.summary.totalCount,
    readCounts: {
      inventoryApi: 0,
      tradingApi: 0,
    },
    source: "mock" as const,
    totalAvailable: previewResult.summary.totalCount,
  };
}

function getImportPreviewReadiness(input: {
  ebayConnected: boolean;
  hasDefaultLocation: boolean;
  listingReaderError?: string | null;
  listingReaderAvailable?: boolean;
}) {
  const blockers = [
    !input.ebayConnected ? "account eBay non collegato" : null,
    !input.hasDefaultLocation
      ? "location Shopify predefinita non confermata"
      : null,
    input.listingReaderError
      ? `lettura listing eBay non riuscita: ${input.listingReaderError}`
      : null,
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
          ? "Preview import pronta sui dati eBay disponibili."
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

function getRuntimePhaseReadiness(input: {
  ebayConnected: boolean;
  hasDefaultLocation: boolean;
}) {
  return [
    {
      detail: input.ebayConnected
        ? "Account eBay collegato; preview live usa Inventory API e fallback Trading API in sola lettura per listing storici."
        : "Bloccato finché OAuth eBay non viene completato.",
      label: "Lettura listing eBay",
      status: input.ebayConnected ? "preparabile" : "bloccato",
    },
    {
      detail: input.hasDefaultLocation
        ? "Location Shopify pronta per bozze e inventario."
        : "Serve una location Shopify attiva e abilitata agli ordini online.",
      label: "Import Shopify in draft",
      status: input.hasDefaultLocation ? "preparabile" : "bloccato",
    },
    {
      detail:
        "Import draft tracciato con job idempotente e retry pianificati; consumer Supabase da collegare per esecuzione automatica.",
      label: "Job queue e retry",
      status: "preparabile",
    },
    {
      detail:
        "Polling entro 5 minuti da collegare dopo mapping e snapshot prodotto.",
      label: "Sync incrementale eBay -> Shopify",
      status: "da implementare",
    },
    {
      detail:
        "Webhook Shopify preparati; update eBay stock dipende da OAuth e capability listing.",
      label: "Protezione disponibilità Shopify -> eBay",
      status: input.ebayConnected ? "preparabile" : "bloccato",
    },
    {
      detail:
        "Webhook Shopify product/inventory tracciati; rilevazione conflitti ancora da collegare.",
      label: "Conflitti Shopify",
      status: "da implementare",
    },
    {
      detail:
        "Challenge e POST account deletion pronti; flag runtime controlla la ricezione reale.",
      label: "Compliance eBay/Shopify",
      status: "preparabile",
    },
  ];
}

function formatImportJobSummary(job: {
  attempts: number;
  createdAt: Date;
  errorMessage: string | null;
  finishedAt: Date | null;
  id: string;
  maxAttempts: number;
  result: Prisma.JsonValue | null;
  runAfter: Date;
  status: SyncJobStatus;
  type: SyncJobType;
}) {
  const result = getJsonObject(job.result);
  const failedResults = getJsonArray(result?.failedResults);

  return {
    attempts: job.attempts,
    canRequestRetry: canRequestRetry(job.status),
    createdAt: job.createdAt.toISOString(),
    errorMessage: job.errorMessage,
    failedCount:
      getJsonNumber(result?.failedCount) ?? failedResults?.length ?? 0,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    id: job.id,
    managedCount: getJsonNumber(result?.managedCount) ?? 0,
    maxAttempts: job.maxAttempts,
    requestedCount: getJsonNumber(result?.requestedCount) ?? 0,
    reusedCount: getJsonNumber(result?.reusedCount) ?? 0,
    runAfter: job.runAfter.toISOString(),
    status: job.status,
    willRetry: getJsonBoolean(result?.willRetry) ?? false,
  };
}

function canRequestRetry(status: SyncJobStatus) {
  const retryableStatuses: SyncJobStatus[] = [
    SyncJobStatus.FAILED,
    SyncJobStatus.RETRYING,
  ];

  return retryableStatuses.includes(status);
}

function summarizeJobsByStatus(
  jobs: Array<{
    status: SyncJobStatus;
  }>,
) {
  return Object.fromEntries(
    Object.values(SyncJobStatus).map((status) => [
      status,
      jobs.filter((job) => job.status === status).length,
    ]),
  );
}

function summarizeJobsByType(
  jobs: Array<{
    type: SyncJobType;
  }>,
) {
  return Object.fromEntries(
    Object.values(SyncJobType).map((type) => [
      type,
      jobs.filter((job) => job.type === type).length,
    ]),
  );
}

function getConfiguredShopifyScopes() {
  return splitScopes(process.env.SHOPIFY_SCOPES ?? process.env.SCOPES);
}

function splitScopes(scopes?: string | null) {
  return scopes
    ? scopes.split(",").flatMap((scope) => {
        const trimmedScope = scope.trim();
        return trimmedScope ? [trimmedScope] : [];
      })
    : [];
}

function hasEffectiveShopifyScope(scopes: string[], requiredScope: string) {
  if (scopes.includes(requiredScope)) return true;

  if (requiredScope === "read_products")
    return scopes.includes("write_products");
  if (requiredScope === "read_inventory")
    return scopes.includes("write_inventory");
  if (requiredScope === "read_locations")
    return scopes.includes("write_locations");

  return false;
}

function hasRuntimeValue(value: string | undefined) {
  return Boolean(value && value.trim().length > 0);
}

function getJsonObject(value: Prisma.JsonValue | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  return value as Record<string, Prisma.JsonValue>;
}

function getJsonArray(value: Prisma.JsonValue | undefined) {
  return Array.isArray(value) ? value : null;
}

function getJsonBoolean(value: Prisma.JsonValue | undefined) {
  return typeof value === "boolean" ? value : null;
}

function getJsonNumber(value: Prisma.JsonValue | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getStringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);

  return null;
}
