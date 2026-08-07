import { Prisma, ProductMappingStatus, ProductSnapshotSource } from "@prisma/client";
import prisma from "../db.server";
import {
  normalizeImportProductStatus,
  type ImportProductStatus,
} from "../lib/import-product-status";
import { getSyncBayDescriptionHash, hashNullableText } from "../lib/syncbay-description-hash";
import { getPersistableInventoryItemGid } from "../lib/syncbay-inventory-mapping";
import { type SyncBayProductFacet } from "../lib/syncbay-product-facets";
import { shouldCreateProductSnapshot } from "../lib/syncbay-product-snapshot-dedupe";
import {
  buildEbayProductSnapshotPayload,
  getProductSnapshotThumbnailUrl,
  serializeProductFacet,
} from "../lib/syncbay-product-snapshot-payload";
import { getEbayMarketplaceId } from "./ebay-environment.server";
import type { ImportPreviewItem } from "./import-preview.server";
import { recordProductSnapshotsInTransaction } from "./product-history.server";

import {
  ShopifyDraftProductInput,
  ShopifyDraftProductResult,
  ShopifyInventorySyncResult,
  ShopifyMediaSyncResult,
  ShopifyProductFacetSyncResult,
  getFirstProductVariant,
} from "./shopify-import-shared.server";

type DraftImportPersistenceResult = {
  createdCount: number;
  inventoryFailedCount: number;
  inventorySkippedCount: number;
  inventorySyncedCount: number;
  mediaDeletedCount: number;
  mediaFailedCount: number;
  mediaImageCreatedCount: number;
  mediaStagedCount: number;
  mediaSyncedCount: number;
  managedCount: number;
  publicationPublishedCount: number;
  publicationSkippedCount: number;
  publicationSyncedCount: number;
  reusedCount: number;
};

export async function recordDraftImportPersistence(input: {
  jobId: string;
  products: ShopifyDraftProductInput[];
  results: ShopifyDraftProductResult[];
  shopId: string;
}): Promise<DraftImportPersistenceResult> {
  const successfulPairs = input.results.flatMap((result, index) =>
    result.status === "created"
      ? [
          {
            draftProduct: input.products[index],
            result,
          },
        ]
      : [],
  );

  await prisma.$transaction(async (tx) => {
    await Promise.all(
      successfulPairs.map(async (pair) => {
        const now = new Date();
        const variantGid = getFirstProductVariant(pair.result.product)?.id ?? null;
        const inventoryItemGid = getPersistableInventoryItemGid(pair.result.inventorySync);
        const ebaySnapshot = buildEbayProductSnapshot({
          draftProduct: pair.draftProduct,
          mappingId: "",
          shopId: input.shopId,
        });
        const facetBaseline =
          shouldPersistProductFacetBaseline(pair.result.facetSync) && pair.result.facetSync
            ? pair.result.facetSync.baselineFacets
            : undefined;
        const thumbnailUrl = getProductSnapshotThumbnailUrl(ebaySnapshot.payload);
        const mapping = await tx.productMapping.upsert({
          where: {
            shopId_marketplaceId_ebayItemId: {
              ebayItemId: pair.draftProduct.source.ebayItemId,
              marketplaceId: getEbayMarketplaceId(),
              shopId: input.shopId,
            },
          },
          create: {
            ebayItemId: pair.draftProduct.source.ebayItemId,
            lastSyncedAt: now,
            marketplaceId: getEbayMarketplaceId(),
            shopId: input.shopId,
            shopifyProductGid: pair.result.product.id,
            shopifyInventoryItemGid: inventoryItemGid,
            shopifyVariantGid: variantGid,
            sku: pair.draftProduct.previewItem.normalized.sku,
            status: ProductMappingStatus.ACTIVE,
            thumbnailUrl,
          },
          update: {
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSyncedAt: now,
            shopifyProductGid: pair.result.product.id,
            ...(inventoryItemGid ? { shopifyInventoryItemGid: inventoryItemGid } : {}),
            shopifyVariantGid: variantGid,
            sku: pair.draftProduct.previewItem.normalized.sku,
            status: ProductMappingStatus.ACTIVE,
            ...(thumbnailUrl ? { thumbnailUrl } : {}),
          },
        });

        await recordProductSnapshotsInTransaction(tx, [
          { ...ebaySnapshot, mappingId: mapping.id },
          buildSyncBayProductSnapshot({
            draftProduct: pair.draftProduct,
            importProductStatus: normalizeImportProductStatus(pair.draftProduct.product.status),
            jobId: input.jobId,
            mappingId: mapping.id,
            productFacets: facetBaseline,
            result: pair.result,
            shopId: input.shopId,
          }),
        ]);
      }),
    );
  });

  return {
    createdCount: successfulPairs.filter((pair) => pair.result.resultType === "created").length,
    inventoryFailedCount: successfulPairs.filter(
      (pair) => pair.result.inventorySync.status === "failed",
    ).length,
    inventorySkippedCount: successfulPairs.filter(
      (pair) => pair.result.inventorySync.status === "skipped",
    ).length,
    inventorySyncedCount: successfulPairs.filter(
      (pair) => pair.result.inventorySync.status === "synced",
    ).length,
    mediaDeletedCount: successfulPairs.reduce(
      (total, pair) => total + pair.result.mediaSync.deletedCount,
      0,
    ),
    mediaFailedCount: successfulPairs.filter((pair) => pair.result.mediaSync.status === "failed")
      .length,
    mediaImageCreatedCount: successfulPairs.reduce(
      (total, pair) => total + pair.result.mediaSync.createdCount,
      0,
    ),
    mediaStagedCount: successfulPairs.reduce(
      (total, pair) => total + pair.result.mediaSync.stagedCreatedCount,
      0,
    ),
    mediaSyncedCount: successfulPairs.filter((pair) => pair.result.mediaSync.status === "synced")
      .length,
    managedCount: successfulPairs.length,
    publicationPublishedCount: successfulPairs.reduce(
      (total, pair) =>
        total +
        (pair.result.publicationSync.status === "synced"
          ? pair.result.publicationSync.publicationCount
          : 0),
      0,
    ),
    publicationSkippedCount: successfulPairs.filter(
      (pair) => pair.result.publicationSync.status === "skipped",
    ).length,
    publicationSyncedCount: successfulPairs.filter(
      (pair) => pair.result.publicationSync.status === "synced",
    ).length,
    reusedCount: successfulPairs.filter((pair) => pair.result.resultType === "reused").length,
  };
}

