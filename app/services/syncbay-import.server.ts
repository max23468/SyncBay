import {
  AuditEventType,
  EbayConnectionStatus,
  Prisma,
  SyncJobStatus,
  SyncJobType,
  type EbayConnection,
} from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import prisma from "../db.server";
import { chunkArray } from "../lib/chunk-array";
import {
  getImportProductStatusLabelCapitalized,
  normalizeImportProductStatus,
  type ImportProductStatus,
} from "../lib/import-product-status";
import { SYNCBAY_AUDIT_LOG_CREATE_SELECT } from "../lib/syncbay-audit-log-write";
import { type DescriptionRuleMode } from "../lib/syncbay-description-rules";
import { serializeExistingCatalogFieldPoliciesByItemId } from "../lib/syncbay-existing-catalog-field-policy";
import {
  buildExistingCatalogTakeoverReport,
  type ExistingCatalogTakeoverApplyRow,
} from "../lib/syncbay-existing-catalog-takeover";
import type { ImportCatalogMode } from "../lib/syncbay-import-catalog-mode";
import type { ImportPreviewLoadMode } from "../lib/syncbay-import-preview-mode";
import {
  measureSyncBayPerformanceStage,
  type SyncBayLoaderPerformanceTrace,
} from "../lib/syncbay-loader-performance";
import {
  normalizeProductPublicationMode,
  parseProductPublicationGids,
} from "../lib/syncbay-product-publication-settings";
import { getEbayMarketplaceId } from "./ebay-environment.server";
import { getEbayLiveImportPreview } from "./ebay-inventory-preview.server";
import { getUsableEbayAccessToken } from "./ebay-token.server";
import { getEbayTradingCatalogImportPlan } from "./ebay-trading-preview.server";
import { getExistingCatalogTakeoverPreview } from "./existing-catalog-takeover-preview.server";
import {
  addExistingProductMatchSuggestions,
  getEmptyImportPreview,
  getImportPreviewValidationRules,
  getMockImportPreview,
  type ImportPreviewResult,
} from "./import-preview.server";
import { getDraftImportReadiness } from "./shopify-draft-import.server";
import { getDraftImportLimit } from "./shopify-import-shared.server";
import { loadExistingShopifyProductsForMatching } from "./shopify-existing-products.server";

import { ensureShopForSession, getEbayRuntimeReadiness } from "./syncbay-operations.server";
import {
  CATALOG_IMPORT_BATCH_MAX_ATTEMPTS,
  ShopifyAdminGraphqlClient,
  ShopifySessionLike,
  getExistingDescriptionRuleForSettings,
  getImportPreviewReadiness,
  getOnboardingReadiness,
} from "./syncbay-shared.server";

export const CATALOG_IMPORT_MAX_PRODUCTS = 2000;

const EXISTING_CATALOG_SHOPIFY_MATCH_MAX_PRODUCTS = 10000;

const EXISTING_CATALOG_SHOPIFY_MATCH_FALLBACK_PRODUCTS = 250;

