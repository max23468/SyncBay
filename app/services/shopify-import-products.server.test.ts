import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  inventory: vi.fn(async (): Promise<Record<string, unknown>> => ({
    inventoryItemGid: "gid://shopify/InventoryItem/1",
    locationGid: "gid://shopify/Location/1",
    quantity: 2,
    status: "synced",
    variantGid: "gid://shopify/ProductVariant/1",
  })),
  media: vi.fn(async () => ({
    createdCount: 0,
    deletedCount: 0,
    directCreatedCount: 0,
    failedResults: [],
    requestedCount: 0,
    sourceImageUrls: [],
    stagedCreatedCount: 0,
    stagedObjectPaths: [],
    status: "synced",
  })),
  publication: vi.fn(async () => ({
    publicationCount: 1,
    publicationIds: ["gid://shopify/Publication/1"],
    status: "synced",
  })),
}));

vi.mock("../db.server", () => ({
  default: {
    productMapping: {
      findUnique: async () => ({
        shopifyProductGid: "gid://shopify/Product/1",
        shopifyVariantGid: "gid://shopify/ProductVariant/1",
      }),
    },
  },
}));
vi.mock("../lib/syncbay-product-publication", () => ({
  loadShopifyProductPublicationIds: async () => ["gid://shopify/Publication/1"],
  syncShopifyProductPublications: fakes.publication,
}));
vi.mock("./shopify-import-inventory.server", () => ({
  syncShopifyInventoryFromEbayQuantity: fakes.inventory,
}));
vi.mock("./shopify-import-media.server", () => ({
  syncShopifyMediaFromEbayImages: fakes.media,
}));
vi.mock("./syncbay-product-facets.server", () => ({
  syncShopifyProductFacets: async () => ({
    baselineFacets: [],
    conflicts: [],
    deleted: [],
    skipped: [],
    status: "synced",
    written: [],
  }),
}));

import { buildImportPreview } from "./import-preview.server";
import {
  buildShopifyDraftProductInputs,
  createShopifyDraftProductSafely as createShopifyDraftProductSafelyImpl,
} from "./shopify-import-products.server";

beforeEach(() => {
  vi.clearAllMocks();
});

test("l’aggiornamento eBay riallinea prodotto e variante Shopify prima di pubblicare", async () => {
  const mutations: string[] = [];
  const result = await runProductSync(getActiveDraftProduct(), getMappedProductAdmin(mutations));

  assert.equal(result.status, "created");
  assert.deepEqual(mutations, ["product", "variant"]);
  assert.equal(fakes.inventory.mock.calls.length, 1);
  assert.equal(fakes.media.mock.calls.length, 1);
  assert.equal(fakes.publication.mock.calls.length, 1);
});

test("non pubblica un prodotto ACTIVE quando l’inventario non è sincronizzato", async () => {
  fakes.inventory.mockResolvedValueOnce({
    errorMessage: "Inventario sintetico non sincronizzato.",
    status: "failed",
  });

  const result = await runProductSync(getActiveDraftProduct(), getMappedProductAdmin());

  assert.equal(result.status, "failed");
  assert.match(result.errorMessage, /Pubblicazione prodotto Shopify rinviata/);
  assert.equal(fakes.publication.mock.calls.length, 0);
});

function getActiveDraftProduct() {
  const draftProduct = buildShopifyDraftProductInputs(
    buildImportPreview([
      {
        currency: "EUR",
        itemId: "synthetic-item-1",
        priceAmount: 19.9,
        quantity: 2,
        sku: "SYNTHETIC-1",
        title: "Prodotto sintetico",
        variantCount: 1,
      },
    ]),
    "ACTIVE",
  )[0];
  assert.ok(draftProduct);
  return draftProduct;
}

function getMappedProductAdmin(mutations: string[] = []) {
  const product = {
    descriptionHtml: "",
    id: "gid://shopify/Product/1",
    media: { nodes: [] },
    metafield: { value: "synthetic-item-1" },
    status: "ACTIVE",
    tags: [],
    title: "Titolo precedente",
    variants: {
      nodes: [
        {
          id: "gid://shopify/ProductVariant/1",
          inventoryItem: { id: "gid://shopify/InventoryItem/1", tracked: true },
          price: "18.00",
        },
      ],
    },
  };
  return {
    graphql: async (query: string) => {
      if (query.includes("SyncBayFindMappedProductVariant")) {
        return Response.json({
          data: {
            productNode: product,
            variantNode: {
              ...product.variants.nodes[0],
              product: { id: product.id },
            },
          },
        });
      }
      if (query.includes("SyncBayUpdateProductStatus")) {
        mutations.push("product");
        return Response.json({
          data: {
            productUpdate: {
              product: { ...product, title: "Prodotto sintetico" },
              userErrors: [],
            },
          },
        });
      }
      if (query.includes("SyncBayUpdateVariantCommercialFields")) {
        mutations.push("variant");
        return Response.json({
          data: {
            productVariantsBulkUpdate: {
              productVariants: [
                { ...product.variants.nodes[0], compareAtPrice: null, price: "19.90" },
              ],
              userErrors: [],
            },
          },
        });
      }
      if (query.includes("SyncBayUpdateInventorySku")) {
        return Response.json({
          data: {
            inventoryItemUpdate: {
              inventoryItem: product.variants.nodes[0].inventoryItem,
              userErrors: [],
            },
          },
        });
      }

      throw new Error(`Query Shopify inattesa: ${query}`);
    },
  };
}

async function runProductSync(
  draftProduct: ReturnType<typeof getActiveDraftProduct>,
  admin: ReturnType<typeof getMappedProductAdmin>,
) {
  return createShopifyDraftProductSafelyImpl(admin, draftProduct, {
    defaultLocationGid: "gid://shopify/Location/1",
    jobId: "job-1",
    publicationOptions: { publicationIds: ["gid://shopify/Publication/1"] },
    reuseOnly: false,
    shopId: "shop-1",
  });
}
