import prisma from "../db.server";
import {
  getImportedProductsLabel,
  normalizeImportProductStatus,
  type ImportProductStatus,
} from "../lib/import-product-status";
import { mapWithConcurrency } from "../lib/map-with-concurrency";
import {
  buildCatalogImportExecutionResult,
  type CatalogImportExecutionResult,
} from "../lib/syncbay-catalog-import-execution";
import { type ExistingCatalogFieldPolicy } from "../lib/syncbay-existing-catalog-field-policy";
import { type SyncBayProductFacet } from "../lib/syncbay-product-facets";
import type { ImportPreviewResult } from "./import-preview.server";
import { getPricingRuleForShopId } from "./pricing-rules.server";

import {
  buildDraftImportSummary,
  getInventoryFailedResults,
  getMediaFailedResults,
  partitionUnchangedDraftProducts,
  recordDraftImportPersistence,
} from "./shopify-import-persistence.server";
import {
  buildShopifyDraftProductInputs,
  createShopifyDraftProductSafely,
  resolveDraftImportPublicationOptions,
} from "./shopify-import-products.server";
import {
  getDraftImportLimit,
  getImportablePreviewItems,
  ShopifyAdminGraphqlClient,
  ShopifyDraftProductResult,
} from "./shopify-import-shared.server";

export type ShopifyDraftImportStatus = "blocked" | "created" | "failed" | "queued";

const DRAFT_PRODUCT_CREATE_CONCURRENCY = 2;

export function getDraftImportReadiness(input: {
  defaultProductStatus: ImportProductStatus;
  hasDefaultLocation: boolean;
  previewResult: ImportPreviewResult;
}) {
  const enabled = process.env.SYNCBAY_DRAFT_IMPORT_ENABLED === "true";
  const draftLimit = getDraftImportLimit();
  const importableItems = getImportablePreviewItems(input.previewResult);
  const plannedCreateCount = Math.min(importableItems.length, draftLimit);
  const blockers = [
    !enabled ? "import Shopify non abilitato" : null,
    !input.hasDefaultLocation ? "location Shopify predefinita non confermata" : null,
    importableItems.length === 0 ? "nessun prodotto importabile nella preview" : null,
  ].filter((blocker): blocker is string => Boolean(blocker));

  return {
    blockers,
    draftLimit,
    enabled,
    importableCount: importableItems.length,
    importProductStatus: input.defaultProductStatus,
    plannedCreateCount,
    nextAction:
      blockers.length > 0
        ? "Completa i blocchi prima di creare prodotti Shopify."
        : `Pronto per creare o riusare fino a ${plannedCreateCount} ${getImportedProductsLabel(input.defaultProductStatus)} dietro conferma esplicita.`,
  };
}

export interface CatalogImportExecutionInput {
  admin: ShopifyAdminGraphqlClient;
  defaultLocationGid?: string | null;
  existingCatalogFieldPoliciesByItemId?: Record<string, ExistingCatalogFieldPolicy>;
  facetBaselinesByItemId?: Record<string, SyncBayProductFacet[]>;
  hasDefaultLocation: boolean;
  importProductStatusOverride?: ImportProductStatus;
  jobId: string;
  previewResult: ImportPreviewResult;
  reuseOnly?: boolean;
  shopId: string;
  shopDomain: string;
  skipUnchangedSinceLastEbaySnapshot?: boolean;
}

