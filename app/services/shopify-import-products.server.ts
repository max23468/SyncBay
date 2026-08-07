import prisma from "../db.server";
import { type ImportProductStatus } from "../lib/import-product-status";
import {
  buildExistingCatalogTagMutations,
  type ExistingCatalogFieldPolicy,
} from "../lib/syncbay-existing-catalog-field-policy";
import { calculateShopifyPricing, type SyncBayPricingRule } from "../lib/syncbay-pricing-rules";
import {
  buildShopifyProductFacetMetafields,
  type SyncBayProductFacet,
} from "../lib/syncbay-product-facets";
import {
  loadShopifyProductPublicationIds,
  syncShopifyProductPublications,
} from "../lib/syncbay-product-publication";
import {
  normalizeProductPublicationMode,
  parseProductPublicationGids,
  resolveProductPublicationIds,
  resolveStoredSelectedProductPublicationIds,
} from "../lib/syncbay-product-publication-settings";
import { buildShopifyDraftCategoryFields } from "../lib/syncbay-shopify-draft-category-fields";
import { buildSyncBayProductMetafields as buildSyncBayBaseProductMetafields } from "../lib/syncbay-shopify-product-metafields";
import { buildShopifyProductUpdateFieldsFromDraft } from "../lib/syncbay-shopify-product-update-fields";
import {
  buildSyncBayProductLookupQueries,
  buildSyncBayShopifyImportTags,
} from "../lib/syncbay-shopify-tags";
import {
  preserveSelectedShopifyVariantForSync,
  selectShopifyVariantForSync,
} from "../lib/syncbay-shopify-variant-selection";
import { getEbayMarketplaceId } from "./ebay-environment.server";
import type { ImportPreviewItem, ImportPreviewResult } from "./import-preview.server";
import { syncShopifyProductFacets } from "./syncbay-product-facets.server";

import { syncShopifyInventoryFromEbayQuantity } from "./shopify-import-inventory.server";
import { syncShopifyMediaFromEbayImages } from "./shopify-import-media.server";
import { getInventorySyncWarning, getMediaSyncWarning } from "./shopify-import-persistence.server";
import {
  SYNCBAY_SOLD_OUT_TAG,
  ShopifyAdminGraphqlClient,
  ShopifyCreatedProduct,
  ShopifyDraftProductCreateResult,
  ShopifyDraftProductInput,
  ShopifyDraftProductNode,
  ShopifyDraftProductResult,
  ShopifyDraftProductVariantNode,
  ShopifyInventoryItemUpdateResponse,
  ShopifyProductCreateResponse,
  ShopifyProductFacetSyncResult,
  ShopifyProductUpdateResponse,
  ShopifyProductVariantsBulkUpdateResponse,
  formatShopifyGraphqlErrors,
  formatShopifyUserErrors,
  getDraftImportLimit,
  getFirstProductVariant,
  getImportablePreviewItems,
  updateShopifyProductTag,
} from "./shopify-import-shared.server";

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

