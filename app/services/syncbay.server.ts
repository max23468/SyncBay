import { createHash, randomUUID } from "node:crypto";

import {
  AuditEventType,
  EbayConnectionStatus,
  ProductPublicationMode as PrismaProductPublicationMode,
  Prisma,
  ProductMappingStatus,
  ProductSnapshotSource,
  ShopInstallationStatus,
  SyncConflictResolution,
  SyncConflictStatus,
  SyncJobStatus,
  SyncJobType,
  type EbayConnection,
} from "@prisma/client";

import prisma from "../db.server";
import {
  getImportProductStatusLabelCapitalized,
  type ImportProductStatus,
  IMPORT_PRODUCT_STATUS_VALUES,
  normalizeImportProductStatus,
} from "../lib/import-product-status";
import {
  CATALOG_PAGE_SIZE,
  type CatalogPageFilter,
  type CatalogSortDir,
  type CatalogSortKey,
  catalogRowMatchesSearch,
  getCatalogPageWindow,
  getCatalogQueryPlan,
  getCatalogSnapshotLookupIds,
  isCatalogRowNeedingCheck,
} from "../lib/syncbay-catalog-page";
import { summarizeReliability } from "../lib/syncbay-dashboard-metrics";
import { summarizeSyncJobQuarantine } from "../lib/syncbay-job-quarantine";
import { buildSyncHealthDigest } from "../lib/syncbay-sync-health-digest";
import { getCompletedCatalogVerificationJobWhere } from "../lib/syncbay-catalog-verification-job";
import { formatConflictValueForDisplay } from "../lib/syncbay-conflict-display";
import {
  getSafeBatchConflictResolutions,
  isStaleConflictResolutionError,
  summarizeConflictDecisionModes,
} from "../lib/syncbay-conflict-actions";
import {
  getLatestSyncBayDescriptionBaselineWhere,
  shouldUseSyncBayDescriptionBaselinePayload,
} from "../lib/syncbay-conflict-detection";
import {
  CONFLICT_PAGE_SIZE,
  type ConflictFilter,
  getConflictStatusFilter,
} from "../lib/syncbay-conflicts-page";
import { getPageWindow } from "../lib/syncbay-pagination";
import {
  getSyncTargetLabel,
  normalizeSyncTargetSeconds,
} from "../lib/syncbay-sync-interval";
import { buildPricingRuleSyncPlan } from "../lib/syncbay-pricing-rule-sync";
import {
  getCatalogRowStatus,
  isCatalogMappingStale,
  type CatalogAvailabilityKind,
  type CatalogStatusKind,
} from "../lib/syncbay-ui-state";
import {
  loadShopifyProductPublications,
  type ShopifyProductPublication,
} from "../lib/syncbay-product-publication";
import {
  normalizeProductPublicationMode,
  parseProductPublicationGids,
  serializeProductPublicationGids,
  type ProductPublicationMode,
} from "../lib/syncbay-product-publication-settings";
import { normalizePricingRuleFormInput } from "../lib/syncbay-pricing-rules";
import {
  getProductSnapshotThumbnailUrlByMappingIdFromRows,
  getProductSnapshotThumbnailUrlFromPayloads,
} from "../lib/syncbay-product-snapshot-payload";
import type { ShopifyMatchCandidate } from "../lib/syncbay-product-matching";
import { getShopifyProductThumbnailUrl } from "../lib/syncbay-shopify-product-thumbnail";
import { hasEffectiveShopifyScope } from "../lib/syncbay-shopify-scopes";
import { getKeepShopifyDescriptionHash } from "../lib/syncbay-keep-shopify-baseline";
import { getShopifyWebhookJobPayload } from "../lib/syncbay-shopify-webhook";
import { getCatalogSyncHealth } from "../lib/syncbay-sync-health";
import { getSyncEnablementBlockers } from "../lib/syncbay-sync-settings";
import { getManualRetryState } from "../lib/syncbay-job-diagnostics";
import { getShopifyChangeJobResourceKeys } from "../lib/syncbay-job-scheduling";
import { buildCatalogHealthCenter } from "../lib/syncbay-catalog-health-center";
import { getFullReconcilePolicyState } from "../lib/syncbay-full-reconcile-policy";
import {
  DEFAULT_DESCRIPTION_RULE,
  type DescriptionRuleMode,
  getDescriptionRuleSummary,
  normalizeDescriptionRule,
  normalizeDescriptionRuleFormInput,
} from "../lib/syncbay-description-rules";
import { getUsableEbayAccessToken } from "./ebay-token.server";
import { getEbayTradingCatalogImportPlan } from "./ebay-trading-preview.server";
import { getEbayLiveImportPreview } from "./ebay-inventory-preview.server";
import {
  addExistingProductMatchSuggestions,
  getImportPreviewValidationRules,
  getMockImportPreview,
  type ImportPreviewResult,
} from "./import-preview.server";
import {
  DEFAULT_PRICING_RULE,
  normalizePricingRule,
} from "./pricing-rules.server";
import {
  getDraftImportLimit,
  getDraftImportReadiness,
} from "./shopify-draft-import.server";
import { getShopifyAdminGraphqlClient } from "./shopify-admin-session.server";

interface ShopifySessionLike {
  shop: string;
  scope?: string | null;
}

interface ShopifyAdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

interface ShopifyExistingProductMatchResponse {
  data?: {
    products?: {
      nodes?: Array<{
        id: string;
        title: string | null;
        variants?: {
          nodes?: Array<{
            barcode: string | null;
            id: string;
            sku: string | null;
          }>;
        };
      }>;
    };
  };
  errors?: unknown[];
}

type LatestProductSnapshotForDisplay = {
  capturedAt: Date;
  currency: string | null;
  mappingId: string | null;
  payload: Prisma.JsonValue | null;
  priceAmount: Prisma.Decimal | null;
  productStatus: string | null;
  quantity: number | null;
  sku: string | null;
  title: string | null;
};