export async function executeShopifyCatalogImport(
  input: CatalogImportExecutionInput,
): Promise<CatalogImportExecutionResult> {
  const shop = await ensureDraftImportShop(input.shopDomain);
  if (shop.id !== input.shopId) {
    throw new Error("Il negozio del job import non corrisponde al dominio Shopify caricato.");
  }
  const pricingRule = await getPricingRuleForShopId(input.shopId);
  const admin = input.admin;
  const reuseOnly = input.reuseOnly === true;
  const importProductStatus =
    input.importProductStatusOverride ?? normalizeImportProductStatus(shop.defaultProductStatus);
  const readiness = getDraftImportReadiness({
    defaultProductStatus: importProductStatus,
    hasDefaultLocation: input.hasDefaultLocation,
    previewResult: input.previewResult,
  });

  if (readiness.blockers.length > 0) {
    return buildCatalogImportExecutionResult({
      errorCode: "SYNCBAY_JOB_BLOCKED",
      errorMessage: readiness.blockers.join(", "),
      status: "blocked",
      summary: { blockers: readiness.blockers },
    });
  }

  const publicationOptions = await resolveDraftImportPublicationOptions(admin, {
    importProductStatus,
    productPublicationGids: shop.productPublicationGids,
    productPublicationMode: shop.productPublicationMode,
  });

  if (publicationOptions.status === "failed") {
    return buildCatalogImportExecutionResult({
      errorCode: "SYNCBAY_JOB_BLOCKED",
      errorMessage: publicationOptions.errorMessage,
      status: "blocked",
      summary: { blockers: [publicationOptions.errorMessage] },
    });
  }

  const allDraftProducts = buildShopifyDraftProductInputs(
    input.previewResult,
    importProductStatus,
    pricingRule,
    input.existingCatalogFieldPoliciesByItemId ?? {},
    input.facetBaselinesByItemId ?? {},
  );
  const unchangedPartition =
    input.skipUnchangedSinceLastEbaySnapshot === true
      ? await partitionUnchangedDraftProducts({
          draftProducts: allDraftProducts,
          shopId: input.shopId,
        })
      : { draftProducts: allDraftProducts, unchangedSkippedCount: 0 };
  const draftProducts = unchangedPartition.draftProducts;
  const results = await mapWithConcurrency(
    draftProducts,
    DRAFT_PRODUCT_CREATE_CONCURRENCY,
    (product) =>
      createShopifyDraftProductSafely(admin, product, {
        defaultLocationGid: input.defaultLocationGid ?? null,
        jobId: input.jobId,
        publicationOptions: publicationOptions.options,
        reuseOnly,
        shopId: input.shopId,
      }),
  );
  const warnings = results.flatMap((result) =>
    result.status === "created" ? (result.warnings ?? []) : [],
  );
  const failedResult = results.find(
    (result): result is Extract<ShopifyDraftProductResult, { status: "failed" }> =>
      result.status === "failed",
  );
  const inventoryFailedResults = getInventoryFailedResults({
    products: draftProducts,
    results,
  });
  const mediaFailedResults = getMediaFailedResults({
    products: draftProducts,
    results,
  });
  const inventoryFailureMessage =
    inventoryFailedResults.length > 0
      ? `Tracking scorte Shopify non completato per ${inventoryFailedResults.length} prodotti.`
      : null;
  const mediaFailureMessage =
    mediaFailedResults.length > 0
      ? `Immagini Shopify non completate per ${mediaFailedResults.length} prodotti.`
      : null;
  const persistenceResult = await recordDraftImportPersistence({
    jobId: input.jobId,
    products: draftProducts,
    results,
    shopId: input.shopId,
  });

  if (failedResult || inventoryFailureMessage || mediaFailureMessage) {
    const errorMessage =
      failedResult?.errorMessage ??
      inventoryFailureMessage ??
      mediaFailureMessage ??
      "Import Shopify non completato dal runner.";
    return buildCatalogImportExecutionResult({
      errorCode: "SHOPIFY_DRAFT_IMPORT_FAILED",
      errorMessage,
      status: "failed",
      summary: buildDraftImportSummary({
        importProductStatus,
        persistenceResult,
        products: draftProducts,
        results,
        unchangedSkippedCount: unchangedPartition.unchangedSkippedCount,
      }),
      warnings,
    });
  }

  return buildCatalogImportExecutionResult({
    status: "succeeded",
    summary: buildDraftImportSummary({
      importProductStatus,
      persistenceResult,
      products: draftProducts,
      results,
      unchangedSkippedCount: unchangedPartition.unchangedSkippedCount,
    }),
    warnings,
  });
}

async function ensureDraftImportShop(shopDomain: string) {
  return prisma.shop.upsert({
    where: { shopDomain },
    create: {
      shopDomain,
    },
    update: {},
  });
}
