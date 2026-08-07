import type { ImportProductStatus } from "../lib/import-product-status";
import type { ExistingCatalogFieldPolicy } from "../lib/syncbay-existing-catalog-field-policy";
import { calculateShopifyPricing } from "../lib/syncbay-pricing-rules";
import type {
  ShopifyProductFacetMetafield,
  SyncBayProductFacet,
} from "../lib/syncbay-product-facets";
import { type ShopifyProductPublicationSyncResult } from "../lib/syncbay-product-publication";
import type { ShopifyDraftCategoryFields } from "../lib/syncbay-shopify-draft-category-fields";
import type { SyncBayProductMetafield } from "../lib/syncbay-shopify-product-metafields";
import { selectShopifyVariantForSync } from "../lib/syncbay-shopify-variant-selection";
import type { ImportPreviewItem, ImportPreviewResult } from "./import-preview.server";
import type { syncShopifyProductFacets } from "./syncbay-product-facets.server";

const DEFAULT_DRAFT_IMPORT_LIMIT = 3;
const MAX_DRAFT_IMPORT_LIMIT = 50;

// Tag Shopify applicato ai prodotti il cui listing eBay è diventato inattivo:
// restano in vetrina come esauriti invece di essere archiviati (ADR 0011).
export const SYNCBAY_SOLD_OUT_TAG = "esaurito";

export function getDraftImportLimit() {
  const parsed = Number.parseInt(process.env.SYNCBAY_DRAFT_IMPORT_LIMIT ?? "", 10);

  if (!Number.isInteger(parsed)) return DEFAULT_DRAFT_IMPORT_LIMIT;

  return Math.min(Math.max(parsed, 1), MAX_DRAFT_IMPORT_LIMIT);
}

export function getImportablePreviewItems(previewResult: ImportPreviewResult) {
  return previewResult.items.filter((item) => item.status === "importable");
}

export interface ShopifyAdminGraphqlClient {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

export interface ShopifyUserError {
  code?: string | null;
  field?: string[] | null;
  message: string;
}

export interface ShopifyInventoryItemNode {
  id: string;
  sku?: string | null;
  tracked?: boolean | null;
}

export interface ShopifyDraftProductVariantNode {
  compareAtPrice?: string | null;
  id: string;
  inventoryItem?: ShopifyInventoryItemNode | null;
  price?: string | null;
  sku?: string | null;
}

export interface ShopifyProductMediaNode {
  alt?: string | null;
  id: string;
  mediaContentType?: string | null;
  preview?: {
    status?: string | null;
  } | null;
}

export interface ShopifyDraftProductNode {
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

export interface ShopifyProductCreateResponse {
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

export interface ShopifyInventoryItemUpdateResponse {
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

export interface ShopifyProductUpdateResponse {
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

export interface ShopifyProductTagsResponse {
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

export interface ShopifyProductVariantsBulkUpdateResponse {
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

export interface ShopifyDraftProductInput {
  existingCatalogFieldPolicy: ExistingCatalogFieldPolicy | null;
  facetBaseline: SyncBayProductFacet[];
  media: Array<{
    alt: string;
    mediaContentType: string;
    originalSource: string;
  }>;
  previewItem: ImportPreviewItem;
  pricing: ReturnType<typeof calculateShopifyPricing>;
  product: ShopifyDraftCategoryFields & {
    descriptionHtml?: string;
    handle: string;
    metafields: Array<ShopifyProductFacetMetafield | SyncBayProductMetafield>;
    status: ImportProductStatus;
    tags: string[];
    title: string;
  };
  productFacets: SyncBayProductFacet[];
  source: { ebayItemId: string };
}

export type ShopifyCreatedProduct = NonNullable<
  NonNullable<ShopifyProductCreateResponse["data"]>["productCreate"]
>["product"];

export type ShopifyProductFacetSyncResult = Awaited<ReturnType<typeof syncShopifyProductFacets>>;

export type ShopifyInventorySyncResult =
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
      reason: "missing_inventory_item" | "missing_location" | "missing_quantity";
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

export type ShopifyMediaSyncResult = {
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

export type ShopifyDraftProductCreateResult =
  | {
      facetSync?: ShopifyProductFacetSyncResult;
      product: NonNullable<ShopifyCreatedProduct>;
      resultType: "created" | "reused";
      status: "created";
      warnings?: string[];
    }
  | {
      errorMessage: string;
      status: "failed";
    };

export type ShopifyDraftProductResult =
  | (Extract<ShopifyDraftProductCreateResult, { status: "created" }> & {
      inventorySync: ShopifyInventorySyncResult;
      mediaSync: ShopifyMediaSyncResult;
      publicationSync: ShopifyProductPublicationSyncResult;
    })
  | Extract<ShopifyDraftProductCreateResult, { status: "failed" }>;

export async function updateShopifyProductTag(
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

export function getFirstProductVariant(product: ShopifyDraftProductNode) {
  return selectShopifyVariantForSync({
    variants: product.variants?.nodes,
  });
}

export function formatShopifyGraphqlErrors(errors: Array<{ message: string }>) {
  return errors.map((error) => error.message).join("; ");
}

export function formatShopifyUserErrors(errors: ShopifyUserError[]) {
  return errors
    .map((error) => {
      const code = error.code ? ` (${error.code})` : "";
      return `${error.message}${code}`;
    })
    .join("; ");
}
