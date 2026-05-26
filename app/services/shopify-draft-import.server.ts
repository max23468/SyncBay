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
import type {
  ImportPreviewItem,
  ImportPreviewResult,
} from "./import-preview.server";

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

interface ShopifyInventoryItemNode {
  id: string;
  tracked?: boolean | null;
}

interface ShopifyDraftProductVariantNode {
  id: string;
  inventoryItem?: ShopifyInventoryItemNode | null;
}

interface ShopifyDraftProductNode {
  id: string;
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
    productByHandle?: ShopifyDraftProductLookupNode | null;
    products?: {
      nodes?: ShopifyDraftProductLookupNode[];
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

export type ShopifyDraftImportStatus = "blocked" | "created" | "failed";

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
  managedCount: number;
  reusedCount: number;
};
const DRAFT_PRODUCT_CREATE_CONCURRENCY = 2;
const DEFAULT_DRAFT_IMPORT_LIMIT = 3;
const MAX_DRAFT_IMPORT_LIMIT = 50;
const MAX_DRAFT_MEDIA_PER_PRODUCT = 3;
const DRAFT_IMPORT_MAX_ATTEMPTS = 3;
const DEFAULT_MARKETPLACE_ID = "EBAY_IT";

type ShopifyInventorySyncResult =
  | {
      inventoryItemGid: string;
      locationGid: string;
      quantity: number;
      status: "synced";
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
    })
  | Extract<ShopifyDraftProductCreateResult, { status: "failed" }>;

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

export function buildShopifyDraftProductInputs(
  previewResult: ImportPreviewResult,
  importProductStatus: ImportProductStatus,
) {
  return getImportablePreviewItems(previewResult)
    .slice(0, getDraftImportLimit())
    .map((item) => ({
      media: item.normalized.imageUrls
        .slice(0, MAX_DRAFT_MEDIA_PER_PRODUCT)
        .map((imageUrl) => ({
          alt: item.normalized.title,
          mediaContentType: "IMAGE",
          originalSource: imageUrl,
        })),
      product: {
        descriptionHtml: item.normalized.descriptionHtml ?? undefined,
        handle: buildSyncBayProductHandle(item.itemId),
        metafields: buildSyncBayProductMetafields(item),
        status: importProductStatus,
        tags: ["SyncBay", "Import preview", "eBay import pilot"],
        title: item.normalized.title,
      },
      source: {
        ebayItemId: item.itemId,
      },
      previewItem: item,
    }));
}

