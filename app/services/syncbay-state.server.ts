import {
  EbayConnectionStatus,
  Prisma,
  ProductMappingStatus,
  SyncConflictStatus,
  SyncJobStatus,
  SyncJobType,
} from "@prisma/client";
import prisma from "../db.server";
import { normalizeImportProductStatus } from "../lib/import-product-status";
import { buildCatalogHealthCenter } from "../lib/syncbay-catalog-health-center";
import {
  getCompletedCatalogVerificationJobWhere,
  getCompletedIncrementalWorkJobWhere,
} from "../lib/syncbay-catalog-verification-job";
import {
  DASHBOARD_RELIABILITY_JOB_LIMIT,
  summarizeReliability,
} from "../lib/syncbay-dashboard-metrics";
import {
  DEFAULT_DESCRIPTION_RULE,
  normalizeDescriptionRule,
} from "../lib/syncbay-description-rules";
import { getFullReconcilePolicyState } from "../lib/syncbay-full-reconcile-policy";
import { summarizeSyncJobQuarantine } from "../lib/syncbay-job-quarantine";
import {
  measureSyncBayPerformanceStage,
  type SyncBayLoaderPerformanceTrace,
} from "../lib/syncbay-loader-performance";
import {
  loadShopifyProductPublications,
  type ShopifyProductPublication,
} from "../lib/syncbay-product-publication";
import {
  normalizeProductPublicationMode,
  parseProductPublicationGids,
} from "../lib/syncbay-product-publication-settings";
import { hasEffectiveShopifyScope } from "../lib/syncbay-shopify-scopes";
import { SHOPIFY_WEBHOOK_TOPICS } from "../lib/syncbay-shopify-webhook";
import { getCatalogSyncHealth } from "../lib/syncbay-sync-health";
import { buildSyncHealthDigest } from "../lib/syncbay-sync-health-digest";
import { getSyncEnablementBlockers } from "../lib/syncbay-sync-settings";
import { getEbayMarketplaceId } from "./ebay-environment.server";
import { DEFAULT_PRICING_RULE, normalizePricingRule } from "./pricing-rules.server";

import {
  ensureShopForSession,
  getAccountDeletionPostConfig,
  getEbayRuntimeReadiness,
} from "./syncbay-operations.server";
import {
  canRequestRetry,
  getCatalogSummaryCounts,
  getExistingDescriptionRuleForSettings,
  getImportPreviewReadiness,
  getJsonNumber,
  getJsonObject,
  getJsonString,
  getOnboardingReadiness,
  hasRuntimeValue,
  ShopifyAdminGraphqlClient,
  ShopifySessionLike,
} from "./syncbay-shared.server";

const REQUIRED_SHOPIFY_SCOPES = [
  "read_products",
  "write_products",
  "read_inventory",
  "write_inventory",
  "read_locations",
  "write_locations",
  "read_orders",
  "write_orders",
  "read_publications",
  "write_publications",
  "read_files",
  "write_files",
];