export function buildDraftImportSummary(input: {
  importProductStatus: ImportProductStatus;
  persistenceResult: DraftImportPersistenceResult;
  products: ShopifyDraftProductInput[];
  results: ShopifyDraftProductResult[];
  unchangedSkippedCount?: number;
}) {
  const failedResults = input.results.flatMap((result, index) =>
    result.status === "failed"
      ? [
          {
            ebayItemId: input.products[index]?.source.ebayItemId ?? null,
            errorMessage: result.errorMessage,
          },
        ]
      : [],
  );
  const inventoryFailedResults = getInventoryFailedResults({
    products: input.products,
    results: input.results,
  });
  const inventorySkippedResults = getInventorySkippedResults({
    products: input.products,
    results: input.results,
  });
  const mediaFailedResults = getMediaFailedResults({
    products: input.products,
    results: input.results,
  });
  return {
    createdCount: input.persistenceResult.createdCount,
    failedResults,
    inventoryFailedCount: input.persistenceResult.inventoryFailedCount,
    inventoryFailedResults,
    inventorySkippedCount: input.persistenceResult.inventorySkippedCount,
    inventorySkippedResults,
    inventorySyncedCount: input.persistenceResult.inventorySyncedCount,
    importProductStatus: input.importProductStatus,
    managedCount: input.persistenceResult.managedCount,
    mediaDeletedCount: input.persistenceResult.mediaDeletedCount,
    mediaFailedCount: input.persistenceResult.mediaFailedCount,
    mediaFailedResults,
    mediaImageCreatedCount: input.persistenceResult.mediaImageCreatedCount,
    mediaStagedCount: input.persistenceResult.mediaStagedCount,
    mediaSyncedCount: input.persistenceResult.mediaSyncedCount,
    publicationPublishedCount: input.persistenceResult.publicationPublishedCount,
    publicationSkippedCount: input.persistenceResult.publicationSkippedCount,
    publicationSyncedCount: input.persistenceResult.publicationSyncedCount,
    requestedCount: input.products.length + (input.unchangedSkippedCount ?? 0),
    reusedCount: input.persistenceResult.reusedCount,
    unchangedSkippedCount: input.unchangedSkippedCount ?? 0,
  } satisfies Record<string, unknown>;
}

// Contenuto eBay normalizzato identico all'ultimo snapshot EBAY registrato:
// la pipeline Shopify può essere saltata senza perdere alcuna modifica.
export function isDraftProductUnchangedSinceLastEbaySnapshot(input: {
  draftProduct: ShopifyDraftProductInput;
  previousEbaySnapshot: Parameters<typeof shouldCreateProductSnapshot>[0]["previous"];
  shopId: string;
}) {
  if (!input.previousEbaySnapshot) return false;

  return !shouldCreateProductSnapshot({
    next: buildEbayProductSnapshot({
      draftProduct: input.draftProduct,
      mappingId: "",
      shopId: input.shopId,
    }),
    previous: input.previousEbaySnapshot,
  });
}

