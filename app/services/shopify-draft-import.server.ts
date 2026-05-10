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
}

export type ShopifyDraftImportStatus = "blocked" | "created" | "failed";

export function getDraftImportReadiness(input: {
  hasDefaultLocation: boolean;
  previewResult: ImportPreviewResult;
}) {
  const enabled = process.env.SYNCBAY_DRAFT_IMPORT_ENABLED === "true";
  const importableItems = getImportablePreviewItems(input.previewResult);
  const blockers = [
    !enabled ? "import Shopify draft non abilitato" : null,
    !input.hasDefaultLocation ? "location Shopify predefinita non confermata" : null,
    importableItems.length === 0 ? "nessun prodotto importabile nella preview" : null,
  ].filter((blocker): blocker is string => Boolean(blocker));

  return {
    blockers,
    enabled,
    importableCount: importableItems.length,
    nextAction:
      blockers.length > 0
        ? "Completa i blocchi prima di creare bozze Shopify."
        : "Pronto per creare bozze Shopify dietro conferma esplicita.",
  };
}

export function buildShopifyDraftProductInputs(previewResult: ImportPreviewResult) {
  return getImportablePreviewItems(previewResult).map((item) => ({
    status: "DRAFT",
    tags: ["SyncBay", "Import mock"],
    title: item.normalized.title,
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

  const createdProducts = [];
  for (const product of buildShopifyDraftProductInputs(input.previewResult)) {
    const response = await input.admin.graphql(
      `#graphql
      mutation SyncBayCreateDraftProduct($product: ProductCreateInput!) {
        productCreate(product: $product) {
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
      { variables: { product } },
    );
    const json = (await response.json()) as ShopifyProductCreateResponse;
    const userErrors = json.data?.productCreate?.userErrors ?? [];

    if (userErrors.length > 0) {
      return {
        createdProducts,
        errorMessage: userErrors.map((error) => error.message).join("; "),
        readiness,
        status: "failed" as const,
      };
    }

    const createdProduct = json.data?.productCreate?.product;
    if (createdProduct) createdProducts.push(createdProduct);
  }

  return {
    createdProducts,
    readiness,
    status: "created" as const,
  };
}

function getImportablePreviewItems(previewResult: ImportPreviewResult) {
  return previewResult.items.filter(isImportablePreviewItem);
}

function isImportablePreviewItem(item: ImportPreviewItem) {
  return item.status === "importable";
}
