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

interface ShopifyProductCreateResponse {
  data?: {
    productCreate?: {
      product?: {
        id: string;
        title: string;
      } | null;
      userErrors?: Array<{
        field?: string[] | null;
        message: string;
      }>;
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
const DRAFT_PRODUCT_CREATE_CONCURRENCY = 2;
const DEFAULT_DRAFT_IMPORT_LIMIT = 3;
const MAX_DRAFT_IMPORT_LIMIT = 10;
const MAX_DRAFT_MEDIA_PER_PRODUCT = 3;

type ShopifyDraftProductResult =
  | {
      product: NonNullable<ShopifyCreatedProduct>;
      status: "created";
    }
  | {
      errorMessage: string;
      status: "failed";
    };

export function getDraftImportReadiness(input: {
  hasDefaultLocation: boolean;
  previewResult: ImportPreviewResult;
}) {
  const enabled = process.env.SYNCBAY_DRAFT_IMPORT_ENABLED === "true";
  const draftLimit = getDraftImportLimit();
  const importableItems = getImportablePreviewItems(input.previewResult);
  const plannedCreateCount = Math.min(importableItems.length, draftLimit);
  const blockers = [
    !enabled ? "import Shopify draft non abilitato" : null,
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
    plannedCreateCount,
    nextAction:
      blockers.length > 0
        ? "Completa i blocchi prima di creare bozze Shopify."
        : `Pronto per creare fino a ${plannedCreateCount} bozze Shopify dietro conferma esplicita.`,
  };
}

export function buildShopifyDraftProductInputs(
  previewResult: ImportPreviewResult,
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
        metafields: buildSyncBayProductMetafields(item),
        status: "DRAFT",
        tags: ["SyncBay", "Import preview", "eBay import pilot"],
        title: item.normalized.title,
      },
    }));
}

export async function createShopifyDraftProductsIfEnabled(input: {
  admin: ShopifyAdminGraphqlClient;
  hasDefaultLocation: boolean;
  previewResult: ImportPreviewResult;
}) {
  const readiness = getDraftImportReadiness({
    hasDefaultLocation: input.hasDefaultLocation,
    previewResult: input.previewResult,
  });

  if (readiness.blockers.length > 0) {
    return {
      createdProducts: [],
      readiness,
      status: "blocked" as const,
    };
  }

  const results = await mapWithConcurrency(
    buildShopifyDraftProductInputs(input.previewResult),
    DRAFT_PRODUCT_CREATE_CONCURRENCY,
    (product) => createShopifyDraftProduct(input.admin, product),
  );
  const createdProducts = results.flatMap((result) =>
    result.status === "created" ? [result.product] : [],
  );
  const failedResult = results.find(
    (
      result,
    ): result is Extract<ShopifyDraftProductResult, { status: "failed" }> =>
      result.status === "failed",
  );

  if (failedResult) {
    return {
      createdProducts,
      errorMessage: failedResult.errorMessage,
      readiness,
      status: "failed" as const,
    };
  }

  return {
    createdProducts,
    readiness,
    status: "created" as const,
  };
}

async function createShopifyDraftProduct(
  admin: ShopifyAdminGraphqlClient,
  draftProduct: ShopifyDraftProductInput,
): Promise<ShopifyDraftProductResult> {
  const response = await admin.graphql(
    `#graphql
    mutation SyncBayCreateDraftProduct($media: [CreateMediaInput!], $product: ProductCreateInput!) {
      productCreate(product: $product, media: $media) {
        product {
          id
          title
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

  if (userErrors.length > 0) {
    return {
      errorMessage: userErrors.map((error) => error.message).join("; "),
      status: "failed",
    };
  }

  const createdProduct = json.data?.productCreate?.product;
  if (!createdProduct) {
    return {
      errorMessage: "Shopify non ha restituito il prodotto draft creato.",
      status: "failed",
    };
  }

  return {
    product: createdProduct,
    status: "created",
  };
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

function getDraftImportLimit() {
  const parsed = Number.parseInt(
    process.env.SYNCBAY_DRAFT_IMPORT_LIMIT ?? "",
    10,
  );

  if (!Number.isInteger(parsed)) return DEFAULT_DRAFT_IMPORT_LIMIT;

  return Math.min(Math.max(parsed, 1), MAX_DRAFT_IMPORT_LIMIT);
}
