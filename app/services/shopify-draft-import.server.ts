import { createHash } from "node:crypto";

import {
  AuditEventType,
  Prisma,
  ProductMappingStatus,
  ProductSnapshotSource,
  SyncJobStatus,
  SyncJobType,
} from "@prisma/client";

import prisma from "../db.server";
import {
  getImportedProductsLabel,
  normalizeImportProductStatus,
  type ImportProductStatus,
} from "../lib/import-product-status";
import {
  loadShopifyProductPublicationIds,
  syncShopifyProductPublications,
  type ShopifyProductPublicationSyncResult,
} from "../lib/syncbay-product-publication";
import { canPublishProductAfterInventorySync } from "../lib/syncbay-product-publication-gate";
import {
  normalizeProductPublicationMode,
  parseProductPublicationGids,
  resolveProductPublicationIds,
  resolveStoredSelectedProductPublicationIds,
} from "../lib/syncbay-product-publication-settings";
import { isShopifyGraphqlThrottleResponse } from "../lib/shopify-graphql-throttle";
import {
  getSyncBayDescriptionHash,
  hashNullableText,
} from "../lib/syncbay-description-hash";
import {
  buildExistingCatalogTagMutations,
  getShopifyImageMediaIds,
  shouldSyncExistingCatalogImages,
  type ExistingCatalogFieldPolicy,
} from "../lib/syncbay-existing-catalog-field-policy";
import {
  calculateShopifyPricing,
  type SyncBayPricingRule,
} from "../lib/syncbay-pricing-rules";
import {
  buildEbayProductSnapshotPayload,
  getProductSnapshotThumbnailUrl,
} from "../lib/syncbay-product-snapshot-payload";
import { SYNCBAY_AUDIT_LOG_CREATE_SELECT } from "../lib/syncbay-audit-log-write";
import { buildShopifyProductFacetMetafields } from "../lib/syncbay-product-facets";
import { buildShopifyDraftCategoryFields } from "../lib/syncbay-shopify-draft-category-fields";
import { buildShopifyProductUpdateFieldsFromDraft } from "../lib/syncbay-shopify-product-update-fields";
import { buildSyncBayProductMetafields as buildSyncBayBaseProductMetafields } from "../lib/syncbay-shopify-product-metafields";
import {
  buildSyncBayProductLookupQueries,
  buildSyncBayShopifyImportTags,
} from "../lib/syncbay-shopify-tags";
import {
  preserveSelectedShopifyVariantForSync,
  selectShopifyVariantForSync,
} from "../lib/syncbay-shopify-variant-selection";
import { shouldUseMappedShopifyVariant } from "../lib/syncbay-sold-out-variant";
import type {
  ImportPreviewItem,
  ImportPreviewResult,
} from "./import-preview.server";
import { getPricingRuleForShopId } from "./pricing-rules.server";

// Tag Shopify applicato ai prodotti il cui listing eBay è diventato inattivo:
// restano in vetrina come esauriti invece di essere archiviati (ADR 0011).
const SYNCBAY_SOLD_OUT_TAG = "esaurito";

interface ShopifyAdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

interface ShopifyUserError {
  code?: string | null;
  field?: string[] | null;
  message: string;
}

interface ShopifyGraphqlResponseEnvelope {
  errors?: Array<{
    extensions?: {
      code?: string | null;
    } | null;
    message: string;
  }>;
  extensions?: {
    cost?: {
      actualQueryCost?: number | null;
      requestedQueryCost?: number | null;
      throttleStatus?: {
        currentlyAvailable?: number | null;
        restoreRate?: number | null;
      } | null;
    } | null;
  } | null;
}

interface ShopifyInventoryItemNode {
  id: string;
  sku?: string | null;
  tracked?: boolean | null;
}

interface ShopifyDraftProductVariantNode {
  compareAtPrice?: string | null;
  id: string;
  inventoryItem?: ShopifyInventoryItemNode | null;
  price?: string | null;
  sku?: string | null;
}

interface ShopifyProductMediaNode {
  alt?: string | null;
  id: string;
  mediaContentType?: string | null;
  preview?: {
    status?: string | null;
  } | null;
}

interface ShopifyDraftProductNode {
  descriptionHtml?: string | null;
  id: string;
  media?: {
    nodes?: ShopifyProductMediaNode[];
  } | null;
  status?: string | null;
  tags?: string[] | null;
  title: string;
  variants?: {
    nodes?: ShopifyDraftProductVariantNode[];
  } | null;
}

interface ShopifyProductCreateResponse {
  data?: {
    productCreate?: {
      product?: ShopifyDraftProductNode | null;
      userErrors?: ShopifyUserError[];
    };
  };
  errors?: Array<{
    message: string;
  }>;
}

interface ShopifyProductLookupResponse {
  data?: {
    node?: ShopifyDraftProductLookupNode | null;
    productByHandle?: ShopifyDraftProductLookupNode | null;
    products?: {
      nodes?: ShopifyDraftProductLookupNode[];
      pageInfo?: {
        endCursor?: string | null;
        hasNextPage?: boolean | null;
      } | null;
    };
  };
  errors?: Array<{
    message: string;
  }>;
}

interface ShopifyDraftProductLookupNode extends ShopifyDraftProductNode {
  metafield?: {
    value: string;
  } | null;
}

interface ShopifyDraftProductVariantLookupNode
  extends ShopifyDraftProductVariantNode {
  product?: {
    id?: string | null;
  } | null;
}

interface ShopifyMappedProductLookupResponse {
  data?: {
    productNode?: ShopifyDraftProductLookupNode | null;
    variantNode?: ShopifyDraftProductVariantLookupNode | null;
  };
  errors?: Array<{
    message: string;
  }>;
}

interface ShopifyInventoryItemUpdateResponse {
  data?: {
    inventoryItemUpdate?: {
      inventoryItem?: ShopifyInventoryItemNode | null;
      userErrors?: ShopifyUserError[];
    };
  };
  errors?: Array<{
    message: string;
  }>;
}

interface ShopifyInventoryActivateResponse {
  data?: {
    inventoryActivate?: {
      inventoryLevel?: {
        id: string;
      } | null;
      userErrors?: ShopifyUserError[];
    };
  };
  errors?: Array<{
    message: string;
  }>;
}

interface ShopifyInventorySetQuantitiesResponse {
  data?: {
    inventorySetQuantities?: {
      inventoryAdjustmentGroup?: {
        referenceDocumentUri?: string | null;
      } | null;
      userErrors?: ShopifyUserError[];
    };
  };
  errors?: Array<{
    message: string;
  }>;
}

interface ShopifyProductUpdateResponse {
  data?: {
    productUpdate?: {
      product?: ShopifyDraftProductNode | null;
      userErrors?: ShopifyUserError[];
    };
  };
  errors?: Array<{
    message: string;
  }>;
}

interface ShopifyProductSoldOutLookupResponse {
  data?: {
    node?: {
      id: string;
      variants?: {
        nodes?: ShopifyDraftProductVariantNode[];
      } | null;
    } | null;
  };
  errors?: Array<{
    message: string;
  }>;
}

interface ShopifyVariantSoldOutLookupResponse {
  data?: {
    node?: ShopifyDraftProductVariantNode | null;
  };
  errors?: Array<{
    message: string;
  }>;
}

interface ShopifyProductTagsResponse {
  data?: {
    tagsAdd?: {
      userErrors?: ShopifyUserError[];
    };
    tagsRemove?: {
      userErrors?: ShopifyUserError[];
    };
  };
  errors?: Array<{
    message: string;
  }>;
}

interface ShopifyProductDeleteMediaResponse {
  data?: {
    productDeleteMedia?: {
      deletedMediaIds?: string[];
      deletedProductImageIds?: string[];
      mediaUserErrors?: ShopifyUserError[];
      product?: ShopifyDraftProductNode | null;
    };
  };
  errors?: Array<{
    message: string;
  }>;
}

interface ShopifyProductVariantsBulkUpdateResponse {
  data?: {
    productVariantsBulkUpdate?: {
      productVariants?: ShopifyDraftProductVariantNode[];
      userErrors?: ShopifyUserError[];
    };
  };
  errors?: Array<{
    message: string;
  }>;
}

interface ShopifyInventoryVerificationResponse {
  data?: {
    node?: {
      id?: string;
      tracked?: boolean | null;
      inventoryLevel?: {
        quantities?: Array<{
          name: string;
          quantity: number;
        }>;
      } | null;
    } | null;
  };
  errors?: Array<{
    message: string;
  }>;
}

export type ShopifyDraftImportStatus =
  | "blocked"
  | "created"
  | "failed"
  | "queued";

type ShopifyDraftProductInput = ReturnType<
  typeof buildShopifyDraftProductInputs
>[number];
type ShopifyCreatedProduct = NonNullable<
  NonNullable<ShopifyProductCreateResponse["data"]>["productCreate"]
>["product"];
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
const DRAFT_PRODUCT_CREATE_CONCURRENCY = 2;
const SHOPIFY_MEDIA_SYNC_CONCURRENCY = 2;
const DEFAULT_DRAFT_IMPORT_LIMIT = 3;
const MAX_DRAFT_IMPORT_LIMIT = 50;
const DRAFT_IMPORT_MAX_ATTEMPTS = 4;
const DEFAULT_MARKETPLACE_ID = "EBAY_IT";
const MAX_SHOPIFY_MEDIA_PER_PRODUCT = 250;
const SHOPIFY_GRAPHQL_MAX_ATTEMPTS = 4;
const SHOPIFY_GRAPHQL_MIN_AVAILABLE_POINTS = 120;
const SHOPIFY_GRAPHQL_MAX_THROTTLE_WAIT_MS = 15_000;
const SUPABASE_SIGNED_URL_TTL_SECONDS = 604_800;

type ShopifyInventorySyncResult =
  | {
      inventoryItemGid: string;
      locationGid: string;
      quantity: number;
      status: "synced";
      warning?: string;
      variantGid: string;
    }
  | {
      message: string;
      reason:
        | "missing_inventory_item"
        | "missing_location"
        | "missing_quantity";
      status: "skipped";
      variantGid?: string;
    }
  | {
      errorMessage: string;
      inventoryItemGid?: string;
      locationGid?: string;
      quantity?: number;
      status: "failed";
      variantGid?: string;
    };

type ShopifyMediaSyncResult = {
  createdCount: number;
  deletedCount: number;
  directCreatedCount: number;
  failedResults: Array<{
    errorMessage: string;
    index: number;
    sourceUrl: string;
  }>;
  preservedCount?: number;
  requestedCount: number;
  sourceImageUrls: string[];
  stagedCreatedCount: number;
  stagedObjectPaths: string[];
  status: "failed" | "synced";
};

type ShopifyDraftProductCreateResult =
  | {
      product: NonNullable<ShopifyCreatedProduct>;
      resultType: "created" | "reused";
      status: "created";
      warnings?: string[];
    }
  | {
      errorMessage: string;
      status: "failed";
    };

type ShopifyDraftProductResult =
  | (Extract<ShopifyDraftProductCreateResult, { status: "created" }> & {
      inventorySync: ShopifyInventorySyncResult;
      mediaSync: ShopifyMediaSyncResult;
      publicationSync: ShopifyProductPublicationSyncResult;
    })
  | Extract<ShopifyDraftProductCreateResult, { status: "failed" }>;

