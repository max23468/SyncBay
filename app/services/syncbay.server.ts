import { createHash, randomUUID } from "node:crypto";

import {
  AuditEventType,
  EbayConnectionStatus,
  Prisma,
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
import { selectShopifyOrderCurrency } from "../lib/syncbay-stock-guard";
import { getUsableEbayAccessToken } from "./ebay-token.server";
import { getEbayTradingCatalogImportPlan } from "./ebay-trading-preview.server";
import { getEbayLiveImportPreview } from "./ebay-inventory-preview.server";
import {
  getImportPreviewValidationRules,
  getMockImportPreview,
} from "./import-preview.server";
import {
  getDraftImportLimit,
  getDraftImportReadiness,
} from "./shopify-draft-import.server";

interface ShopifySessionLike {
  shop: string;
  scope?: string | null;
}

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
const RETRIED_SYNC_JOB_MIN_MAX_ATTEMPTS = 4;
const REQUIRED_SHOPIFY_SCOPES = [
  "read_products",
  "write_products",
  "read_inventory",
  "write_inventory",
  "read_locations",
  "write_locations",
  "read_orders",
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
  const [
    ebayConnection,
    recentJobs,
    recentImportJobs,
    recentAuditLogs,
    mappingCount,
    openConflictCount,
    openConflicts,
    snapshotCount,
  ] = await prisma.$transaction([
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
  ]);
  const latestImportRun = await getLatestImportRunSummary(shop.id);
  const ebayRuntime = getEbayRuntimeReadiness();
  const shopifyScopes = splitScopes(shop.shopifyScopes);
  const shopifyReadiness = getShopifyReadiness(shopifyScopes);
  const supabaseReadiness = getSupabaseReadiness();
  const vercelReadiness = getVercelReadiness();
  const complianceReadiness = getComplianceReadiness();
  const importPreview = getImportPreviewReadiness({
    defaultProductStatus,
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
    onboarding: getOnboardingReadiness({ defaultProductStatus }),
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
  const baselineSnapshot =
    resolution === SyncConflictResolution.KEEP_SHOPIFY && conflict?.mappingId
      ? await prisma.productSnapshot.findFirst({
          orderBy: { capturedAt: "desc" },
          where: {
            mappingId: conflict.mappingId,
            source: ProductSnapshotSource.SYNCBAY,
          },
        })
      : null;

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

function buildKeepShopifyBaselineSnapshot(input: {
  conflict: Prisma.SyncConflictGetPayload<Record<string, never>>;
  snapshot: Prisma.ProductSnapshotGetPayload<Record<string, never>>;
}) {
  const shopifyValue = input.conflict.shopifyValue;
  const snapshotPayload = getKeepShopifyBaselinePayload(input.snapshot.payload);

  return {
    currency: input.snapshot.currency,
    descriptionHash:
      input.conflict.field === "description"
        ? getJsonStringValue(shopifyValue)
        : input.snapshot.descriptionHash,
    ebayItemId: input.snapshot.ebayItemId,
    imageCount:
      input.conflict.field === "images"
        ? getJsonIntegerValue(shopifyValue)
        : input.snapshot.imageCount,
    mappingId: input.snapshot.mappingId,
    payload: {
      ...snapshotPayload,
      conflictResolution: {
        conflictId: input.conflict.id,
        field: input.conflict.field,
        resolution: SyncConflictResolution.KEEP_SHOPIFY,
      },
    } satisfies Prisma.JsonObject,
    priceAmount:
      input.conflict.field === "price"
        ? getJsonDecimalValue(shopifyValue)
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

export async function getImportWizardState(session: ShopifySessionLike) {
  const shop = await ensureShopForSession(session);
  const defaultProductStatus = normalizeImportProductStatus(
    shop.defaultProductStatus,
  );
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
    defaultProductStatus,
    ebayConnected,
    hasDefaultLocation: Boolean(shop.defaultLocationGid),
    listingReaderAvailable: true,
    listingReaderError: preview.errorMessage,
  });
  const previewResult = preview.previewResult;

  return {
    draftImport: getDraftImportReadiness({
      defaultProductStatus,
      hasDefaultLocation: Boolean(shop.defaultLocationGid),
      previewResult,
    }),
    ebay: {
      marketplaceId: getEbayMarketplaceId(),
      status: ebayConnection?.status ?? EbayConnectionStatus.NOT_CONNECTED,
    },
    importPreview,
    onboarding: getOnboardingReadiness({ defaultProductStatus }),
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

export async function getShopSettingsState(session: ShopifySessionLike) {
  const shop = await ensureShopForSession(session);

  return {
    shop: {
      defaultProductStatus: normalizeImportProductStatus(
        shop.defaultProductStatus,
      ),
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
  if (topic === "orders/paid") {
    return {
      orderCurrency: extractShopifyOrderCurrency(payload),
      lineItems: extractShopifyOrderLineItems(payload),
    } satisfies Prisma.JsonObject;
  }

  if (topic === "inventory_levels/update") {
    return {
      inventoryItemGid: extractShopifyInventoryItemGid(payload),
    } satisfies Prisma.JsonObject;
  }

  return {};
}

function extractShopifyOrderLineItems(payload: unknown) {
  if (!payload || typeof payload !== "object") return [];

  const record = payload as Record<string, unknown>;
  const rawLineItems = Array.isArray(record.line_items)
    ? record.line_items
    : [];

  return rawLineItems.flatMap((lineItem, index) => {
    if (!lineItem || typeof lineItem !== "object") return [];

    const lineItemRecord = lineItem as Record<string, unknown>;
    const lineItemId = getStringField(lineItemRecord, "id");
    const quantity = getNumberField(lineItemRecord, "quantity");
    const productId = getStringField(lineItemRecord, "product_id");
    const variantId = getStringField(lineItemRecord, "variant_id");

    if (!quantity || quantity <= 0) return [];

    return [
      {
        lineItemKey:
          lineItemId ??
          `${productId ?? "no-product"}:${variantId ?? "no-variant"}:${index}`,
        quantity,
        shopifyProductGid: productId
          ? `gid://shopify/Product/${productId}`
          : null,
        shopifyVariantGid: variantId
          ? `gid://shopify/ProductVariant/${variantId}`
          : null,
      },
    ];
  });
}

function extractShopifyOrderCurrency(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  const moneySet = getRecordField(record, "current_total_price_set");
  const presentmentMoney = getRecordField(moneySet, "presentment_money");
  const shopMoney = getRecordField(moneySet, "shop_money");

  return selectShopifyOrderCurrency({
    currency: getStringField(record, "currency"),
    presentmentCurrency: getStringField(record, "presentment_currency"),
    presentmentMoneyCurrency: getStringField(presentmentMoney, "currency_code"),
    shopMoneyCurrency: getStringField(shopMoney, "currency_code"),
  });
}

function extractShopifyInventoryItemGid(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  const inventoryItemId = getStringField(record, "inventory_item_id");

  return inventoryItemId
    ? `gid://shopify/InventoryItem/${inventoryItemId}`
    : null;
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
  defaultProductStatus: ImportProductStatus;
}) {
  return {
    defaults: {
      descriptionMode: "HTML pulito senza template",
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
      descriptionMode: "HTML pulito senza template",
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
  const resourceId = getJsonString(details.resourceId);
  const inventoryItemGid = getJsonString(details.inventoryItemGid);
  const topicMatcher = topic
    ? { payload: { path: ["topic"], equals: topic } }
    : null;
  const matchers: Prisma.SyncJobWhereInput[] = [];

  if (resourceId) {
    matchers.push({
      AND: [
        ...(topicMatcher ? [topicMatcher] : []),
        { payload: { path: ["resourceId"], equals: resourceId } },
      ],
    });
  }

  if (inventoryItemGid) {
    matchers.push({
      AND: [
        ...(topicMatcher ? [topicMatcher] : []),
        { payload: { path: ["inventoryItemGid"], equals: inventoryItemGid } },
      ],
    });
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

function getJsonString(value: Prisma.JsonValue | undefined) {
  return typeof value === "string" ? value : null;
}

function getRecordField(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];

  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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

function getNumberField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}