export async function getOverviewState(
  session: ShopifySessionLike,
  trace?: SyncBayLoaderPerformanceTrace,
) {
  const shop = await measureSyncBayPerformanceStage(trace, "dashboard.shop.ensure", () =>
    ensureShopForSession(session),
  );
  const defaultProductStatus = normalizeImportProductStatus(shop.defaultProductStatus);
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [
    [
      ebayConnection,
      recentJobs,
      recentImportJobs,
      recentAuditLogs,
      mappingCount,
      openConflictCount,
      openConflicts,
      snapshotCount,
      latestIncrementalJob,
      activeIncrementalJobCount,
      nextRetryJob,
      latestIncrementalWorkJob,
      latestFullReconcileJob,
      reliabilityJobs,
      newMappings24h,
      newConflicts24h,
      erroredMappingCount,
    ],
    latestImportRun,
    descriptionRule,
  ] = await Promise.all([
    measureSyncBayPerformanceStage(trace, "dashboard.db.mainTransaction", () =>
      prisma.$transaction([
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
        prisma.syncConflict.count({
          where: {
            shopId: shop.id,
            status: SyncConflictStatus.OPEN,
          },
        }),
        prisma.syncConflict.findMany({
          include: {
            mapping: {
              select: {
                ebayItemId: true,
                shopifyProductGid: true,
              },
            },
          },
          orderBy: { detectedAt: "desc" },
          take: 8,
          where: {
            shopId: shop.id,
            status: SyncConflictStatus.OPEN,
          },
        }),
        prisma.productSnapshot.count({
          where: { shopId: shop.id },
        }),
        prisma.syncJob.findFirst({
          orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
          where: getCompletedCatalogVerificationJobWhere(shop.id),
        }),
        prisma.syncJob.count({
          where: {
            shopId: shop.id,
            status: {
              in: [SyncJobStatus.PENDING, SyncJobStatus.RETRYING, SyncJobStatus.RUNNING],
            },
            type: SyncJobType.SYNC_INCREMENTAL,
          },
        }),
        prisma.syncJob.findFirst({
          orderBy: [{ runAfter: "asc" }, { createdAt: "asc" }],
          select: { runAfter: true },
          where: {
            runAfter: { gt: now },
            shopId: shop.id,
            status: SyncJobStatus.RETRYING,
          },
        }),
        prisma.syncJob.findFirst({
          orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
          select: { result: true },
          where: getCompletedIncrementalWorkJobWhere(shop.id),
        }),
        prisma.syncJob.findFirst({
          orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
          select: { finishedAt: true },
          where: {
            payload: { path: ["source"], equals: "catalog_reconcile" },
            shopId: shop.id,
            status: SyncJobStatus.SUCCEEDED,
            type: SyncJobType.SYNC_INCREMENTAL,
          },
        }),
        prisma.syncJob.findMany({
          orderBy: { createdAt: "desc" },
          select: {
            attempts: true,
            createdAt: true,
            maxAttempts: true,
            status: true,
          },
          take: DASHBOARD_RELIABILITY_JOB_LIMIT,
          where: { createdAt: { gte: weekAgo }, shopId: shop.id },
        }),
        prisma.productMapping.count({
          where: {
            createdAt: { gte: dayAgo },
            marketplaceId: getEbayMarketplaceId(),
            shopId: shop.id,
          },
        }),
        prisma.syncConflict.count({
          where: { detectedAt: { gte: dayAgo }, shopId: shop.id },
        }),
        prisma.productMapping.count({
          where: {
            marketplaceId: getEbayMarketplaceId(),
            shopId: shop.id,
            status: ProductMappingStatus.ERROR,
          },
        }),
      ]),
    ),
    measureSyncBayPerformanceStage(trace, "dashboard.db.latestImportRun", () =>
      getLatestImportRunSummary(shop.id),
    ),
    measureSyncBayPerformanceStage(trace, "dashboard.db.descriptionRule", () =>
      getExistingDescriptionRuleForSettings(shop.id),
    ),
  ]);
  const ebayRuntime = getEbayRuntimeReadiness();
  const shopifyScopes = splitScopes(shop.shopifyScopes);
  const shopifyReadiness = getShopifyReadiness(shopifyScopes);
  const supabaseReadiness = getSupabaseReadiness();
  const vercelReadiness = getVercelReadiness();
  const complianceReadiness = getComplianceReadiness();
  const importPreview = getImportPreviewReadiness({
    defaultProductStatus,
    descriptionRuleMode: descriptionRule.mode,
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
  const reliability = summarizeReliability(reliabilityJobs, now);
  const catalogSyncHealth = getCatalogSyncHealth({
    activeIncrementalJobCount,
    latestIncrementalFinishedAt: latestIncrementalJob?.finishedAt ?? null,
    now,
    syncEnabled: shop.syncEnabled,
    syncTargetSeconds: shop.syncTargetSeconds,
  });
  const quarantinedJobCount = summarizeSyncJobQuarantine(
    reliabilityJobs.filter((job) => job.createdAt >= dayAgo),
  ).actionableCount;
  const syncHealthDigest = buildSyncHealthDigest({
    conflictsOpen: openConflictCount,
    healthStatus: catalogSyncHealth.status,
    jobs: reliabilityJobs,
    now,
    quarantinedCount: quarantinedJobCount,
    secondsUntilDue: catalogSyncHealth.secondsUntilDue,
  });
  const lastRunCounts = {
    requested: readJobResultCount(latestIncrementalWorkJob?.result, "requestedCount"),
    synced: readJobResultCount(latestIncrementalWorkJob?.result, "syncedCount"),
  };
  const catalogSummary = await measureSyncBayPerformanceStage(
    trace,
    "dashboard.db.catalogSummaryCounts",
    () =>
      getCatalogSummaryCounts({
        now,
        shopId: shop.id,
        syncTargetSeconds: shop.syncTargetSeconds,
      }),
  );
  const failedJobCount = recentJobs.filter((job) => job.status === SyncJobStatus.FAILED).length;
  const catalogHealthCenter = buildCatalogHealthCenter({
    activeIncrementalJobCount,
    erroredMappingCount,
    failedJobCount,
    needsCheckCount: catalogSummary.needsCheckCount,
    openConflictCount,
    staleActiveCount: catalogSummary.staleActiveCount,
    unknownAvailabilityCount: catalogSummary.unknownAvailabilityCount,
  });
  const fullReconcile = getFullReconcilePolicyState({
    intervalHours: 24,
    latestFinishedAt: latestFullReconcileJob?.finishedAt ?? null,
    now,
  });

  return {
    readiness,
    shop: {
      domain: shop.shopDomain,
      installationStatus: shop.installationStatus,
      syncEnabled: shop.syncEnabled,
      syncTargetSeconds: shop.syncTargetSeconds,
      defaultLocationGid: shop.defaultLocationGid,
      defaultProductStatus,
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
    onboarding: getOnboardingReadiness({
      defaultProductStatus,
      descriptionRuleMode: descriptionRule.mode,
    }),
    importPreview,
    imports: {
      latestRun: latestImportRun,
      mappingCount,
      recentJobs: recentImportJobs.map(formatImportJobSummary),
      snapshotCount,
    },
    conflicts: {
      openCount: openConflictCount,
      recent: openConflicts.map((conflict) => ({
        detectedAt: conflict.detectedAt.toISOString(),
        ebayItemId: conflict.mapping?.ebayItemId ?? null,
        field: conflict.field,
        id: conflict.id,
        shopifyProductGid: conflict.mapping?.shopifyProductGid ?? null,
        shopifyValue: conflict.shopifyValue,
        syncbayValue: conflict.lastSyncBayValue,
      })),
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
      pendingJobs: recentJobs.filter((job) => job.status === SyncJobStatus.PENDING).length,
      nextRetryRunAfter: nextRetryJob?.runAfter.toISOString() ?? null,
      lastJobs: recentJobs.map((job) => ({
        attempts: job.attempts,
        createdAt: job.createdAt.toISOString(),
        errorCode: job.errorCode,
        errorMessage: job.errorMessage,
        id: job.id,
        maxAttempts: job.maxAttempts,
        payload: job.payload,
        runAfter: job.runAfter.toISOString(),
        status: job.status,
        type: job.type,
      })),
      catalogHealth: {
        ...formatCatalogSyncHealth(catalogSyncHealth),
        activeIncrementalJobCount,
        latestIncrementalFinishedAt: latestIncrementalJob?.finishedAt?.toISOString() ?? null,
        latestIncrementalStatus: latestIncrementalJob?.status ?? null,
      },
      healthDigest: {
        conflictsOpen: syncHealthDigest.conflictsOpen,
        failedCount: syncHealthDigest.failedCount,
        headline: syncHealthDigest.headline,
        lagBreached: syncHealthDigest.lagBreached,
        lagSeconds: syncHealthDigest.lagSeconds,
        quarantinedCount: syncHealthDigest.quarantinedCount,
        syncedCount: syncHealthDigest.syncedCount,
        windowHours: syncHealthDigest.windowHours,
      },
      catalogHealthCenter,
      fullReconcile,
      lastRunCounts,
    },
    metrics: {
      reliability,
      trends: {
        newConflicts24h,
        newMappings24h,
      },
    },
    audit: recentAuditLogs.map((log) => ({
      createdAt: log.createdAt.toISOString(),
      message: log.message,
      type: log.type,
    })),
  };
}

export async function getActivityState(
  session: ShopifySessionLike,
  trace?: SyncBayLoaderPerformanceTrace,
) {
  const shop = await measureSyncBayPerformanceStage(trace, "activity.shop.ensure", () =>
    ensureShopForSession(session),
  );
  const now = new Date();
  const [
    recentJobs,
    recentAuditLogs,
    openConflictCount,
    openConflicts,
    latestIncrementalJob,
    activeIncrementalJobCount,
    latestFullReconcileJob,
    erroredMappingCount,
  ] = await measureSyncBayPerformanceStage(trace, "activity.db.state", () =>
    Promise.all([
      prisma.syncJob.findMany({
        where: { shopId: shop.id },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.auditLog.findMany({
        where: { shopId: shop.id },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.syncConflict.count({
        where: {
          shopId: shop.id,
          status: SyncConflictStatus.OPEN,
        },
      }),
      prisma.syncConflict.findMany({
        include: {
          mapping: {
            select: {
              ebayItemId: true,
              shopifyProductGid: true,
            },
          },
        },
        orderBy: { detectedAt: "desc" },
        take: 8,
        where: {
          shopId: shop.id,
          status: SyncConflictStatus.OPEN,
        },
      }),
      prisma.syncJob.findFirst({
        orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
        where: getCompletedCatalogVerificationJobWhere(shop.id),
      }),
      prisma.syncJob.count({
        where: {
          shopId: shop.id,
          status: {
            in: [SyncJobStatus.PENDING, SyncJobStatus.RETRYING, SyncJobStatus.RUNNING],
          },
          type: SyncJobType.SYNC_INCREMENTAL,
        },
      }),
      prisma.syncJob.findFirst({
        orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
        select: { finishedAt: true },
        where: {
          payload: { path: ["source"], equals: "catalog_reconcile" },
          shopId: shop.id,
          status: SyncJobStatus.SUCCEEDED,
          type: SyncJobType.SYNC_INCREMENTAL,
        },
      }),
      prisma.productMapping.count({
        where: {
          marketplaceId: getEbayMarketplaceId(),
          shopId: shop.id,
          status: ProductMappingStatus.ERROR,
        },
      }),
    ]),
  );
  const catalogSyncHealth = getCatalogSyncHealth({
    activeIncrementalJobCount,
    latestIncrementalFinishedAt: latestIncrementalJob?.finishedAt ?? null,
    now,
    syncEnabled: shop.syncEnabled,
    syncTargetSeconds: shop.syncTargetSeconds,
  });
  const failedJobCount = recentJobs.filter((job) => job.status === SyncJobStatus.FAILED).length;
  const catalogHealthCenter = buildCatalogHealthCenter({
    activeIncrementalJobCount,
    erroredMappingCount,
    failedJobCount,
    needsCheckCount: 0,
    openConflictCount,
    staleActiveCount: 0,
    unknownAvailabilityCount: 0,
  });
  const fullReconcile = getFullReconcilePolicyState({
    intervalHours: 24,
    latestFinishedAt: latestFullReconcileJob?.finishedAt ?? null,
    now,
  });

  return {
    conflicts: {
      openCount: openConflictCount,
      recent: openConflicts.map((conflict) => ({
        detectedAt: conflict.detectedAt.toISOString(),
        ebayItemId: conflict.mapping?.ebayItemId ?? null,
        field: conflict.field,
        id: conflict.id,
        shopifyProductGid: conflict.mapping?.shopifyProductGid ?? null,
        shopifyValue: conflict.shopifyValue,
        syncbayValue: conflict.lastSyncBayValue,
      })),
    },
    sync: {
      pendingJobs: recentJobs.filter((job) => job.status === SyncJobStatus.PENDING).length,
      lastJobs: recentJobs.map((job) => ({
        attempts: job.attempts,
        createdAt: job.createdAt.toISOString(),
        errorCode: job.errorCode,
        errorMessage: job.errorMessage,
        id: job.id,
        maxAttempts: job.maxAttempts,
        payload: job.payload,
        runAfter: job.runAfter.toISOString(),
        status: job.status,
        type: job.type,
      })),
      catalogHealth: {
        ...formatCatalogSyncHealth(catalogSyncHealth),
        activeIncrementalJobCount,
        latestIncrementalFinishedAt: latestIncrementalJob?.finishedAt?.toISOString() ?? null,
        latestIncrementalStatus: latestIncrementalJob?.status ?? null,
      },
      catalogHealthCenter,
      fullReconcile,
    },
    audit: recentAuditLogs.map((log) => ({
      createdAt: log.createdAt.toISOString(),
      message: log.message,
      type: log.type,
    })),
  };
}

/**
 * Legge in modo difensivo un conteggio numerico dal `result` JSON di un job.
 * Il result varia di forma per tipo di job; se il campo manca o non è numerico
 * restituisce null invece di inventare un valore.
 */
function readJobResultCount(
  result: Prisma.JsonValue | null | undefined,
  key: string,
): number | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }

  const value = (result as Record<string, unknown>)[key];

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function getShopSettingsState(
  session: ShopifySessionLike,
  admin?: ShopifyAdminGraphqlClient,
  trace?: SyncBayLoaderPerformanceTrace,
) {
  const shop = await measureSyncBayPerformanceStage(trace, "settings.shop.ensure", () =>
    ensureShopForSession(session),
  );
  const [ebayConnection, activeMappingCount, latestIncrementalJob, pricingRule, descriptionRule] =
    await measureSyncBayPerformanceStage(trace, "settings.db.stateTransaction", () =>
      prisma.$transaction([
        prisma.ebayConnection.findUnique({
          where: {
            shopId_marketplaceId: {
              marketplaceId: getEbayMarketplaceId(),
              shopId: shop.id,
            },
          },
        }),
        prisma.productMapping.count({
          where: {
            marketplaceId: getEbayMarketplaceId(),
            shopId: shop.id,
            status: ProductMappingStatus.ACTIVE,
          },
        }),
        prisma.syncJob.findFirst({
          orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
          select: { finishedAt: true },
          where: {
            shopId: shop.id,
            status: SyncJobStatus.SUCCEEDED,
            type: SyncJobType.SYNC_INCREMENTAL,
          },
        }),
        prisma.pricingRule.findUnique({
          select: {
            discountPercent: true,
            roundingMode: true,
          },
          where: { shopId: shop.id },
        }),
        prisma.descriptionRule.findUnique({
          select: { mode: true },
          where: { shopId: shop.id },
        }),
      ]),
    );
  const ebayRuntime = getEbayRuntimeReadiness();
  const shopifyScopes = splitScopes(shop.shopifyScopes);
  const shopifyReadiness = getShopifyReadiness(shopifyScopes);
  const syncBlockers = getSyncEnablementBlockers({
    activeMappingCount,
    ebayConnected: ebayConnection?.status === EbayConnectionStatus.CONNECTED,
    hasDefaultLocation: Boolean(shop.defaultLocationGid),
    requestedSyncEnabled: true,
  });
  const publicationMode = normalizeProductPublicationMode(shop.productPublicationMode);
  const selectedPublicationIds = parseProductPublicationGids(shop.productPublicationGids);
  const publicationState = admin
    ? await measureSyncBayPerformanceStage(trace, "settings.shopify.publications", () =>
        loadShopSettingsPublications(admin),
      )
    : { availablePublications: [], errorMessage: null };

  return {
    ebay: {
      connectedAt: ebayConnection?.connectedAt?.toISOString() ?? null,
      marketplaceId: getEbayMarketplaceId(),
      oauthEnabled: ebayRuntime.oauthEnabled,
      oauthReady: ebayRuntime.ready,
      status: ebayConnection?.status ?? EbayConnectionStatus.NOT_CONNECTED,
    },
    productPublications: {
      availablePublications: publicationState.availablePublications,
      errorMessage: publicationState.errorMessage,
      mode: publicationMode,
      selectedPublicationIds,
    },
    descriptionRule: normalizeDescriptionRule(descriptionRule ?? DEFAULT_DESCRIPTION_RULE),
    pricingRule: normalizePricingRule(pricingRule ?? DEFAULT_PRICING_RULE),
    shopify: {
      configuredScopes: getConfiguredShopifyScopes(),
      missingConfiguredScopes: shopifyReadiness.missingConfiguredScopes,
      missingScopes: shopifyReadiness.missingScopes,
      scopes: shopifyScopes,
      webhookTopics: SHOPIFY_WEBHOOK_TOPICS,
    },
    shop: {
      defaultProductStatus: normalizeImportProductStatus(shop.defaultProductStatus),
      domain: shop.shopDomain,
      syncEnabled: shop.syncEnabled,
      syncTargetSeconds: shop.syncTargetSeconds,
    },
    sync: {
      activeMappingCount,
      canEnable: syncBlockers.length === 0,
      enablementBlockers: syncBlockers,
      lastIncrementalFinishedAt: latestIncrementalJob?.finishedAt?.toISOString() ?? null,
    },
  };
}

async function loadShopSettingsPublications(admin: ShopifyAdminGraphqlClient) {
  const publications = await loadShopifyProductPublications(admin);

  if ("errorMessage" in publications) {
    return {
      availablePublications: [] as ShopifyProductPublication[],
      errorMessage: publications.errorMessage,
    };
  }

  return {
    availablePublications: publications,
    errorMessage: null,
  };
}

function getShopifyReadiness(scopes: string[]) {
  const configuredScopes = getConfiguredShopifyScopes();
  const missingScopes = REQUIRED_SHOPIFY_SCOPES.filter(
    (scope) => !hasEffectiveShopifyScope(scopes, scope),
  );
  const missingConfiguredScopes = REQUIRED_SHOPIFY_SCOPES.filter(
    (scope) => !hasEffectiveShopifyScope(configuredScopes, scope),
  );
  const ready = missingScopes.length === 0 && missingConfiguredScopes.length === 0;

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
  const queueProviderReady = process.env.JOB_QUEUE_PROVIDER === "supabase_queues";
  const schedulerProviderReady = process.env.JOB_SCHEDULER_PROVIDER === "supabase_cron";
  const storageBucket = process.env.SUPABASE_STORAGE_BUCKET ?? "syncbay-import-staging";

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

  return "Installazione, scope minimi concessi e webhook 1.0 privata predisposti.";
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
      status: ready && accountDeletion.notificationsEnabled ? "pronto" : "da completare",
    },
  };
}

async function getLatestImportRunSummary(shopId: string) {
  const importJobs = await prisma.syncJob.findMany({
    orderBy: [{ createdAt: "desc" }, { updatedAt: "desc" }],
    take: 300,
    where: { shopId, type: SyncJobType.IMPORT_CATALOG },
  });
  const latestRunId = importJobs
    .map((job) => getCatalogImportRunIdFromPayload(job.payload))
    .find((runId): runId is string => Boolean(runId));

  if (!latestRunId) return null;

  const runJobs = importJobs.filter(
    (job) => getCatalogImportRunIdFromPayload(job.payload) === latestRunId,
  );
  const statusRowsByKey = new Map<
    string,
    {
      batchCount: number | null;
      firstBatch: number | null;
      itemCount: number;
      jobCount: number;
      jobKind: string;
      lastBatch: number | null;
      status: SyncJobStatus;
    }
  >();

  for (const job of runJobs) {
    const payload = getJsonObject(job.payload);
    const jobKind = getImportJobKind(payload);
    const batchIndex = getJsonNumber(payload?.batchIndex);
    const batchCount = getJsonNumber(payload?.batchCount);
    const itemCount = getImportJobItemCount(payload, job.result);
    const key = `${jobKind}:${job.status}`;
    const row = statusRowsByKey.get(key) ?? {
      batchCount: batchCount ?? null,
      firstBatch: batchIndex ?? null,
      itemCount: 0,
      jobCount: 0,
      jobKind,
      lastBatch: batchIndex ?? null,
      status: job.status,
    };

    row.batchCount = Math.max(row.batchCount ?? 0, batchCount ?? 0) || null;
    row.firstBatch =
      row.firstBatch === null || batchIndex === null
        ? row.firstBatch
        : Math.min(row.firstBatch, batchIndex);
    row.lastBatch =
      row.lastBatch === null || batchIndex === null
        ? row.lastBatch
        : Math.max(row.lastBatch, batchIndex);
    row.itemCount += itemCount;
    row.jobCount += 1;
    statusRowsByKey.set(key, row);
  }

  const catalogBatchJobs = runJobs.filter(
    (job) => getImportJobKind(getJsonObject(job.payload)) === "catalog_batch",
  );
  const activeStatuses = new Set<SyncJobStatus>([
    SyncJobStatus.PENDING,
    SyncJobStatus.RETRYING,
    SyncJobStatus.RUNNING,
  ]);
  const plannedItemCount = catalogBatchJobs.reduce(
    (total, job) => total + getImportJobItemCount(getJsonObject(job.payload), job.result),
    0,
  );
  const completedItemCount = catalogBatchJobs
    .filter((job) => job.status === SyncJobStatus.SUCCEEDED)
    .reduce(
      (total, job) => total + getImportJobItemCount(getJsonObject(job.payload), job.result),
      0,
    );
  const failedJobCount = runJobs.filter((job) => job.status === SyncJobStatus.FAILED).length;
  const activeJobCount = runJobs.filter((job) => activeStatuses.has(job.status)).length;

  return {
    activeJobCount,
    batchCount: catalogBatchJobs.length,
    completedItemCount,
    failedJobCount,
    plannedItemCount,
    recentProblemJobs: runJobs
      .filter(
        (job) =>
          job.status === SyncJobStatus.FAILED ||
          job.status === SyncJobStatus.RETRYING ||
          job.status === SyncJobStatus.RUNNING,
      )
      .slice(0, 8)
      .map((job) => {
        const payload = getJsonObject(job.payload);

        return {
          attempts: job.attempts,
          batchIndex: getJsonNumber(payload?.batchIndex),
          errorCode: job.errorCode,
          errorMessage: job.errorMessage,
          id: job.id,
          jobKind: getImportJobKind(payload),
          maxAttempts: job.maxAttempts,
          runAfter: job.runAfter.toISOString(),
          status: job.status,
        };
      }),
    runId: latestRunId,
    statusRows: [...statusRowsByKey.values()].sort((left, right) =>
      `${left.jobKind}:${left.status}`.localeCompare(`${right.jobKind}:${right.status}`),
    ),
  };
}

function getCatalogImportRunIdFromPayload(value: Prisma.JsonValue | null) {
  return getJsonString(getJsonObject(value)?.catalogImportRunId);
}

function getImportJobKind(payload: Record<string, Prisma.JsonValue> | null) {
  return payload?.batchIndex ? "catalog_batch" : "shopify_import";
}

function getImportJobItemCount(
  payload: Record<string, Prisma.JsonValue> | null,
  result: Prisma.JsonValue | null,
) {
  const payloadItemCount = getJsonArray(payload?.ebayItemIds)?.length;
  const requestedCount =
    getJsonNumber(payload?.requestedCount) ?? getJsonNumber(getJsonObject(result)?.requestedCount);

  return payloadItemCount ?? requestedCount ?? 0;
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
    failedCount: getJsonNumber(result?.failedCount) ?? failedResults?.length ?? 0,
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

function formatCatalogSyncHealth(health: ReturnType<typeof getCatalogSyncHealth>) {
  return {
    nextDueAt: health.nextDueAt?.toISOString() ?? null,
    overdueAt: health.overdueAt?.toISOString() ?? null,
    secondsUntilDue: health.secondsUntilDue,
    status: health.status,
  };
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

function getJsonArray(value: Prisma.JsonValue | undefined) {
  return Array.isArray(value) ? value : null;
}

function getJsonBoolean(value: Prisma.JsonValue | undefined) {
  return typeof value === "boolean" ? value : null;
}