type DraftImportPublicationOptions = {
  disabled?: boolean;
  publicationIds?: string[];
};

function createShopifyAdminGraphqlClientWithBackoff(
  admin: ShopifyAdminGraphqlClient,
): ShopifyAdminGraphqlClient {
  return {
    async graphql(query, options) {
      let response: Response | null = null;

      for (
        let attempt = 1;
        attempt <= SHOPIFY_GRAPHQL_MAX_ATTEMPTS;
        attempt += 1
      ) {
        response = await admin.graphql(query, options);

        const envelope = await readShopifyGraphqlEnvelope(response);
        const throttled = isShopifyGraphqlThrottled(response, envelope);

        if (!throttled) {
          await waitForShopifyGraphqlBudget(envelope);
          return response;
        }

        if (attempt === SHOPIFY_GRAPHQL_MAX_ATTEMPTS) {
          return response;
        }

        await sleep(calculateShopifyThrottleWaitMs(envelope, attempt));
      }

      return response ?? admin.graphql(query, options);
    },
  };
}

async function readShopifyGraphqlEnvelope(response: Response) {
  try {
    return (await response.clone().json()) as ShopifyGraphqlResponseEnvelope;
  } catch {
    return null;
  }
}

function isShopifyGraphqlThrottled(
  response: Response,
  envelope: ShopifyGraphqlResponseEnvelope | null,
) {
  return isShopifyGraphqlThrottleResponse({
    envelope,
    status: response.status,
  });
}

async function waitForShopifyGraphqlBudget(
  envelope: ShopifyGraphqlResponseEnvelope | null,
) {
  const waitMs = calculateShopifyThrottleWaitMs(envelope, 0);

  if (waitMs > 0) {
    await sleep(waitMs);
  }
}

