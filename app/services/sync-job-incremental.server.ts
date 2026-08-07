import {
  AuditEventType,
  Prisma,
  ProductMappingStatus,
  ProductSnapshotSource,
  SyncConflictResolution,
  SyncConflictStatus,
  SyncJobStatus,
  SyncJobType,
} from "@prisma/client";
import prisma from "../db.server";
import { SYNCBAY_AUDIT_LOG_CREATE_SELECT } from "../lib/syncbay-audit-log-write";
import {
  SYNCBAY_DESCRIPTION_BASELINE_PAYLOAD_SQL,
  isLiveDescriptionConflictAligned,
  shouldBlockIncrementalSyncForOpenConflictMappingStatus,
  shouldResolveLiveAlignedDescriptionConflictForMappingStatus,
  shouldResolveLiveAlignedPriceConflictForMappingStatus,
  shouldResolveOpenConflictsForInactiveMappingStatus,
} from "../lib/syncbay-conflict-detection";
import { hashNullableText } from "../lib/syncbay-description-hash";
import {
  shouldAdvanceCatalogReconcileRunWatermark,
  shouldAdvanceSellerEventsRunWatermark,
} from "../lib/syncbay-ebay-delta-sync";
import { deserializeIncrementalPreviewCandidate } from "../lib/syncbay-incremental-preview-candidate";
import {
  buildPriceConflictValue,
  getAlignedPriceConflictRepair,
  getFinalizedPriceConflictRepairIds,
  getPriceConflictRepairSnapshotVariantGid,
} from "../lib/syncbay-price-conflict-alignment";
import { isPricingOnlySyncJobPayload } from "../lib/syncbay-pricing-rule-sync";
import {
  calculateShopifyPricing,
  shouldWriteShopifyPricing,
  type SyncBayPricingWriteBaseline,
} from "../lib/syncbay-pricing-rules";
import { buildSnapshotPricingSourcesByItemId } from "../lib/syncbay-pricing-source";
import { hasSyncBayProductFacetBaselineChanged } from "../lib/syncbay-product-facet-baseline";
import { buildSyncBayProductFacetProposalFromSnapshot } from "../lib/syncbay-product-facet-proposal";
import { shouldCreateProductSnapshot } from "../lib/syncbay-product-snapshot-dedupe";
import { serializeProductFacet } from "../lib/syncbay-product-snapshot-payload";
import { selectShopifyVariantForSync } from "../lib/syncbay-shopify-variant-selection";
import { buildImportPreview, type ImportPreviewListingCandidate } from "./import-preview.server";
import { getPricingRuleForShopId } from "./pricing-rules.server";
import { recordProductSnapshotsInTransaction } from "./product-history.server";
import { getShopifyAdminGraphqlClient } from "./shopify-admin-session.server";
import { executeShopifyCatalogImport } from "./shopify-draft-import.server";
import { markShopifyProductSoldOut } from "./shopify-import-inventory.server";
import { syncShopifyProductFacets } from "./syncbay-product-facets.server";

import {
  DueSyncJob,
  filterPreviewResultByItemIds,
  getBooleanFromPayload,
  getConnectedEbayConnection,
  getEbayItemIds,
  getEbayMarketplaceId,
  getImportPreviewResultByItemIds,
  getImportProductStatus,
  getInterruptedRunningSyncJobResult,
  getJsonNumber,
  getJsonObject,
  getLatestFacetBaselinesByItemId,
  getShopifyProductForConflict,
  getStringFromPayload,
  markJobFailedOrRetrying,
  markJobSucceeded,
  splitOversizedEbayItemJobIfNeeded,
} from "./sync-job-shared.server";

type ShopifyUserError = {
  field?: string[] | null;
  message: string;
};

type ShopifyPricingVariantUpdateResponse = {
  data?: {
    productVariantsBulkUpdate?: {
      productVariants?: Array<{
        compareAtPrice?: string | null;
        id: string;
        price?: string | null;
      }>;
      userErrors?: ShopifyUserError[];
    } | null;
  };
  errors?: Array<{ message: string }>;
};

