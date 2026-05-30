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

interface ShopifyProductMediaNode {
  alt?: string | null;
  id: string;
  mediaContentType?: string | null;
  preview?: {
    status?: string | null;
  } | null;
}

interface ShopifyDraftProductNode {
  id: string;
  media?: {
    nodes?: ShopifyProductMediaNode[];
  } | null;
  status?: string | null;
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
  mediaDeletedCount: number;
  mediaFailedCount: number;
  mediaImageCreatedCount: number;
  mediaStagedCount: number;
  mediaSyncedCount: number;
  managedCount: number;
  reusedCount: number;
};
const DRAFT_PRODUCT_CREATE_CONCURRENCY = 2;
const DEFAULT_DRAFT_IMPORT_LIMIT = 3;
const MAX_DRAFT_IMPORT_LIMIT = 50;
const DRAFT_IMPORT_MAX_ATTEMPTS = 3;
const DEFAULT_MARKETPLACE_ID = "EBAY_IT";
const MAX_SHOPIFY_MEDIA_PER_PRODUCT = 250;
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
      media: dedupeImageUrls(item.normalized.imageUrls)
        .slice(0, MAX_SHOPIFY_MEDIA_PER_PRODUCT)
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

async function createShopifyDraftProduct(
  admin: ShopifyAdminGraphqlClient,
  draftProduct: ShopifyDraftProductInput,
): Promise<ShopifyDraftProductCreateResult> {
  const existingProduct = await findExistingSyncBayDraftProduct(
    admin,
    draftProduct,
  );

  if (existingProduct) {
    const statusResult = await updateShopifyProductStatus(
      admin,
      existingProduct,
      draftProduct.product.status,
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
  },
): Promise<ShopifyDraftProductResult> {
  try {
    const result = await createShopifyDraftProduct(admin, draftProduct);

    if (result.status === "failed") return result;

    const mediaSync = await syncShopifyMediaFromEbayImages(
      admin,
      result.product,
      draftProduct,
      {
        jobId: context.jobId,
      },
    );
    const inventorySync = await syncShopifyInventoryFromEbayQuantity(
      admin,
      result.product,
      draftProduct,
      context,
    );
    const inventoryWarnings =
      inventorySync.status === "skipped" ||
      inventorySync.status === "failed" ||
      Boolean(inventorySync.warning)
        ? [getInventorySyncWarning(inventorySync)]
        : [];
    const mediaWarnings =
      mediaSync.status === "failed" ? [getMediaSyncWarning(mediaSync)] : [];

    return {
      ...result,
      inventorySync,
      mediaSync,
      warnings: [
        ...(result.warnings ?? []),
        ...mediaWarnings,
        ...inventoryWarnings,
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
  const handleLookupResponse = await admin.graphql(
    `#graphql
    query SyncBayFindDraftProduct($handle: String!) {
      productByHandle(handle: $handle) {
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

  const products: ShopifyDraftProductLookupNode[] = [];
  let cursor: string | null = null;

  while (true) {
    const queryResponse = await admin.graphql(
      `#graphql
      query SyncBayFindDraftProduct($query: String!, $cursor: String) {
        products(first: 250, query: $query, after: $cursor) {
          nodes {
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
          query: "tag:SyncBay",
          cursor,
        },
      },
    );

    if (!queryResponse.ok) return null;

    const queryJson = (await queryResponse.json()) as ShopifyProductLookupResponse & {
      data?: {
        products?: {
          pageInfo?: {
            hasNextPage?: boolean;
            endCursor?: string | null;
          };
        };
      };
    };

    if (queryJson.errors?.length) return null;

    products.push(
      ...((queryJson.data?.products?.nodes as ShopifyDraftProductLookupNode[]) ?? []),
    );

    if (!queryJson.data?.products?.pageInfo?.hasNextPage) break;
    cursor = queryJson.data.products.pageInfo.endCursor ?? null;
    if (!cursor) break;
  }

  const allProducts = [
    handleLookupJson.data?.productByHandle?.metafield?.value ===
    draftProduct.source.ebayItemId
      ? handleLookupJson.data?.productByHandle
      : null,
    ...products,
  ].filter((product): product is ShopifyDraftProductLookupNode => Boolean(product));

  return (
    allProducts.find(
      (product) => product.metafield?.value === draftProduct.source.ebayItemId,
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

async function updateShopifyProductStatus(
  admin: ShopifyAdminGraphqlClient,
  product: NonNullable<ShopifyCreatedProduct>,
  status: ImportProductStatus,
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
  if (product.status === status) {
    return {
      product,
      status: "synced",
      warnings: [],
    };
  }

  const response = await admin.graphql(
    `#graphql
    mutation SyncBayUpdateProductStatus($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
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
          status
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
        product: {
          id: product.id,
          status,
        },
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

  return {
    product: updatedProduct,
    status: "synced",
    warnings: [
      `SyncBay ha riallineato lo stato Shopify del prodotto a ${status}.`,
    ],
  };
}

async function syncShopifyMediaFromEbayImages(
  admin: ShopifyAdminGraphqlClient,
  product: NonNullable<ShopifyCreatedProduct>,
  draftProduct: ShopifyDraftProductInput,
  context: {
    jobId: string;
  },
): Promise<ShopifyMediaSyncResult> {
  const existingMediaIds = getProductMediaIds(product);
  const sourceMedia = draftProduct.media;
  const stagedObjectPaths: string[] = [];
  const failedResults: ShopifyMediaSyncResult["failedResults"] = [];
  let directCreatedCount = 0;
  let stagedCreatedCount = 0;
  let deletedCount = 0;

  if (existingMediaIds.length > 0 && sourceMedia.length > 0) {
    const deleteResult = await deleteShopifyProductMediaFiles(
      admin,
      product.id,
      existingMediaIds,
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

  for (const [index, media] of sourceMedia.entries()) {
    const directResult = await addShopifyProductMedia(admin, {
      media,
      productGid: product.id,
    });

    if (directResult.status === "synced") {
      directCreatedCount += 1;
      continue;
    }

    const stagedResult = await createStagedImageMediaInput({
      ebayItemId: draftProduct.source.ebayItemId,
      index,
      jobId: context.jobId,
      media,
    });

    if (stagedResult.status === "failed") {
      failedResults.push({
        errorMessage: `${directResult.errorMessage}; fallback Supabase non riuscito: ${stagedResult.errorMessage}`,
        index,
        sourceUrl: media.originalSource,
      });
      continue;
    }

    stagedObjectPaths.push(stagedResult.objectPath);

    const stagedMediaResult = await addShopifyProductMedia(admin, {
      media: stagedResult.media,
      productGid: product.id,
    });

    if (stagedMediaResult.status === "failed") {
      failedResults.push({
        errorMessage: `${directResult.errorMessage}; fallback Supabase caricato ma rifiutato da Shopify: ${stagedMediaResult.errorMessage}`,
        index,
        sourceUrl: media.originalSource,
      });
      continue;
    }

    stagedCreatedCount += 1;
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
    mutation SyncBayDeleteProductMediaFiles($fileIds: [ID!]!, $productId: ID!) {
      productUpdate(product: { id: $productId, mediaIdsToDelete: $fileIds }) {
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
          code
          field
          message
        }
      }
    }`,
    {
      variables: {
        fileIds: uniqueMediaIds,
        productId: productGid,
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

  return {
    deletedCount: uniqueMediaIds.length,
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

async function downloadImageForStaging(
  sourceUrl: string,
): Promise<
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
      errorMessage: "Il download immagine non ha restituito un content-type immagine supportato.",
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
      errorMessage: "Shopify non ha restituito l'inventory item per leggere la quantità corrente.",
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
      warning:
        `Shopify riporta una quantità diversa (${availableQuantity ?? "assente"}) rispetto a quella appena scritta (${input.quantity}); la verifica può variare per aggiornamenti concorrenti.`,
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
    imageCount: input.result.mediaSync.createdCount,
    mappingId: input.mappingId,
    payload: {
      handle: input.draftProduct.product.handle,
      importJobId: input.jobId,
      inventorySync: input.result.inventorySync,
      mediaSync: input.result.mediaSync,
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
  return product.variants?.nodes?.[0] ?? null;
}

function getProductMediaIds(product: ShopifyDraftProductNode) {
  return (product.media?.nodes ?? []).map((media) => media.id);
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