export async function startCatalogImportJobs(session: ShopifySessionLike) {
  const shop = await ensureShopForSession(session);
  const importProductStatus = normalizeImportProductStatus(shop.defaultProductStatus);
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
    // react-doctor-disable-next-line react-doctor/async-await-in-loop -- enqueue batch import in serie: limita il burst di scritture job (egress).
    const result = await upsertCatalogImportBatchJob({
      batchCount: batches.length,
      batchIndex,
      catalogImportRunId,
      draftLimit,
      ebayItemIds,
      importProductStatus,
      now,
      reuseOnly: false,
      shopId: shop.id,
      source: "trading_api",
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
    select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
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
  trace?: SyncBayLoaderPerformanceTrace,
  options: {
    catalogMode?: ImportCatalogMode;
    previewLoadMode?: ImportPreviewLoadMode;
  } = {},
) {
  const shop = await measureSyncBayPerformanceStage(trace, "import.shop.ensure", () =>
    ensureShopForSession(session),
  );
  const defaultProductStatus = normalizeImportProductStatus(shop.defaultProductStatus);
  const productPublicationMode = normalizeProductPublicationMode(shop.productPublicationMode);
  const selectedPublicationIds = parseProductPublicationGids(shop.productPublicationGids);
  const [descriptionRule, ebayConnection] = await Promise.all([
    measureSyncBayPerformanceStage(trace, "import.db.descriptionRule", () =>
      getExistingDescriptionRuleForSettings(shop.id),
    ),
    measureSyncBayPerformanceStage(trace, "import.db.ebayConnection", () =>
      prisma.ebayConnection.findUnique({
        where: {
          shopId_marketplaceId: {
            marketplaceId: getEbayMarketplaceId(),
            shopId: shop.id,
          },
        },
      }),
    ),
  ]);
  const ebayRuntime = getEbayRuntimeReadiness();
  const ebayConnected = ebayConnection?.status === EbayConnectionStatus.CONNECTED;
  const catalogMode = options.catalogMode ?? "new_products";
  const previewLoadMode = options.previewLoadMode ?? "deferred";
  const shouldLoadExistingCatalogPreview =
    catalogMode === "existing_catalog" &&
    ebayConnected &&
    ebayConnection &&
    previewLoadMode === "live";
  const preview =
    shouldLoadExistingCatalogPreview && ebayConnection
      ? await measureSyncBayPerformanceStage(trace, "import.ebay.existingCatalogPreview", () =>
          getExistingCatalogTakeoverPreview({
            connection: ebayConnection,
            descriptionRuleMode: descriptionRule.mode,
            maxProducts: CATALOG_IMPORT_MAX_PRODUCTS,
          }),
        )
      : ebayConnected && ebayConnection && previewLoadMode === "live"
        ? await measureSyncBayPerformanceStage(trace, "import.ebay.preview", () =>
            getEbayLiveImportPreview(ebayConnection, {
              descriptionRuleMode: descriptionRule.mode,
            }),
          )
        : ebayConnected
          ? getDeferredImportPreviewState()
          : getMockImportPreviewState(descriptionRule.mode);
  const importPreview = getImportPreviewReadiness({
    defaultProductStatus,
    descriptionRuleMode: descriptionRule.mode,
    ebayConnected,
    hasDefaultLocation: Boolean(shop.defaultLocationGid),
    listingReaderAvailable: true,
    listingReaderError: preview.errorMessage,
    listingReaderPending: preview.source === "deferred",
  });
  const matchedPreviewResult = await measureSyncBayPerformanceStage(
    trace,
    "import.shopify.existingMatches",
    () =>
      getImportPreviewWithExistingShopifyMatches({
        admin,
        fallbackScanLimit:
          catalogMode === "existing_catalog"
            ? EXISTING_CATALOG_SHOPIFY_MATCH_FALLBACK_PRODUCTS
            : undefined,
        limit:
          catalogMode === "existing_catalog" ? EXISTING_CATALOG_SHOPIFY_MATCH_MAX_PRODUCTS : 250,
        preferTargetedSkuHints: catalogMode === "existing_catalog",
        previewResult: preview.previewResult,
        skuHints:
          catalogMode === "existing_catalog"
            ? getExistingCatalogSkuHints(preview.previewResult)
            : [],
      }),
  );
  const previewResult =
    catalogMode === "existing_catalog"
      ? previewLoadMode === "live"
        ? {
            ...matchedPreviewResult,
            existingCatalogTakeover: buildExistingCatalogTakeoverReport({
              items: matchedPreviewResult.items,
              shopDomain: shop.shopDomain,
            }),
          }
        : matchedPreviewResult
      : matchedPreviewResult;

  return {
    catalogMode,
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
  fallbackScanLimit?: number;
  limit?: number;
  preferTargetedSkuHints?: boolean;
  previewResult: ImportPreviewResult;
  skuHints?: string[];
}) {
  if (!input.admin || input.previewResult.items.length === 0) {
    return input.previewResult;
  }

  const shopifyProducts = await loadExistingShopifyProductsForMatching(input.admin, {
    fallbackScanLimit: input.fallbackScanLimit,
    limit: input.limit,
    preferTargetedSkuHints: input.preferTargetedSkuHints,
    skuHints: input.skuHints,
  });

  return addExistingProductMatchSuggestions(input.previewResult, shopifyProducts);
}

function getExistingCatalogSkuHints(previewResult: ImportPreviewResult) {
  return previewResult.items.flatMap((item) => [
    item.itemId,
    item.normalized.skuGenerated ? "" : (item.normalized.sku ?? ""),
  ]);
}

export function getCatalogImportBlockers(input: {
  connection: EbayConnection | null;
  hasDefaultLocation: boolean;
}) {
  return [
    process.env.SYNCBAY_DRAFT_IMPORT_ENABLED !== "true" ? "import Shopify non abilitato" : null,
    !input.hasDefaultLocation ? "location Shopify predefinita non confermata" : null,
    !input.connection || input.connection.status !== EbayConnectionStatus.CONNECTED
      ? "account eBay non collegato"
      : null,
  ].filter((blocker): blocker is string => Boolean(blocker));
}

export async function upsertCatalogImportBatchJob(input: {
  batchCount: number;
  batchIndex: number;
  catalogImportRunId: string;
  draftLimit: number;
  ebayItemIds: string[];
  fieldPoliciesByItemId?: Record<string, ExistingCatalogTakeoverApplyRow["fieldPolicy"]>;
  importProductStatus: ImportProductStatus;
  now: Date;
  reuseOnly: boolean;
  shopId: string;
  source: "existing_catalog_takeover" | "trading_api";
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

export function buildCatalogImportBatchPayload(input: {
  batchCount: number;
  batchIndex: number;
  catalogImportRunId: string;
  draftLimit: number;
  ebayItemIds: string[];
  fieldPoliciesByItemId?: Record<string, ExistingCatalogTakeoverApplyRow["fieldPolicy"]>;
  importProductStatus: ImportProductStatus;
  reuseOnly: boolean;
  shopId: string;
  source: "existing_catalog_takeover" | "trading_api";
  totalAvailable: number | null;
  totalPlanned: number;
}) {
  const existingCatalogFieldPoliciesByItemId = input.fieldPoliciesByItemId
    ? serializeExistingCatalogFieldPoliciesByItemId(input.fieldPoliciesByItemId)
    : null;

  return {
    batchCount: input.batchCount,
    batchIndex: input.batchIndex + 1,
    catalogImportMaxProducts: CATALOG_IMPORT_MAX_PRODUCTS,
    catalogImportRunId: input.catalogImportRunId,
    draftLimit: input.draftLimit,
    ebayItemIds: input.ebayItemIds,
    ...(input.reuseOnly && existingCatalogFieldPoliciesByItemId
      ? { existingCatalogFieldPoliciesByItemId }
      : {}),
    importProductStatus: input.importProductStatus,
    marketplaceId: getEbayMarketplaceId(),
    previewMode: "live",
    requestedCount: input.ebayItemIds.length,
    ...(input.reuseOnly ? { reuseOnly: true } : {}),
    shopId: input.shopId,
    source: input.source,
    totalAvailable: input.totalAvailable,
    totalPlanned: input.totalPlanned,
  } satisfies Prisma.JsonObject;
}

export function buildCatalogImportRunId(input: { now: Date; shopId: string }) {
  return `catalog-import:${input.shopId}:${input.now.toISOString()}:${randomUUID()}`;
}

function buildCatalogImportBatchIdempotencyKey(input: {
  batchIndex: number;
  ebayItemIds: string[];
  fieldPoliciesByItemId?: Record<string, ExistingCatalogTakeoverApplyRow["fieldPolicy"]>;
  importProductStatus: ImportProductStatus;
  reuseOnly: boolean;
  shopId: string;
  source: "existing_catalog_takeover" | "trading_api";
}) {
  const existingCatalogFieldPoliciesByItemId = input.fieldPoliciesByItemId
    ? serializeExistingCatalogFieldPoliciesByItemId(input.fieldPoliciesByItemId)
    : {};
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        batchIndex: input.batchIndex,
        ebayItemIds: input.ebayItemIds,
        importProductStatus: input.importProductStatus,
        marketplaceId: getEbayMarketplaceId(),
        shopId: input.shopId,
        ...(input.reuseOnly
          ? {
              existingCatalogFieldPoliciesByItemId,
              reuseOnly: true,
              source: input.source,
            }
          : {}),
      }),
    )
    .digest("hex")
    .slice(0, 20);

  return `catalog-import-batch:${input.shopId}:${hash}`;
}

function getMockImportPreviewState(descriptionRuleMode: DescriptionRuleMode = "CLEAN_HTML") {
  const previewResult = getMockImportPreview(descriptionRuleMode);

  return {
    coverageNote: "Preview dimostrativa locale: usa dati fittizi finché eBay non è collegato.",
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

function getDeferredImportPreviewState() {
  return {
    coverageNote:
      "Preview live non ancora aggiornata in questa apertura: usa l'azione dedicata per leggere eBay in sola lettura.",
    errorMessage: null,
    previewResult: getEmptyImportPreview("empty"),
    readCount: 0,
    readCounts: {
      inventoryApi: 0,
      tradingApi: 0,
    },
    source: "deferred" as const,
    totalAvailable: null,
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
      detail: "Runner pianifica batch incrementali per mapping attivi entro il target configurato.",
      label: "Sync incrementale eBay -> Shopify",
      status: "preparabile",
    },
    {
      detail: "Webhook orders/paid crea job prioritari per ridurre disponibilità eBay.",
      label: "Protezione disponibilità Shopify -> eBay",
      status: input.ebayConnected ? "preparabile" : "bloccato",
    },
    {
      detail: "Webhook product/inventory aprono conflitti visibili e risolvibili in dashboard.",
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