export async function runIncrementalSyncJob(job: DueSyncJob) {
  const ebayItemIds = getEbayItemIds(job.payload);

  if (ebayItemIds.length === 0) {
    throw new Error("Job sync incrementale senza eBay ItemID.");
  }

  const splitResult = await splitOversizedEbayItemJobIfNeeded(job, ebayItemIds);

  if (splitResult !== "not_needed") {
    return {
      jobId: job.id,
      status: "succeeded" as const,
      type: job.type,
    };
  }

  const interruptedJob = await getInterruptedRunningSyncJobResult(job);
  if (interruptedJob) return interruptedJob;

  const openConflicts = await prisma.syncConflict.findMany({
    select: {
      field: true,
      id: true,
      lastSyncBayValue: true,
      mappingId: true,
      mapping: {
        select: {
          ebayItemId: true,
          id: true,
          shopifyProductGid: true,
          shopifyVariantGid: true,
          sku: true,
          status: true,
        },
      },
      shopifyValue: true,
    },
    where: {
      mapping: { ebayItemId: { in: ebayItemIds } },
      shopId: job.shopId,
      status: SyncConflictStatus.OPEN,
    },
  });
  const reactivationConflictMappingIds = [
    ...new Set(
      openConflicts.flatMap((conflict) => {
        if (!shouldResolveOpenConflictsForInactiveMappingStatus(conflict.mapping?.status ?? null)) {
          return [];
        }

        return conflict.mapping?.id ? [conflict.mapping.id] : [];
      }),
    ),
  ];
  let reactivationConflictResolvedCount = 0;
  if (reactivationConflictMappingIds.length > 0) {
    const interruptedJobBeforeConflictUpdate = await getInterruptedRunningSyncJobResult(job);
    if (interruptedJobBeforeConflictUpdate) {
      return interruptedJobBeforeConflictUpdate;
    }

    reactivationConflictResolvedCount = (
      await prisma.syncConflict.updateMany({
        data: {
          resolvedAt: new Date(),
          status: SyncConflictStatus.RESOLVED,
        },
        where: {
          mappingId: { in: reactivationConflictMappingIds },
          shopId: job.shopId,
          status: SyncConflictStatus.OPEN,
        },
      })
    ).count;
  }

  const interruptedJobBeforeConflictProbe = await getInterruptedRunningSyncJobResult(job);
  if (interruptedJobBeforeConflictProbe) return interruptedJobBeforeConflictProbe;

  const alignedDescriptionConflicts = await resolveLiveAlignedDescriptionConflicts({
    conflicts: openConflicts,
    defaultLocationGid: job.shop.defaultLocationGid,
    shopId: job.shopId,
    shopDomain: job.shop.shopDomain,
  });
  const resolvedAlignedDescriptionConflictIds = new Set(alignedDescriptionConflicts.conflictIds);
  const alignedPriceConflicts = await resolveLiveAlignedPriceConflicts({
    conflicts: openConflicts,
    defaultLocationGid: job.shop.defaultLocationGid,
    job,
    shopDomain: job.shop.shopDomain,
  });
  const resolvedAlignedPriceConflictIds = new Set(alignedPriceConflicts.conflictIds);
  const openConflictItemIds = new Set(
    openConflicts.flatMap((conflict) => {
      if (
        resolvedAlignedDescriptionConflictIds.has(conflict.id) ||
        resolvedAlignedPriceConflictIds.has(conflict.id)
      ) {
        return [];
      }
      if (
        !shouldBlockIncrementalSyncForOpenConflictMappingStatus(conflict.mapping?.status ?? null)
      ) {
        return [];
      }

      return conflict.mapping?.ebayItemId ? [conflict.mapping.ebayItemId] : [];
    }),
  );
  const syncableItemIds = ebayItemIds.filter((itemId) => !openConflictItemIds.has(itemId));

  if (syncableItemIds.length === 0) {
    await markJobSucceeded({
      job,
      result: {
        alignedDescriptionConflictResolvedCount: alignedDescriptionConflicts.count,
        alignedPriceConflictResolvedCount: alignedPriceConflicts.count,
        conflictSkippedCount: ebayItemIds.length,
        reactivationConflictResolvedCount,
        requestedCount: ebayItemIds.length,
        syncedCount: 0,
      },
      warnings: [
        "Sync incrementale saltato: tutti i prodotti del batch hanno conflitti Shopify aperti.",
      ],
    });

    return {
      jobId: job.id,
      status: "succeeded" as const,
      type: job.type,
    };
  }

  if (isFacetOnlySyncJobPayload(job.payload)) {
    return runFacetOnlyIncrementalSyncJob({
      alignedDescriptionConflictResolvedCount: alignedDescriptionConflicts.count,
      alignedPriceConflictResolvedCount: alignedPriceConflicts.count,
      job,
      openConflictSkippedCount: openConflictItemIds.size,
      reactivationConflictResolvedCount,
      requestedItemIds: ebayItemIds,
      syncableItemIds,
    });
  }

  if (isPricingOnlySyncJobPayload(job.payload)) {
    return runPricingOnlyIncrementalSyncJob({
      alignedDescriptionConflictResolvedCount: alignedDescriptionConflicts.count,
      alignedPriceConflictResolvedCount: alignedPriceConflicts.count,
      job,
      openConflictSkippedCount: openConflictItemIds.size,
      reactivationConflictResolvedCount,
      requestedItemIds: ebayItemIds,
      syncableItemIds,
    });
  }

  const interruptedJobBeforeProvider = await getInterruptedRunningSyncJobResult(job);
  if (interruptedJobBeforeProvider) return interruptedJobBeforeProvider;

  const [admin, previewResult, facetBaselinesByItemId] = await Promise.all([
    getShopifyAdminGraphqlClient(job.shop.shopDomain),
    getIncrementalPreviewResult(job, syncableItemIds),
    getLatestFacetBaselinesByItemId({
      ebayItemIds: syncableItemIds,
      shopId: job.shopId,
    }),
  ]);
  const filteredPreviewResult = filterPreviewResultByItemIds(previewResult, syncableItemIds);
  const result = await executeShopifyCatalogImport({
    admin,
    defaultLocationGid: job.shop.defaultLocationGid,
    facetBaselinesByItemId,
    hasDefaultLocation: Boolean(job.shop.defaultLocationGid),
    importProductStatusOverride: getImportProductStatus(job.payload),
    jobId: job.id,
    previewResult: filteredPreviewResult,
    shopId: job.shopId,
    shopDomain: job.shop.shopDomain,
    // Reconcile e delta seller events ripassano l'intero catalogo: senza
    // questo skip ogni giro riscrive su Shopify anche i prodotti identici,
    // generando eco products/update e job DETECT a valanga (egress).
    skipUnchangedSinceLastEbaySnapshot: true,
  });

  if (result.status === "blocked" || result.status === "failed") {
    await markJobFailedOrRetrying({
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      job,
    });

    return {
      errorMessage: result.errorMessage,
      jobId: job.id,
      status: "failed" as const,
      type: job.type,
    };
  }

  await markJobSucceeded({
    job,
    result: {
      ...result.summary,
      alignedDescriptionConflictResolvedCount: alignedDescriptionConflicts.count,
      alignedPriceConflictResolvedCount: alignedPriceConflicts.count,
      conflictSkippedCount: openConflictItemIds.size,
      reactivationConflictResolvedCount,
      requestedCount: ebayItemIds.length,
      syncedCount: syncableItemIds.length,
    },
    warnings: result.warnings ?? [],
  });
  await maybeMarkSellerEventsRunWatermarkSucceeded(job);
  await maybeMarkCatalogReconcileRunWatermarkSucceeded(job);

  return {
    jobId: job.id,
    status: "succeeded" as const,
    type: job.type,
  };
}