function calculateShopifyThrottleWaitMs(
  envelope: ShopifyGraphqlResponseEnvelope | null,
  attempt: number,
) {
  const cost = envelope?.extensions?.cost;
  const throttleStatus = cost?.throttleStatus;
  const currentlyAvailable = throttleStatus?.currentlyAvailable;
  const restoreRate = throttleStatus?.restoreRate;
  const requestedCost = cost?.requestedQueryCost ?? cost?.actualQueryCost ?? 0;
  const targetAvailable = Math.max(
    SHOPIFY_GRAPHQL_MIN_AVAILABLE_POINTS,
    requestedCost,
  );

  if (
    typeof currentlyAvailable === "number" &&
    typeof restoreRate === "number" &&
    restoreRate > 0 &&
    currentlyAvailable < targetAvailable
  ) {
    return Math.min(
      Math.ceil(((targetAvailable - currentlyAvailable) / restoreRate) * 1000) +
        250,
      SHOPIFY_GRAPHQL_MAX_THROTTLE_WAIT_MS,
    );
  }

  if (attempt <= 0) return 0;

  return Math.min(
    1000 * 2 ** (attempt - 1),
    SHOPIFY_GRAPHQL_MAX_THROTTLE_WAIT_MS,
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatShopifyPrice(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value.toFixed(2);
}

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
    !input.hasDefaultLocation
      ? "location Shopify predefinita non confermata"
      : null,
    importableItems.length === 0
      ? "nessun prodotto importabile nella preview"
      : null,
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

function buildShopifyDraftProductInputs(
  previewResult: ImportPreviewResult,
  importProductStatus: ImportProductStatus,
  pricingRule: SyncBayPricingRule = {
    discountPercent: 0,
    roundingMode: "CENTS",
  },
  existingCatalogFieldPoliciesByItemId: Record<
    string,
    ExistingCatalogFieldPolicy
  > = {},
) {
  return getImportablePreviewItems(previewResult)
    .slice(0, getDraftImportLimit())
    .map((item) => {
      const categoryFields = buildShopifyDraftCategoryFields(
        item.normalized.categoryProposal,
      );

      return {
        existingCatalogFieldPolicy:
          existingCatalogFieldPoliciesByItemId[item.itemId] ?? null,
        media: dedupeImageUrls(item.normalized.imageUrls)
          .slice(0, MAX_SHOPIFY_MEDIA_PER_PRODUCT)
          .map((imageUrl) => ({
            alt: item.normalized.title,
            mediaContentType: "IMAGE",
            originalSource: imageUrl,
          })),
        product: {
          ...categoryFields,
          descriptionHtml: item.normalized.descriptionHtml ?? undefined,
          handle: buildSyncBayProductHandle(item.itemId),
          metafields: buildSyncBayProductMetafields(item),
          status: importProductStatus,
          tags: buildSyncBayShopifyImportTags(),
          title: item.normalized.title,
        },
        source: {
          ebayItemId: item.itemId,
        },
        pricing: calculateShopifyPricing({
          discountPercent: pricingRule.discountPercent,
          ebayPriceAmount: item.normalized.priceAmount,
          roundingMode: pricingRule.roundingMode,
        }),
        previewItem: item,
      };
    });
}

export async function createShopifyDraftProductsIfEnabled(input: {
  admin: ShopifyAdminGraphqlClient;
  catalogImportRunId?: string | null;
  defaultLocationGid?: string | null;
  existingCatalogFieldPoliciesByItemId?: Record<
    string,
    ExistingCatalogFieldPolicy
  >;
  hasDefaultLocation: boolean;
  importProductStatusOverride?: ImportProductStatus;
  previewResult: ImportPreviewResult;
  reuseOnly?: boolean;
  shopDomain: string;
}) {
  const shop = await ensureDraftImportShop(input.shopDomain);
  const pricingRule = await getPricingRuleForShopId(shop.id);
  const admin = createShopifyAdminGraphqlClientWithBackoff(input.admin);
  const reuseOnly = input.reuseOnly === true;
  const importProductStatus =
    input.importProductStatusOverride ??
    normalizeImportProductStatus(shop.defaultProductStatus);
  const readiness = getDraftImportReadiness({
    defaultProductStatus: importProductStatus,
    hasDefaultLocation: input.hasDefaultLocation,
    previewResult: input.previewResult,
  });

  if (readiness.blockers.length > 0) {
    return {
      createdProducts: [],
      jobId: null,
      readiness,
      status: "blocked" as const,
    };
  }

  const publicationOptions = await resolveDraftImportPublicationOptions(admin, {
    importProductStatus,
    productPublicationGids: shop.productPublicationGids,
    productPublicationMode: shop.productPublicationMode,
  });

  if (publicationOptions.status === "failed") {
    return {
      createdProducts: [],
      jobId: null,
      readiness: {
        ...readiness,
        blockers: [...readiness.blockers, publicationOptions.errorMessage],
      },
      status: "blocked" as const,
    };
  }

  const draftProducts = buildShopifyDraftProductInputs(
    input.previewResult,
    importProductStatus,
    pricingRule,
    input.existingCatalogFieldPoliciesByItemId ?? {},
  );
  const job = await startDraftImportJob({
    catalogImportRunId: input.catalogImportRunId ?? null,
    draftLimit: readiness.draftLimit,
    importProductStatus,
    previewMode: input.previewResult.mode,
    products: draftProducts,
    reuseOnly,
    shopId: shop.id,
  });
  const results = await mapWithConcurrency(
    draftProducts,
    DRAFT_PRODUCT_CREATE_CONCURRENCY,
    (product) =>
      createShopifyDraftProductSafely(admin, product, {
        defaultLocationGid: input.defaultLocationGid ?? null,
        jobId: job.id,
        publicationOptions: publicationOptions.options,
        reuseOnly,
        shopId: shop.id,
      }),
  );
  const createdProducts = results.flatMap((result) =>
    result.status === "created" ? [result.product] : [],
  );
  const warnings = results.flatMap((result) =>
    result.status === "created" ? (result.warnings ?? []) : [],
  );
  const failedResult = results.find(
    (
      result,
    ): result is Extract<ShopifyDraftProductResult, { status: "failed" }> =>
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
    jobId: job.id,
    products: draftProducts,
    results,
    shopId: shop.id,
  });

  if (failedResult || inventoryFailureMessage || mediaFailureMessage) {
    await finishDraftImportJob({
      errorMessage:
        failedResult?.errorMessage ??
        inventoryFailureMessage ??
        mediaFailureMessage ??
        undefined,
      importProductStatus,
      jobId: job.id,
      persistenceResult,
      products: draftProducts,
      results,
      shopId: shop.id,
      status: "failed",
      warnings,
    });

    return {
      createdProducts,
      errorMessage:
        failedResult?.errorMessage ??
        inventoryFailureMessage ??
        mediaFailureMessage ??
        undefined,
      jobId: job.id,
      readiness,
      status: "failed" as const,
      warnings,
    };
  }

  await finishDraftImportJob({
    importProductStatus,
    jobId: job.id,
    persistenceResult,
    products: draftProducts,
    results,
    shopId: shop.id,
    status: "created",
    warnings,
  });

  return {
    createdProducts,
    jobId: job.id,
    readiness,
    status: "created" as const,
    warnings,
  };
}

async function resolveDraftImportPublicationOptions(
  admin: ShopifyAdminGraphqlClient,
  input: {
    importProductStatus: ImportProductStatus;
    productPublicationGids: string | null;
    productPublicationMode: string | null;
  },
): Promise<
  | {
      options?: DraftImportPublicationOptions;
      status: "ready";
    }
  | {
      errorMessage: string;
      status: "failed";
    }
> {
  if (input.importProductStatus !== "ACTIVE") {
    return { status: "ready" };
  }

  const mode = normalizeProductPublicationMode(input.productPublicationMode);

  if (mode === "NONE") {
    return {
      options: { disabled: true },
      status: "ready",
    };
  }

  const selectedPublicationIds = parseProductPublicationGids(
    input.productPublicationGids,
  );

  if (mode === "SELECTED") {
    const resolution = resolveStoredSelectedProductPublicationIds({
      selectedPublicationIds,
    });

    if (resolution.status === "failed") {
      return resolution;
    }

    return {
      options: { publicationIds: resolution.publicationIds },
      status: "ready",
    };
  }

  const availablePublicationIds = await loadShopifyProductPublicationIds(admin);

  if ("errorMessage" in availablePublicationIds) {
    return {
      errorMessage: availablePublicationIds.errorMessage,
      status: "failed",
    };
  }

  const resolution = resolveProductPublicationIds({
    availablePublicationIds,
    mode,
    selectedPublicationIds,
  });

  if (resolution.status === "failed") {
    return resolution;
  }

  return {
    options:
      resolution.status === "disabled"
        ? { disabled: true }
        : { publicationIds: resolution.publicationIds },
    status: "ready",
  };
}

async function createShopifyDraftProduct(
  admin: ShopifyAdminGraphqlClient,
  draftProduct: ShopifyDraftProductInput,
  context: {
    reuseOnly: boolean;
    shopId: string;
  },
): Promise<ShopifyDraftProductCreateResult> {
  const existingProduct = await findExistingSyncBayDraftProduct(
    admin,
    draftProduct,
    context,
  );

  if (existingProduct) {
    const statusResult = await updateShopifyProductFromEbay(
      admin,
      existingProduct,
      draftProduct,
    );

    if (statusResult.status === "failed") {
      return statusResult;
    }

    return {
      product: statusResult.product,
      resultType: "reused",
      status: "created",
      warnings: [
        "SyncBay ha riusato prodotti Shopify già presenti per lo stesso eBay ItemID e non ha creato duplicati.",
        ...statusResult.warnings,
      ],
    };
  }

  if (context.reuseOnly) {
    return {
      errorMessage:
        "Takeover catalogo esistente bloccato: prodotto Shopify esistente non riusato, nessun duplicato creato.",
      status: "failed",
    };
  }

  return createShopifyDraftProductRequest(admin, {
    ...draftProduct,
    media: [],
  });
}

async function createShopifyDraftProductSafely(
  admin: ShopifyAdminGraphqlClient,
  draftProduct: ShopifyDraftProductInput,
  context: {
    defaultLocationGid: string | null;
    jobId: string;
    publicationOptions?: DraftImportPublicationOptions;
    reuseOnly: boolean;
    shopId: string;
  },
): Promise<ShopifyDraftProductResult> {
  try {
    const result = await createShopifyDraftProduct(admin, draftProduct, {
      reuseOnly: context.reuseOnly,
      shopId: context.shopId,
    });

    if (result.status === "failed") return result;

    const commercialFieldsSync =
      await syncShopifyVariantCommercialFieldsFromEbay(admin, {
        draftProduct,
        product: result.product,
      });

    if (commercialFieldsSync.status === "failed") {
      return commercialFieldsSync;
    }

    const mediaSync = await syncShopifyMediaFromEbayImages(
      admin,
      commercialFieldsSync.product,
      draftProduct,
      {
        jobId: context.jobId,
      },
    );
    const inventorySync = await syncShopifyInventoryFromEbayQuantity(
      admin,
      commercialFieldsSync.product,
      draftProduct,
      context,
    );

    if (
      !canPublishProductAfterInventorySync({
        inventorySyncStatus: inventorySync.status,
        productStatus: commercialFieldsSync.product.status,
      })
    ) {
      return {
        errorMessage: `Pubblicazione prodotto Shopify rinviata: ${getInventorySyncWarning(inventorySync)}`,
        status: "failed",
      };
    }

    const publicationSync = await syncShopifyProductPublications(
      admin,
      commercialFieldsSync.product,
      context.publicationOptions,
    );

    if (publicationSync.status === "failed") {
      return {
        errorMessage: `Pubblicazione prodotto Shopify sui canali non completata: ${publicationSync.errorMessage}`,
        status: "failed",
      };
    }

    const inventoryWarnings =
      inventorySync.status === "skipped" ||
      inventorySync.status === "failed" ||
      Boolean(inventorySync.warning)
        ? [getInventorySyncWarning(inventorySync)]
        : [];
    const mediaWarnings =
      mediaSync.status === "failed" ? [getMediaSyncWarning(mediaSync)] : [];
    const publicationWarnings =
      publicationSync.status === "skipped" &&
      publicationSync.reason === "no_publications"
        ? [publicationSync.message]
        : [];

    return {
      ...result,
      product: commercialFieldsSync.product,
      inventorySync,
      mediaSync,
      publicationSync,
      warnings: [
        ...(result.warnings ?? []),
        ...mediaWarnings,
        ...inventoryWarnings,
        ...publicationWarnings,
      ],
    };
  } catch (error) {
    return {
      errorMessage: getErrorMessage(error),
      status: "failed",
    };
  }
}

async function createShopifyDraftProductRequest(
  admin: ShopifyAdminGraphqlClient,
  draftProduct: ShopifyDraftProductInput,
): Promise<ShopifyDraftProductCreateResult> {
  const response = await admin.graphql(
    `#graphql
    mutation SyncBayCreateDraftProduct($media: [CreateMediaInput!], $product: ProductCreateInput!) {
      productCreate(product: $product, media: $media) {
        product {
          descriptionHtml
          id
          media(first: 250) {
            nodes {
              alt
              id
              mediaContentType
              preview {
                status
              }
            }
          }
          status
          title
          variants(first: 1) {
            nodes {
              id
              price
              compareAtPrice
              inventoryItem {
                id
                tracked
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        media: draftProduct.media,
        product: draftProduct.product,
      },
    },
  );
  const json = (await response.json()) as ShopifyProductCreateResponse;

  if (!response.ok) {
    return {
      errorMessage: `Shopify ha risposto con stato HTTP ${response.status}.`,
      status: "failed",
    };
  }

  if (json.errors?.length) {
    return {
      errorMessage: json.errors.map((error) => error.message).join("; "),
      status: "failed",
    };
  }

  const userErrors = json.data?.productCreate?.userErrors ?? [];
  const createdProduct = json.data?.productCreate?.product;

  if (userErrors.length > 0) {
    if (createdProduct) {
      return {
        product: createdProduct,
        resultType: "created",
        status: "created",
        warnings: [
          `Shopify ha creato il prodotto con avvisi: ${userErrors
            .map((error) => error.message)
            .join("; ")}`,
        ],
      };
    }

    return {
      errorMessage: userErrors.map((error) => error.message).join("; "),
      status: "failed",
    };
  }

  if (!createdProduct) {
    return {
      errorMessage: "Shopify non ha restituito il prodotto creato.",
      status: "failed",
    };
  }

  return {
    product: createdProduct,
    resultType: "created",
    status: "created",
  };
}

async function findExistingSyncBayDraftProduct(
  admin: ShopifyAdminGraphqlClient,
  draftProduct: ShopifyDraftProductInput,
  context: {
    reuseOnly: boolean;
    shopId: string;
  },
) {
  const mappedProduct = await findMappedSyncBayDraftProduct(admin, {
    ebayItemId: draftProduct.source.ebayItemId,
    shopId: context.shopId,
  });

  if (mappedProduct) return mappedProduct;
  if (context.reuseOnly) return null;

  const handleLookupResponse = await admin.graphql(
    `#graphql
    query SyncBayFindDraftProduct($handle: String!) {
      productByHandle(handle: $handle) {
        descriptionHtml
        id
        media(first: 250) {
          nodes {
            alt
            id
            mediaContentType
            preview {
              status
            }
          }
        }
        status
        title
        variants(first: 1) {
          nodes {
            id
            price
            compareAtPrice
            inventoryItem {
              id
              tracked
            }
          }
        }
        metafield(namespace: "syncbay", key: "ebay_item_id") {
          value
        }
      }
    }`,
    {
      variables: {
        handle: draftProduct.product.handle,
      },
    },
  );

  if (!handleLookupResponse.ok) return null;

  const handleLookupJson =
    (await handleLookupResponse.json()) as ShopifyProductLookupResponse;

  if (handleLookupJson.errors?.length) return null;

  const productByHandle = handleLookupJson.data?.productByHandle;

  if (productByHandle?.metafield?.value === draftProduct.source.ebayItemId) {
    return productByHandle;
  }

  return findExistingSyncBayDraftProductByMetafieldScan(admin, draftProduct);
}

async function findMappedSyncBayDraftProduct(
  admin: ShopifyAdminGraphqlClient,
  input: {
    ebayItemId: string;
    shopId: string;
  },
) {
  const mapping = await prisma.productMapping.findUnique({
    select: {
      shopifyProductGid: true,
      shopifyVariantGid: true,
    },
    where: {
      shopId_marketplaceId_ebayItemId: {
        ebayItemId: input.ebayItemId,
        marketplaceId: getEbayMarketplaceId(),
        shopId: input.shopId,
      },
    },
  });

  if (!mapping?.shopifyProductGid) return null;

  const response = mapping.shopifyVariantGid
    ? await admin.graphql(
        `#graphql
        query SyncBayFindMappedProductVariant($productId: ID!, $variantId: ID!) {
          productNode: node(id: $productId) {
            ... on Product {
              descriptionHtml
              id
              media(first: 250) {
                nodes {
                  alt
                  id
                  mediaContentType
                  preview {
                    status
                  }
                }
              }
              status
              title
              variants(first: 1) {
                nodes {
                  id
                  price
                  compareAtPrice
                  inventoryItem {
                    id
                    tracked
                  }
                }
              }
              metafield(namespace: "syncbay", key: "ebay_item_id") {
                value
              }
            }
          }
          variantNode: node(id: $variantId) {
            ... on ProductVariant {
              id
              price
              compareAtPrice
              sku
              inventoryItem {
                id
                tracked
              }
              product {
                id
              }
            }
          }
        }`,
        {
          variables: {
            productId: mapping.shopifyProductGid,
            variantId: mapping.shopifyVariantGid,
          },
        },
      )
    : await admin.graphql(
        `#graphql
        query SyncBayFindMappedProduct($id: ID!) {
          node(id: $id) {
            ... on Product {
              descriptionHtml
              id
              media(first: 250) {
                nodes {
                  alt
                  id
                  mediaContentType
                  preview {
                    status
                  }
                }
              }
              status
              title
              variants(first: 1) {
                nodes {
                  id
                  price
                  compareAtPrice
                  inventoryItem {
                    id
                    tracked
                  }
                }
              }
              metafield(namespace: "syncbay", key: "ebay_item_id") {
                value
              }
            }
          }
        }`,
        {
          variables: {
            id: mapping.shopifyProductGid,
          },
        },
      );

  if (!response.ok) return null;

  const json = mapping.shopifyVariantGid
    ? ((await response.json()) as ShopifyMappedProductLookupResponse)
    : ((await response.json()) as ShopifyProductLookupResponse);

  if (json.errors?.length) return null;

  const product = mapping.shopifyVariantGid
    ? (json as ShopifyMappedProductLookupResponse).data?.productNode
    : (json as ShopifyProductLookupResponse).data?.node;

  if (product?.metafield?.value !== input.ebayItemId) return null;

  if (!mapping.shopifyVariantGid) return product;

  const mappedJson = json as ShopifyMappedProductLookupResponse;
  const variant =
    mappedJson.data?.variantNode?.product?.id === product.id
      ? mappedJson.data.variantNode
      : null;
  const selectedVariant = selectShopifyVariantForSync({
    preferredVariantGid: mapping.shopifyVariantGid,
    variants: [
      ...(variant ? [variant] : []),
      ...(product.variants?.nodes ?? []),
    ],
  });

  if (!selectedVariant) return null;

  return {
    ...product,
    variants: {
      nodes: [selectedVariant],
    },
  };
}

async function findExistingSyncBayDraftProductByMetafieldScan(
  admin: ShopifyAdminGraphqlClient,
  draftProduct: ShopifyDraftProductInput,
) {
  for (const query of buildSyncBayProductLookupQueries()) {
    let cursor: string | null = null;

    while (true) {
      const response = await admin.graphql(
        `#graphql
      query SyncBayFindDraftProductByMetafield($query: String!, $cursor: String) {
        products(first: 250, query: $query, after: $cursor) {
          nodes {
            descriptionHtml
            id
            media(first: 250) {
              nodes {
                alt
                id
                mediaContentType
                preview {
                  status
                }
              }
            }
            status
            title
            variants(first: 1) {
              nodes {
                id
                price
                compareAtPrice
                inventoryItem {
                  id
                  tracked
                }
              }
            }
            metafield(namespace: "syncbay", key: "ebay_item_id") {
              value
            }
          }
          pageInfo {
            endCursor
            hasNextPage
          }
        }
      }`,
        {
          variables: {
            cursor,
            query,
          },
        },
      );

      if (!response.ok) return null;

      const json = (await response.json()) as ShopifyProductLookupResponse;

      if (json.errors?.length) return null;

      for (const node of json.data?.products?.nodes ?? []) {
        if (node.metafield?.value === draftProduct.source.ebayItemId) {
          return node;
        }
      }

      const pageInfo = json.data?.products?.pageInfo;

      if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;

      cursor = pageInfo.endCursor;
    }
  }

  return null;
}

async function syncShopifyInventoryFromEbayQuantity(
  admin: ShopifyAdminGraphqlClient,
  product: NonNullable<ShopifyCreatedProduct>,
  draftProduct: ShopifyDraftProductInput,
  context: {
    defaultLocationGid: string | null;
    jobId: string;
  },
): Promise<ShopifyInventorySyncResult> {
  const quantity = draftProduct.previewItem.normalized.quantity;
  const variant = getFirstProductVariant(product);
  const inventoryItemGid = variant?.inventoryItem?.id;

  if (!context.defaultLocationGid) {
    return {
      message: "Location Shopify predefinita assente.",
      reason: "missing_location",
      status: "skipped",
      variantGid: variant?.id,
    };
  }

  if (quantity === null) {
    return {
      message: "Quantità eBay non disponibile per il prodotto importato.",
      reason: "missing_quantity",
      status: "skipped",
      variantGid: variant?.id,
    };
  }

  if (!variant || !inventoryItemGid) {
    return {
      message:
        "Inventory item Shopify non restituito per la variante importata.",
      reason: "missing_inventory_item",
      status: "skipped",
      variantGid: variant?.id,
    };
  }

  const trackingResult = await updateShopifyInventoryItemTracking(
    admin,
    inventoryItemGid,
  );

  if (trackingResult.status === "failed") {
    return {
      ...trackingResult,
      inventoryItemGid,
      locationGid: context.defaultLocationGid,
      quantity,
      variantGid: variant.id,
    };
  }

  const activationResult = await activateShopifyInventoryAtLocation(admin, {
    inventoryItemGid,
    locationGid: context.defaultLocationGid,
    quantity,
  });

  if (activationResult.status === "failed") {
    return {
      ...activationResult,
      inventoryItemGid,
      locationGid: context.defaultLocationGid,
      quantity,
      variantGid: variant.id,
    };
  }

  const quantityResult = await setShopifyInventoryQuantity(admin, {
    inventoryItemGid,
    jobId: context.jobId,
    locationGid: context.defaultLocationGid,
    quantity,
  });

  if (quantityResult.status === "failed") {
    return {
      ...quantityResult,
      inventoryItemGid,
      locationGid: context.defaultLocationGid,
      quantity,
      variantGid: variant.id,
    };
  }

  const verificationResult = await verifyShopifyInventoryAtLocation(admin, {
    inventoryItemGid,
    locationGid: context.defaultLocationGid,
    quantity,
  });

  if (verificationResult.status === "failed") {
    return {
      ...verificationResult,
      inventoryItemGid,
      locationGid: context.defaultLocationGid,
      quantity,
      variantGid: variant.id,
    };
  }

  return {
    inventoryItemGid,
    locationGid: context.defaultLocationGid,
    quantity,
    status: "synced",
    variantGid: variant.id,
  };
}

async function updateShopifyProductFromEbay(
  admin: ShopifyAdminGraphqlClient,
  product: NonNullable<ShopifyCreatedProduct>,
  draftProduct: ShopifyDraftProductInput,
): Promise<
  | {
      product: NonNullable<ShopifyCreatedProduct>;
      status: "synced";
      warnings: string[];
    }
  | {
      errorMessage: string;
      status: "failed";
    }
> {
  const productInput = buildShopifyProductUpdateFieldsFromDraft({
    product: draftProduct.product,
    productId: product.id,
  });

  const response = await admin.graphql(
    `#graphql
    mutation SyncBayUpdateProductStatus($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product {
          descriptionHtml
          id
          media(first: 250) {
            nodes {
              alt
              id
              mediaContentType
              preview {
                status
              }
            }
          }
          status
          tags
          title
          variants(first: 1) {
            nodes {
              id
              price
              compareAtPrice
              inventoryItem {
                id
                tracked
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        product: productInput,
      },
    },
  );
  const json = (await response.json()) as ShopifyProductUpdateResponse;

  if (!response.ok) {
    return {
      errorMessage: `Shopify productUpdate ha risposto con stato HTTP ${response.status}.`,
      status: "failed",
    };
  }

  if (json.errors?.length) {
    return {
      errorMessage: formatShopifyGraphqlErrors(json.errors),
      status: "failed",
    };
  }

  const userErrors = json.data?.productUpdate?.userErrors ?? [];

  if (userErrors.length > 0) {
    return {
      errorMessage: formatShopifyUserErrors(userErrors),
      status: "failed",
    };
  }

  const updatedProduct = json.data?.productUpdate?.product;

  if (!updatedProduct) {
    return {
      errorMessage: "Shopify non ha restituito il prodotto aggiornato.",
      status: "failed",
    };
  }

  const tagSyncResult = await syncShopifyExistingCatalogTags(admin, {
    currentTags: updatedProduct.tags ?? [],
    fieldPolicy: draftProduct.existingCatalogFieldPolicy,
    productGid: product.id,
  });

  if (tagSyncResult.status === "failed") {
    return tagSyncResult;
  }

  let syncedProduct = {
    ...updatedProduct,
    tags: applyShopifyTagMutations(updatedProduct.tags ?? [], tagSyncResult),
  };
  const tagWarning =
    tagSyncResult.addedTags.length > 0 || tagSyncResult.removedTags.length > 0
      ? `SyncBay ha aggiornato i tag del takeover: aggiunti ${tagSyncResult.addedTags.length}, rimossi ${tagSyncResult.removedTags.length}.`
      : null;
  const warnings = [
    "SyncBay ha riallineato titolo, descrizione e stato Shopify dal listing eBay.",
    ...(tagWarning ? [tagWarning] : []),
  ];

  // Rientro: se il prodotto era marcato come esaurito (listing eBay tornato
  // attivo), rimuovi il tag così non resta segnalato come esaurito. La scorta
  // viene ripristinata dal normale sync della disponibilità. Vedi ADR 0011.
  if (syncedProduct.tags?.includes(SYNCBAY_SOLD_OUT_TAG)) {
    const clearTagResult = await clearShopifySoldOutTag(admin, product.id);

    if (clearTagResult.status === "failed") {
      warnings.push(
        `Tag esaurito non rimosso al rientro del listing: ${clearTagResult.errorMessage}`,
      );
    } else {
      syncedProduct = {
        ...syncedProduct,
        tags: syncedProduct.tags.filter((tag) => tag !== SYNCBAY_SOLD_OUT_TAG),
      };
    }
  }

  return {
    product: preserveSelectedShopifyVariantForSync({
      previousProduct: product,
      updatedProduct: syncedProduct,
    }),
    status: "synced",
    warnings,
  };
}

async function syncShopifyExistingCatalogTags(
  admin: ShopifyAdminGraphqlClient,
  input: {
    currentTags: string[];
    fieldPolicy: ExistingCatalogFieldPolicy | null;
    productGid: string;
  },
): Promise<
  | {
      addedTags: string[];
      removedTags: string[];
      status: "synced";
    }
  | {
      errorMessage: string;
      status: "failed";
    }
> {
  const mutations = buildExistingCatalogTagMutations({
    currentTags: input.currentTags,
    fieldPolicy: input.fieldPolicy,
  });

  for (const tag of mutations.remove) {
    const result = await updateShopifyProductTag(admin, {
      operation: "remove",
      productGid: input.productGid,
      tag,
    });

    if (result.status === "failed") return result;
  }

  for (const tag of mutations.add) {
    const result = await updateShopifyProductTag(admin, {
      operation: "add",
      productGid: input.productGid,
      tag,
    });

    if (result.status === "failed") return result;
  }

  return {
    addedTags: mutations.add,
    removedTags: mutations.remove,
    status: "synced",
  };
}

function applyShopifyTagMutations(
  currentTags: string[],
  mutations: { addedTags: string[]; removedTags: string[] },
) {
  const removed = new Set(mutations.removedTags);
  const tags = currentTags.filter((tag) => !removed.has(tag));
  const existingTags = new Set(tags);

  for (const tag of mutations.addedTags) {
    if (existingTags.has(tag)) continue;

    tags.push(tag);
    existingTags.add(tag);
  }

  return tags;
}

async function syncShopifyVariantCommercialFieldsFromEbay(
  admin: ShopifyAdminGraphqlClient,
  input: {
    draftProduct: ShopifyDraftProductInput;
    product: NonNullable<ShopifyCreatedProduct>;
  },
): Promise<
  | {
      product: NonNullable<ShopifyCreatedProduct>;
      status: "synced";
    }
  | {
      errorMessage: string;
      status: "failed";
    }
> {
  const variant = getFirstProductVariant(input.product);
  const price = formatShopifyPrice(input.draftProduct.pricing.priceAmount);
  const compareAtPrice = formatShopifyPrice(
    input.draftProduct.pricing.compareAtPriceAmount,
  );

  if (!variant) {
    return {
      errorMessage:
        "Variante Shopify non restituita per il prodotto importato.",
      status: "failed",
    };
  }

  if (!price) {
    return {
      errorMessage: "Prezzo eBay non disponibile per la variante Shopify.",
      status: "failed",
    };
  }

  const response = await admin.graphql(
    `#graphql
    mutation SyncBayUpdateVariantCommercialFields($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants {
          id
          sku
          price
          compareAtPrice
          inventoryItem {
            id
            tracked
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        productId: input.product.id,
        variants: [
          {
            compareAtPrice,
            id: variant.id,
            price,
          },
        ],
      },
    },
  );
  const json =
    (await response.json()) as ShopifyProductVariantsBulkUpdateResponse;

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

  const updatedVariant =
    json.data?.productVariantsBulkUpdate?.productVariants?.[0];

  if (!updatedVariant) {
    return {
      errorMessage: "Shopify non ha restituito la variante aggiornata.",
      status: "failed",
    };
  }

  const inventoryItemGid =
    updatedVariant.inventoryItem?.id ?? variant.inventoryItem?.id ?? null;
  const sku = input.draftProduct.previewItem.normalized.sku;

  if (sku && !inventoryItemGid) {
    return {
      errorMessage:
        "Inventory item Shopify non restituito per aggiornare lo SKU.",
      status: "failed",
    };
  }

  if (sku && inventoryItemGid) {
    const skuResult = await updateShopifyInventoryItemSku(
      admin,
      inventoryItemGid,
      sku,
    );

    if (skuResult.status === "failed") return skuResult;
  }

  return {
    product: {
      ...input.product,
      variants: {
        nodes: [
          {
            ...variant,
            inventoryItem: inventoryItemGid
              ? {
                  ...(updatedVariant.inventoryItem ?? variant.inventoryItem),
                  id: inventoryItemGid,
                  sku: sku ?? updatedVariant.inventoryItem?.sku ?? null,
                }
              : (updatedVariant.inventoryItem ?? variant.inventoryItem),
            price: updatedVariant.price,
            compareAtPrice: updatedVariant.compareAtPrice,
            sku: updatedVariant.sku ?? variant.sku,
          },
        ],
      },
    },
    status: "synced",
  };
}

async function updateShopifyInventoryItemSku(
  admin: ShopifyAdminGraphqlClient,
  inventoryItemGid: string,
  sku: string,
): Promise<{ status: "synced" } | { errorMessage: string; status: "failed" }> {
  const response = await admin.graphql(
    `#graphql
    mutation SyncBayUpdateInventorySku($id: ID!, $input: InventoryItemInput!) {
      inventoryItemUpdate(id: $id, input: $input) {
        inventoryItem {
          id
          sku
          tracked
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        id: inventoryItemGid,
        input: {
          sku,
        },
      },
    },
  );
  const json = (await response.json()) as ShopifyInventoryItemUpdateResponse;

  if (!response.ok) {
    return {
      errorMessage: `Shopify inventoryItemUpdate ha risposto con stato HTTP ${response.status}.`,
      status: "failed",
    };
  }

  if (json.errors?.length) {
    return {
      errorMessage: formatShopifyGraphqlErrors(json.errors),
      status: "failed",
    };
  }

  const userErrors = json.data?.inventoryItemUpdate?.userErrors ?? [];

  if (userErrors.length > 0) {
    return {
      errorMessage: formatShopifyUserErrors(userErrors),
      status: "failed",
    };
  }

  return { status: "synced" };
}

async function syncShopifyMediaFromEbayImages(
  admin: ShopifyAdminGraphqlClient,
  product: NonNullable<ShopifyCreatedProduct>,
  draftProduct: ShopifyDraftProductInput,
  context: {
    jobId: string;
  },
): Promise<ShopifyMediaSyncResult> {
  const existingImageMediaIds = getProductImageMediaIds(product);
  const sourceMedia = draftProduct.media;
  const stagedObjectPaths: string[] = [];
  const failedResults: ShopifyMediaSyncResult["failedResults"] = [];
  let directCreatedCount = 0;
  let stagedCreatedCount = 0;
  let deletedCount = 0;

  if (
    !shouldSyncExistingCatalogImages({
      currentImageCount: existingImageMediaIds.length,
      fieldPolicy: draftProduct.existingCatalogFieldPolicy,
    })
  ) {
    return {
      createdCount: 0,
      deletedCount: 0,
      directCreatedCount: 0,
      failedResults: [],
      preservedCount: existingImageMediaIds.length,
      requestedCount: 0,
      sourceImageUrls: [],
      stagedCreatedCount: 0,
      stagedObjectPaths,
      status: "synced",
    };
  }

  if (existingImageMediaIds.length > 0 && sourceMedia.length > 0) {
    const deleteResult = await deleteShopifyProductMediaFiles(
      admin,
      product.id,
      existingImageMediaIds,
    );

    if (deleteResult.status === "failed") {
      return {
        createdCount: 0,
        deletedCount: 0,
        directCreatedCount: 0,
        failedResults: [
          {
            errorMessage: deleteResult.errorMessage,
            index: -1,
            sourceUrl: "",
          },
        ],
        requestedCount: sourceMedia.length,
        sourceImageUrls: sourceMedia.map((media) => media.originalSource),
        stagedCreatedCount: 0,
        stagedObjectPaths,
        status: "failed",
      };
    }

    deletedCount = deleteResult.deletedCount;
  }

  const mediaResults = await mapWithConcurrency(
    sourceMedia.map((media, index) => ({ index, media })),
    SHOPIFY_MEDIA_SYNC_CONCURRENCY,
    async ({ index, media }) => {
      const directResult = await addShopifyProductMedia(admin, {
        media,
        productGid: product.id,
      });

      if (directResult.status === "synced") {
        return { mode: "direct" as const, status: "synced" as const };
      }

      const stagedResult = await createStagedImageMediaInput({
        ebayItemId: draftProduct.source.ebayItemId,
        index,
        jobId: context.jobId,
        media,
      });

      if (stagedResult.status === "failed") {
        return {
          errorMessage: `${directResult.errorMessage}; fallback Supabase non riuscito: ${stagedResult.errorMessage}`,
          index,
          sourceUrl: media.originalSource,
          status: "failed" as const,
        };
      }

      const stagedMediaResult = await addShopifyProductMedia(admin, {
        media: stagedResult.media,
        productGid: product.id,
      });

      if (stagedMediaResult.status === "failed") {
        return {
          errorMessage: `${directResult.errorMessage}; fallback Supabase caricato ma rifiutato da Shopify: ${stagedMediaResult.errorMessage}`,
          index,
          sourceUrl: media.originalSource,
          status: "failed" as const,
        };
      }

      return {
        mode: "staged" as const,
        objectPath: stagedResult.objectPath,
        status: "synced" as const,
      };
    },
  );

  for (const result of mediaResults) {
    if (result.status === "failed") {
      failedResults.push({
        errorMessage: result.errorMessage,
        index: result.index,
        sourceUrl: result.sourceUrl,
      });
      continue;
    }

    if (result.mode === "direct") {
      directCreatedCount += 1;
      continue;
    }

    stagedCreatedCount += 1;
    stagedObjectPaths.push(result.objectPath);
  }

  const createdCount = directCreatedCount + stagedCreatedCount;

  return {
    createdCount,
    deletedCount,
    directCreatedCount,
    failedResults,
    requestedCount: sourceMedia.length,
    sourceImageUrls: sourceMedia.map((media) => media.originalSource),
    stagedCreatedCount,
    stagedObjectPaths,
    status: failedResults.length > 0 ? "failed" : "synced",
  };
}

async function addShopifyProductMedia(
  admin: ShopifyAdminGraphqlClient,
  input: {
    media: ShopifyDraftProductInput["media"][number];
    productGid: string;
  },
): Promise<{ status: "synced" } | { errorMessage: string; status: "failed" }> {
  const response = await admin.graphql(
    `#graphql
    mutation SyncBayAddProductMedia($media: [CreateMediaInput!], $product: ProductUpdateInput!) {
      productUpdate(media: $media, product: $product) {
        product {
          id
          media(first: 250) {
            nodes {
              alt
              id
              mediaContentType
              preview {
                status
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        media: [input.media],
        product: {
          id: input.productGid,
        },
      },
    },
  );
  const json = (await response.json()) as ShopifyProductUpdateResponse;

  if (!response.ok) {
    return {
      errorMessage: `Shopify productUpdate media ha risposto con stato HTTP ${response.status}.`,
      status: "failed",
    };
  }

  if (json.errors?.length) {
    return {
      errorMessage: formatShopifyGraphqlErrors(json.errors),
      status: "failed",
    };
  }

  const userErrors = json.data?.productUpdate?.userErrors ?? [];

  if (userErrors.length > 0) {
    return {
      errorMessage: formatShopifyUserErrors(userErrors),
      status: "failed",
    };
  }

  return { status: "synced" };
}

async function deleteShopifyProductMediaFiles(
  admin: ShopifyAdminGraphqlClient,
  productGid: string,
  mediaIds: string[],
): Promise<
  | { deletedCount: number; status: "synced" }
  | { errorMessage: string; status: "failed" }
> {
  const uniqueMediaIds = [...new Set(mediaIds)];

  if (uniqueMediaIds.length === 0) {
    return {
      deletedCount: 0,
      status: "synced",
    };
  }

  const response = await admin.graphql(
    `#graphql
    mutation SyncBayDeleteProductMediaFiles($mediaIds: [ID!]!, $productId: ID!) {
      productDeleteMedia(mediaIds: $mediaIds, productId: $productId) {
        deletedMediaIds
        deletedProductImageIds
        product {
          id
          media(first: 250) {
            nodes {
              alt
              id
              mediaContentType
              preview {
                status
              }
            }
          }
        }
        mediaUserErrors {
          code
          field
          message
        }
      }
    }`,
    {
      variables: {
        mediaIds: uniqueMediaIds,
        productId: productGid,
      },
    },
  );
  const json = (await response.json()) as ShopifyProductDeleteMediaResponse;

  if (!response.ok) {
    return {
      errorMessage: `Shopify productDeleteMedia ha risposto con stato HTTP ${response.status}.`,
      status: "failed",
    };
  }

  if (json.errors?.length) {
    return {
      errorMessage: formatShopifyGraphqlErrors(json.errors),
      status: "failed",
    };
  }

  const userErrors = json.data?.productDeleteMedia?.mediaUserErrors ?? [];

  if (userErrors.length > 0) {
    return {
      errorMessage: formatShopifyUserErrors(userErrors),
      status: "failed",
    };
  }

  return {
    deletedCount:
      json.data?.productDeleteMedia?.deletedMediaIds?.length ??
      json.data?.productDeleteMedia?.deletedProductImageIds?.length ??
      uniqueMediaIds.length,
    status: "synced",
  };
}

async function createStagedImageMediaInput(input: {
  ebayItemId: string;
  index: number;
  jobId: string;
  media: ShopifyDraftProductInput["media"][number];
}): Promise<
  | {
      media: ShopifyDraftProductInput["media"][number];
      objectPath: string;
      status: "synced";
    }
  | {
      errorMessage: string;
      status: "failed";
    }
> {
  const config = getSupabaseStorageConfig();

  if (!config) {
    return {
      errorMessage:
        "Supabase Storage fallback non configurato nel runtime server.",
      status: "failed",
    };
  }

  const imageResult = await downloadImageForStaging(input.media.originalSource);

  if (imageResult.status === "failed") {
    return imageResult;
  }

  const objectPath = buildSupabaseImageObjectPath({
    contentType: imageResult.contentType,
    ebayItemId: input.ebayItemId,
    index: input.index,
    jobId: input.jobId,
    sourceUrl: input.media.originalSource,
  });
  const uploadResult = await uploadSupabaseStorageObject({
    body: imageResult.body,
    bucket: config.bucket,
    contentType: imageResult.contentType,
    objectPath,
    serviceRoleKey: config.serviceRoleKey,
    supabaseUrl: config.supabaseUrl,
  });

  if (uploadResult.status === "failed") {
    return uploadResult;
  }

  const signedUrlResult = await createSupabaseSignedUrl({
    bucket: config.bucket,
    objectPath,
    serviceRoleKey: config.serviceRoleKey,
    supabaseUrl: config.supabaseUrl,
  });

  if (signedUrlResult.status === "failed") {
    return signedUrlResult;
  }

  return {
    media: {
      ...input.media,
      originalSource: signedUrlResult.signedUrl,
    },
    objectPath,
    status: "synced",
  };
}

async function downloadImageForStaging(sourceUrl: string): Promise<
  | {
      body: Uint8Array;
      contentType: string;
      status: "synced";
    }
  | {
      errorMessage: string;
      status: "failed";
    }
> {
  const response = await fetch(sourceUrl, {
    headers: {
      "user-agent": "SyncBay/0.1 image-staging",
    },
  });

  if (!response.ok) {
    return {
      errorMessage: `Download immagine eBay fallito con HTTP ${response.status}.`,
      status: "failed",
    };
  }

  const contentType = normalizeImageContentType(
    response.headers.get("content-type"),
    sourceUrl,
  );

  if (!contentType) {
    return {
      errorMessage:
        "Il download immagine non ha restituito un content-type immagine supportato.",
      status: "failed",
    };
  }

  const body = new Uint8Array(await response.arrayBuffer());

  if (body.byteLength === 0) {
    return {
      errorMessage: "Il download immagine ha restituito un file vuoto.",
      status: "failed",
    };
  }

  return {
    body,
    contentType,
    status: "synced",
  };
}

async function uploadSupabaseStorageObject(input: {
  body: Uint8Array;
  bucket: string;
  contentType: string;
  objectPath: string;
  serviceRoleKey: string;
  supabaseUrl: string;
}): Promise<{ status: "synced" } | { errorMessage: string; status: "failed" }> {
  const response = await fetch(
    `${input.supabaseUrl}/storage/v1/object/${encodeURIComponent(input.bucket)}/${encodeSupabaseObjectPath(input.objectPath)}`,
    {
      body: Buffer.from(input.body),
      headers: {
        apikey: input.serviceRoleKey,
        authorization: `Bearer ${input.serviceRoleKey}`,
        "cache-control": "31536000",
        "content-type": input.contentType,
        "x-upsert": "true",
      },
      method: "POST",
    },
  );

  if (!response.ok) {
    return {
      errorMessage: `Upload Supabase Storage fallito con HTTP ${response.status}: ${await readShortResponseText(response)}`,
      status: "failed",
    };
  }

  return { status: "synced" };
}

async function createSupabaseSignedUrl(input: {
  bucket: string;
  objectPath: string;
  serviceRoleKey: string;
  supabaseUrl: string;
}): Promise<
  | { signedUrl: string; status: "synced" }
  | { errorMessage: string; status: "failed" }
> {
  const response = await fetch(
    `${input.supabaseUrl}/storage/v1/object/sign/${encodeURIComponent(input.bucket)}/${encodeSupabaseObjectPath(input.objectPath)}`,
    {
      body: JSON.stringify({
        expiresIn: SUPABASE_SIGNED_URL_TTL_SECONDS,
      }),
      headers: {
        apikey: input.serviceRoleKey,
        authorization: `Bearer ${input.serviceRoleKey}`,
        "content-type": "application/json",
      },
      method: "POST",
    },
  );

  if (!response.ok) {
    return {
      errorMessage: `Creazione signed URL Supabase fallita con HTTP ${response.status}: ${await readShortResponseText(response)}`,
      status: "failed",
    };
  }

  const json = (await response.json()) as { signedURL?: string };
  const signedUrl = json.signedURL;

  if (!signedUrl) {
    return {
      errorMessage: "Supabase Storage non ha restituito una signed URL.",
      status: "failed",
    };
  }

  return {
    signedUrl: signedUrl.startsWith("http")
      ? signedUrl
      : `${input.supabaseUrl}/storage/v1${signedUrl}`,
    status: "synced",
  };
}

async function updateShopifyInventoryItemTracking(
  admin: ShopifyAdminGraphqlClient,
  inventoryItemGid: string,
): Promise<{ status: "synced" } | { errorMessage: string; status: "failed" }> {
  const response = await admin.graphql(
    `#graphql
    mutation SyncBayTrackInventoryItem($id: ID!, $input: InventoryItemInput!) {
      inventoryItemUpdate(id: $id, input: $input) {
        inventoryItem {
          id
          tracked
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        id: inventoryItemGid,
        input: {
          tracked: true,
        },
      },
    },
  );
  const json = (await response.json()) as ShopifyInventoryItemUpdateResponse;

  if (!response.ok) {
    return {
      errorMessage: `Shopify inventoryItemUpdate ha risposto con stato HTTP ${response.status}.`,
      status: "failed",
    };
  }

  if (json.errors?.length) {
    return {
      errorMessage: formatShopifyGraphqlErrors(json.errors),
      status: "failed",
    };
  }

  const userErrors = json.data?.inventoryItemUpdate?.userErrors ?? [];

  if (userErrors.length > 0) {
    return {
      errorMessage: formatShopifyUserErrors(userErrors),
      status: "failed",
    };
  }

  return { status: "synced" };
}

async function activateShopifyInventoryAtLocation(
  admin: ShopifyAdminGraphqlClient,
  input: {
    inventoryItemGid: string;
    locationGid: string;
    quantity: number;
  },
): Promise<{ status: "synced" } | { errorMessage: string; status: "failed" }> {
  const response = await admin.graphql(
    `#graphql
    mutation SyncBayActivateInventoryItem($available: Int, $idempotencyKey: String!, $inventoryItemId: ID!, $locationId: ID!) {
      inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: $available) @idempotent(key: $idempotencyKey) {
        inventoryLevel {
          id
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        available: input.quantity,
        idempotencyKey: buildShopifyMutationIdempotencyKey({
          inventoryItemGid: input.inventoryItemGid,
          locationGid: input.locationGid,
          operation: "inventory-activate",
          quantity: input.quantity,
        }),
        inventoryItemId: input.inventoryItemGid,
        locationId: input.locationGid,
      },
    },
  );
  const json = (await response.json()) as ShopifyInventoryActivateResponse;

  if (!response.ok) {
    return {
      errorMessage: `Shopify inventoryActivate ha risposto con stato HTTP ${response.status}.`,
      status: "failed",
    };
  }

  if (json.errors?.length) {
    return {
      errorMessage: formatShopifyGraphqlErrors(json.errors),
      status: "failed",
    };
  }

  const userErrors = json.data?.inventoryActivate?.userErrors ?? [];

  if (userErrors.length > 0 && !isAlreadyActiveInventoryError(userErrors)) {
    return {
      errorMessage: formatShopifyUserErrors(userErrors),
      status: "failed",
    };
  }

  return { status: "synced" };
}

async function setShopifyInventoryQuantity(
  admin: ShopifyAdminGraphqlClient,
  input: {
    inventoryItemGid: string;
    jobId: string;
    locationGid: string;
    quantity: number;
  },
): Promise<{ status: "synced" } | { errorMessage: string; status: "failed" }> {
  const currentQuantityResult = await getShopifyInventoryAvailableQuantity(
    admin,
    {
      inventoryItemGid: input.inventoryItemGid,
      locationGid: input.locationGid,
    },
  );

  if (currentQuantityResult.status === "failed") return currentQuantityResult;

  const changeFromQuantity = currentQuantityResult.availableQuantity ?? 0;

  const response = await admin.graphql(
    `#graphql
    mutation SyncBaySetInventoryQuantity($idempotencyKey: String!, $input: InventorySetQuantitiesInput!) {
      inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
        inventoryAdjustmentGroup {
          referenceDocumentUri
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        idempotencyKey: buildShopifyMutationIdempotencyKey({
          inventoryItemGid: input.inventoryItemGid,
          jobId: input.jobId,
          locationGid: input.locationGid,
          changeFromQuantity,
          operation: "inventory-set-quantities",
          quantity: input.quantity,
        }),
        input: {
          name: "available",
          quantities: [
            {
              changeFromQuantity,
              inventoryItemId: input.inventoryItemGid,
              locationId: input.locationGid,
              quantity: input.quantity,
            },
          ],
          reason: "correction",
          referenceDocumentUri: `gid://syncbay/SyncJob/${input.jobId}`,
        },
      },
    },
  );
  const json = (await response.json()) as ShopifyInventorySetQuantitiesResponse;

  if (!response.ok) {
    return {
      errorMessage: `Shopify inventorySetQuantities ha risposto con stato HTTP ${response.status}.`,
      status: "failed",
    };
  }

  if (json.errors?.length) {
    return {
      errorMessage: formatShopifyGraphqlErrors(json.errors),
      status: "failed",
    };
  }

  const userErrors = json.data?.inventorySetQuantities?.userErrors ?? [];

  if (userErrors.length > 0) {
    return {
      errorMessage: formatShopifyUserErrors(userErrors),
      status: "failed",
    };
  }

  return { status: "synced" };
}

/**
 * Mette un prodotto Shopify nello stato "esaurito" quando il listing eBay
 * collegato è diventato inattivo: lo stato del prodotto resta ACTIVE (la pagina
 * e il suo URL restano serviti e indicizzabili), la scorta viene azzerata con
 * politica DENY e viene applicato il tag `esaurito`. Vedi ADR 0011.
 *
 * Non lancia per problemi parziali su scorta o tag: raccoglie avvisi e li
 * restituisce, così il listing risulta comunque marcato come esaurito.
 */
export async function markShopifyProductSoldOut(
  admin: ShopifyAdminGraphqlClient,
  input: {
    jobId: string;
    locationGid: string | null;
    productGid: string;
    variantGid?: string | null;
  },
): Promise<{ status: "synced"; warnings: string[] }> {
  const warnings: string[] = [];

  const hasMappedVariant = shouldUseMappedShopifyVariant({
    mappedVariantGid: input.variantGid,
  });
  const variant = hasMappedVariant
    ? await getShopifyVariantForSoldOut(admin, input.variantGid?.trim() ?? "")
    : await getFirstShopifyProductVariantForSoldOut(admin, input.productGid);
  const inventoryItemGid = variant?.inventoryItem?.id ?? null;

  if (hasMappedVariant && !variant) {
    warnings.push(
      "Variante Shopify mappata non disponibile: scorta e policy non aggiornate.",
    );
  }

  if (variant) {
    const policyResult = await setShopifyVariantInventoryPolicyDeny(admin, {
      productGid: input.productGid,
      variantGid: variant.id,
    });

    if (policyResult.status === "failed") {
      warnings.push(policyResult.errorMessage);
    }
  } else if (!hasMappedVariant) {
    warnings.push(
      "Politica di inventario non aggiornata: variante Shopify non disponibile.",
    );
  }

  if (variant && inventoryItemGid && input.locationGid) {
    const trackingResult = await updateShopifyInventoryItemTracking(
      admin,
      inventoryItemGid,
    );

    if (trackingResult.status === "failed") {
      warnings.push(trackingResult.errorMessage);
    } else {
      const activationResult = await activateShopifyInventoryAtLocation(admin, {
        inventoryItemGid,
        locationGid: input.locationGid,
        quantity: 0,
      });

      if (activationResult.status === "failed") {
        warnings.push(activationResult.errorMessage);
      }

      const quantityResult = await setShopifyInventoryQuantity(admin, {
        inventoryItemGid,
        jobId: input.jobId,
        locationGid: input.locationGid,
        quantity: 0,
      });

      if (quantityResult.status === "failed") {
        warnings.push(quantityResult.errorMessage);
      }
    }
  } else if (!input.locationGid) {
    warnings.push("Scorta non azzerata: location Shopify predefinita assente.");
  } else if (!inventoryItemGid) {
    warnings.push(
      "Scorta non azzerata: inventory item Shopify non disponibile.",
    );
  }

  const tagResult = await updateShopifyProductTag(admin, {
    operation: "add",
    productGid: input.productGid,
    tag: SYNCBAY_SOLD_OUT_TAG,
  });

  if (tagResult.status === "failed") {
    warnings.push(tagResult.errorMessage);
  }

  return { status: "synced", warnings };
}

async function getFirstShopifyProductVariantForSoldOut(
  admin: ShopifyAdminGraphqlClient,
  productGid: string,
) {
  const lookupResponse = await admin.graphql(
    `#graphql
    query SyncBaySoldOutProductLookup($id: ID!) {
      node(id: $id) {
        ... on Product {
          id
          variants(first: 1) {
            nodes {
              id
              price
              compareAtPrice
              inventoryItem {
                id
                tracked
              }
            }
          }
        }
      }
    }`,
    {
      variables: {
        id: productGid,
      },
    },
  );

  if (!lookupResponse.ok) {
    throw new Error(
      `Shopify non ha restituito il prodotto da mettere in esaurito (HTTP ${lookupResponse.status}).`,
    );
  }

  const lookupJson =
    (await lookupResponse.json()) as ShopifyProductSoldOutLookupResponse;

  if (lookupJson.errors?.length) {
    throw new Error(formatShopifyGraphqlErrors(lookupJson.errors));
  }

  return lookupJson.data?.node?.variants?.nodes?.[0] ?? null;
}

async function getShopifyVariantForSoldOut(
  admin: ShopifyAdminGraphqlClient,
  variantGid: string,
) {
  const lookupResponse = await admin.graphql(
    `#graphql
    query SyncBaySoldOutVariantLookup($id: ID!) {
      node(id: $id) {
        ... on ProductVariant {
          id
          inventoryItem {
            id
            tracked
          }
        }
      }
    }`,
    {
      variables: {
        id: variantGid,
      },
    },
  );

  if (!lookupResponse.ok) {
    throw new Error(
      `Shopify non ha restituito la variante da mettere in esaurito (HTTP ${lookupResponse.status}).`,
    );
  }

  const lookupJson =
    (await lookupResponse.json()) as ShopifyVariantSoldOutLookupResponse;

  if (lookupJson.errors?.length) {
    throw new Error(formatShopifyGraphqlErrors(lookupJson.errors));
  }

  return lookupJson.data?.node ?? null;
}

/**
 * Rimuove il tag `esaurito` da un prodotto Shopify quando il listing eBay torna
 * attivo. Idempotente: usata nel percorso di riallineamento dei prodotti già
 * presenti. Vedi ADR 0011.
 */
async function clearShopifySoldOutTag(
  admin: ShopifyAdminGraphqlClient,
  productGid: string,
): Promise<{ status: "synced" } | { errorMessage: string; status: "failed" }> {
  return updateShopifyProductTag(admin, {
    operation: "remove",
    productGid,
    tag: SYNCBAY_SOLD_OUT_TAG,
  });
}

async function setShopifyVariantInventoryPolicyDeny(
  admin: ShopifyAdminGraphqlClient,
  input: {
    productGid: string;
    variantGid: string;
  },
): Promise<{ status: "synced" } | { errorMessage: string; status: "failed" }> {
  const response = await admin.graphql(
    `#graphql
    mutation SyncBaySetVariantInventoryPolicyDeny($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants {
          id
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
            id: input.variantGid,
            inventoryPolicy: "DENY",
          },
        ],
      },
    },
  );

  if (!response.ok) {
    return {
      errorMessage: `Shopify productVariantsBulkUpdate ha risposto con stato HTTP ${response.status}.`,
      status: "failed",
    };
  }

  const json =
    (await response.json()) as ShopifyProductVariantsBulkUpdateResponse;

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

  return { status: "synced" };
}

async function updateShopifyProductTag(
  admin: ShopifyAdminGraphqlClient,
  input: {
    operation: "add" | "remove";
    productGid: string;
    tag: string;
  },
): Promise<{ status: "synced" } | { errorMessage: string; status: "failed" }> {
  const mutationName = input.operation === "add" ? "tagsAdd" : "tagsRemove";
  const response = await admin.graphql(
    `#graphql
    mutation SyncBayUpdateProductTag($id: ID!, $tags: [String!]!) {
      ${mutationName}(id: $id, tags: $tags) {
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        id: input.productGid,
        tags: [input.tag],
      },
    },
  );

  if (!response.ok) {
    return {
      errorMessage: `Shopify ${mutationName} ha risposto con stato HTTP ${response.status}.`,
      status: "failed",
    };
  }

  const json = (await response.json()) as ShopifyProductTagsResponse;

  if (json.errors?.length) {
    return {
      errorMessage: formatShopifyGraphqlErrors(json.errors),
      status: "failed",
    };
  }

  const userErrors =
    (input.operation === "add"
      ? json.data?.tagsAdd?.userErrors
      : json.data?.tagsRemove?.userErrors) ?? [];

  if (userErrors.length > 0) {
    return {
      errorMessage: formatShopifyUserErrors(userErrors),
      status: "failed",
    };
  }

  return { status: "synced" };
}

async function getShopifyInventoryAvailableQuantity(
  admin: ShopifyAdminGraphqlClient,
  input: {
    inventoryItemGid: string;
    locationGid: string;
  },
): Promise<
  | {
      availableQuantity: number | null;
      status: "synced";
    }
  | { errorMessage: string; status: "failed" }
> {
  const response = await admin.graphql(
    `#graphql
    query SyncBayCurrentInventoryQuantity($inventoryItemGid: ID!, $locationGid: ID!) {
      node(id: $inventoryItemGid) {
        ... on InventoryItem {
          id
          inventoryLevel(locationId: $locationGid) {
            quantities(names: ["available"]) {
              name
              quantity
            }
          }
        }
      }
    }`,
    {
      variables: {
        inventoryItemGid: input.inventoryItemGid,
        locationGid: input.locationGid,
      },
    },
  );
  const json = (await response.json()) as ShopifyInventoryVerificationResponse;

  if (!response.ok) {
    return {
      errorMessage: `Shopify lettura quantità corrente ha risposto con stato HTTP ${response.status}.`,
      status: "failed",
    };
  }

  if (json.errors?.length) {
    return {
      errorMessage: formatShopifyGraphqlErrors(json.errors),
      status: "failed",
    };
  }

  const inventoryItem = json.data?.node;

  if (!inventoryItem) {
    return {
      errorMessage:
        "Shopify non ha restituito l'inventory item per leggere la quantità corrente.",
      status: "failed",
    };
  }

  return {
    availableQuantity:
      inventoryItem.inventoryLevel?.quantities?.find(
        (quantity) => quantity.name === "available",
      )?.quantity ?? null,
    status: "synced",
  };
}

async function verifyShopifyInventoryAtLocation(
  admin: ShopifyAdminGraphqlClient,
  input: {
    inventoryItemGid: string;
    locationGid: string;
    quantity: number;
  },
): Promise<
  | { status: "synced"; warning?: string }
  | { errorMessage: string; status: "failed" }
> {
  const response = await admin.graphql(
    `#graphql
    query SyncBayVerifyInventory($inventoryItemGid: ID!, $locationGid: ID!) {
      node(id: $inventoryItemGid) {
        ... on InventoryItem {
          id
          tracked
          inventoryLevel(locationId: $locationGid) {
            quantities(names: ["available"]) {
              name
              quantity
            }
          }
        }
      }
    }`,
    {
      variables: {
        inventoryItemGid: input.inventoryItemGid,
        locationGid: input.locationGid,
      },
    },
  );
  const json = (await response.json()) as ShopifyInventoryVerificationResponse;

  if (!response.ok) {
    return {
      errorMessage: `Shopify verifica inventario ha risposto con stato HTTP ${response.status}.`,
      status: "failed",
    };
  }

  if (json.errors?.length) {
    return {
      errorMessage: formatShopifyGraphqlErrors(json.errors),
      status: "failed",
    };
  }

  const inventoryItem = json.data?.node;

  if (!inventoryItem) {
    return {
      errorMessage: "Shopify non ha restituito l'inventory item da verificare.",
      status: "failed",
    };
  }

  if (inventoryItem.tracked !== true) {
    return {
      errorMessage: "Shopify non ha confermato il tracking scorte attivo.",
      status: "failed",
    };
  }

  const availableQuantity =
    inventoryItem.inventoryLevel?.quantities?.find(
      (quantity) => quantity.name === "available",
    )?.quantity ?? null;

  if (availableQuantity !== input.quantity) {
    return {
      warning: `Shopify riporta una quantità diversa (${availableQuantity ?? "assente"}) rispetto a quella appena scritta (${input.quantity}); la verifica può variare per aggiornamenti concorrenti.`,
      status: "synced",
    };
  }

  return { status: "synced" };
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

async function startDraftImportJob(input: {
  catalogImportRunId?: string | null;
  draftLimit: number;
  importProductStatus: ImportProductStatus;
  previewMode: ImportPreviewResult["mode"];
  products: ShopifyDraftProductInput[];
  reuseOnly: boolean;
  shopId: string;
}) {
  const now = new Date();
  const payload = buildDraftImportJobPayload(input);
  const idempotencyKey = buildDraftImportJobIdempotencyKey(input);
  const job = await prisma.syncJob.upsert({
    where: { idempotencyKey },
    create: {
      attempts: 1,
      idempotencyKey,
      maxAttempts: DRAFT_IMPORT_MAX_ATTEMPTS,
      payload,
      runAfter: now,
      shopId: input.shopId,
      startedAt: now,
      status: SyncJobStatus.RUNNING,
      type: SyncJobType.IMPORT_CATALOG,
    },
    update: {
      attempts: { increment: 1 },
      errorCode: null,
      errorMessage: null,
      finishedAt: null,
      maxAttempts: DRAFT_IMPORT_MAX_ATTEMPTS,
      payload,
      result: Prisma.DbNull,
      runAfter: now,
      startedAt: now,
      status: SyncJobStatus.RUNNING,
    },
  });

  await prisma.auditLog.create({
    select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
    data: {
      details: payload,
      message: "Import Shopify avviato.",
      shopId: input.shopId,
      type: AuditEventType.SYNC_JOB_CREATED,
    },
  });

  return job;
}

async function recordDraftImportPersistence(input: {
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
        const variantGid =
          getFirstProductVariant(pair.result.product)?.id ?? null;
        const ebaySnapshot = buildEbayProductSnapshot({
          draftProduct: pair.draftProduct,
          mappingId: "",
          shopId: input.shopId,
        });
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
            shopifyVariantGid: variantGid,
            sku: pair.draftProduct.previewItem.normalized.sku,
            status: ProductMappingStatus.ACTIVE,
            ...(thumbnailUrl ? { thumbnailUrl } : {}),
          },
        });

        await tx.productSnapshot.createMany({
          data: [
            { ...ebaySnapshot, mappingId: mapping.id },
            buildSyncBayProductSnapshot({
              draftProduct: pair.draftProduct,
              importProductStatus: normalizeImportProductStatus(
                pair.draftProduct.product.status,
              ),
              jobId: input.jobId,
              mappingId: mapping.id,
              result: pair.result,
              shopId: input.shopId,
            }),
          ],
        });
      }),
    );
  });

  return {
    createdCount: successfulPairs.filter(
      (pair) => pair.result.resultType === "created",
    ).length,
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
    mediaFailedCount: successfulPairs.filter(
      (pair) => pair.result.mediaSync.status === "failed",
    ).length,
    mediaImageCreatedCount: successfulPairs.reduce(
      (total, pair) => total + pair.result.mediaSync.createdCount,
      0,
    ),
    mediaStagedCount: successfulPairs.reduce(
      (total, pair) => total + pair.result.mediaSync.stagedCreatedCount,
      0,
    ),
    mediaSyncedCount: successfulPairs.filter(
      (pair) => pair.result.mediaSync.status === "synced",
    ).length,
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
    reusedCount: successfulPairs.filter(
      (pair) => pair.result.resultType === "reused",
    ).length,
  };
}