export async function partitionUnchangedDraftProducts(input: {
  draftProducts: ShopifyDraftProductInput[];
  shopId: string;
}) {
  if (input.draftProducts.length === 0) {
    return { draftProducts: input.draftProducts, unchangedSkippedCount: 0 };
  }

  const mappings = await prisma.productMapping.findMany({
    select: {
      ebayItemId: true,
      id: true,
      snapshots: {
        orderBy: { capturedAt: "desc" },
        select: {
          currency: true,
          descriptionHash: true,
          ebayItemId: true,
          imageCount: true,
          payload: true,
          priceAmount: true,
          productStatus: true,
          quantity: true,
          shopifyProductGid: true,
          shopifyVariantGid: true,
          sku: true,
          source: true,
          title: true,
        },
        take: 1,
        where: { source: ProductSnapshotSource.EBAY },
      },
    },
    where: {
      ebayItemId: {
        in: input.draftProducts.map((draftProduct) => draftProduct.source.ebayItemId),
      },
      lastErrorCode: null,
      marketplaceId: getEbayMarketplaceId(),
      shopId: input.shopId,
      shopifyProductGid: { not: null },
      status: ProductMappingStatus.ACTIVE,
    },
  });
  const mappingsByItemId = new Map(mappings.map((mapping) => [mapping.ebayItemId, mapping]));
  const unchangedMappingIds: string[] = [];
  const changedDraftProducts = input.draftProducts.filter((draftProduct) => {
    const mapping = mappingsByItemId.get(draftProduct.source.ebayItemId);
    const unchanged =
      mapping !== undefined &&
      isDraftProductUnchangedSinceLastEbaySnapshot({
        draftProduct,
        previousEbaySnapshot: mapping.snapshots[0] ?? null,
        shopId: input.shopId,
      });

    if (unchanged) unchangedMappingIds.push(mapping.id);

    return !unchanged;
  });

  if (unchangedMappingIds.length > 0) {
    await prisma.productMapping.updateMany({
      data: { lastSyncedAt: new Date() },
      where: { id: { in: unchangedMappingIds }, shopId: input.shopId },
    });
  }

  return {
    draftProducts: changedDraftProducts,
    unchangedSkippedCount: unchangedMappingIds.length,
  };
}

function buildEbayProductSnapshot(input: {
  draftProduct: ShopifyDraftProductInput;
  mappingId: string;
  shopId: string;
}) {
  const item = input.draftProduct.previewItem;

  return {
    currency: item.normalized.currency,
    descriptionHash: hashNullableText(item.normalized.descriptionHtml),
    ebayItemId: item.itemId,
    imageCount: item.normalized.imageCount,
    mappingId: input.mappingId,
    payload: buildEbaySnapshotPayload(item),
    priceAmount: item.normalized.priceAmount,
    quantity: item.normalized.quantity,
    shopId: input.shopId,
    sku: item.normalized.sku,
    source: ProductSnapshotSource.EBAY,
    title: item.normalized.title,
  };
}

function shouldPersistProductFacetBaseline(facetSync: ShopifyProductFacetSyncResult | undefined) {
  return Boolean(facetSync && (facetSync.written.length > 0 || facetSync.deleted.length > 0));
}