export async function runPricingOnlyIncrementalSyncJob(input: {
  alignedDescriptionConflictResolvedCount: number;
  alignedPriceConflictResolvedCount: number;
  job: DueSyncJob;
  openConflictSkippedCount: number;
  reactivationConflictResolvedCount: number;
  requestedItemIds: string[];
  syncableItemIds: string[];
}) {
  const interruptedJobBeforeProvider = await getInterruptedRunningSyncJobResult(input.job);
  if (interruptedJobBeforeProvider) return interruptedJobBeforeProvider;

  const [admin, previewResult, pricingRule, mappings, snapshots] = await Promise.all([
    getShopifyAdminGraphqlClient(input.job.shop.shopDomain),
    getIncrementalPreviewResult(input.job, input.syncableItemIds),
    getPricingRuleForShopId(input.job.shopId),
    prisma.productMapping.findMany({
      select: {
        ebayItemId: true,
        id: true,
        shopifyProductGid: true,
        shopifyVariantGid: true,
        sku: true,
      },
      where: {
        ebayItemId: { in: input.syncableItemIds },
        marketplaceId: getEbayMarketplaceId(input.job.payload),
        shopId: input.job.shopId,
      },
    }),
    prisma.productSnapshot.findMany({
      orderBy: { capturedAt: "desc" },
      select: {
        capturedAt: true,
        currency: true,
        ebayItemId: true,
        payload: true,
        priceAmount: true,
        productStatus: true,
        quantity: true,
        sku: true,
        source: true,
        title: true,
      },
      where: {
        ebayItemId: { in: input.syncableItemIds },
        priceAmount: { not: null },
        shopId: input.job.shopId,
        source: {
          in: [ProductSnapshotSource.EBAY, ProductSnapshotSource.SYNCBAY],
        },
      },
    }),
  ]);
  const previewItemsById = new Map(
    filterPreviewResultByItemIds(previewResult, input.syncableItemIds).items.map((item) => [
      item.itemId,
      item,
    ]),
  );
  const mappingsByItemId = new Map(mappings.map((mapping) => [mapping.ebayItemId, mapping]));
  const snapshotPricingSourcesByItemId = buildSnapshotPricingSourcesByItemId(
    snapshots.flatMap((snapshot) =>
      snapshot.ebayItemId
        ? [
            {
              capturedAt: snapshot.capturedAt,
              currency: snapshot.currency,
              ebayItemId: snapshot.ebayItemId,
              payload: snapshot.payload,
              priceAmount: snapshot.priceAmount === null ? null : Number(snapshot.priceAmount),
              productStatus: snapshot.productStatus,
              quantity: snapshot.quantity,
              sku: snapshot.sku,
              source: snapshot.source,
              title: snapshot.title,
            },
          ]
        : [],
    ),
  );
  const latestSyncBayPricingBaselinesByItemId =
    buildLatestSyncBayPricingBaselinesByItemId(snapshots);
  const synced: Prisma.JsonObject[] = [];
  const skipped: Prisma.JsonObject[] = [];
  const unchanged: Prisma.JsonObject[] = [];
  const syncBaySnapshots: Prisma.ProductSnapshotCreateManyInput[] = [];
  const now = new Date();

  for (const itemId of input.syncableItemIds) {
    const item = previewItemsById.get(itemId);
    const mapping = mappingsByItemId.get(itemId);
    const pricingSource =
      item === undefined
        ? snapshotPricingSourcesByItemId.get(itemId)
        : {
            currency: item.normalized.currency,
            priceAmount: item.normalized.priceAmount,
            productStatus: item.normalized.productStatus,
            quantity: item.normalized.quantity,
            sku: item.normalized.sku,
            source: "preview" as const,
            title: item.normalized.title,
          };

    if (!pricingSource || !mapping?.shopifyProductGid || !mapping.shopifyVariantGid) {
      skipped.push({
        ebayItemId: itemId,
        reason: !pricingSource ? "pricing_source_missing" : "shopify_mapping_missing",
      });
      continue;
    }

    const pricing = calculateShopifyPricing({
      discountPercent: pricingRule.discountPercent,
      ebayPriceAmount: pricingSource.priceAmount,
      roundingMode: pricingRule.roundingMode,
    });
    const price = formatShopifyPrice(pricing.priceAmount);
    const compareAtPrice = formatShopifyPrice(pricing.compareAtPriceAmount);

    if (!price) {
      skipped.push({
        ebayItemId: itemId,
        reason: "ebay_price_missing",
      });
      continue;
    }

    if (
      !shouldWriteShopifyPricing({
        next: { compareAtPrice, price },
        previous: latestSyncBayPricingBaselinesByItemId.get(itemId) ?? null,
      })
    ) {
      unchanged.push({
        compareAtPrice,
        ebayItemId: itemId,
        price,
        reason: "unchanged_pricing",
        shopifyProductGid: mapping.shopifyProductGid,
        shopifyVariantGid: mapping.shopifyVariantGid,
      });
      continue;
    }

    const interruptedJobBeforePricingWrite = await getInterruptedRunningSyncJobResult(input.job);
    if (interruptedJobBeforePricingWrite) return interruptedJobBeforePricingWrite;

    const updateResult = await updateShopifyVariantPricingOnly(admin, {
      compareAtPrice,
      price,
      productGid: mapping.shopifyProductGid,
      variantGid: mapping.shopifyVariantGid,
    });

    if (updateResult.status === "failed") {
      throw new Error(updateResult.errorMessage);
    }

    synced.push({
      compareAtPrice: updateResult.compareAtPrice,
      ebayItemId: itemId,
      price: updateResult.price,
      shopifyProductGid: mapping.shopifyProductGid,
      shopifyVariantGid: mapping.shopifyVariantGid,
    });
    syncBaySnapshots.push({
      capturedAt: now,
      currency: pricingSource.currency,
      ebayItemId: itemId,
      mappingId: mapping.id,
      payload: {
        pricing: {
          applied: pricing.applied,
          compareAtPriceAmount: pricing.compareAtPriceAmount,
          discountPercent: pricing.discountPercent,
          ebayPriceAmount: pricingSource.priceAmount,
          priceAmount: pricing.priceAmount,
          pricingOnly: true,
          roundingMode: pricing.roundingMode,
        },
        pricingOnly: true,
        syncJobId: input.job.id,
      } satisfies Prisma.JsonObject,
      priceAmount: pricing.priceAmount,
      productStatus: pricingSource.productStatus ?? null,
      quantity: pricingSource.quantity ?? null,
      shopId: input.job.shopId,
      shopifyProductGid: mapping.shopifyProductGid,
      shopifyVariantGid: mapping.shopifyVariantGid,
      sku: pricingSource.sku ?? mapping.sku,
      source: ProductSnapshotSource.SYNCBAY,
      title: pricingSource.title,
    });
  }

  if (syncBaySnapshots.length > 0) {
    const syncedMappingIds = syncBaySnapshots
      .map((snapshot) => snapshot.mappingId)
      .filter((mappingId): mappingId is string => Boolean(mappingId));
    const changedSyncBaySnapshots = await filterChangedSyncBayProductSnapshots(syncBaySnapshots);

    await prisma.$transaction(async (tx) => {
      if (changedSyncBaySnapshots.length > 0) {
        await recordProductSnapshotsInTransaction(tx, changedSyncBaySnapshots);
      }

      await tx.productMapping.updateMany({
        data: { lastSyncedAt: now },
        where: { id: { in: syncedMappingIds } },
      });
    });
  }

  await markJobSucceeded({
    job: input.job,
    result: {
      alignedDescriptionConflictResolvedCount: input.alignedDescriptionConflictResolvedCount,
      alignedPriceConflictResolvedCount: input.alignedPriceConflictResolvedCount,
      conflictSkippedCount: input.openConflictSkippedCount,
      pricingOnly: true,
      reactivationConflictResolvedCount: input.reactivationConflictResolvedCount,
      requestedCount: input.requestedItemIds.length,
      skipped,
      skippedCount: skipped.length,
      synced,
      syncedCount: synced.length,
      unchanged,
      unchangedCount: unchanged.length,
    },
    warnings:
      skipped.length > 0 ? [`Sync prezzo completato con ${skipped.length} prodotti saltati.`] : [],
  });
  await maybeMarkSellerEventsRunWatermarkSucceeded(input.job);
  await maybeMarkCatalogReconcileRunWatermarkSucceeded(input.job);

  return {
    jobId: input.job.id,
    status: "succeeded" as const,
    type: input.job.type,
  };
}