async function finishDraftImportJob(input: {
  errorMessage?: string;
  importProductStatus: ImportProductStatus;
  jobId: string;
  persistenceResult: DraftImportPersistenceResult;
  products: ShopifyDraftProductInput[];
  results: ShopifyDraftProductResult[];
  shopId: string;
  status: "created" | "failed";
  warnings: string[];
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
  const resultPayload = {
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
    publicationPublishedCount:
      input.persistenceResult.publicationPublishedCount,
    publicationSkippedCount: input.persistenceResult.publicationSkippedCount,
    publicationSyncedCount: input.persistenceResult.publicationSyncedCount,
    requestedCount: input.products.length,
    reusedCount: input.persistenceResult.reusedCount,
    warnings: [...new Set(input.warnings)],
  } satisfies Prisma.JsonObject;
  const success = input.status === "created";
  const job = await prisma.syncJob.findUnique({
    where: { id: input.jobId },
  });
  const retryAt =
    !success && job && job.attempts < job.maxAttempts
      ? getDraftImportRetryAfter(job.attempts)
      : null;
  const finalResultPayload = {
    ...resultPayload,
    retryScheduledAt: retryAt?.toISOString() ?? null,
    willRetry: Boolean(retryAt),
  } satisfies Prisma.JsonObject;

  await prisma.$transaction([
    prisma.syncJob.update({
      data: {
        errorCode: success ? null : "SHOPIFY_DRAFT_IMPORT_FAILED",
        errorMessage: success ? null : input.errorMessage,
        finishedAt: new Date(),
        result: finalResultPayload,
        runAfter: retryAt ?? undefined,
        status: success
          ? SyncJobStatus.SUCCEEDED
          : retryAt
            ? SyncJobStatus.RETRYING
            : SyncJobStatus.FAILED,
      },
      where: { id: input.jobId },
    }),
    prisma.auditLog.create({
      select: SYNCBAY_AUDIT_LOG_CREATE_SELECT,
      data: {
        details: finalResultPayload,
        message: success
          ? "Import Shopify completato."
          : retryAt
            ? "Import Shopify non completato; retry pianificato."
            : "Import Shopify non completato.",
        shopId: input.shopId,
        type: success
          ? AuditEventType.SYNC_JOB_SUCCEEDED
          : AuditEventType.SYNC_JOB_FAILED,
      },
    }),
  ]);
}

function getDraftImportRetryAfter(attempts: number) {
  const retryDelaySeconds = attempts <= 1 ? 60 : attempts === 2 ? 300 : 900;

  return new Date(Date.now() + retryDelaySeconds * 1000);
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

function buildSyncBayProductSnapshot(input: {
  draftProduct: ShopifyDraftProductInput;
  importProductStatus: ImportProductStatus;
  jobId: string;
  mappingId: string;
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
    imageCount:
      input.result.mediaSync.createdCount +
      (input.result.mediaSync.preservedCount ?? 0),
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

function getInventoryFailedResults(input: {
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

function getInventorySkippedResults(input: {
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

function getMediaFailedResults(input: {
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

function getInventorySyncWarning(result: ShopifyInventorySyncResult) {
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

function getMediaSyncWarning(result: ShopifyMediaSyncResult) {
  return `Immagini Shopify non completate: ${result.failedResults
    .map((failure) => failure.errorMessage)
    .join("; ")}`;
}

function getFirstProductVariant(product: ShopifyDraftProductNode) {
  return selectShopifyVariantForSync({
    variants: product.variants?.nodes,
  });
}

function getProductImageMediaIds(product: ShopifyDraftProductNode) {
  return getShopifyImageMediaIds(product.media?.nodes);
}

function formatShopifyGraphqlErrors(errors: Array<{ message: string }>) {
  return errors.map((error) => error.message).join("; ");
}

function formatShopifyUserErrors(errors: ShopifyUserError[]) {
  return errors
    .map((error) => {
      const code = error.code ? ` (${error.code})` : "";
      return `${error.message}${code}`;
    })
    .join("; ");
}

function isAlreadyActiveInventoryError(errors: ShopifyUserError[]) {
  return errors.every((error) => {
    const normalizedMessage = error.message.toLowerCase();

    return (
      normalizedMessage.includes("already") &&
      (normalizedMessage.includes("active") ||
        normalizedMessage.includes("stock"))
    );
  });
}

function buildDraftImportJobPayload(input: {
  catalogImportRunId?: string | null;
  draftLimit: number;
  importProductStatus: ImportProductStatus;
  previewMode: ImportPreviewResult["mode"];
  products: ShopifyDraftProductInput[];
  reuseOnly: boolean;
  shopId: string;
}) {
  return {
    catalogImportRunId: input.catalogImportRunId ?? null,
    draftLimit: input.draftLimit,
    ebayItemIds: input.products.map((product) => product.source.ebayItemId),
    importProductStatus: input.importProductStatus,
    marketplaceId: getEbayMarketplaceId(),
    previewMode: input.previewMode,
    requestedCount: input.products.length,
    ...(input.reuseOnly ? { reuseOnly: true } : {}),
    shopId: input.shopId,
    source: input.reuseOnly
      ? "existing_catalog_takeover"
      : "shopify_import",
  } satisfies Prisma.JsonObject;
}

function buildDraftImportJobIdempotencyKey(input: {
  catalogImportRunId?: string | null;
  importProductStatus: ImportProductStatus;
  previewMode: ImportPreviewResult["mode"];
  products: ShopifyDraftProductInput[];
  reuseOnly: boolean;
  shopId: string;
}) {
  const keyPayload: {
    catalogImportRunId?: string;
    ebayItemIds: string[];
    importProductStatus: ImportProductStatus;
    marketplaceId: string;
    previewMode: ImportPreviewResult["mode"];
    reuseOnly?: boolean;
    shopId: string;
  } = {
    ebayItemIds: input.products.map((product) => product.source.ebayItemId),
    importProductStatus: input.importProductStatus,
    marketplaceId: getEbayMarketplaceId(),
    previewMode: input.previewMode,
    shopId: input.shopId,
  };

  if (input.catalogImportRunId) {
    keyPayload.catalogImportRunId = input.catalogImportRunId;
  }
  if (input.reuseOnly) {
    keyPayload.reuseOnly = true;
  }

  const hash = createHash("sha256")
    .update(JSON.stringify(keyPayload))
    .digest("hex")
    .slice(0, 20);

  return `draft-import:${input.shopId}:${hash}`;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;

  return "Errore inatteso durante l'import Shopify.";
}

function getEbayMarketplaceId() {
  return process.env.EBAY_MARKETPLACE_ID ?? DEFAULT_MARKETPLACE_ID;
}

function getSupabaseStorageConfig() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket =
    process.env.SUPABASE_STORAGE_BUCKET?.trim() ?? "syncbay-import-staging";

  if (!supabaseUrl || !serviceRoleKey || !bucket) return null;

  return {
    bucket,
    serviceRoleKey,
    supabaseUrl,
  };
}

function buildShopifyMutationIdempotencyKey(input: {
  inventoryItemGid: string;
  jobId?: string;
  locationGid: string;
  operation: string;
  quantity: number;
  changeFromQuantity?: number;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        inventoryItemGid: input.inventoryItemGid,
        jobId: input.jobId ?? null,
        locationGid: input.locationGid,
        operation: input.operation,
        changeFromQuantity: input.changeFromQuantity ?? null,
        quantity: input.quantity,
      }),
    )
    .digest("hex");
}

function buildSupabaseImageObjectPath(input: {
  contentType: string;
  ebayItemId: string;
  index: number;
  jobId: string;
  sourceUrl: string;
}) {
  const hash = createHash("sha256")
    .update(input.sourceUrl)
    .digest("hex")
    .slice(0, 16);
  const extension = getImageExtension(input.contentType, input.sourceUrl);

  return [
    "imports",
    sanitizeStoragePathSegment(input.jobId),
    sanitizeStoragePathSegment(input.ebayItemId),
    `${String(input.index + 1).padStart(3, "0")}-${hash}.${extension}`,
  ].join("/");
}

function sanitizeStoragePathSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function encodeSupabaseObjectPath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function normalizeImageContentType(
  rawContentType: string | null,
  sourceUrl: string,
) {
  const contentType = rawContentType?.split(";")[0]?.trim().toLowerCase();

  if (contentType?.startsWith("image/")) return contentType;

  const extension = sourceUrl
    .split("?")[0]
    .split("#")[0]
    .split(".")
    .pop()
    ?.toLowerCase();

  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";

  return null;
}

function getImageExtension(contentType: string, sourceUrl: string) {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";

  return (
    sourceUrl
      .split("?")[0]
      .split("#")[0]
      .split(".")
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, "") || "jpg"
  );
}

async function readShortResponseText(response: Response) {
  const text = await response.text();

  return text.slice(0, 300);
}

function dedupeImageUrls(imageUrls: string[]) {
  return [...new Set(imageUrls.map((imageUrl) => imageUrl.trim()))].filter(
    Boolean,
  );
}

async function mapWithConcurrency<Input, Output>(
  items: Input[],
  concurrency: number,
  mapper: (item: Input, index: number) => Promise<Output>,
) {
  const results = new Array<Output>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  const runNext = (): Promise<void> => {
    const currentIndex = nextIndex;
    nextIndex += 1;

    if (currentIndex >= items.length) {
      return Promise.resolve();
    }

    return mapper(items[currentIndex], currentIndex).then((result) => {
      results[currentIndex] = result;
      return runNext();
    });
  };

  await Promise.all(Array.from({ length: workerCount }, () => runNext()));

  return results;
}

function getImportablePreviewItems(previewResult: ImportPreviewResult) {
  return previewResult.items.filter(isImportablePreviewItem);
}

function isImportablePreviewItem(item: ImportPreviewItem) {
  return item.status === "importable";
}

function buildSyncBayProductMetafields(item: ImportPreviewItem) {
  return [
    ...buildSyncBayBaseProductMetafields({
      ebayItemId: item.itemId,
      ebayPrimaryCategoryId: item.normalized.ebayPrimaryCategoryId,
      ebayPrimaryCategoryName: item.normalized.ebayPrimaryCategoryName,
      ebayPrimaryCategoryPath: item.normalized.ebayPrimaryCategoryPath,
      priceAmount: item.normalized.priceAmount,
      quantity: item.normalized.quantity,
      sku: item.normalized.sku,
      skuGenerated: item.normalized.skuGenerated,
      storeCategoryId: item.normalized.storeCategoryId,
      storeCategoryName: item.normalized.storeCategoryName,
    }),
    ...buildShopifyProductFacetMetafields(item.normalized.productFacets),
  ].filter((metafield): metafield is NonNullable<typeof metafield> =>
    Boolean(metafield),
  );
}

function buildSyncBayProductHandle(ebayItemId: string) {
  return `syncbay-ebay-${ebayItemId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
}

export function getDraftImportLimit() {
  const parsed = Number.parseInt(
    process.env.SYNCBAY_DRAFT_IMPORT_LIMIT ?? "",
    10,
  );

  if (!Number.isInteger(parsed)) return DEFAULT_DRAFT_IMPORT_LIMIT;

  return Math.min(Math.max(parsed, 1), MAX_DRAFT_IMPORT_LIMIT);
}