interface ShopifyDraftProductVariantLookupNode extends ShopifyDraftProductVariantNode {
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

const MAX_SHOPIFY_MEDIA_PER_PRODUCT = 250;

type DraftImportPublicationOptions = {
  disabled?: boolean;
  publicationIds?: string[];
};

export function formatShopifyPrice(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value.toFixed(2);
}

export function buildShopifyDraftProductInputs(
  previewResult: ImportPreviewResult,
  importProductStatus: ImportProductStatus,
  pricingRule: SyncBayPricingRule = {
    discountPercent: 0,
    roundingMode: "CENTS",
  },
  existingCatalogFieldPoliciesByItemId: Record<string, ExistingCatalogFieldPolicy> = {},
  facetBaselinesByItemId: Record<string, SyncBayProductFacet[]> = {},
) {
  return getImportablePreviewItems(previewResult)
    .slice(0, getDraftImportLimit())
    .map((item) => {
      const categoryFields = buildShopifyDraftCategoryFields(item.normalized.categoryProposal);

      return {
        existingCatalogFieldPolicy: existingCatalogFieldPoliciesByItemId[item.itemId] ?? null,
        facetBaseline: facetBaselinesByItemId[item.itemId] ?? [],
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
        productFacets: item.normalized.productFacets,
        previewItem: item,
      };
    });
}

export async function resolveDraftImportPublicationOptions(
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

  const selectedPublicationIds = parseProductPublicationGids(input.productPublicationGids);

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
  const existingProduct = await findExistingSyncBayDraftProduct(admin, draftProduct, context);

  if (existingProduct) {
    const statusResult = await updateShopifyProductFromEbay(admin, existingProduct, draftProduct);

    if (statusResult.status === "failed") {
      return statusResult;
    }

    return {
      facetSync: statusResult.facetSync,
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

export async function createShopifyDraftProductSafely(
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

    const commercialFieldsSync = await syncShopifyVariantCommercialFieldsFromEbay(admin, {
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

    if (commercialFieldsSync.product.status === "ACTIVE" && inventorySync.status !== "synced") {
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
    const mediaWarnings = mediaSync.status === "failed" ? [getMediaSyncWarning(mediaSync)] : [];
    const publicationWarnings =
      publicationSync.status === "skipped" && publicationSync.reason === "no_publications"
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

  const handleLookupJson = (await handleLookupResponse.json()) as ShopifyProductLookupResponse;

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
    mappedJson.data?.variantNode?.product?.id === product.id ? mappedJson.data.variantNode : null;
  const selectedVariant = selectShopifyVariantForSync({
    preferredVariantGid: mapping.shopifyVariantGid,
    variants: [...(variant ? [variant] : []), ...(product.variants?.nodes ?? [])],
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

async function updateShopifyProductFromEbay(
  admin: ShopifyAdminGraphqlClient,
  product: NonNullable<ShopifyCreatedProduct>,
  draftProduct: ShopifyDraftProductInput,
): Promise<
  | {
      product: NonNullable<ShopifyCreatedProduct>;
      facetSync: ShopifyProductFacetSyncResult;
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

  const facetSync = await syncShopifyProductFacets({
    admin,
    ownerId: syncedProduct.id,
    previousSyncBayFacets: draftProduct.facetBaseline,
    proposedFacets: draftProduct.productFacets,
  });

  warnings.push(...formatProductFacetSyncWarnings(facetSync));

  return {
    facetSync,
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
  const compareAtPrice = formatShopifyPrice(input.draftProduct.pricing.compareAtPriceAmount);

  if (!variant) {
    return {
      errorMessage: "Variante Shopify non restituita per il prodotto importato.",
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
  const json = (await response.json()) as ShopifyProductVariantsBulkUpdateResponse;

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

  const updatedVariant = json.data?.productVariantsBulkUpdate?.productVariants?.[0];

  if (!updatedVariant) {
    return {
      errorMessage: "Shopify non ha restituito la variante aggiornata.",
      status: "failed",
    };
  }

  const inventoryItemGid = updatedVariant.inventoryItem?.id ?? variant.inventoryItem?.id ?? null;
  const sku = input.draftProduct.previewItem.normalized.sku;

  if (sku && !inventoryItemGid) {
    return {
      errorMessage: "Inventory item Shopify non restituito per aggiornare lo SKU.",
      status: "failed",
    };
  }

  if (sku && inventoryItemGid) {
    const skuResult = await updateShopifyInventoryItemSku(admin, inventoryItemGid, sku);

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

function formatProductFacetSyncWarnings(facetSync: ShopifyProductFacetSyncResult) {
  const warnings: string[] = [];

  if (facetSync.status === "missing_owner") {
    warnings.push("Faccette prodotto non aggiornate: prodotto Shopify non trovato.");
  }

  if (facetSync.written.length > 0) {
    warnings.push(
      `SyncBay ha aggiornato ${facetSync.written.length} metafield faccette dedotte dal catalogo.`,
    );
  }

  if (facetSync.deleted.length > 0) {
    warnings.push(
      `SyncBay ha rimosso ${facetSync.deleted.length} metafield faccette senza evidenza aggiornata.`,
    );
  }

  if (facetSync.conflicts.length > 0) {
    warnings.push(
      `Faccette Shopify non sovrascritte perché modificate manualmente: ${facetSync.conflicts
        .map((facet) => facet.key)
        .join(", ")}.`,
    );
  }

  return warnings;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;

  return "Errore inatteso durante l'import Shopify.";
}

function dedupeImageUrls(imageUrls: string[]) {
  return [...new Set(imageUrls.map((imageUrl) => imageUrl.trim()))].filter(Boolean);
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
  ].filter((metafield): metafield is NonNullable<typeof metafield> => Boolean(metafield));
}

function buildSyncBayProductHandle(ebayItemId: string) {
  return `syncbay-ebay-${ebayItemId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
}
