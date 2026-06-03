export const MAX_SHOPIFY_ADMIN_DIAGNOSTIC_PRODUCT_IDS = 20;

export type ShopifyAdminDiagnosticsProductInput = {
  defaultLocationGid: string | null;
  productGids: string[];
  shopDomain: string;
};

export function normalizeShopifyAdminDiagnosticsProductInput(
  payload: unknown,
  input: { fallbackShopDomain: string },
): ShopifyAdminDiagnosticsProductInput {
  const objectPayload = getObjectPayload(payload);
  const productGidsPayload = objectPayload.productGids;

  if (!Array.isArray(productGidsPayload)) {
    throw new Error("productGids deve essere un array.");
  }

  const productGids = [...new Set(productGidsPayload.map(normalizeProductGid))];

  if (productGids.length > MAX_SHOPIFY_ADMIN_DIAGNOSTIC_PRODUCT_IDS) {
    throw new Error(
      `La diagnostica Shopify accetta massimo ${MAX_SHOPIFY_ADMIN_DIAGNOSTIC_PRODUCT_IDS} prodotti per richiesta.`,
    );
  }

  return {
    defaultLocationGid: normalizeNullableLocationGid(
      objectPayload.defaultLocationGid,
    ),
    productGids,
    shopDomain: normalizeShopDomain(
      objectPayload.shopDomain,
      input.fallbackShopDomain,
    ),
  };
}

export function buildShopifyAdminDiagnosticsProductQuery(input: {
  defaultLocationGid: string | null;
  productGids: string[];
}) {
  if (input.defaultLocationGid) {
    return {
      query: `query SyncBayVerifyProducts($ids: [ID!]!, $locationId: ID!) {
  nodes(ids: $ids) {
    ... on Product {
      id
      title
      handle
      status
      totalInventory
      media(first: 50) {
        nodes {
          mediaContentType
          preview {
            status
          }
        }
      }
      variants(first: 1) {
        nodes {
          id
          sku
          price
          inventoryQuantity
          inventoryItem {
            sku
            tracked
            inventoryLevel(locationId: $locationId) {
              quantities(names: ["available"]) {
                name
                quantity
              }
            }
          }
        }
      }
    }
  }
}`,
      variables: {
        ids: input.productGids,
        locationId: input.defaultLocationGid,
      },
    };
  }

  return {
    query: `query SyncBayVerifyProducts($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Product {
      id
      title
      handle
      status
      totalInventory
      media(first: 50) {
        nodes {
          mediaContentType
          preview {
            status
          }
        }
      }
      variants(first: 1) {
        nodes {
          id
          sku
          price
          inventoryQuantity
          inventoryItem {
            sku
            tracked
          }
        }
      }
    }
  }
}`,
    variables: {
      ids: input.productGids,
    },
  };
}

function getObjectPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  return payload as Record<string, unknown>;
}

function normalizeProductGid(value: unknown) {
  const productGid = typeof value === "string" ? value.trim() : "";

  if (!/^gid:\/\/shopify\/Product\/\d+$/.test(productGid)) {
    throw new Error("Product GID Shopify non valido.");
  }

  return productGid;
}

function normalizeNullableLocationGid(value: unknown) {
  if (value === null || value === undefined || value === "") return null;

  const locationGid = typeof value === "string" ? value.trim() : "";

  if (!/^gid:\/\/shopify\/Location\/\d+$/.test(locationGid)) {
    throw new Error("Location GID Shopify non valido.");
  }

  return locationGid;
}

function normalizeShopDomain(value: unknown, fallbackShopDomain: string) {
  const shopDomain =
    typeof value === "string" && value.trim()
      ? value.trim()
      : fallbackShopDomain.trim();

  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shopDomain)) {
    throw new Error("Dominio shop Shopify non valido.");
  }

  return shopDomain.toLowerCase();
}