export async function runFacetOnlyIncrementalSyncJob(input: {
  alignedDescriptionConflictResolvedCount: number;
  alignedPriceConflictResolvedCount: number;
  job: DueSyncJob;
  openConflictSkippedCount: number;
  reactivationConflictResolvedCount: number;
  requestedItemIds: string[];
  syncableItemIds: string[];
}) {
  const interruptedJobBeforeProvider = await getInterruptedRunningSyncJobResult(input.job);
  if (interruptedJobBeforeProvider) return interruptedJobBeforeProvider;

  const [admin, mappings, ebaySnapshots, facetBaselinesByItemId] = await Promise.all([
    getShopifyAdminGraphqlClient(input.job.shop.shopDomain),
    prisma.productMapping.findMany({
      select: {
        ebayItemId: true,
        id: true,
        shopifyProductGid: true,
      },
      where: {
        ebayItemId: { in: input.syncableItemIds },
        marketplaceId: getEbayMarketplaceId(input.job.payload),
        shopId: input.job.shopId,
        status: ProductMappingStatus.ACTIVE,
      },
    }),
    prisma.productSnapshot.findMany({
      orderBy: { capturedAt: "desc" },
      select: {
        ebayItemId: true,
        payload: true,
        title: true,
      },
      where: {
        ebayItemId: { in: input.syncableItemIds },
        shopId: input.job.shopId,
        source: ProductSnapshotSource.EBAY,
      },
    }),
    getLatestFacetBaselinesByItemId({
      ebayItemIds: input.syncableItemIds,
      shopId: input.job.shopId,
    }),
  ]);
  const mappingsByItemId = new Map(mappings.map((mapping) => [mapping.ebayItemId, mapping]));
  const latestEbaySnapshotByItemId = new Map<
    string,
    { payload: Prisma.JsonValue | null; title: string | null }
  >();

  for (const snapshot of ebaySnapshots) {
    if (!snapshot.ebayItemId || latestEbaySnapshotByItemId.has(snapshot.ebayItemId)) {
      continue;
    }

    latestEbaySnapshotByItemId.set(snapshot.ebayItemId, {
      payload: snapshot.payload,
      title: snapshot.title,
    });
  }

  let facetConflictCount = 0;
  let facetDeletedCount = 0;
  let facetSkippedCount = 0;
  let facetWrittenCount = 0;
  const synced: Prisma.JsonObject[] = [];
  const skipped: Prisma.JsonObject[] = [];
  const syncBaySnapshots: Prisma.ProductSnapshotCreateManyInput[] = [];
  const now = new Date();

  for (const itemId of input.syncableItemIds) {
    const interruptedJobBeforeFacetWrite = await getInterruptedRunningSyncJobResult(input.job);
    if (interruptedJobBeforeFacetWrite) return interruptedJobBeforeFacetWrite;

    const mapping = mappingsByItemId.get(itemId);

    if (!mapping?.shopifyProductGid) {
      skipped.push({
        ebayItemId: itemId,
        reason: "shopify_mapping_missing",
      });
      continue;
    }

    const ebaySnapshot = latestEbaySnapshotByItemId.get(itemId);
    if (!ebaySnapshot) {
      skipped.push({
        ebayItemId: itemId,
        reason: "ebay_snapshot_missing",
      });
      continue;
    }

    const payload = getJsonObject(ebaySnapshot.payload);
    const proposedFacets = buildSyncBayProductFacetProposalFromSnapshot({
      ebayPrimaryCategoryName: getNullableStringFromRecord(payload, "ebayPrimaryCategoryName"),
      payload,
      storeCategoryName: getNullableStringFromRecord(payload, "storeCategoryName"),
      title: ebaySnapshot.title,
    });
    const previousSyncBayFacets = facetBaselinesByItemId[itemId] ?? [];

    if (proposedFacets.length === 0 && previousSyncBayFacets.length === 0) {
      skipped.push({
        ebayItemId: itemId,
        reason: "no_high_confidence_facets",
      });
      continue;
    }

    const facetSync = await syncShopifyProductFacets({
      admin,
      ownerId: mapping.shopifyProductGid,
      previousSyncBayFacets,
      proposedFacets,
    });

    if (facetSync.status === "missing_owner") {
      skipped.push({
        ebayItemId: itemId,
        reason: "shopify_product_missing",
        shopifyProductGid: mapping.shopifyProductGid,
      });
      continue;
    }

    facetConflictCount += facetSync.conflicts.length;
    facetDeletedCount += facetSync.deleted.length;
    facetSkippedCount += facetSync.skipped.length;
    facetWrittenCount += facetSync.written.length;
    synced.push({
      conflictCount: facetSync.conflicts.length,
      deletedCount: facetSync.deleted.length,
      ebayItemId: itemId,
      proposedCount: proposedFacets.length,
      shopifyProductGid: mapping.shopifyProductGid,
      skippedCount: facetSync.skipped.length,
      writtenCount: facetSync.written.length,
    });

    const shouldPersistFacetBaseline =
      facetSync.written.length > 0 ||
      facetSync.deleted.length > 0 ||
      hasSyncBayProductFacetBaselineChanged(previousSyncBayFacets, facetSync.baselineFacets);

    if (shouldPersistFacetBaseline) {
      syncBaySnapshots.push({
        capturedAt: now,
        ebayItemId: itemId,
        mappingId: mapping.id,
        payload: buildProductFacetBaselineSnapshotPayload({
          facetSync,
          jobId: input.job.id,
        }),
        shopId: input.job.shopId,
        shopifyProductGid: mapping.shopifyProductGid,
        source: ProductSnapshotSource.SYNCBAY,
        title: ebaySnapshot.title,
      });
    }
  }

  if (syncBaySnapshots.length > 0) {
    const syncedMappingIds = syncBaySnapshots
      .map((snapshot) => snapshot.mappingId)
      .filter((mappingId): mappingId is string => Boolean(mappingId));
    const changedSyncBaySnapshots = await filterChangedSyncBayProductSnapshots(syncBaySnapshots);

    await prisma.$transaction(async (tx) => {
      if (changedSyncBaySnapshots.length > 0) {
        await recordProductSnapshotsInTransaction(tx, changedSyncBaySnapshots);
      }

      await tx.productMapping.updateMany({
        data: { lastSyncedAt: now },
        where: { id: { in: syncedMappingIds } },
      });
    });
  }

  await markJobSucceeded({
    job: input.job,
    result: {
      alignedDescriptionConflictResolvedCount: input.alignedDescriptionConflictResolvedCount,
      alignedPriceConflictResolvedCount: input.alignedPriceConflictResolvedCount,
      conflictSkippedCount: input.openConflictSkippedCount,
      facetConflictCount,
      facetDeletedCount,
      facetOnly: true,
      facetSkippedCount,
      facetWrittenCount,
      reactivationConflictResolvedCount: input.reactivationConflictResolvedCount,
      requestedCount: input.requestedItemIds.length,
      skipped,
      skippedCount: skipped.length,
      source: getStringFromPayload(input.job.payload, "source") ?? "facet_only",
      synced,
      syncedCount: synced.length,
    },
    warnings: buildFacetOnlyWarnings({ skipped, synced }),
  });
  await maybeMarkFacetBackfillRunSucceeded(input.job);

  return {
    jobId: input.job.id,
    status: "succeeded" as const,
    type: input.job.type,
  };
}

type SyncBayPricingBaselineSnapshot = {
  capturedAt: Date;
  ebayItemId: string | null;
  payload: Prisma.JsonValue | null;
  priceAmount: Prisma.Decimal | null;
  source: ProductSnapshotSource;
};

type SyncBayFacetSyncResult = Awaited<ReturnType<typeof syncShopifyProductFacets>>;

function buildProductFacetBaselineSnapshotPayload(input: {
  facetSync: SyncBayFacetSyncResult;
  jobId: string;
}) {
  return {
    facetOnly: true,
    facetSync: {
      conflictKeys: input.facetSync.conflicts.map((facet) => facet.key),
      deletedKeys: input.facetSync.deleted.map((facet) => facet.key),
      skippedKeys: input.facetSync.skipped.map((facet) => facet.key),
      status: input.facetSync.status,
      writtenKeys: input.facetSync.written.map((facet) => facet.key),
    },
    productFacets: input.facetSync.baselineFacets.map(serializeProductFacet),
    syncJobId: input.jobId,
  } satisfies Prisma.JsonObject;
}

function buildFacetOnlyWarnings(input: {
  skipped: Prisma.JsonObject[];
  synced: Prisma.JsonObject[];
}) {
  const warnings: string[] = [];
  const conflictCount = input.synced.reduce(
    (total, row) => total + (getJsonNumber(row.conflictCount) ?? 0),
    0,
  );

  if (input.skipped.length > 0) {
    warnings.push(`Backfill faccette completato con ${input.skipped.length} prodotti saltati.`);
  }

  if (conflictCount > 0) {
    warnings.push(
      `Faccette Shopify non sovrascritte su ${conflictCount} campi modificati manualmente.`,
    );
  }

  return warnings;
}

function buildLatestSyncBayPricingBaselinesByItemId(snapshots: SyncBayPricingBaselineSnapshot[]) {
  const baselines = new Map<string, SyncBayPricingWriteBaseline>();
  const sortedSnapshots = [...snapshots].sort(
    (left, right) => right.capturedAt.getTime() - left.capturedAt.getTime(),
  );

  for (const snapshot of sortedSnapshots) {
    if (
      snapshot.source !== ProductSnapshotSource.SYNCBAY ||
      !snapshot.ebayItemId ||
      baselines.has(snapshot.ebayItemId)
    ) {
      continue;
    }

    const priceAmount =
      getPricingPayloadMoneyAmount(snapshot.payload, "priceAmount") ??
      getSnapshotPriceAmountForPricingWriteBaseline(snapshot);

    if (priceAmount === null) continue;

    baselines.set(snapshot.ebayItemId, {
      compareAtPriceAmount: getPricingPayloadMoneyAmount(snapshot.payload, "compareAtPriceAmount"),
      priceAmount,
    });
  }

  return baselines;
}