function buildSyncBayProductSnapshot(input: {
  draftProduct: ShopifyDraftProductInput;
  importProductStatus: ImportProductStatus;
  jobId: string;
  mappingId: string;
  productFacets?: SyncBayProductFacet[];
  result: Extract<ShopifyDraftProductResult, { status: "created" }>;
  shopId: string;
}) {
  const item = input.draftProduct.previewItem;
  const variant = getFirstProductVariant(input.result.product);

  return {
    currency: item.normalized.currency,
    descriptionHash: getSyncBayDescriptionHash({
      fallbackDescriptionHtml: item.normalized.descriptionHtml,
      shopifyDescriptionHtml: input.result.product.descriptionHtml,
    }),
    ebayItemId: item.itemId,
    imageCount: input.result.mediaSync.createdCount + (input.result.mediaSync.preservedCount ?? 0),
    mappingId: input.mappingId,
    payload: {
      handle: input.draftProduct.product.handle,
      importJobId: input.jobId,
      inventorySync: input.result.inventorySync,
      mediaSync: input.result.mediaSync,
      pricing: {
        applied: input.draftProduct.pricing.applied,
        compareAtPriceAmount: input.draftProduct.pricing.compareAtPriceAmount,
        discountPercent: input.draftProduct.pricing.discountPercent,
        ebayPriceAmount: item.normalized.priceAmount,
        priceAmount: input.draftProduct.pricing.priceAmount,
        roundingMode: input.draftProduct.pricing.roundingMode,
      },
      publicationSync: input.result.publicationSync,
      resultType: input.result.resultType,
      tags: input.draftProduct.product.tags,
      ...(Object.hasOwn(input, "productFacets")
        ? {
            productFacets: (input.productFacets ?? []).map(serializeProductFacet),
          }
        : {}),
    } satisfies Prisma.JsonObject,
    priceAmount: input.draftProduct.pricing.priceAmount,
    productStatus: input.importProductStatus,
    quantity: item.normalized.quantity,
    shopId: input.shopId,
    shopifyProductGid: input.result.product.id,
    shopifyVariantGid: variant?.id ?? null,
    sku: item.normalized.sku,
    source: ProductSnapshotSource.SYNCBAY,
    title: input.result.product.title,
  };
}

function buildEbaySnapshotPayload(item: ImportPreviewItem) {
  return buildEbayProductSnapshotPayload({
    categoryProposal: item.normalized.categoryProposal,
    descriptionMode: item.normalized.descriptionMode,
    ebayPrimaryCategoryId: item.normalized.ebayPrimaryCategoryId,
    ebayPrimaryCategoryName: item.normalized.ebayPrimaryCategoryName,
    ebayPrimaryCategoryPath: item.normalized.ebayPrimaryCategoryPath,
    imageUrls: item.normalized.imageUrls,
    issueCodes: item.issues.map((issue) => issue.code),
    productFacets: item.normalized.productFacets,
    skuGenerated: item.normalized.skuGenerated,
    status: item.status,
    storeCategoryId: item.normalized.storeCategoryId,
    storeCategoryName: item.normalized.storeCategoryName,
  });
}

export function getInventoryFailedResults(input: {
  products: ShopifyDraftProductInput[];
  results: ShopifyDraftProductResult[];
}) {
  return input.results.flatMap((result, index) =>
    result.status === "created" && result.inventorySync.status === "failed"
      ? [
          {
            ebayItemId: input.products[index]?.source.ebayItemId ?? null,
            errorMessage: result.inventorySync.errorMessage,
            inventoryItemGid: result.inventorySync.inventoryItemGid ?? null,
            locationGid: result.inventorySync.locationGid ?? null,
            quantity: result.inventorySync.quantity ?? null,
            shopifyProductGid: result.product.id,
            shopifyVariantGid: result.inventorySync.variantGid ?? null,
          },
        ]
      : [],
  );
}

export function getInventorySkippedResults(input: {
  products: ShopifyDraftProductInput[];
  results: ShopifyDraftProductResult[];
}) {
  return input.results.flatMap((result, index) =>
    result.status === "created" && result.inventorySync.status === "skipped"
      ? [
          {
            ebayItemId: input.products[index]?.source.ebayItemId ?? null,
            message: result.inventorySync.message,
            reason: result.inventorySync.reason,
            shopifyProductGid: result.product.id,
            shopifyVariantGid: result.inventorySync.variantGid ?? null,
          },
        ]
      : [],
  );
}

export function getMediaFailedResults(input: {
  products: ShopifyDraftProductInput[];
  results: ShopifyDraftProductResult[];
}) {
  return input.results.flatMap((result, index) =>
    result.status === "created" && result.mediaSync.status === "failed"
      ? [
          {
            ebayItemId: input.products[index]?.source.ebayItemId ?? null,
            failedImages: result.mediaSync.failedResults,
            requestedCount: result.mediaSync.requestedCount,
            shopifyProductGid: result.product.id,
            stagedObjectPaths: result.mediaSync.stagedObjectPaths,
          },
        ]
      : [],
  );
}

export function getInventorySyncWarning(result: ShopifyInventorySyncResult) {
  if (result.status === "failed") {
    return `Tracking scorte Shopify non completato: ${result.errorMessage}`;
  }

  if (result.status === "skipped") {
    return `Tracking scorte Shopify saltato: ${result.message}`;
  }

  if (result.warning) {
    return `Tracking scorte Shopify con warning: ${result.warning}`;
  }

  return "";
}

export function getMediaSyncWarning(result: ShopifyMediaSyncResult) {
  return `Immagini Shopify non completate: ${result.failedResults
    .map((failure) => failure.errorMessage)
    .join("; ")}`;
}