interface WebhookRecordInput {
  payload?: unknown;
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
const CATALOG_IMPORT_MAX_PRODUCTS = 2000;
const CATALOG_IMPORT_BATCH_MAX_ATTEMPTS = 4;
const PRICING_RULE_SYNC_BATCH_SIZE = 10;
const RETRIED_SYNC_JOB_MIN_MAX_ATTEMPTS = 4;
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
const SHOPIFY_WEBHOOK_TOPICS = [
  "app/uninstalled",
  "app/scopes_update",
  "orders/paid",
  "products/update",
  "inventory_levels/update",
];

export async function getDashboardState(session: ShopifySessionLike) {
  const shop = await ensureShopForSession(session);
  const defaultProductStatus = normalizeImportProductStatus(
    shop.defaultProductStatus,
  );
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
  ] = await Promise.all([
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
            in: [
              SyncJobStatus.PENDING,
              SyncJobStatus.RETRYING,
              SyncJobStatus.RUNNING,
            ],
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
        where: {
          shopId: shop.id,
          status: SyncJobStatus.SUCCEEDED,
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
      prisma.syncJob.findMany({
        orderBy: { createdAt: "asc" },
        select: {
          attempts: true,
          createdAt: true,
          maxAttempts: true,
          status: true,
        },
        take: 2000,
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
    getLatestImportRunSummary(shop.id),
  ]);
  const descriptionRule = await getExistingDescriptionRuleForSettings(shop.id);
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
    requested: readJobResultCount(
      latestIncrementalWorkJob?.result,
      "requestedCount",
    ),
    synced: readJobResultCount(latestIncrementalWorkJob?.result, "syncedCount"),
  };
  const catalogSummary = await getCatalogSummaryCounts({
    now,
    shopId: shop.id,
    syncTargetSeconds: shop.syncTargetSeconds,
  });
  const failedJobCount = recentJobs.filter(
    (job) => job.status === SyncJobStatus.FAILED,
  ).length;
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
      pendingJobs: recentJobs.filter(
        (job) => job.status === SyncJobStatus.PENDING,
      ).length,
      nextRetryRunAfter: nextRetryJob?.runAfter.toISOString() ?? null,
      lastJobs: recentJobs.map((job) => ({
        attempts: job.attempts,
        createdAt: job.createdAt.toISOString(),
        errorCode: job.errorCode,
        errorMessage: job.errorMessage,
        id: job.id,
        maxAttempts: job.maxAttempts,
        runAfter: job.runAfter.toISOString(),
        status: job.status,
        type: job.type,
      })),
      catalogHealth: {
        ...formatCatalogSyncHealth(catalogSyncHealth),
        activeIncrementalJobCount,
        latestIncrementalFinishedAt:
          latestIncrementalJob?.finishedAt?.toISOString() ?? null,
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

/**
 * Aggrega l'affidabilità del servizio sugli ultimi 7 giorni a partire dai job
 * realmente registrati: totale, riusciti, tasso e serie giornaliera per la
 * sparkline. Nessun dato sintetico: se non ci sono job, la finestra è vuota.
 */
export async function getCatalogPageState(
  session: ShopifySessionLike,
  input: {
    filter?: CatalogPageFilter;
    page?: number;
    search?: string;
    sort?: CatalogSortKey | null;
    sortDir?: CatalogSortDir;
  } = {},
) {
  const shop = await ensureShopForSession(session);
  const activeFilter = input.filter ?? "all";
  const activePage = input.page ?? 1;
  const activeSearch = input.search ?? "";
  const activeSort = input.sort ?? null;
  const activeSortDir = input.sortDir ?? "asc";
  const where = {
    marketplaceId: getEbayMarketplaceId(),
    shopId: shop.id,
  };
  const totalAvailableCount = await prisma.productMapping.count({ where });
  const databasePageWhere =
    !activeSearch.trim() && !activeSort
      ? getCatalogDatabasePageWhere(where, activeFilter)
      : null;
  const databasePageTotalCount = databasePageWhere
    ? await prisma.productMapping.count({ where: databasePageWhere })
    : totalAvailableCount;
  const queryPlan = getCatalogQueryPlan({
    filter: activeFilter,
    page: activePage,
    search: activeSearch,
    sort: activeSort,
    sortDir: activeSortDir,
    totalRows: databasePageTotalCount,
  });

  if (queryPlan.mode === "database-page" && databasePageWhere) {
    const [
      [mappings, linkedCount, latestIncrementalJob],
      summary,
    ] =
      await Promise.all([
        prisma.$transaction([
          prisma.productMapping.findMany({
            include: {
              conflicts: {
                select: {
                  field: true,
                  id: true,
                },
                where: { status: SyncConflictStatus.OPEN },
              },
            },
            orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
            skip: queryPlan.pagination.offset,
            take: queryPlan.take,
            where: databasePageWhere,
          }),
          prisma.productMapping.count({
            where: {
              ...where,
              shopifyProductGid: { not: null },
            },
          }),
          prisma.syncJob.findFirst({
            orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
            select: { finishedAt: true },
            where: getCompletedCatalogVerificationJobWhere(shop.id),
          }),
        ]),
        getCatalogSummaryCounts({
          now: new Date(),
          shopId: shop.id,
          syncTargetSeconds: shop.syncTargetSeconds,
        }),
      ]);
    const catalogVerifiedAt = latestIncrementalJob?.finishedAt ?? null;
    const latestSnapshotByMappingId = await getLatestProductSnapshotByMappingId(
      mappings.map((mapping) => mapping.id),
    );
    const now = new Date();
    const pageRows = mappings.map((mapping) =>
      formatCatalogPageRow({
        catalogVerifiedAt,
        latestSnapshot: latestSnapshotByMappingId.get(mapping.id) ?? null,
        mapping,
        now,
        syncTargetSeconds: shop.syncTargetSeconds,
        thumbnailUrl: null,
      }),
    );

    return {
      filters: [
        "all",
        "linked",
        "fresh",
        "needs_check",
        "conflicts",
        "not_updated",
        "archived",
      ] as const,
      pagination: {
        ...queryPlan.pagination,
        cappedAtMaxProducts: totalAvailableCount > CATALOG_IMPORT_MAX_PRODUCTS,
        maxLoadedRows: pageRows.length,
        maxProducts: CATALOG_IMPORT_MAX_PRODUCTS,
        totalAvailableCount,
      },
      rows: await getCatalogRowsWithThumbnails({
        rows: pageRows,
        shopDomain: shop.shopDomain,
      }),
      shop: {
        domain: shop.shopDomain,
        syncTargetSeconds: shop.syncTargetSeconds,
      },
      summary: {
        ...summary,
        linkedCount,
        totalCount: totalAvailableCount,
      },
    };
  }

  const [mappings, linkedCount, latestIncrementalJob] =
    await prisma.$transaction([
      prisma.productMapping.findMany({
        include: {
          conflicts: {
            select: {
              field: true,
              id: true,
            },
            where: { status: SyncConflictStatus.OPEN },
          },
        },
        orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
        take: CATALOG_IMPORT_MAX_PRODUCTS,
        where,
      }),
      prisma.productMapping.count({
        where: {
          ...where,
          shopifyProductGid: { not: null },
        },
      }),
      // Watermark a livello shop: ultimo ciclo di sync incrementale riuscito
      // (delta eventi venditore o reconcile). Stesso segnale della salute sync
      // in dashboard, così catalogo e dashboard restano coerenti.
      prisma.syncJob.findFirst({
        orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
        select: { finishedAt: true },
        where: getCompletedCatalogVerificationJobWhere(shop.id),
      }),
    ]);
  const catalogVerifiedAt = latestIncrementalJob?.finishedAt ?? null;
  const latestSnapshotByMappingId = await getLatestProductSnapshotByMappingId(
    mappings.map((mapping) => mapping.id),
  );

  // Le miniature non influenzano filtro/ordinamento: si risolvono dopo la
  // paginazione, solo per le righe mostrate, per tenere veloci filtri e sort.
  const now = new Date();
  const allRows = mappings.map((mapping) =>
    formatCatalogPageRow({
      catalogVerifiedAt,
      latestSnapshot: latestSnapshotByMappingId.get(mapping.id) ?? null,
      mapping,
      now,
      syncTargetSeconds: shop.syncTargetSeconds,
      thumbnailUrl: null,
    }),
  );
  const filteredRows = filterCatalogPageRows(
    searchCatalogPageRows(allRows, activeSearch),
    activeFilter,
  );
  const sortedRows = sortCatalogPageRows(
    filteredRows,
    activeSort,
    activeSortDir,
  );
  const pagination = getCatalogPageWindow({
    page: activePage,
    pageSize: CATALOG_PAGE_SIZE,
    totalRows: sortedRows.length,
  });
  const pageRows = sortedRows.slice(
    pagination.offset,
    pagination.offset + pagination.pageSize,
  );
  const rowsWithThumbnails = await getCatalogRowsWithThumbnails({
    rows: pageRows,
    shopDomain: shop.shopDomain,
  });

  return {
    filters: [
      "all",
      "linked",
      "fresh",
      "needs_check",
      "conflicts",
      "not_updated",
      "archived",
    ] as const,
    pagination: {
      ...pagination,
      cappedAtMaxProducts: totalAvailableCount > mappings.length,
      maxLoadedRows: mappings.length,
      maxProducts: CATALOG_IMPORT_MAX_PRODUCTS,
      totalAvailableCount,
    },
    rows: rowsWithThumbnails,
    shop: {
      domain: shop.shopDomain,
      syncTargetSeconds: shop.syncTargetSeconds,
    },
    summary: {
      archivedCount: allRows.filter((row) => row.status === "archived").length,
      conflictCount: allRows.filter((row) => row.status === "open_conflict")
        .length,
      freshCount: allRows.filter((row) => row.status === "active_fresh").length,
      linkedCount,
      needsCheckCount: allRows.filter(isCatalogRowNeedingCheck).length,
      totalCount: totalAvailableCount,
    },
  };
}

export async function getConflictsPageState(
  session: ShopifySessionLike,
  input: { filter?: ConflictFilter; page?: number } = {},
) {
  const shop = await ensureShopForSession(session);
  const activeFilter = input.filter ?? "open";
  const statusFilter = [
    ...getConflictStatusFilter(activeFilter),
  ] as SyncConflictStatus[];
  const allStatuses = [
    ...getConflictStatusFilter("all"),
  ] as SyncConflictStatus[];
  const resolvedStatuses = [
    ...getConflictStatusFilter("resolved"),
  ] as SyncConflictStatus[];
  const [
    openCount,
    resolvedCount,
    totalCount,
    filteredCount,
    openConflictFields,
  ] =
    await prisma.$transaction([
      prisma.syncConflict.count({
        where: {
          shopId: shop.id,
          status: SyncConflictStatus.OPEN,
        },
      }),
      prisma.syncConflict.count({
        where: {
          shopId: shop.id,
          status: { in: resolvedStatuses },
        },
      }),
      prisma.syncConflict.count({
        where: {
          shopId: shop.id,
          status: { in: allStatuses },
        },
      }),
      prisma.syncConflict.count({
        where: {
          shopId: shop.id,
          status: { in: statusFilter },
        },
      }),
      prisma.syncConflict.findMany({
        select: { field: true },
        where: {
          shopId: shop.id,
          status: SyncConflictStatus.OPEN,
        },
      }),
    ]);
  const decisionModeCounts = summarizeConflictDecisionModes(
    openConflictFields.map((conflict) => ({
      count: 1,
      field: conflict.field,
    })),
  );
  const pagination = getPageWindow({
    page: input.page ?? 1,
    pageSize: CONFLICT_PAGE_SIZE,
    totalRows: filteredCount,
  });
  const conflicts = await prisma.syncConflict.findMany({
    include: {
      mapping: true,
    },
    orderBy: [{ status: "asc" }, { detectedAt: "desc" }],
    skip: pagination.offset,
    take: pagination.pageSize,
    where: {
      shopId: shop.id,
      status: { in: statusFilter },
    },
  });
  const thumbnailUrlByMappingId =
    await getLatestThumbnailUrlByMappingId(
      conflicts.flatMap((conflict) =>
        conflict.mapping?.id ? [conflict.mapping.id] : [],
      ),
    );
  const latestSnapshotByMappingId = await getLatestProductSnapshotByMappingId(
    conflicts.flatMap((conflict) =>
      conflict.mapping?.id ? [conflict.mapping.id] : [],
    ),
  );
  const rows = conflicts.map((conflict) =>
    formatConflictPageRow(conflict, {
      latestSnapshot: conflict.mapping?.id
        ? (latestSnapshotByMappingId.get(conflict.mapping.id) ?? null)
        : null,
      thumbnailUrl:
        (conflict.mapping?.id
          ? thumbnailUrlByMappingId.get(conflict.mapping.id)
          : null) ?? null,
    }),
  );
  const shopifyThumbnailUrlByProductGid =
    await getShopifyThumbnailUrlByProductGid({
      productGids: rows.flatMap((row) =>
        !row.product.thumbnailUrl && row.product.shopifyProductGid
          ? [row.product.shopifyProductGid as string]
          : [],
      ),
      shopDomain: shop.shopDomain,
    });
  const rowsWithThumbnails = rows.map((row) =>
    row.product.thumbnailUrl
      ? row
      : {
          ...row,
          product: {
            ...row.product,
            thumbnailUrl:
              (row.product.shopifyProductGid
                ? shopifyThumbnailUrlByProductGid.get(
                    row.product.shopifyProductGid,
                  )
                : null) ?? null,
          },
        },
  );

  return {
    filters: ["open", "resolved", "all"] as const,
    pagination,
    rows: rowsWithThumbnails,
    shop: {
      domain: shop.shopDomain,
    },
    summary: {
      ...decisionModeCounts,
      filteredCount,
      openCount,
      resolvedCount,
      totalCount,
    },
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
  const retryState = getManualRetryState(
    {
      attempts: job.attempts,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      maxAttempts: job.maxAttempts,
      runAfter: job.runAfter,
      status: job.status,
      type: job.type,
    },
    now,
  );

  if (!retryState.canRetry) {
    throw new Response(retryState.reason, { status: 400 });
  }

  const details = {
    jobId: job.id,
    previousAttempts: job.attempts,
    previousMaxAttempts: job.maxAttempts,
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
        attempts: 0,
        maxAttempts: Math.max(
          job.maxAttempts,
          RETRIED_SYNC_JOB_MIN_MAX_ATTEMPTS,
        ),
        result: Prisma.DbNull,
        runAfter: now,
        startedAt: null,
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
      "Job rimesso in coda. Il runner automatico lo prenderà in carico quando sarà collegato; per l'import puoi rieseguire subito dalla preview.",
    status: "queued" as const,
  };
}

export async function resolveSyncConflict(
  session: ShopifySessionLike,
  input: {
    conflictId: string;
    resolution: string;
  },
) {
  const shop = await ensureShopForSession(session);
  const resolution = normalizeConflictResolution(input.resolution);
  const conflict = await prisma.syncConflict.findFirst({
    include: { mapping: true },
    where: {
      id: input.conflictId,
      shopId: shop.id,
      status: SyncConflictStatus.OPEN,
    },
  });
  let baselineSnapshot: Prisma.ProductSnapshotGetPayload<
    Record<string, never>
  > | null = null;
  let descriptionBaselineSnapshot: Prisma.ProductSnapshotGetPayload<
    Record<string, never>
  > | null = null;
  if (resolution === SyncConflictResolution.KEEP_SHOPIFY && conflict?.mappingId) {
    [baselineSnapshot, descriptionBaselineSnapshot] = await Promise.all([
      prisma.productSnapshot.findFirst({
        orderBy: { capturedAt: "desc" },
        where: {
          mappingId: conflict.mappingId,
          source: ProductSnapshotSource.SYNCBAY,
        },
      }),
      findLatestKeepShopifyDescriptionBaseline(conflict.mappingId),
    ]);
  }

  if (!conflict) {
    throw new Response("Conflitto SyncBay non trovato.", { status: 404 });
  }

  const now = new Date();
  const operations: Prisma.PrismaPromise<unknown>[] = [
    prisma.syncConflict.update({
      data: {
        resolution,
        resolvedAt: now,
        status:
          resolution === SyncConflictResolution.IGNORE_FIELD
            ? SyncConflictStatus.IGNORED
            : SyncConflictStatus.RESOLVED,
      },
      where: { id: conflict.id },
    }),
    prisma.auditLog.create({
      data: {
        details: {
          conflictId: conflict.id,
          field: conflict.field,
          resolution,
        },
        message: "Conflitto Shopify gestito dalla dashboard.",
        shopId: shop.id,
        type: AuditEventType.CONNECTION_CHECK,
      },
    }),
  ];

  if (baselineSnapshot) {
    operations.push(
      prisma.productSnapshot.create({
        data: buildKeepShopifyBaselineSnapshot({
          conflict,
          latestDescriptionBaselineHash:
            descriptionBaselineSnapshot?.descriptionHash ?? null,
          snapshot: baselineSnapshot,
        }),
      }),
    );
  }

  if (
    resolution === SyncConflictResolution.REALIGN_FROM_EBAY &&
    conflict.mapping?.ebayItemId
  ) {
    operations.push(
      prisma.syncJob.create({
        data: {
          payload: {
            ebayItemIds: [conflict.mapping.ebayItemId],
            marketplaceId: conflict.mapping.marketplaceId,
            source: "conflict_resolution",
          } satisfies Prisma.JsonObject,
          runAfter: now,
          shopId: shop.id,
          status: SyncJobStatus.PENDING,
          type: SyncJobType.SYNC_INCREMENTAL,
        },
      }),
    );
  }

  await prisma.$transaction(operations);

  return {
    message: "Conflitto aggiornato.",
    status: "resolved" as const,
  };
}

/**
 * Risolve in blocco i soli conflitti "sicuri" aperti applicando, per ogni
 * campo, la risoluzione sicura prevista (oggi: descrizione -> mantieni la
 * versione di Shopify, senza toccare eBay). Riusa `resolveSyncConflict` per
 * ogni conflitto, così la logica resta una sola. Copre tutti i conflitti
 * aperti, non solo la pagina visibile. I conflitti delicati restano manuali.
 */
export async function resolveBatchSafeConflicts(session: ShopifySessionLike) {
  const shop = await ensureShopForSession(session);
  const openConflicts = await prisma.syncConflict.findMany({
    select: { field: true, id: true },
    where: { shopId: shop.id, status: SyncConflictStatus.OPEN },
  });

  let resolvedCount = 0;
  for (const conflict of openConflicts) {
    const safeResolution = getSafeBatchConflictResolutions(conflict.field)[0];

    if (!safeResolution) continue;

    try {
      await resolveSyncConflict(session, {
        conflictId: conflict.id,
        resolution: safeResolution,
      });
      resolvedCount += 1;
    } catch (error) {
      if (!isStaleConflictResolutionError(error)) throw error;
      // Conflitto già risolto o non più valido: salta senza fermare il blocco.
    }
  }

  return {
    message:
      resolvedCount === 0
        ? "Nessun conflitto sicuro da risolvere."
        : resolvedCount === 1
          ? "1 conflitto sicuro risolto: descrizione di Shopify mantenuta."
          : `${resolvedCount} conflitti sicuri risolti: descrizioni di Shopify mantenute.`,
    resolvedCount,
  };
}

function buildKeepShopifyBaselineSnapshot(input: {
  conflict: Prisma.SyncConflictGetPayload<Record<string, never>>;
  latestDescriptionBaselineHash: string | null;
  snapshot: Prisma.ProductSnapshotGetPayload<Record<string, never>>;
}) {
  const shopifyValue = input.conflict.shopifyValue;
  const snapshotPayload = getKeepShopifyBaselinePayload(input.snapshot.payload);
  const keptShopifyPriceAmount =
    input.conflict.field === "price"
      ? getConflictPriceAmount(shopifyValue)
      : input.snapshot.priceAmount;
  const keptShopifyCompareAtPrice =
    input.conflict.field === "price"
      ? getConflictCompareAtPrice(shopifyValue)
      : getPricingPayloadValue(snapshotPayload, "compareAtPriceAmount");

  return {
    currency: input.snapshot.currency,
    descriptionHash: getKeepShopifyDescriptionHash({
      conflictField: input.conflict.field,
      latestDescriptionBaselineHash: input.latestDescriptionBaselineHash,
      shopifyValue,
      snapshotDescriptionHash: input.snapshot.descriptionHash,
    }),
    ebayItemId: input.snapshot.ebayItemId,
    imageCount:
      input.conflict.field === "images"
        ? getJsonIntegerValue(shopifyValue)
        : input.snapshot.imageCount,
    mappingId: input.snapshot.mappingId,
    payload: {
      ...snapshotPayload,
      ...(input.conflict.field === "price"
        ? {
            pricing: {
              ...getJsonObject(snapshotPayload.pricing),
              compareAtPriceAmount: keptShopifyCompareAtPrice,
              priceAmount: keptShopifyPriceAmount?.toString() ?? null,
            },
          }
        : {}),
      conflictResolution: {
        conflictId: input.conflict.id,
        field: input.conflict.field,
        resolution: SyncConflictResolution.KEEP_SHOPIFY,
      },
    } satisfies Prisma.JsonObject,
    priceAmount:
      input.conflict.field === "price"
        ? keptShopifyPriceAmount
        : input.snapshot.priceAmount,
    productStatus:
      input.conflict.field === "status"
        ? getJsonStringValue(shopifyValue)
        : input.snapshot.productStatus,
    quantity:
      input.conflict.field === "quantity"
        ? getJsonIntegerValue(shopifyValue)
        : input.snapshot.quantity,
    shopId: input.snapshot.shopId,
    shopifyProductGid: input.snapshot.shopifyProductGid,
    shopifyVariantGid: input.snapshot.shopifyVariantGid,
    sku: input.snapshot.sku,
    source: ProductSnapshotSource.SYNCBAY,
    title:
      input.conflict.field === "title"
        ? getJsonStringValue(shopifyValue)
        : input.snapshot.title,
  };
}

function getKeepShopifyBaselinePayload(value: Prisma.JsonValue | undefined) {
  const payload = { ...(getJsonObject(value) ?? {}) };

  delete payload.updatedEbayFromShopifyOrder;
  delete payload.restoredEbayAfterTest;

  return payload;
}

async function findLatestKeepShopifyDescriptionBaseline(mappingId: string) {
  const candidates = await prisma.productSnapshot.findMany({
    orderBy: { capturedAt: "desc" },
    where: getLatestSyncBayDescriptionBaselineWhere(mappingId),
  });

  return (
    candidates.find((snapshot) =>
      shouldUseSyncBayDescriptionBaselinePayload(snapshot.payload),
    ) ?? null
  );
}

export async function startCatalogImportJobs(session: ShopifySessionLike) {
  const shop = await ensureShopForSession(session);
  const importProductStatus = normalizeImportProductStatus(
    shop.defaultProductStatus,
  );
  const connection = await prisma.ebayConnection.findUnique({
    where: {
      shopId_marketplaceId: {
        marketplaceId: getEbayMarketplaceId(),
        shopId: shop.id,
      },
    },
  });
  const blockers = getCatalogImportBlockers({
    connection,
    hasDefaultLocation: Boolean(shop.defaultLocationGid),
  });

  if (blockers.length > 0) {
    return {
      blockers,
      status: "blocked" as const,
    };
  }

  if (!connection) {
    throw new Error("Connessione eBay non disponibile per l'import catalogo.");
  }

  const { accessToken } = await getUsableEbayAccessToken(connection);
  const plan = await getEbayTradingCatalogImportPlan({
    accessToken,
    connection,
    maxProducts: CATALOG_IMPORT_MAX_PRODUCTS,
  });

  if (plan.itemIds.length === 0) {
    return {
      blockers: ["nessun listing attivo eBay leggibile per l'import"],
      status: "blocked" as const,
    };
  }

  const draftLimit = getDraftImportLimit();
  const batches = chunkArray(plan.itemIds, draftLimit);
  const now = new Date();
  const catalogImportRunId = buildCatalogImportRunId({
    now,
    shopId: shop.id,
  });
  let createdJobCount = 0;
  let existingJobCount = 0;
  let requeuedJobCount = 0;
  let resumedJobCount = 0;

  for (const [batchIndex, ebayItemIds] of batches.entries()) {
    const result = await upsertCatalogImportBatchJob({
      batchCount: batches.length,
      batchIndex,
      catalogImportRunId,
      draftLimit,
      ebayItemIds,
      importProductStatus,
      now,
      shopId: shop.id,
      totalAvailable: plan.totalAvailable,
      totalPlanned: plan.itemIds.length,
    });

    if (result === "created") createdJobCount += 1;
    if (result === "existing") existingJobCount += 1;
    if (result === "requeued") requeuedJobCount += 1;
    if (result === "resumed") resumedJobCount += 1;
  }

  await prisma.shop.update({
    data: { syncEnabled: true },
    where: { id: shop.id },
  });

  const resultPayload = {
    batchCount: batches.length,
    catalogImportMaxProducts: CATALOG_IMPORT_MAX_PRODUCTS,
    createdJobCount,
    draftLimit,
    existingJobCount,
    importProductStatus,
    plannedListingCount: plan.itemIds.length,
    readCount: plan.readCount,
    requeuedJobCount,
    resumedJobCount,
    source: "trading_api",
    totalAvailable: plan.totalAvailable,
    truncatedAtMaxProducts:
      plan.totalAvailable !== null
        ? plan.totalAvailable > plan.itemIds.length
        : plan.itemIds.length >= CATALOG_IMPORT_MAX_PRODUCTS,
  } satisfies Prisma.JsonObject;

  await prisma.auditLog.create({
    data: {
      details: resultPayload,
      message: "Import catalogo eBay pianificato in batch.",
      shopId: shop.id,
      type: AuditEventType.SYNC_JOB_CREATED,
    },
  });

  return {
    ...resultPayload,
    blockers: [],
    status: "queued" as const,
  };
}

export async function getImportWizardState(
  session: ShopifySessionLike,
  admin?: ShopifyAdminGraphqlClient,
) {
  const shop = await ensureShopForSession(session);
  const defaultProductStatus = normalizeImportProductStatus(
    shop.defaultProductStatus,
  );
  const productPublicationMode = normalizeProductPublicationMode(
    shop.productPublicationMode,
  );
  const selectedPublicationIds = parseProductPublicationGids(
    shop.productPublicationGids,
  );
  const descriptionRule = await getExistingDescriptionRuleForSettings(shop.id);
  const ebayConnection = await prisma.ebayConnection.findUnique({
    where: {
      shopId_marketplaceId: {
        marketplaceId: getEbayMarketplaceId(),
        shopId: shop.id,
      },
    },
  });
  const ebayRuntime = getEbayRuntimeReadiness();
  const ebayConnected =
    ebayConnection?.status === EbayConnectionStatus.CONNECTED;
  const preview =
    ebayConnected && ebayConnection
      ? await getEbayLiveImportPreview(ebayConnection, {
          descriptionRuleMode: descriptionRule.mode,
        })
      : getMockImportPreviewState(descriptionRule.mode);
  const importPreview = getImportPreviewReadiness({
    defaultProductStatus,
    descriptionRuleMode: descriptionRule.mode,
    ebayConnected,
    hasDefaultLocation: Boolean(shop.defaultLocationGid),
    listingReaderAvailable: true,
    listingReaderError: preview.errorMessage,
  });
  const previewResult = await getImportPreviewWithExistingShopifyMatches({
    admin,
    previewResult: preview.previewResult,
  });

  return {
    draftImport: getDraftImportReadiness({
      defaultProductStatus,
      hasDefaultLocation: Boolean(shop.defaultLocationGid),
      previewResult,
    }),
    ebay: {
      marketplaceId: getEbayMarketplaceId(),
      missingRequirements: ebayRuntime.missingRequirements,
      oauthEnabled: ebayRuntime.oauthEnabled,
      oauthReady: ebayRuntime.ready,
      status: ebayConnection?.status ?? EbayConnectionStatus.NOT_CONNECTED,
    },
    importPreview,
    onboarding: getOnboardingReadiness({
      defaultProductStatus,
      descriptionRuleMode: descriptionRule.mode,
    }),
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
    productPublications: {
      mode: productPublicationMode,
      selectedCount: selectedPublicationIds.length,
      selectedPublicationIds,
    },
    runtimePhases: getRuntimePhaseReadiness({
      defaultProductStatus,
      ebayConnected,
      hasDefaultLocation: Boolean(shop.defaultLocationGid),
    }),
    shop: {
      defaultLocationGid: shop.defaultLocationGid,
      defaultProductStatus,
      domain: shop.shopDomain,
    },
    validationRules: getImportPreviewValidationRules(),
  };
}

async function getImportPreviewWithExistingShopifyMatches(input: {
  admin?: ShopifyAdminGraphqlClient;
  previewResult: ImportPreviewResult;
}) {
  if (!input.admin || input.previewResult.items.length === 0) {
    return input.previewResult;
  }

  const shopifyProducts = await loadExistingShopifyProductsForMatching(
    input.admin,
  );

  return addExistingProductMatchSuggestions(
    input.previewResult,
    shopifyProducts,
  );
}

async function loadExistingShopifyProductsForMatching(
  admin: ShopifyAdminGraphqlClient,
): Promise<ShopifyMatchCandidate[]> {
  const response = await admin.graphql(`#graphql
    query SyncBayExistingProductsForMatching {
      products(first: 250, sortKey: UPDATED_AT, reverse: true) {
        nodes {
          id
          title
          variants(first: 100) {
            nodes {
              barcode
              id
              sku
            }
          }
        }
      }
    }`);

  if (!response.ok) return [];

  const json = (await response.json()) as ShopifyExistingProductMatchResponse;

  if (json.errors?.length) return [];

  return (json.data?.products?.nodes ?? []).flatMap((product) => {
    if (!product.id || !product.title) return [];

    return (product.variants?.nodes ?? [null]).map((variant) => ({
      barcode: normalizeNullableString(variant?.barcode),
        productGid: product.id,
        sku: normalizeNullableString(variant?.sku),
        title: product.title,
        variantGid: variant?.id ?? null,
    }));
  });
}

function normalizeNullableString(value: string | null | undefined) {
  const normalized = value?.trim();

  return normalized ? normalized : null;
}

export async function getShopSettingsState(
  session: ShopifySessionLike,
  admin?: ShopifyAdminGraphqlClient,
) {
  const shop = await ensureShopForSession(session);
  const [
    ebayConnection,
    activeMappingCount,
    latestIncrementalJob,
    pricingRule,
    descriptionRule,
  ] = await prisma.$transaction([
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
    ]);
  const ebayRuntime = getEbayRuntimeReadiness();
  const shopifyScopes = splitScopes(shop.shopifyScopes);
  const shopifyReadiness = getShopifyReadiness(shopifyScopes);
  const syncBlockers = getSyncEnablementBlockers({
    activeMappingCount,
    ebayConnected: ebayConnection?.status === EbayConnectionStatus.CONNECTED,
    hasDefaultLocation: Boolean(shop.defaultLocationGid),
    requestedSyncEnabled: true,
  });
  const publicationMode = normalizeProductPublicationMode(
    shop.productPublicationMode,
  );
  const selectedPublicationIds = parseProductPublicationGids(
    shop.productPublicationGids,
  );
  const publicationState = admin
    ? await loadShopSettingsPublications(admin)
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
    descriptionRule: normalizeDescriptionRule(
      descriptionRule ?? DEFAULT_DESCRIPTION_RULE,
    ),
    pricingRule: normalizePricingRule(pricingRule ?? DEFAULT_PRICING_RULE),
    shopify: {
      configuredScopes: getConfiguredShopifyScopes(),
      missingConfiguredScopes: shopifyReadiness.missingConfiguredScopes,
      missingScopes: shopifyReadiness.missingScopes,
      scopes: shopifyScopes,
      webhookTopics: SHOPIFY_WEBHOOK_TOPICS,
    },
    shop: {
      defaultProductStatus: normalizeImportProductStatus(
        shop.defaultProductStatus,
      ),
      domain: shop.shopDomain,
      syncEnabled: shop.syncEnabled,
      syncTargetSeconds: shop.syncTargetSeconds,
    },
    sync: {
      activeMappingCount,
      canEnable: syncBlockers.length === 0,
      enablementBlockers: syncBlockers,
      lastIncrementalFinishedAt:
        latestIncrementalJob?.finishedAt?.toISOString() ?? null,
    },
  };
}

export async function updateDescriptionRuleSettings(
  session: ShopifySessionLike,
  input: { mode: string },
) {
  const normalized = normalizeDescriptionRuleFormInput(input);
  const shop = await ensureShopForSession(session);

  if (normalized.status === "invalid") {
    return {
      descriptionRule: await getExistingDescriptionRuleForSettings(shop.id),
      message: normalized.message,
      status: "blocked" as const,
    };
  }

  const savedRule = await prisma.$transaction(async (tx) => {
    const rule = await tx.descriptionRule.upsert({
      create: {
        mode: normalized.mode,
        shopId: shop.id,
      },
      select: { mode: true },
      update: { mode: normalized.mode },
      where: { shopId: shop.id },
    });

    await tx.auditLog.create({
      data: {
        details: {
          descriptionMode: normalized.mode,
        },
        message: `Regola descrizione aggiornata: ${getDescriptionRuleSummary(normalized.mode)}.`,
        shopId: shop.id,
        type: AuditEventType.CONNECTION_CHECK,
      },
    });

    return rule;
  });

  return {
    descriptionRule: normalizeDescriptionRule(savedRule),
    message: `Regola descrizione salvata: ${getDescriptionRuleSummary(savedRule.mode)}. Verrà usata dai prossimi import e dalle prossime anteprime di pulizia.`,
    status: "saved" as const,
  };
}

async function getExistingDescriptionRuleForSettings(shopId: string) {
  const descriptionRule = await prisma.descriptionRule.findUnique({
    select: { mode: true },
    where: { shopId },
  });

  return normalizeDescriptionRule(descriptionRule ?? DEFAULT_DESCRIPTION_RULE);
}

export async function updatePricingRuleSettings(
  session: ShopifySessionLike,
  input: {
    discountPercent: string;
    roundingMode: string;
  },
) {
  const normalized = normalizePricingRuleFormInput(input);
  const shop = await ensureShopForSession(session);

  if (normalized.status === "invalid") {
    return {
      message: normalized.message,
      pricingRule: await getExistingPricingRuleForSettings(shop.id),
      status: "blocked" as const,
    };
  }

  const pricingUpdate = await prisma.$transaction(async (tx) => {
    const savedRule = await tx.pricingRule.upsert({
      create: {
        discountPercent: normalized.discountPercent,
        roundingMode: normalized.roundingMode,
        shopId: shop.id,
      },
      select: {
        discountPercent: true,
        roundingMode: true,
      },
      update: {
        discountPercent: normalized.discountPercent,
        roundingMode: normalized.roundingMode,
      },
      where: { shopId: shop.id },
    });
    const activeMappings = await tx.productMapping.findMany({
      orderBy: { updatedAt: "asc" },
      select: { ebayItemId: true },
      where: {
        marketplaceId: getEbayMarketplaceId(),
        shopId: shop.id,
        status: ProductMappingStatus.ACTIVE,
      },
    });
    const ebayConnection = await tx.ebayConnection.findUnique({
      select: { status: true },
      where: {
        shopId_marketplaceId: {
          marketplaceId: getEbayMarketplaceId(),
          shopId: shop.id,
        },
      },
    });
    const syncPlan = buildPricingRuleSyncPlan({
      activeEbayItemIds: activeMappings.map((mapping) => mapping.ebayItemId),
      batchSize: PRICING_RULE_SYNC_BATCH_SIZE,
      ebayConnected: ebayConnection?.status === EbayConnectionStatus.CONNECTED,
      hasDefaultLocation: Boolean(shop.defaultLocationGid),
    });
    const now = new Date();
    const runId = `pricing-rule:${shop.id}:${now.toISOString()}:${randomUUID()}`;

    if (syncPlan.batches.length > 0) {
      await tx.syncJob.createMany({
        data: syncPlan.batches.map((ebayItemIds, index) => ({
          attempts: 0,
          idempotencyKey: `pricing-rule-sync:${shop.id}:${index + 1}:${runId}`,
          maxAttempts: CATALOG_IMPORT_BATCH_MAX_ATTEMPTS,
          payload: {
            batchCount: syncPlan.batches.length,
            batchIndex: index + 1,
            discountPercent: normalized.discountPercent,
            ebayItemIds,
            importProductStatus: normalizeImportProductStatus(
              shop.defaultProductStatus,
            ),
            marketplaceId: getEbayMarketplaceId(),
            pricingOnly: syncPlan.pricingOnly,
            requestedCount: ebayItemIds.length,
            roundingMode: normalized.roundingMode,
            runId,
            source: "pricing_rule_update",
          } satisfies Prisma.JsonObject,
          runAfter: now,
          shopId: shop.id,
          status: SyncJobStatus.PENDING,
          type: SyncJobType.SYNC_INCREMENTAL,
        })),
      });
    }

    await tx.auditLog.create({
      data: {
        details: {
          discountPercent: normalized.discountPercent,
          queuedPricingRuleSyncJobCount: syncPlan.batches.length,
          queuedPricingRuleSyncProductCount: syncPlan.queuedProductCount,
          queuedPricingRuleSyncSkippedReason: syncPlan.skippedReason,
          roundingMode: normalized.roundingMode,
        },
        message: `Regola prezzo Shopify aggiornata: sconto ${normalized.discountPercent}% con arrotondamento ${getPricingRoundingModeLabel(normalized.roundingMode)}.`,
        shopId: shop.id,
        type: AuditEventType.CONNECTION_CHECK,
      },
    });

    return {
      pricingRule: savedRule,
      syncSkippedReason: syncPlan.skippedReason,
      queuedProductCount: syncPlan.queuedProductCount,
      queuedSyncJobCount: syncPlan.batches.length,
    };
  });
  const syncMessage = pricingUpdate.syncSkippedReason
    ? ` Riallineamento non pianificato: ${pricingUpdate.syncSkippedReason}.`
    : pricingUpdate.queuedProductCount > 0
      ? ` Riallineamento pianificato per ${pricingUpdate.queuedProductCount} prodotti.`
      : " Nessun prodotto attivo da riallineare.";

  return {
    message: `Regola prezzo salvata: ${formatPricingRuleSummary(pricingUpdate.pricingRule)}.${syncMessage}`,
    pricingRule: normalizePricingRule(pricingUpdate.pricingRule),
    status: "saved" as const,
  };
}

async function getExistingPricingRuleForSettings(shopId: string) {
  const pricingRule = await prisma.pricingRule.findUnique({
    select: {
      discountPercent: true,
      roundingMode: true,
    },
    where: { shopId },
  });

  return normalizePricingRule(pricingRule ?? DEFAULT_PRICING_RULE);
}

export async function updateSyncTargetSeconds(
  session: ShopifySessionLike,
  value: string,
) {
  const shop = await ensureShopForSession(session);
  const seconds = normalizeSyncTargetSeconds(value);

  if (seconds === null) {
    return {
      message: "Intervallo non valido. Scegli tra 2, 3 o 5 minuti.",
      status: "blocked" as const,
      syncTargetSeconds: shop.syncTargetSeconds,
    };
  }

  await prisma.$transaction([
    prisma.shop.update({
      data: { syncTargetSeconds: seconds },
      where: { id: shop.id },
    }),
    prisma.auditLog.create({
      data: {
        details: { syncTargetSeconds: seconds },
        message: `Intervallo target di aggiornamento impostato a ${seconds} secondi dalle impostazioni.`,
        shopId: shop.id,
        type: AuditEventType.CONNECTION_CHECK,
      },
    }),
  ]);

  return {
    message: `Intervallo target salvato: ${getSyncTargetLabel(seconds)}.`,
    status: "saved" as const,
    syncTargetSeconds: seconds,
  };
}

export async function disconnectEbayConnection(session: ShopifySessionLike) {
  const shop = await ensureShopForSession(session);
  const connection = await prisma.ebayConnection.findUnique({
    where: {
      shopId_marketplaceId: {
        marketplaceId: getEbayMarketplaceId(),
        shopId: shop.id,
      },
    },
  });

  if (
    !connection ||
    connection.status === EbayConnectionStatus.NOT_CONNECTED
  ) {
    return {
      message: "Nessun account eBay collegato da scollegare.",
      status: "not_connected" as const,
    };
  }

  const disconnectedAt = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const cancelledJobs = await tx.syncJob.updateMany({
      data: {
        errorCode: "EBAY_DISCONNECTED",
        errorMessage:
          "Account eBay scollegato dalle impostazioni. Job catalogo annullato.",
        finishedAt: disconnectedAt,
        status: SyncJobStatus.CANCELLED,
      },
      where: {
        shopId: shop.id,
        status: {
          in: [
            SyncJobStatus.PENDING,
            SyncJobStatus.RETRYING,
            SyncJobStatus.RUNNING,
          ],
        },
        type: {
          in: [
            SyncJobType.IMPORT_CATALOG,
            SyncJobType.SYNC_INCREMENTAL,
            SyncJobType.ARCHIVE_INACTIVE_LISTING,
          ],
        },
      },
    });

    await tx.ebayConnection.update({
      data: {
        connectedAt: null,
        ebayUserId: null,
        encryptedAccessToken: null,
        encryptedRefreshToken: null,
        lastRefreshAt: null,
        refreshTokenExpiresAt: null,
        scopes: null,
        status: EbayConnectionStatus.NOT_CONNECTED,
        tokenExpiresAt: null,
      },
      where: { id: connection.id },
    });
    await tx.shop.update({
      data: { syncEnabled: false },
      where: { id: shop.id },
    });
    await tx.auditLog.create({
      data: {
        details: { cancelledSyncJobCount: cancelledJobs.count },
        message:
          "Account eBay scollegato dalle impostazioni. Sync automatico disattivato.",
        shopId: shop.id,
        type: AuditEventType.EBAY_DISCONNECTED,
      },
    });

    return { cancelledSyncJobCount: cancelledJobs.count };
  });

  return {
    message: formatDisconnectEbayMessage(result.cancelledSyncJobCount),
    status: "disconnected" as const,
  };
}

function formatDisconnectEbayMessage(cancelledSyncJobCount: number) {
  const base =
    "Account eBay scollegato. Il catalogo già importato resta su Shopify; ricollega eBay per riprendere gli aggiornamenti.";

  if (cancelledSyncJobCount === 0) return base;

  if (cancelledSyncJobCount === 1) {
    return `${base} 1 aggiornamento catalogo in coda è stato annullato.`;
  }

  return `${base} ${cancelledSyncJobCount} aggiornamenti catalogo in coda sono stati annullati.`;
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

export async function updateDefaultImportProductStatus(
  session: ShopifySessionLike,
  defaultProductStatus: string,
) {
  if (
    !IMPORT_PRODUCT_STATUS_VALUES.includes(
      defaultProductStatus as ImportProductStatus,
    )
  ) {
    throw new Response("Stato prodotti non supportato.", { status: 400 });
  }

  const shop = await ensureShopForSession(session);
  const normalizedStatus = normalizeImportProductStatus(defaultProductStatus);

  await prisma.$transaction([
    prisma.shop.update({
      data: { defaultProductStatus: normalizedStatus },
      where: { id: shop.id },
    }),
    prisma.auditLog.create({
      data: {
        details: {
          defaultProductStatus: normalizedStatus,
        },
        message: `Default stato prodotti aggiornato: ${getImportProductStatusLabelCapitalized(normalizedStatus)}.`,
        shopId: shop.id,
        type: AuditEventType.CONNECTION_CHECK,
      },
    }),
  ]);

  return normalizedStatus;
}

export async function updateProductPublicationSettings(
  session: ShopifySessionLike,
  input: {
    availablePublications: ShopifyProductPublication[];
    mode: string;
    selectedPublicationIds: string[];
  },
) {
  const mode = normalizeProductPublicationMode(input.mode);
  const availablePublicationIds = new Set(
    input.availablePublications.map((publication) => publication.id),
  );
  const selectedPublicationIds = input.selectedPublicationIds.filter(
    (publicationId) => availablePublicationIds.has(publicationId),
  );

  if (mode === "SELECTED" && selectedPublicationIds.length === 0) {
    return {
      blockers: ["seleziona almeno un canale Shopify disponibile"],
      mode,
      selectedPublicationIds,
      status: "blocked" as const,
    };
  }

  const shop = await ensureShopForSession(session);
  const serializedPublicationIds =
    mode === "SELECTED"
      ? serializeProductPublicationGids(selectedPublicationIds)
      : null;

  await prisma.$transaction([
    prisma.shop.update({
      data: {
        productPublicationGids: serializedPublicationIds,
        productPublicationMode: mode as PrismaProductPublicationMode,
      },
      where: { id: shop.id },
    }),
    prisma.auditLog.create({
      data: {
        details: {
          productPublicationGids: serializedPublicationIds,
          productPublicationMode: mode,
        },
        message: `Policy pubblicazione canali Shopify aggiornata: ${getProductPublicationModeLabel(mode)}.`,
        shopId: shop.id,
        type: AuditEventType.CONNECTION_CHECK,
      },
    }),
  ]);

  return {
    blockers: [],
    mode,
    selectedPublicationIds,
    status: "saved" as const,
  };
}

export async function updateShopSyncEnabled(
  session: ShopifySessionLike,
  requestedSyncEnabled: boolean,
) {
  const shop = await ensureShopForSession(session);
  const [ebayConnection, activeMappingCount] = await prisma.$transaction([
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
  ]);
  const blockers = getSyncEnablementBlockers({
    activeMappingCount,
    ebayConnected: ebayConnection?.status === EbayConnectionStatus.CONNECTED,
    hasDefaultLocation: Boolean(shop.defaultLocationGid),
    requestedSyncEnabled,
  });

  if (blockers.length > 0) {
    return {
      blockers,
      status: "blocked" as const,
      syncEnabled: shop.syncEnabled,
    };
  }

  await prisma.$transaction([
    prisma.shop.update({
      data: { syncEnabled: requestedSyncEnabled },
      where: { id: shop.id },
    }),
    prisma.auditLog.create({
      data: {
        details: {
          activeMappingCount,
          syncEnabled: requestedSyncEnabled,
        },
        message: requestedSyncEnabled
          ? "Sync catalogo automatico attivato dalle impostazioni."
          : "Sync catalogo automatico disattivato dalle impostazioni.",
        shopId: shop.id,
        type: AuditEventType.CONNECTION_CHECK,
      },
    }),
  ]);

  return {
    blockers: [],
    status: "saved" as const,
    syncEnabled: requestedSyncEnabled,
  };
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
    ...getWebhookJobPayload(normalizedTopic, input.payload),
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
    const coalescedJob = await findCoalescedWebhookJob({
      details,
      jobType,
      shopId: shop.id,
    });

    await prisma.$transaction(async (tx) => {
      let coalesced = false;

      if (coalescedJob) {
        const updated = await tx.syncJob.updateMany({
          where: {
            id: coalescedJob.id,
            status: { in: [SyncJobStatus.PENDING, SyncJobStatus.RETRYING] },
          },
          data: {
            errorCode: null,
            errorMessage: null,
            finishedAt: null,
            payload: details,
            runAfter: new Date(),
            status: SyncJobStatus.PENDING,
          },
        });

        coalesced = updated.count === 1;
      }

      if (!coalesced) {
        if (idempotencyKey) {
          await tx.syncJob.upsert({
            where: { idempotencyKey },
            create: jobData,
            update: {},
          });
        } else {
          await tx.syncJob.create({ data: jobData });
        }
      }

      await tx.auditLog.create({
        data: {
          details,
          message: "Webhook Shopify ricevuto e tracciato.",
          shopId: shop.id,
          type: AuditEventType.SHOPIFY_WEBHOOK_RECEIVED,
        },
      });
    });
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

function getWebhookJobPayload(topic: string, payload: unknown) {
  return getShopifyWebhookJobPayload(topic, payload) satisfies Prisma.JsonObject;
}

function normalizeShopifyWebhookTopic(topic: string) {
  return topic.toLowerCase().replaceAll("_", "/");
}

function getEbayMarketplaceId() {
  return process.env.EBAY_MARKETPLACE_ID ?? DEFAULT_MARKETPLACE_ID;
}

function getCatalogImportBlockers(input: {
  connection: EbayConnection | null;
  hasDefaultLocation: boolean;
}) {
  return [
    process.env.SYNCBAY_DRAFT_IMPORT_ENABLED !== "true"
      ? "import Shopify non abilitato"
      : null,
    !input.hasDefaultLocation
      ? "location Shopify predefinita non confermata"
      : null,
    !input.connection ||
    input.connection.status !== EbayConnectionStatus.CONNECTED
      ? "account eBay non collegato"
      : null,
  ].filter((blocker): blocker is string => Boolean(blocker));
}

async function upsertCatalogImportBatchJob(input: {
  batchCount: number;
  batchIndex: number;
  catalogImportRunId: string;
  draftLimit: number;
  ebayItemIds: string[];
  importProductStatus: ImportProductStatus;
  now: Date;
  shopId: string;
  totalAvailable: number | null;
  totalPlanned: number;
}) {
  const idempotencyKey = buildCatalogImportBatchIdempotencyKey(input);
  const payload = buildCatalogImportBatchPayload(input);
  const existingJob = await prisma.syncJob.findUnique({
    where: { idempotencyKey },
  });

  if (!existingJob) {
    await prisma.syncJob.create({
      data: {
        attempts: 0,
        idempotencyKey,
        maxAttempts: CATALOG_IMPORT_BATCH_MAX_ATTEMPTS,
        payload,
        runAfter: input.now,
        shopId: input.shopId,
        status: SyncJobStatus.PENDING,
        type: SyncJobType.IMPORT_CATALOG,
      },
    });

    return "created" as const;
  }

  if (existingJob.status === SyncJobStatus.SUCCEEDED) {
    const wasReset = await resetCatalogImportBatchJob({
      existingJobId: existingJob.id,
      expectedStatus: existingJob.status,
      now: input.now,
      payload,
    });

    return wasReset ? ("requeued" as const) : ("existing" as const);
  }

  if (
    existingJob.status === SyncJobStatus.FAILED ||
    existingJob.status === SyncJobStatus.CANCELLED
  ) {
    const wasReset = await resetCatalogImportBatchJob({
      existingJobId: existingJob.id,
      expectedStatus: existingJob.status,
      now: input.now,
      payload,
    });

    return wasReset ? ("resumed" as const) : ("existing" as const);
  }

  return "existing" as const;
}

async function resetCatalogImportBatchJob(input: {
  existingJobId: string;
  expectedStatus: SyncJobStatus;
  now: Date;
  payload: Prisma.JsonObject;
}) {
  const reset = await prisma.syncJob.updateMany({
    data: {
      attempts: 0,
      errorCode: null,
      errorMessage: null,
      finishedAt: null,
      maxAttempts: CATALOG_IMPORT_BATCH_MAX_ATTEMPTS,
      payload: input.payload,
      result: Prisma.DbNull,
      runAfter: input.now,
      startedAt: null,
      status: SyncJobStatus.PENDING,
    },
    where: {
      id: input.existingJobId,
      status: input.expectedStatus,
      type: SyncJobType.IMPORT_CATALOG,
    },
  });

  return reset.count === 1;
}

function buildCatalogImportBatchPayload(input: {
  batchCount: number;
  batchIndex: number;
  catalogImportRunId: string;
  draftLimit: number;
  ebayItemIds: string[];
  importProductStatus: ImportProductStatus;
  shopId: string;
  totalAvailable: number | null;
  totalPlanned: number;
}) {
  return {
    batchCount: input.batchCount,
    batchIndex: input.batchIndex + 1,
    catalogImportMaxProducts: CATALOG_IMPORT_MAX_PRODUCTS,
    catalogImportRunId: input.catalogImportRunId,
    draftLimit: input.draftLimit,
    ebayItemIds: input.ebayItemIds,
    importProductStatus: input.importProductStatus,
    marketplaceId: getEbayMarketplaceId(),
    previewMode: "live",
    requestedCount: input.ebayItemIds.length,
    shopId: input.shopId,
    source: "trading_api",
    totalAvailable: input.totalAvailable,
    totalPlanned: input.totalPlanned,
  } satisfies Prisma.JsonObject;
}

function buildCatalogImportRunId(input: { now: Date; shopId: string }) {
  return `catalog-import:${input.shopId}:${input.now.toISOString()}:${randomUUID()}`;
}

function buildCatalogImportBatchIdempotencyKey(input: {
  batchIndex: number;
  ebayItemIds: string[];
  importProductStatus: ImportProductStatus;
  shopId: string;
}) {
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        batchIndex: input.batchIndex,
        ebayItemIds: input.ebayItemIds,
        importProductStatus: input.importProductStatus,
        marketplaceId: getEbayMarketplaceId(),
        shopId: input.shopId,
      }),
    )
    .digest("hex")
    .slice(0, 20);

  return `catalog-import-batch:${input.shopId}:${hash}`;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
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

function getProductPublicationModeLabel(mode: ProductPublicationMode) {
  if (mode === "NONE") return "non pubblicare automaticamente";
  if (mode === "SELECTED") return "solo canali selezionati";

  return "tutti i canali disponibili";
}

function getPricingRoundingModeLabel(mode: string) {
  if (mode === "WHOLE_EURO") return "all'euro";

  return "a due decimali";
}

function formatPricingRuleSummary(input: {
  discountPercent: number;
  roundingMode: string;
}) {
  if (input.discountPercent === 0) {
    return "nessuno sconto applicato ai prezzi Shopify";
  }

  return `sconto ${input.discountPercent}%, arrotondamento ${getPricingRoundingModeLabel(input.roundingMode)}`;
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

function getOnboardingReadiness(input: {
  descriptionRuleMode: DescriptionRuleMode;
  defaultProductStatus: ImportProductStatus;
}) {
  return {
    defaults: {
      descriptionMode: getDescriptionRuleSummary(input.descriptionRuleMode),
      imageImport: "Tutte le immagini",
      productStatus: getImportProductStatusLabelCapitalized(
        input.defaultProductStatus,
      ),
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

function getMockImportPreviewState(
  descriptionRuleMode: DescriptionRuleMode = "CLEAN_HTML",
) {
  const previewResult = getMockImportPreview(descriptionRuleMode);

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
  descriptionRuleMode: DescriptionRuleMode;
  defaultProductStatus: ImportProductStatus;
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
      descriptionMode: getDescriptionRuleSummary(input.descriptionRuleMode),
      imageImport: "Tutte le immagini",
      productStatus: getImportProductStatusLabelCapitalized(
        input.defaultProductStatus,
      ),
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
      "Creare prodotti Shopify solo dopo conferma",
    ],
  };
}

function getRuntimePhaseReadiness(input: {
  defaultProductStatus: ImportProductStatus;
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
        ? `Location Shopify pronta per import prodotti in stato ${getImportProductStatusLabelCapitalized(
            input.defaultProductStatus,
          )} e inventario.`
        : "Serve una location Shopify attiva e abilitata agli ordini online.",
      label: "Import Shopify controllato",
      status: input.hasDefaultLocation ? "preparabile" : "bloccato",
    },
    {
      detail:
        "Import controllato tracciato con job idempotente e retry pianificati; runner protetto disponibile, schedule Supabase Cron da collegare.",
      label: "Job queue e retry",
      status: "preparabile",
    },
    {
      detail:
        "Runner pianifica batch incrementali per mapping attivi entro il target configurato.",
      label: "Sync incrementale eBay -> Shopify",
      status: "preparabile",
    },
    {
      detail:
        "Webhook orders/paid crea job prioritari per ridurre disponibilità eBay.",
      label: "Protezione disponibilità Shopify -> eBay",
      status: input.ebayConnected ? "preparabile" : "bloccato",
    },
    {
      detail:
        "Webhook product/inventory aprono conflitti visibili e risolvibili in dashboard.",
      label: "Conflitti Shopify",
      status: "preparabile",
    },
    {
      detail:
        "Challenge e POST account deletion pronti; flag runtime controlla la ricezione reale.",
      label: "Compliance eBay/Shopify",
      status: "preparabile",
    },
  ];
}

type LatestProductSnapshotThumbnailRow = {
  mappingId: string | null;
  thumbnailUrl: string | null;
};

async function getLatestThumbnailUrlByMappingId(mappingIds: string[]) {
  const uniqueMappingIds = [...new Set(mappingIds)];

  if (uniqueMappingIds.length === 0) return new Map<string, string>();

  const rows = await prisma.$queryRaw<LatestProductSnapshotThumbnailRow[]>`
    WITH candidate_urls AS (
      SELECT
        "mappingId",
        "capturedAt",
        candidate.priority,
        candidate.ordinality,
        candidate.url AS "thumbnailUrl"
      FROM "ProductSnapshot"
      CROSS JOIN LATERAL (
        SELECT
          1 AS priority,
          image_url.ordinality,
          image_url.value AS url
        FROM jsonb_array_elements_text(
          CASE
            WHEN jsonb_typeof("payload"->'imageUrls') = 'array'
              THEN "payload"->'imageUrls'
            ELSE '[]'::jsonb
          END
        ) WITH ORDINALITY AS image_url(value, ordinality)
        UNION ALL
        SELECT
          2 AS priority,
          media_url.ordinality,
          media_url.value AS url
        FROM jsonb_array_elements_text(
          CASE
            WHEN jsonb_typeof("payload"#>'{mediaSync,sourceImageUrls}') = 'array'
              THEN "payload"#>'{mediaSync,sourceImageUrls}'
            ELSE '[]'::jsonb
          END
        ) WITH ORDINALITY AS media_url(value, ordinality)
        UNION ALL
        SELECT 3 AS priority, 1 AS ordinality, "payload"->>'imageUrl' AS url
        UNION ALL
        SELECT 4 AS priority, 1 AS ordinality, "payload"->>'thumbnailUrl' AS url
        UNION ALL
        SELECT 5 AS priority, 1 AS ordinality, "payload"->>'galleryUrl' AS url
        UNION ALL
        SELECT 6 AS priority, 1 AS ordinality, "payload"->>'GalleryURL' AS url
      ) AS candidate
      WHERE
        "mappingId" IN (${Prisma.join(uniqueMappingIds)})
        AND candidate.url IS NOT NULL
        AND candidate.url <> ''
        AND candidate.url ~* '^https?://[^[:space:]/?#@:]+(:[0-9]+)?([/?#]|$)'
    ),
    ranked_candidates AS (
      SELECT
        "mappingId",
        "thumbnailUrl",
        row_number() OVER (
          PARTITION BY "mappingId"
          ORDER BY "capturedAt" DESC, priority, ordinality
        ) AS candidate_rank
      FROM candidate_urls
    )
    SELECT
      "mappingId",
      "thumbnailUrl"
    FROM ranked_candidates
    WHERE candidate_rank <= 8
    ORDER BY "mappingId", candidate_rank
  `;

  return getProductSnapshotThumbnailUrlByMappingIdFromRows(rows);
}

async function getLatestProductSnapshotByMappingId(mappingIds: string[]) {
  const uniqueMappingIds = [...new Set(mappingIds)];
  const snapshotByMappingId = new Map<string, LatestProductSnapshotForDisplay>();

  if (uniqueMappingIds.length === 0) return snapshotByMappingId;

  const snapshots = await prisma.$queryRaw<LatestProductSnapshotForDisplay[]>`
    SELECT DISTINCT ON ("mappingId")
      "mappingId",
      "capturedAt",
      "currency",
      "payload",
      "priceAmount",
      "productStatus",
      "quantity",
      "sku",
      "title"
    FROM "ProductSnapshot"
    WHERE "mappingId" IN (${Prisma.join(uniqueMappingIds)})
    ORDER BY "mappingId", "capturedAt" DESC
  `;

  for (const snapshot of snapshots) {
    if (!snapshot.mappingId) continue;

    snapshotByMappingId.set(snapshot.mappingId, snapshot);
  }

  return snapshotByMappingId;
}

async function getShopifyThumbnailUrlByProductGid(input: {
  productGids: string[];
  shopDomain: string;
}) {
  const uniqueProductGids = [...new Set(input.productGids)];
  const thumbnailUrlByProductGid = new Map<string, string>();

  if (uniqueProductGids.length === 0) return thumbnailUrlByProductGid;

  try {
    const admin = await getShopifyAdminGraphqlClient(input.shopDomain);

    for (const productGidBatch of chunkArray(uniqueProductGids, 50)) {
      const response = await admin.graphql(
        `#graphql
        query SyncBayCatalogProductThumbnails($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              media(first: 10) {
                nodes {
                  mediaContentType
                  preview {
                    status
                    image {
                      url
                    }
                  }
                  ... on MediaImage {
                    image {
                      url
                    }
                  }
                }
              }
            }
          }
        }`,
        { variables: { ids: productGidBatch } },
      );
      const json = (await response
        .json()
        .catch(() => null)) as ShopifyProductThumbnailsResponse | null;

      if (!response.ok || json?.errors?.length) continue;

      for (const node of json?.data?.nodes ?? []) {
        if (!node?.id) continue;

        const thumbnailUrl = getShopifyProductThumbnailUrl(node);

        if (thumbnailUrl) thumbnailUrlByProductGid.set(node.id, thumbnailUrl);
      }
    }
  } catch {
    return thumbnailUrlByProductGid;
  }

  return thumbnailUrlByProductGid;
}

type ShopifyProductThumbnailsResponse = {
  data?: {
    nodes?: Array<{
      id?: string | null;
      media?: {
        nodes?: unknown[];
      } | null;
    } | null>;
  };
  errors?: Array<unknown>;
};

type CatalogPageRow = ReturnType<typeof formatCatalogPageRow>;

function getCatalogDatabasePageWhere(
  baseWhere: { marketplaceId: string; shopId: string },
  filter: CatalogPageFilter,
): Prisma.ProductMappingWhereInput | null {
  if (filter === "all") return baseWhere;
  if (filter === "linked") {
    return {
      ...baseWhere,
      shopifyProductGid: { not: null },
    };
  }
  if (filter === "conflicts") {
    return {
      ...baseWhere,
      conflicts: { some: { status: SyncConflictStatus.OPEN } },
    };
  }
  if (filter === "not_updated") {
    return {
      ...baseWhere,
      lastSyncedAt: null,
    };
  }
  if (filter === "archived") {
    return {
      ...baseWhere,
      status: {
        in: [ProductMappingStatus.ARCHIVED, ProductMappingStatus.OUT_OF_STOCK],
      },
    };
  }

  return null;
}

async function getCatalogRowsWithThumbnails(input: {
  rows: CatalogPageRow[];
  shopDomain: string;
}) {
  const thumbnailUrlByMappingId =
    await getLatestThumbnailUrlByMappingId(
      getCatalogSnapshotLookupIds({
        maxLookupRows: CATALOG_PAGE_SIZE,
        rows: input.rows,
      }),
    );
  const pageRowsWithSnapshotThumbs = input.rows.map((row) => {
    if (row.thumbnailUrl) return row;

    return {
      ...row,
      thumbnailUrl: thumbnailUrlByMappingId.get(row.id) ?? null,
    };
  });
  const shopifyThumbnailUrlByProductGid =
    await getShopifyThumbnailUrlByProductGid({
      productGids: pageRowsWithSnapshotThumbs.flatMap((row) =>
        !row.thumbnailUrl && row.shopifyProductGid
          ? [row.shopifyProductGid as string]
          : [],
      ),
      shopDomain: input.shopDomain,
    });

  return pageRowsWithSnapshotThumbs.map((row) =>
    row.thumbnailUrl
      ? row
      : {
          ...row,
          thumbnailUrl:
            (row.shopifyProductGid
              ? shopifyThumbnailUrlByProductGid.get(row.shopifyProductGid)
              : null) ?? null,
        },
  );
}

async function getCatalogSummaryCounts(input: {
  now: Date;
  shopId: string;
  syncTargetSeconds: number;
}) {
  const latestIncrementalJob = await prisma.syncJob.findFirst({
    orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
    select: { finishedAt: true },
    where: getCompletedCatalogVerificationJobWhere(input.shopId),
  });
  const catalogVerifiedAtMs = latestIncrementalJob?.finishedAt?.getTime() ?? 0;
  const freshnessThresholdMs =
    input.now.getTime() - Math.max(input.syncTargetSeconds, 60) * 1000 * 2;
  const marketplaceId = getEbayMarketplaceId();
  const [summary] = await prisma.$queryRaw<
    Array<{
      archivedCount: number;
      conflictCount: number;
      freshCount: number;
      needsCheckCount: number;
      staleActiveCount: number;
      unknownAvailabilityCount: number;
    }>
  >`
    WITH latest_snapshot AS (
      SELECT DISTINCT ON ("mappingId")
        "mappingId",
        "quantity"
      FROM "ProductSnapshot"
      WHERE
        "shopId" = ${input.shopId}
        AND "mappingId" IS NOT NULL
      ORDER BY "mappingId", "capturedAt" DESC
    ),
    open_conflicts AS (
      SELECT
        "mappingId",
        COUNT(*)::integer AS "openConflictCount",
        BOOL_OR("field" = 'quantity') AS "hasQuantityConflict"
      FROM "SyncConflict"
      WHERE
        "shopId" = ${input.shopId}
        AND "status"::text = 'OPEN'
        AND "mappingId" IS NOT NULL
      GROUP BY "mappingId"
    ),
    catalog_rows AS (
      SELECT
        CASE
          WHEN m."status"::text IN ('OUT_OF_STOCK', 'ARCHIVED') THEN 'archived'
          WHEN m."status"::text = 'ERROR' OR m."lastErrorCode" IS NOT NULL THEN 'mapping_error'
          WHEN COALESCE(oc."openConflictCount", 0) > 0 THEN 'open_conflict'
          WHEN
            m."status"::text = 'PAUSED'
            OR m."lastSyncedAt" IS NULL
            OR GREATEST(EXTRACT(EPOCH FROM m."lastSyncedAt") * 1000, ${catalogVerifiedAtMs}) < ${freshnessThresholdMs}
          THEN 'stale_sync'
          ELSE 'active_fresh'
        END AS "status",
        CASE
          WHEN m."status"::text = 'ERROR' OR m."lastErrorCode" IS NOT NULL THEN 'blocked'
          WHEN COALESCE(oc."hasQuantityConflict", false) THEN 'needs_check'
          WHEN ls."quantity" IS NULL THEN 'unknown'
          ELSE 'aligned'
        END AS "availability"
      FROM "ProductMapping" m
      LEFT JOIN latest_snapshot ls ON ls."mappingId" = m."id"
      LEFT JOIN open_conflicts oc ON oc."mappingId" = m."id"
      WHERE
        m."shopId" = ${input.shopId}
        AND m."marketplaceId" = ${marketplaceId}
    )
    SELECT
      COUNT(*) FILTER (WHERE "status" = 'archived')::integer AS "archivedCount",
      COUNT(*) FILTER (WHERE "status" = 'open_conflict')::integer AS "conflictCount",
      COUNT(*) FILTER (WHERE "status" = 'active_fresh')::integer AS "freshCount",
      COUNT(*) FILTER (WHERE "status" = 'stale_sync')::integer AS "staleActiveCount",
      COUNT(*) FILTER (
        WHERE "status" <> 'archived' AND "availability" = 'unknown'
      )::integer AS "unknownAvailabilityCount",
      COUNT(*) FILTER (
        WHERE
          "status" IN ('mapping_error', 'stale_sync')
          OR ("status" <> 'archived' AND "availability" <> 'aligned')
      )::integer AS "needsCheckCount"
    FROM catalog_rows
  `;

  return (
    summary ?? {
      archivedCount: 0,
      conflictCount: 0,
      freshCount: 0,
      needsCheckCount: 0,
      staleActiveCount: 0,
      unknownAvailabilityCount: 0,
    }
  );
}

function searchCatalogPageRows(rows: CatalogPageRow[], query: string) {
  if (!query.trim()) return rows;

  return rows.filter((row) => catalogRowMatchesSearch(row, query));
}

function filterCatalogPageRows(
  rows: CatalogPageRow[],
  filter: CatalogPageFilter,
) {
  if (filter === "linked") {
    return rows.filter((row) => row.shopifyProductGid);
  }
  if (filter === "fresh") {
    return rows.filter((row) => row.status === "active_fresh");
  }
  if (filter === "needs_check") {
    return rows.filter(isCatalogRowNeedingCheck);
  }
  if (filter === "conflicts") {
    return rows.filter((row) => row.status === "open_conflict");
  }
  if (filter === "not_updated") {
    return rows.filter((row) => !row.lastSyncedAt);
  }
  if (filter === "archived") {
    return rows.filter((row) => row.status === "archived");
  }

  return rows;
}

const CATALOG_STATUS_SORT_ORDER: Record<string, number> = {
  mapping_error: 0,
  open_conflict: 1,
  stale_sync: 2,
  active_fresh: 3,
  archived: 4,
};

function sortCatalogPageRows(
  rows: CatalogPageRow[],
  sort: CatalogSortKey | null,
  dir: CatalogSortDir,
) {
  if (!sort) return rows;

  const factor = dir === "desc" ? -1 : 1;
  const byText = (a: string, b: string) =>
    factor * a.localeCompare(b, "it", { sensitivity: "base" });
  const byNumber = (a: number, b: number) => factor * (a - b);

  return [...rows].sort((a, b) => {
    if (sort === "product") return byText(a.title, b.title);
    if (sort === "link") {
      return byNumber(a.shopifyProductGid ? 0 : 1, b.shopifyProductGid ? 0 : 1);
    }
    if (sort === "availability") {
      return byNumber(a.quantity ?? -1, b.quantity ?? -1);
    }
    if (sort === "price") {
      return byNumber(
        a.price ? Number.parseFloat(a.price.amount) : -1,
        b.price ? Number.parseFloat(b.price.amount) : -1,
      );
    }
    if (sort === "updated") {
      return byNumber(
        a.lastSyncedAt ? Date.parse(a.lastSyncedAt) : 0,
        b.lastSyncedAt ? Date.parse(b.lastSyncedAt) : 0,
      );
    }

    return byNumber(
      CATALOG_STATUS_SORT_ORDER[a.status] ?? 9,
      CATALOG_STATUS_SORT_ORDER[b.status] ?? 9,
    );
  });
}

function formatCatalogPageRow(input: {
  catalogVerifiedAt: Date | null;
  latestSnapshot: LatestProductSnapshotForDisplay | null;
  mapping: Prisma.ProductMappingGetPayload<{
    include: {
      conflicts: {
        select: {
          field: true;
          id: true;
        };
      };
    };
  }>;
  now: Date;
  syncTargetSeconds: number;
  thumbnailUrl: string | null;
}) {
  const latestSnapshot = input.latestSnapshot;
  const lastSyncedAt = input.mapping.lastSyncedAt?.toISOString() ?? null;
  const status = getCatalogRowStatus({
    lastErrorCode: input.mapping.lastErrorCode,
    lastSyncedAt,
    mappingStatus: input.mapping.status,
    openConflictCount: input.mapping.conflicts.length,
    stale: isCatalogMappingStale({
      catalogVerifiedAt: input.catalogVerifiedAt,
      lastSyncedAt: input.mapping.lastSyncedAt,
      mappingStatus: input.mapping.status,
      now: input.now,
      syncTargetSeconds: input.syncTargetSeconds,
    }),
  });
  const availability = getCatalogAvailability({
    openConflictFields: input.mapping.conflicts.map((conflict) => conflict.field),
    quantity: latestSnapshot?.quantity ?? null,
    status,
  });

  return {
    availability,
    conflictIds: input.mapping.conflicts.map((conflict) => conflict.id),
    ebayItemId: input.mapping.ebayItemId,
    id: input.mapping.id,
    lastErrorCode: input.mapping.lastErrorCode,
    lastErrorMessage: input.mapping.lastErrorMessage,
    lastSyncedAt,
    mappingStatus: input.mapping.status,
    openConflictCount: input.mapping.conflicts.length,
    price: latestSnapshot?.priceAmount
      ? {
          amount: latestSnapshot.priceAmount.toString(),
          currency: latestSnapshot.currency ?? null,
        }
      : null,
    productStatus: latestSnapshot?.productStatus ?? null,
    quantity: latestSnapshot?.quantity ?? null,
    shopifyProductGid: input.mapping.shopifyProductGid,
    sku: latestSnapshot?.sku ?? input.mapping.sku,
    snapshotCapturedAt: latestSnapshot?.capturedAt.toISOString() ?? null,
    status,
    thumbnailUrl:
      getProductSnapshotThumbnailUrlFromPayloads([latestSnapshot?.payload]) ??
      input.thumbnailUrl,
    title:
      latestSnapshot?.title ??
      input.mapping.sku ??
      `Inserzione eBay ${input.mapping.ebayItemId}`,
  };
}

function formatConflictPageRow(
  conflict: Prisma.SyncConflictGetPayload<{
    include: {
      mapping: true;
    };
  }>,
  input: {
    latestSnapshot: LatestProductSnapshotForDisplay | null;
    thumbnailUrl: string | null;
  },
) {
  const latestSnapshot = input.latestSnapshot;

  return {
    detectedAt: conflict.detectedAt.toISOString(),
    ebayItemId: conflict.mapping?.ebayItemId ?? null,
    field: conflict.field,
    id: conflict.id,
    product: {
      shopifyProductGid: conflict.mapping?.shopifyProductGid ?? null,
      sku: latestSnapshot?.sku ?? conflict.mapping?.sku ?? null,
      thumbnailUrl:
        getProductSnapshotThumbnailUrlFromPayloads([latestSnapshot?.payload]) ??
        input.thumbnailUrl,
      title:
        latestSnapshot?.title ??
        conflict.mapping?.sku ??
        (conflict.mapping?.ebayItemId
          ? `Inserzione eBay ${conflict.mapping.ebayItemId}`
          : "Prodotto non collegato"),
    },
    resolution: conflict.resolution,
    resolvedAt: conflict.resolvedAt?.toISOString() ?? null,
    shopifyValue: formatConflictValueForDisplay({
      field: conflict.field,
      value: conflict.shopifyValue,
    }),
    sourceValue: formatConflictValueForDisplay({
      field: conflict.field,
      value: conflict.ebayValue ?? conflict.lastSyncBayValue,
    }),
    status: conflict.status,
  };
}

function getCatalogAvailability(input: {
  openConflictFields: string[];
  quantity: number | null;
  status: CatalogStatusKind;
}): CatalogAvailabilityKind {
  if (input.status === "mapping_error") return "blocked";
  if (input.openConflictFields.includes("quantity")) return "needs_check";
  if (input.quantity === null) return "unknown";

  return "aligned";
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
    (total, job) =>
      total + getImportJobItemCount(getJsonObject(job.payload), job.result),
    0,
  );
  const completedItemCount = catalogBatchJobs
    .filter((job) => job.status === SyncJobStatus.SUCCEEDED)
    .reduce(
      (total, job) =>
        total + getImportJobItemCount(getJsonObject(job.payload), job.result),
      0,
    );
  const failedJobCount = runJobs.filter(
    (job) => job.status === SyncJobStatus.FAILED,
  ).length;
  const activeJobCount = runJobs.filter((job) =>
    activeStatuses.has(job.status),
  ).length;

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
      `${left.jobKind}:${left.status}`.localeCompare(
        `${right.jobKind}:${right.status}`,
      ),
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
    getJsonNumber(payload?.requestedCount) ??
    getJsonNumber(getJsonObject(result)?.requestedCount);

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

function normalizeConflictResolution(value: string) {
  if (value === SyncConflictResolution.KEEP_SHOPIFY) {
    return SyncConflictResolution.KEEP_SHOPIFY;
  }
  if (value === SyncConflictResolution.REALIGN_FROM_EBAY) {
    return SyncConflictResolution.REALIGN_FROM_EBAY;
  }
  if (value === SyncConflictResolution.IGNORE_FIELD) {
    return SyncConflictResolution.IGNORE_FIELD;
  }

  throw new Response("Risoluzione conflitto non supportata.", { status: 400 });
}

function formatCatalogSyncHealth(
  health: ReturnType<typeof getCatalogSyncHealth>,
) {
  return {
    nextDueAt: health.nextDueAt?.toISOString() ?? null,
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

async function findCoalescedWebhookJob(input: {
  details: Prisma.JsonObject;
  jobType: SyncJobType;
  shopId: string;
}) {
  if (input.jobType !== SyncJobType.DETECT_SHOPIFY_CHANGES) return null;

  const matchers = getCoalescedWebhookMatchers(input.details);

  if (matchers.length === 0) return null;

  return prisma.syncJob.findFirst({
    select: { id: true },
    orderBy: { createdAt: "desc" },
    where: {
      OR: matchers,
      shopId: input.shopId,
      status: { in: [SyncJobStatus.PENDING, SyncJobStatus.RETRYING] },
      type: input.jobType,
    },
  });
}

function getCoalescedWebhookMatchers(
  details: Prisma.JsonObject,
): Prisma.SyncJobWhereInput[] {
  const topic = getJsonString(details.topic);
  const resourceKeys = getShopifyChangeJobResourceKeys(details);
  const topicMatcher = topic
    ? { payload: { path: ["topic"], equals: topic } }
    : null;
  const matchers: Prisma.SyncJobWhereInput[] = [];

  for (const resourceKey of resourceKeys) {
    for (const path of [
      ["resourceId"],
      ["inventoryItemGid"],
      ["adminGraphqlApiId"],
      ["admin_graphql_api_id"],
    ]) {
      matchers.push({
        AND: [
          ...(topicMatcher ? [topicMatcher] : []),
          { payload: { path, equals: resourceKey } },
        ],
      });
    }
  }

  return matchers;
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

function getJsonIntegerValue(value: Prisma.JsonValue | undefined) {
  const number = getJsonNumber(value);

  return Number.isInteger(number) ? number : null;
}

function getJsonStringValue(value: Prisma.JsonValue | undefined) {
  return typeof value === "string" ? value : null;
}

function getJsonDecimalValue(value: Prisma.JsonValue | undefined) {
  if (typeof value !== "number" && typeof value !== "string") return null;

  const number = Number(value);

  return Number.isFinite(number) ? new Prisma.Decimal(value) : null;
}

function getConflictPriceAmount(value: Prisma.JsonValue | undefined) {
  const object = getJsonObject(value);

  return getJsonDecimalValue(object?.amount) ?? getJsonDecimalValue(value);
}

function getConflictCompareAtPrice(value: Prisma.JsonValue | undefined) {
  const object = getJsonObject(value);

  return getPricingPayloadValue(object, "compareAtPrice");
}

function getPricingPayloadValue(
  payload: Record<string, Prisma.JsonValue> | null | undefined,
  key: "compareAtPrice" | "compareAtPriceAmount",
) {
  const value = payload?.[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toFixed(2);
  }

  if (typeof value === "string" && value.trim()) {
    const number = Number(value);

    return Number.isFinite(number) ? number.toFixed(2) : value.trim();
  }

  return null;
}

function getJsonString(value: Prisma.JsonValue | undefined) {
  return typeof value === "string" ? value : null;
}

function getStringField(
  record: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = record?.[key];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);

  return null;
}