function getSnapshotPriceAmountForPricingWriteBaseline(snapshot: SyncBayPricingBaselineSnapshot) {
  if (snapshot.priceAmount === null) return null;

  const priceAmount = Number(snapshot.priceAmount);

  return Number.isFinite(priceAmount) ? priceAmount.toFixed(2) : null;
}

export async function updateShopifyVariantPricingOnly(
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  },
  input: {
    compareAtPrice: string | null;
    price: string;
    productGid: string;
    variantGid: string;
  },
): Promise<
  | {
      compareAtPrice: string | null;
      price: string | null;
      status: "synced";
    }
  | {
      errorMessage: string;
      status: "failed";
    }
> {
  const response = await admin.graphql(
    `#graphql
    mutation SyncBayUpdateVariantPricingOnly($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants {
          id
          price
          compareAtPrice
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        productId: input.productGid,
        variants: [
          {
            compareAtPrice: input.compareAtPrice,
            id: input.variantGid,
            price: input.price,
          },
        ],
      },
    },
  );
  const json = (await response.json()) as ShopifyPricingVariantUpdateResponse;

  if (!response.ok) {
    return {
      errorMessage: `Shopify productVariantsBulkUpdate ha risposto con stato HTTP ${response.status}.`,
      status: "failed",
    };
  }

  if (json.errors?.length) {
    return {
      errorMessage: formatShopifyGraphqlErrors(json.errors),
      status: "failed",
    };
  }

  const userErrors = json.data?.productVariantsBulkUpdate?.userErrors ?? [];

  if (userErrors.length > 0) {
    return {
      errorMessage: formatShopifyUserErrors(userErrors),
      status: "failed",
    };
  }

  const updatedVariant = json.data?.productVariantsBulkUpdate?.productVariants?.[0] ?? null;

  if (!updatedVariant) {
    return {
      errorMessage: "Shopify non ha restituito la variante aggiornata.",
      status: "failed",
    };
  }

  return {
    compareAtPrice: updatedVariant.compareAtPrice ?? null,
    price: updatedVariant.price ?? null,
    status: "synced",
  };
}

type LatestSyncBayProductSnapshotForDedupe = {
  currency: string | null;
  descriptionHash: string | null;
  ebayItemId: string | null;
  imageCount: number | null;
  mappingId: string | null;
  payload: Prisma.JsonValue | null;
  priceAmount: Prisma.Decimal | null;
  productStatus: string | null;
  quantity: number | null;
  shopifyProductGid: string | null;
  shopifyVariantGid: string | null;
  sku: string | null;
  source: ProductSnapshotSource;
  title: string | null;
};

async function filterChangedSyncBayProductSnapshots(
  snapshots: Prisma.ProductSnapshotCreateManyInput[],
) {
  const mappingIds = [
    ...new Set(
      snapshots
        .map((snapshot) => snapshot.mappingId)
        .filter((mappingId): mappingId is string => Boolean(mappingId)),
    ),
  ];

  if (mappingIds.length === 0) return snapshots;

  const previousSnapshots = await prisma.$queryRaw<LatestSyncBayProductSnapshotForDedupe[]>`
      SELECT DISTINCT ON ("mappingId")
        "currency",
        "descriptionHash",
        "ebayItemId",
        "imageCount",
        "mappingId",
        "payload",
        "priceAmount",
        "productStatus",
        "quantity",
        "shopifyProductGid",
        "shopifyVariantGid",
        "sku",
        "source",
        "title"
      FROM "ProductSnapshot"
      WHERE
        "mappingId" IN (${Prisma.join(mappingIds)})
        AND "source" = 'SYNCBAY'::"ProductSnapshotSource"
      ORDER BY "mappingId", "capturedAt" DESC
    `;
  const previousSnapshotByMappingId = new Map(
    previousSnapshots.flatMap((snapshot) =>
      snapshot.mappingId ? [[snapshot.mappingId, snapshot]] : [],
    ),
  );

  return snapshots.filter((snapshot) =>
    shouldCreateProductSnapshot({
      next: snapshot,
      previous: snapshot.mappingId ? previousSnapshotByMappingId.get(snapshot.mappingId) : null,
    }),
  );
}

// Job storicamente chiamato ARCHIVE_INACTIVE_LISTING: il listing eBay inattivo
// non viene più archiviato ma mantenuto su Shopify come esaurito (scorta 0,
// politica DENY, tag esaurito, mapping OUT_OF_STOCK). Vedi ADR 0011.
export async function runMarkInactiveListingSoldOutJob(job: DueSyncJob) {
  const ebayItemId = getArchiveEbayItemId(job.payload);

  if (!ebayItemId) {
    throw new Error("Job esaurito listing inattivo senza eBay ItemID.");
  }

  const marketplaceId = getEbayMarketplaceId(job.payload);
  const mapping = await prisma.productMapping.findFirst({
    where: {
      ebayItemId,
      marketplaceId,
      shopId: job.shopId,
      status: ProductMappingStatus.ACTIVE,
    },
  });

  if (!mapping) {
    await markJobSucceeded({
      job,
      result: {
        ebayItemId,
        skippedReason: "active_mapping_not_found",
        soldOutCount: 0,
      },
      warnings: ["Esaurito saltato: mapping attivo non trovato."],
    });
    await maybeMarkSellerEventsRunWatermarkSucceeded(job);
    await maybeMarkCatalogReconcileRunWatermarkSucceeded(job);

    return {
      jobId: job.id,
      status: "succeeded" as const,
      type: job.type,
    };
  }

  const soldOutWarnings: string[] = [];
  const interruptedJob = await getInterruptedRunningSyncJobResult(job);
  if (interruptedJob) return interruptedJob;

  if (mapping.shopifyProductGid) {
    const admin = await getShopifyAdminGraphqlClient(job.shop.shopDomain);
    const soldOutResult = await markShopifyProductSoldOut(admin, {
      jobId: job.id,
      locationGid: job.shop.defaultLocationGid,
      productGid: mapping.shopifyProductGid,
      variantGid: mapping.shopifyVariantGid,
    });
    soldOutWarnings.push(...soldOutResult.warnings);
  }

  const now = new Date();

  const soldOutSnapshot = {
    ebayItemId: mapping.ebayItemId,
    mappingId: mapping.id,
    payload: {
      reason: "ebay_listing_inactive",
      soldOutShopifyProduct: Boolean(mapping.shopifyProductGid),
      syncJobId: job.id,
    } satisfies Prisma.JsonObject,
    // Il prodotto Shopify resta ACTIVE: è solo esaurito (scorta 0).
    productStatus: "ACTIVE",
    quantity: 0,
    shopId: job.shopId,
    shopifyProductGid: mapping.shopifyProductGid,
    shopifyVariantGid: mapping.shopifyVariantGid,
    sku: mapping.sku,
    source: ProductSnapshotSource.SYNCBAY,
  } satisfies Prisma.ProductSnapshotCreateManyInput;
  const changedSoldOutSnapshots = await filterChangedSyncBayProductSnapshots([soldOutSnapshot]);
  const resolvedConflicts = await prisma.$transaction(async (tx) => {
    await tx.productMapping.update({
      data: {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncedAt: now,
        status: ProductMappingStatus.OUT_OF_STOCK,
      },
      where: { id: mapping.id },
    });
    if (changedSoldOutSnapshots.length > 0) {
      await recordProductSnapshotsInTransaction(tx, [soldOutSnapshot]);
    }
    return tx.syncConflict.updateMany({
      data: {
        resolvedAt: now,
        status: SyncConflictStatus.RESOLVED,
      },
      where: {
        mappingId: mapping.id,
        shopId: job.shopId,
        status: SyncConflictStatus.OPEN,
      },
    });
  });

  await markJobSucceeded({
    job,
    result: {
      ebayItemId,
      resolvedConflictCount: resolvedConflicts.count,
      shopifyProductGid: mapping.shopifyProductGid,
      soldOutCount: 1,
      soldOutShopifyProduct: Boolean(mapping.shopifyProductGid),
    },
    warnings: mapping.shopifyProductGid
      ? soldOutWarnings
      : ["Mapping messo in esaurito senza prodotto Shopify collegato."],
  });
  await maybeMarkSellerEventsRunWatermarkSucceeded(job);
  await maybeMarkCatalogReconcileRunWatermarkSucceeded(job);

  return {
    jobId: job.id,
    status: "succeeded" as const,
    type: job.type,
  };
}

async function maybeMarkSellerEventsRunWatermarkSucceeded(job: DueSyncJob) {
  const source = getStringFromPayload(job.payload, "source");
  const runId = getStringFromPayload(job.payload, "runId");
  const marketplaceId = getEbayMarketplaceId(job.payload);
  const modTimeFrom = getStringFromPayload(job.payload, "modTimeFrom");
  const modTimeTo = getStringFromPayload(job.payload, "modTimeTo");

  if (source !== "seller_events_delta" || !runId || !modTimeTo) return;

  const runJobs = await prisma.syncJob.findMany({
    select: { status: true },
    where: {
      AND: [
        { payload: { path: ["source"], equals: "seller_events_delta" } },
        { payload: { path: ["runId"], equals: runId } },
      ],
      shopId: job.shopId,
      type: {
        in: [SyncJobType.SYNC_INCREMENTAL, SyncJobType.ARCHIVE_INACTIVE_LISTING],
      },
    },
  });

  if (
    !shouldAdvanceSellerEventsRunWatermark({
      statuses: runJobs.map((runJob) => runJob.status),
    })
  ) {
    return;
  }

  const finishedAt = new Date();
  const processedJobCount = runJobs.length;

  await prisma.syncJob.createMany({
    data: [
      {
        attempts: 1,
        finishedAt,
        idempotencyKey: `seller-events-watermark:${job.shopId}:${marketplaceId}:${runId}`,
        maxAttempts: 1,
        payload: {
          marketplaceId,
          modTimeFrom,
          modTimeTo,
          processedJobCount,
          runId,
          source: "seller_events_delta",
          watermarkAdvanced: true,
        } satisfies Prisma.JsonObject,
        result: {
          processedJobCount,
          source: "seller_events_delta",
          watermarkAdvanced: true,
        } satisfies Prisma.JsonObject,
        runAfter: finishedAt,
        shopId: job.shopId,
        status: SyncJobStatus.SUCCEEDED,
        type: SyncJobType.SYNC_INCREMENTAL,
      },
    ],
    skipDuplicates: true,
  });
}

async function maybeMarkCatalogReconcileRunWatermarkSucceeded(job: DueSyncJob) {
  const source = getStringFromPayload(job.payload, "source");
  const runId = getStringFromPayload(job.payload, "runId");
  const marketplaceId = getEbayMarketplaceId(job.payload);

  if (source !== "catalog_reconcile" || !runId) return;

  const runJobs = await prisma.syncJob.findMany({
    select: { status: true },
    where: {
      AND: [
        { payload: { path: ["source"], equals: "catalog_reconcile" } },
        { payload: { path: ["runId"], equals: runId } },
      ],
      shopId: job.shopId,
      type: {
        in: [SyncJobType.SYNC_INCREMENTAL, SyncJobType.ARCHIVE_INACTIVE_LISTING],
      },
    },
  });

  if (
    !shouldAdvanceCatalogReconcileRunWatermark({
      statuses: runJobs.map((runJob) => runJob.status),
    })
  ) {
    return;
  }

  const payloadObject = getJsonObject(job.payload);
  const finishedAt = new Date();
  const processedJobCount = runJobs.length;
  const activeCatalogReadAt = getStringFromPayload(job.payload, "activeCatalogReadAt");
  const activeCatalogReadCount = getJsonNumber(payloadObject?.activeCatalogReadCount);
  const activeCatalogTotalAvailable =
    getJsonNumber(payloadObject?.activeCatalogTotalAvailable) ?? null;
  const activeScanComplete = getBooleanFromPayload(job.payload, "activeScanComplete");
  const markerPayload = {
    activeCatalogReadAt,
    activeCatalogReadCount,
    activeCatalogTotalAvailable,
    activeScanComplete,
    marketplaceId,
    processedJobCount,
    runId,
    source: "catalog_reconcile",
    watermarkAdvanced: true,
  } satisfies Prisma.JsonObject;

  await prisma.syncJob.createMany({
    data: [
      {
        attempts: 1,
        finishedAt,
        idempotencyKey: `catalog-reconcile-watermark:${job.shopId}:${marketplaceId}:${runId}`,
        maxAttempts: 1,
        payload: markerPayload,
        result: markerPayload,
        runAfter: finishedAt,
        shopId: job.shopId,
        status: SyncJobStatus.SUCCEEDED,
        type: SyncJobType.SYNC_INCREMENTAL,
      },
    ],
    skipDuplicates: true,
  });
}

async function maybeMarkFacetBackfillRunSucceeded(job: DueSyncJob) {
  const source = getStringFromPayload(job.payload, "source");
  const runId = getStringFromPayload(job.payload, "facetBackfillRunId");
  const marketplaceId = getEbayMarketplaceId(job.payload);
  const payloadObject = getJsonObject(job.payload);
  const version = getJsonNumber(payloadObject?.facetBackfillVersion);
  const expectedBatchCount = getJsonNumber(payloadObject?.batchCount);

  if (source !== "facet_backfill" || !runId || version === null || expectedBatchCount === null) {
    return;
  }

  const runJobs = await prisma.syncJob.findMany({
    select: { status: true },
    where: {
      AND: [
        { payload: { path: ["source"], equals: "facet_backfill" } },
        { payload: { path: ["facetBackfillRunId"], equals: runId } },
      ],
      shopId: job.shopId,
      type: SyncJobType.SYNC_INCREMENTAL,
    },
  });

  if (
    runJobs.length < expectedBatchCount ||
    runJobs.some((runJob) => runJob.status !== SyncJobStatus.SUCCEEDED)
  ) {
    return;
  }

  const finishedAt = new Date();
  const markerPayload = {
    facetBackfillRunId: runId,
    facetBackfillVersion: version,
    marketplaceId,
    processedJobCount: runJobs.length,
    source: "facet_backfill_marker",
  } satisfies Prisma.JsonObject;

  await prisma.syncJob.createMany({
    data: [
      {
        attempts: 1,
        finishedAt,
        idempotencyKey: `facet-backfill-marker:${job.shopId}:${marketplaceId}:v${version}:${runId}`,
        maxAttempts: 1,
        payload: markerPayload,
        result: markerPayload,
        runAfter: finishedAt,
        shopId: job.shopId,
        status: SyncJobStatus.SUCCEEDED,
        type: SyncJobType.SYNC_INCREMENTAL,
      },
    ],
    skipDuplicates: true,
  });
}

function getPricingPayloadMoneyAmount(
  payload: Prisma.JsonValue | null | undefined,
  key: "compareAtPriceAmount" | "priceAmount",
) {
  const object = getJsonObject(payload);
  const pricing = getJsonObject(object?.pricing);
  const value = pricing?.[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toFixed(2);
  }

  if (typeof value === "string" && value.trim()) {
    const number = Number(value);

    return Number.isFinite(number) ? number.toFixed(2) : value.trim();
  }

  return null;
}

async function getIncrementalPreviewResult(job: DueSyncJob, ebayItemIds: string[]) {
  const payloadCandidates = getPreviewCandidates(job.payload);

  if (payloadCandidates.length > 0) {
    return buildImportPreview(payloadCandidates, "live");
  }

  const connection = await getConnectedEbayConnection(job);

  return getImportPreviewResultByItemIds(connection, ebayItemIds);
}

function getPreviewCandidates(payload: Prisma.JsonValue | null) {
  const object = getJsonObject(payload);
  const candidates = object?.previewCandidates;

  return Array.isArray(candidates)
    ? candidates.flatMap((candidate) => {
        const normalized = getPreviewCandidate(candidate);
        return normalized ? [normalized] : [];
      })
    : [];
}

function getPreviewCandidate(value: unknown): ImportPreviewListingCandidate | null {
  return deserializeIncrementalPreviewCandidate(value);
}

function getArchiveEbayItemId(payload: Prisma.JsonValue | null) {
  const ebayItemId = getStringFromPayload(payload, "ebayItemId");

  if (ebayItemId?.trim()) return ebayItemId.trim();

  return getEbayItemIds(payload)[0] ?? null;
}

function isFacetOnlySyncJobPayload(payload: Prisma.JsonValue | null) {
  const source = getStringFromPayload(payload, "source");

  return getBooleanFromPayload(payload, "facetOnly") || source === "facet_backfill";
}

async function resolveLiveAlignedDescriptionConflicts(input: {
  conflicts: {
    field: string;
    id: string;
    mappingId: string | null;
    mapping: {
      shopifyProductGid: string | null;
      status: ProductMappingStatus;
    } | null;
  }[];
  defaultLocationGid: string | null;
  shopId: string;
  shopDomain: string;
}) {
  const candidates = input.conflicts.filter(
    (conflict) =>
      conflict.field === "description" &&
      conflict.mappingId &&
      conflict.mapping?.shopifyProductGid &&
      shouldResolveLiveAlignedDescriptionConflictForMappingStatus(conflict.mapping?.status ?? null),
  );
  const mappingIds = [...new Set(candidates.flatMap((conflict) => conflict.mappingId ?? []))];

  if (mappingIds.length === 0) {
    return { conflictIds: [], count: 0 };
  }

  const latestDescriptionSnapshots = await prisma.$queryRaw<
    { descriptionHash: string | null; mappingId: string | null }[]
  >`
    SELECT DISTINCT ON ("mappingId") "descriptionHash", "mappingId"
    FROM "ProductSnapshot"
    WHERE
      "mappingId" IN (${Prisma.join(mappingIds)})
      AND "shopId" = ${input.shopId}
      AND "source" = 'SYNCBAY'::"ProductSnapshotSource"
      AND "descriptionHash" IS NOT NULL
      AND ${SYNCBAY_DESCRIPTION_BASELINE_PAYLOAD_SQL}
    ORDER BY "mappingId", "capturedAt" DESC
  `;
  const latestDescriptionHashByMappingId = new Map<string, string>();

  for (const snapshot of latestDescriptionSnapshots) {
    if (
      snapshot.mappingId &&
      snapshot.descriptionHash &&
      !latestDescriptionHashByMappingId.has(snapshot.mappingId)
    ) {
      latestDescriptionHashByMappingId.set(snapshot.mappingId, snapshot.descriptionHash);
    }
  }

  const admin = await getShopifyAdminGraphqlClient(input.shopDomain);
  const conflictIds: string[] = [];

  for (const conflict of candidates) {
    const latestSyncBayDescriptionHash = conflict.mappingId
      ? (latestDescriptionHashByMappingId.get(conflict.mappingId) ?? null)
      : null;
    const shopifyProductGid = conflict.mapping?.shopifyProductGid ?? null;

    if (!latestSyncBayDescriptionHash || !shopifyProductGid) {
      continue;
    }

    // react-doctor-disable-next-line react-doctor/async-await-in-loop -- lettura Shopify live per-conflitto rate-limited: in serie per rispettare i limiti del provider.
    const product = await getShopifyProductForConflict(
      admin,
      shopifyProductGid,
      input.defaultLocationGid,
    );
    const currentShopifyDescriptionHash = product
      ? hashNullableText(product.descriptionHtml ?? null)
      : null;

    if (
      isLiveDescriptionConflictAligned({
        currentShopifyDescriptionHash,
        field: conflict.field,
        latestSyncBayDescriptionHash,
      })
    ) {
      conflictIds.push(conflict.id);
    }
  }

  if (conflictIds.length === 0) {
    return { conflictIds: [], count: 0 };
  }

  const result = await prisma.syncConflict.updateMany({
    data: {
      resolvedAt: new Date(),
      status: SyncConflictStatus.RESOLVED,
    },
    where: {
      id: { in: conflictIds },
      shopId: input.shopId,
      status: SyncConflictStatus.OPEN,
    },
  });

  return { conflictIds, count: result.count };
}

async function resolveLiveAlignedPriceConflicts(input: {
  conflicts: {
    field: string;
    id: string;
    lastSyncBayValue: Prisma.JsonValue | null;
    mappingId: string | null;
    mapping: {
      ebayItemId: string;
      id: string;
      shopifyProductGid: string | null;
      shopifyVariantGid: string | null;
      sku: string | null;
      status: ProductMappingStatus;
    } | null;
    shopifyValue: Prisma.JsonValue | null;
  }[];
  defaultLocationGid: string | null;
  job: DueSyncJob;
  shopDomain: string;
}) {
  const candidates = input.conflicts.filter(
    (conflict) =>
      conflict.field === "price" &&
      conflict.mappingId &&
      conflict.mapping?.ebayItemId &&
      conflict.mapping?.shopifyProductGid &&
      shouldResolveLiveAlignedPriceConflictForMappingStatus(conflict.mapping?.status ?? null),
  );
  const itemIds = [
    ...new Set(candidates.flatMap((conflict) => conflict.mapping?.ebayItemId ?? [])),
  ];
  const mappingIds = [...new Set(candidates.flatMap((conflict) => conflict.mappingId ?? []))];

  if (itemIds.length === 0 || mappingIds.length === 0) {
    return { conflictIds: [], count: 0 };
  }

  const [admin, previewResult, pricingRule, latestSyncBaySnapshots] = await Promise.all([
    getShopifyAdminGraphqlClient(input.shopDomain),
    getIncrementalPreviewResult(input.job, itemIds),
    getPricingRuleForShopId(input.job.shopId),
    prisma.productSnapshot.findMany({
      orderBy: { capturedAt: "desc" },
      select: {
        currency: true,
        descriptionHash: true,
        ebayItemId: true,
        imageCount: true,
        mappingId: true,
        payload: true,
        priceAmount: true,
        productStatus: true,
        quantity: true,
        shopId: true,
        shopifyProductGid: true,
        shopifyVariantGid: true,
        sku: true,
        title: true,
      },
      where: {
        mappingId: { in: mappingIds },
        shopId: input.job.shopId,
        source: ProductSnapshotSource.SYNCBAY,
      },
    }),
  ]);
  const previewItemsById = new Map(
    filterPreviewResultByItemIds(previewResult, itemIds).items.map((item) => [item.itemId, item]),
  );
  const latestSnapshotByMappingId = new Map<string, (typeof latestSyncBaySnapshots)[number]>();

  for (const snapshot of latestSyncBaySnapshots) {
    if (snapshot.mappingId && !latestSnapshotByMappingId.has(snapshot.mappingId)) {
      latestSnapshotByMappingId.set(snapshot.mappingId, snapshot);
    }
  }

  const conflictIds: string[] = [];
  const syncBaySnapshots: Prisma.ProductSnapshotCreateManyInput[] = [];
  const now = new Date();

  for (const conflict of candidates) {
    const mapping = conflict.mapping;
    const mappingId = conflict.mappingId;
    const item = mapping?.ebayItemId ? previewItemsById.get(mapping.ebayItemId) : null;
    const latestSnapshot = mappingId ? latestSnapshotByMappingId.get(mappingId) : null;

    if (!mapping || !mappingId || !item || !latestSnapshot || !mapping.shopifyProductGid) {
      continue;
    }

    // Lettura Shopify live per-conflitto, come resolveLiveAlignedDescriptionConflicts:
    // limitata ai soli conflitti prezzo aperti su mapping ACTIVE (volume basso, nessuna
    // write provider). Quando il mapping conserva una variante Shopify specifica,
    // valida quella invece della prima variante del prodotto.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop -- lettura Shopify live per-conflitto rate-limited: in serie per rispettare i limiti del provider.
    const product = await getShopifyProductForConflict(
      admin,
      mapping.shopifyProductGid,
      input.defaultLocationGid,
      {
        preferredVariantGid: mapping.shopifyVariantGid ?? latestSnapshot.shopifyVariantGid,
      },
    );
    const variant = selectShopifyVariantForSync({
      preferredVariantGid: mapping.shopifyVariantGid ?? latestSnapshot.shopifyVariantGid,
      variants: product?.variants?.nodes,
    });
    const repair = getAlignedPriceConflictRepair({
      ebayPriceAmount: item.normalized.priceAmount,
      field: conflict.field,
      latestSyncBayValue: conflict.lastSyncBayValue,
      pricingRule,
      shopifyValue: buildPriceConflictValue({
        compareAtPrice: variant?.compareAtPrice ?? null,
        price: variant?.price ?? null,
      }),
    });

    if (!repair) {
      continue;
    }

    const latestPayload = getJsonObject(latestSnapshot.payload) ?? {};
    const pricingPayload = getJsonObject(latestPayload.pricing) ?? {};

    conflictIds.push(conflict.id);
    syncBaySnapshots.push({
      currency: item.normalized.currency ?? latestSnapshot.currency,
      descriptionHash: latestSnapshot.descriptionHash,
      ebayItemId: latestSnapshot.ebayItemId ?? item.itemId,
      imageCount: latestSnapshot.imageCount,
      mappingId,
      payload: {
        ...latestPayload,
        conflictResolution: {
          conflictId: conflict.id,
          field: conflict.field,
          resolution: SyncConflictResolution.KEEP_SHOPIFY,
          source: "live_aligned_price_conflict_repair",
          syncJobId: input.job.id,
        },
        priceConflictBaselineRepair: {
          conflictId: conflict.id,
          repairedAt: now.toISOString(),
          syncJobId: input.job.id,
        },
        pricing: {
          ...pricingPayload,
          applied: repair.applied,
          compareAtPriceAmount: repair.compareAtPriceAmount,
          discountPercent: repair.discountPercent,
          ebayPriceAmount: repair.ebayPriceAmount,
          priceAmount: repair.priceAmount,
          roundingMode: repair.roundingMode,
        },
      } satisfies Prisma.JsonObject,
      priceAmount: repair.priceAmount,
      productStatus: latestSnapshot.productStatus,
      quantity: latestSnapshot.quantity,
      shopId: input.job.shopId,
      shopifyProductGid: latestSnapshot.shopifyProductGid ?? mapping.shopifyProductGid,
      shopifyVariantGid: getPriceConflictRepairSnapshotVariantGid({
        latestSnapshotVariantGid: latestSnapshot.shopifyVariantGid,
        mappingVariantGid: mapping.shopifyVariantGid,
        selectedVariantGid: variant?.id,
      }),
      sku: latestSnapshot.sku ?? mapping.sku,
      source: ProductSnapshotSource.SYNCBAY,
      title: latestSnapshot.title,
    });
  }

  if (conflictIds.length === 0) {
    return { conflictIds: [], count: 0 };
  }

  const changedSyncBaySnapshots = await filterChangedSyncBayProductSnapshots(syncBaySnapshots);
  const resolvedMappingIds = [
    ...new Set(
      syncBaySnapshots
        .map((snapshot) => snapshot.mappingId)
        .filter((mappingId): mappingId is string => Boolean(mappingId)),
    ),
  ];

  const result = await prisma.$transaction(async (tx) => {
    const updatedConflicts = await tx.syncConflict.updateMany({
      data: {
        resolution: SyncConflictResolution.KEEP_SHOPIFY,
        resolvedAt: now,
        status: SyncConflictStatus.RESOLVED,
      },
      where: {
        id: { in: conflictIds },
        shopId: input.job.shopId,
        status: SyncConflictStatus.OPEN,
      },
    });
    const finalizedConflictIds = getFinalizedPriceConflictRepairIds({
      conflictIds,
      updatedCount: updatedConflicts.count,
    });

    if (finalizedConflictIds.length !== conflictIds.length) {
      throw new Error(
        "Price conflict repair skipped baseline snapshot because not all conflicts were updated.",
      );
    }

    if (changedSyncBaySnapshots.length > 0) {
      await recordProductSnapshotsInTransaction(tx, changedSyncBaySnapshots);
    }

    await tx.productMapping.updateMany({
      data: { lastSyncedAt: now },
      where: { id: { in: resolvedMappingIds } },
    });
    await tx.auditLog.create({
      select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
      data: {
        details: {
          conflictIds: finalizedConflictIds,
          source: "live_aligned_price_conflict_repair",
          syncJobId: input.job.id,
        },
        message: "Conflitti prezzo Shopify allineati risolti dal runner.",
        shopId: input.job.shopId,
        type: AuditEventType.CONNECTION_CHECK,
      },
    });

    return updatedConflicts;
  });

  return { conflictIds, count: result.count };
}

function getNullableStringFromRecord(value: Record<string, Prisma.JsonValue> | null, key: string) {
  const entry = value?.[key];

  return typeof entry === "string" && entry.trim() ? entry.trim() : null;
}

function formatShopifyPrice(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value.toFixed(2);
}

function formatShopifyGraphqlErrors(errors: Array<{ message: string }>) {
  return errors.map((error) => error.message).join("; ");
}

function formatShopifyUserErrors(errors: ShopifyUserError[]) {
  return errors
    .map((error) =>
      error.field?.length ? `${error.field.join(".")}: ${error.message}` : error.message,
    )
    .join("; ");
}