export async function createShopifyDraftProductsIfEnabled(input: {
  admin: ShopifyAdminGraphqlClient;
  defaultLocationGid?: string | null;
  hasDefaultLocation: boolean;
  previewResult: ImportPreviewResult;
  shopDomain: string;
}) {
  const shop = await ensureDraftImportShop(input.shopDomain);
  const importProductStatus = normalizeImportProductStatus(
    shop.defaultProductStatus,
  );
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

  const draftProducts = buildShopifyDraftProductInputs(
    input.previewResult,
    importProductStatus,
  );
  const job = await startDraftImportJob({
    draftLimit: readiness.draftLimit,
    importProductStatus,
    previewMode: input.previewResult.mode,
    products: draftProducts,
    shopId: shop.id,
  });
  const results = await mapWithConcurrency(
    draftProducts,
    DRAFT_PRODUCT_CREATE_CONCURRENCY,
    (product) =>
      createShopifyDraftProductSafely(input.admin, product, {
        defaultLocationGid: input.defaultLocationGid ?? null,
        jobId: job.id,
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
  const inventoryFailureMessage =
    inventoryFailedResults.length > 0
      ? `Tracking scorte Shopify non completato per ${inventoryFailedResults.length} prodotti.`
      : null;
  const persistenceResult = await recordDraftImportPersistence({
    jobId: job.id,
    products: draftProducts,
    results,
    shopId: shop.id,
  });

  if (failedResult || inventoryFailureMessage) {
    await finishDraftImportJob({
      errorMessage:
        failedResult?.errorMessage ?? inventoryFailureMessage ?? undefined,
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
        failedResult?.errorMessage ?? inventoryFailureMessage ?? undefined,
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

async function createShopifyDraftProduct(
  admin: ShopifyAdminGraphqlClient,
  draftProduct: ShopifyDraftProductInput,
): Promise<ShopifyDraftProductCreateResult> {
  const existingProduct = await findExistingSyncBayDraftProduct(
    admin,
    draftProduct,
  );

  if (existingProduct) {
    return {
      product: existingProduct,
      resultType: "reused",
      status: "created",
      warnings: [
        "SyncBay ha riusato prodotti Shopify già presenti per lo stesso eBay ItemID e non ha creato duplicati.",
      ],
    };
  }

  const resultWithMedia = await createShopifyDraftProductRequest(
    admin,
    draftProduct,
  );

  if (resultWithMedia.status === "created" || draftProduct.media.length === 0) {
    return resultWithMedia;
  }

  const resultWithoutMedia = await createShopifyDraftProductRequest(admin, {
    ...draftProduct,
    media: [],
  });

  if (resultWithoutMedia.status === "created") {
    return {
      ...resultWithoutMedia,
      warnings: [
        "Shopify ha creato alcuni prodotti senza immagini perché le URL media esterne sono state rifiutate.",
      ],
    };
  }

  return resultWithMedia;
}

async function createShopifyDraftProductSafely(
  admin: ShopifyAdminGraphqlClient,
  draftProduct: ShopifyDraftProductInput,
  context: {
    defaultLocationGid: string | null;
    jobId: string;
  },
): Promise<ShopifyDraftProductResult> {
  try {
    const result = await createShopifyDraftProduct(admin, draftProduct);

    if (result.status === "failed") return result;

    const inventorySync = await syncShopifyInventoryFromEbayQuantity(
      admin,
      result.product,
      draftProduct,
      context,
    );
    const inventoryWarnings =
      inventorySync.status === "skipped" || inventorySync.status === "failed"
        ? [getInventorySyncWarning(inventorySync)]
        : [];

    return {
      ...result,
      inventorySync,
      warnings: [...(result.warnings ?? []), ...inventoryWarnings],
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
          id
          title
          variants(first: 1) {
            nodes {
              id
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
) {
  const response = await admin.graphql(
    `#graphql
    query SyncBayFindDraftProduct($handle: String!, $query: String!) {
      productByHandle(handle: $handle) {
        id
        title
        variants(first: 1) {
          nodes {
            id
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
      products(first: 250, query: $query) {
        nodes {
          id
          title
          variants(first: 1) {
            nodes {
              id
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
        handle: draftProduct.product.handle,
        query: "tag:SyncBay",
      },
    },
  );

  if (!response.ok) return null;

  const json = (await response.json()) as ShopifyProductLookupResponse;

  if (json.errors?.length) return null;

  const products = [
    json.data?.productByHandle ?? null,
    ...(json.data?.products?.nodes ?? []),
  ].filter((product): product is ShopifyDraftProductLookupNode =>
    Boolean(product),
  );

  return (
    products.find(
      (product) =>
        product.metafield?.value === draftProduct.source.ebayItemId ||
        product.id === json.data?.productByHandle?.id,
    ) ?? null
  );
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

  return {
    inventoryItemGid,
    locationGid: context.defaultLocationGid,
    quantity,
    status: "synced",
    variantGid: variant.id,
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
    mutation SyncBayActivateInventoryItem($available: Int, $inventoryItemId: ID!, $locationId: ID!) {
      inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: $available) {
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
  const response = await admin.graphql(
    `#graphql
    mutation SyncBaySetInventoryQuantity($input: InventorySetQuantitiesInput!) {
      inventorySetQuantities(input: $input) {
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
        input: {
          ignoreCompareQuantity: true,
          name: "available",
          quantities: [
            {
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
  draftLimit: number;
  importProductStatus: ImportProductStatus;
  previewMode: ImportPreviewResult["mode"];
  products: ShopifyDraftProductInput[];
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
    for (const pair of successfulPairs) {
      const now = new Date();
      const variantGid =
        getFirstProductVariant(pair.result.product)?.id ?? null;
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
        },
        update: {
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSyncedAt: now,
          shopifyProductGid: pair.result.product.id,
          shopifyVariantGid: variantGid,
          sku: pair.draftProduct.previewItem.normalized.sku,
          status: ProductMappingStatus.ACTIVE,
        },
      });

      await tx.productSnapshot.createMany({
        data: [
          buildEbayProductSnapshot({
            draftProduct: pair.draftProduct,
            mappingId: mapping.id,
            shopId: input.shopId,
          }),
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
    }
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
    managedCount: successfulPairs.length,
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
    descriptionHash: hashNullableText(item.normalized.descriptionHtml),
    ebayItemId: item.itemId,
    imageCount: input.draftProduct.media.length,
    mappingId: input.mappingId,
    payload: {
      handle: input.draftProduct.product.handle,
      importJobId: input.jobId,
      inventorySync: input.result.inventorySync,
      resultType: input.result.resultType,
      tags: input.draftProduct.product.tags,
    } satisfies Prisma.JsonObject,
    priceAmount: item.normalized.priceAmount,
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
  return {
    descriptionMode: item.normalized.descriptionMode,
    issueCodes: item.issues.map((issue) => issue.code),
    skuGenerated: item.normalized.skuGenerated,
    status: item.status,
  } satisfies Prisma.JsonObject;
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

function getInventorySyncWarning(result: ShopifyInventorySyncResult) {
  if (result.status === "failed") {
    return `Tracking scorte Shopify non completato: ${result.errorMessage}`;
  }

  if (result.status === "skipped") {
    return `Tracking scorte Shopify saltato: ${result.message}`;
  }

  return "";
}

function getFirstProductVariant(product: ShopifyDraftProductNode) {
  return product.variants?.nodes?.[0] ?? null;
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
  draftLimit: number;
  importProductStatus: ImportProductStatus;
  previewMode: ImportPreviewResult["mode"];
  products: ShopifyDraftProductInput[];
  shopId: string;
}) {
  return {
    draftLimit: input.draftLimit,
    ebayItemIds: input.products.map((product) => product.source.ebayItemId),
    importProductStatus: input.importProductStatus,
    marketplaceId: getEbayMarketplaceId(),
    previewMode: input.previewMode,
    requestedCount: input.products.length,
    shopId: input.shopId,
  } satisfies Prisma.JsonObject;
}

function buildDraftImportJobIdempotencyKey(input: {
  importProductStatus: ImportProductStatus;
  previewMode: ImportPreviewResult["mode"];
  products: ShopifyDraftProductInput[];
  shopId: string;
}) {
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        ebayItemIds: input.products.map((product) => product.source.ebayItemId),
        importProductStatus: input.importProductStatus,
        marketplaceId: getEbayMarketplaceId(),
        previewMode: input.previewMode,
        shopId: input.shopId,
      }),
    )
    .digest("hex")
    .slice(0, 20);

  return `draft-import:${input.shopId}:${hash}`;
}

function hashNullableText(value: string | null) {
  if (!value) return null;

  return createHash("sha256").update(value).digest("hex");
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;

  return "Errore inatteso durante l'import Shopify.";
}

function getEbayMarketplaceId() {
  return process.env.EBAY_MARKETPLACE_ID ?? DEFAULT_MARKETPLACE_ID;
}

async function mapWithConcurrency<Input, Output>(
  items: Input[],
  concurrency: number,
  mapper: (item: Input) => Promise<Output>,
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

    return mapper(items[currentIndex]).then((result) => {
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
    {
      key: "ebay_item_id",
      namespace: "syncbay",
      type: "single_line_text_field",
      value: item.itemId,
    },
    item.normalized.sku
      ? {
          key: "ebay_sku",
          namespace: "syncbay",
          type: "single_line_text_field",
          value: item.normalized.sku,
        }
      : null,
    item.normalized.priceAmount !== null
      ? {
          key: "ebay_price",
          namespace: "syncbay",
          type: "single_line_text_field",
          value: String(item.normalized.priceAmount),
        }
      : null,
    item.normalized.quantity !== null
      ? {
          key: "ebay_quantity",
          namespace: "syncbay",
          type: "single_line_text_field",
          value: String(item.normalized.quantity),
        }
      : null,
    item.normalized.skuGenerated
      ? {
          key: "sku_policy",
          namespace: "syncbay",
          type: "single_line_text_field",
          value: "generated_from_ebay_item_id",
        }
      : null,
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

function getDraftImportLimit() {
  const parsed = Number.parseInt(
    process.env.SYNCBAY_DRAFT_IMPORT_LIMIT ?? "",
    10,
  );

  if (!Number.isInteger(parsed)) return DEFAULT_DRAFT_IMPORT_LIMIT;

  return Math.min(Math.max(parsed, 1), MAX_DRAFT_IMPORT_LIMIT);
}
