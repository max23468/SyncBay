import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  create: vi.fn(async (_admin: unknown, _product: unknown, _context: { jobId: string }) => ({
    inventorySync: { status: "synced" },
    mediaSync: { status: "synced" },
    product: { id: "gid://shopify/Product/1", status: "ACTIVE", title: "Prodotto sintetico" },
    publicationSync: { publicationCount: 1, status: "synced" },
    resultType: "created",
    status: "created",
    warnings: [],
  })),
  draftProduct: { source: { ebayItemId: "synthetic-item-1" } },
}));

vi.mock("../db.server", () => ({
  default: {
    shop: {
      upsert: async () => ({
        defaultProductStatus: "ACTIVE",
        id: "shop-1",
        productPublicationGids: null,
        productPublicationMode: "ALL",
      }),
    },
  },
}));
vi.mock("./pricing-rules.server", () => ({
  getPricingRuleForShopId: async () => ({ discountPercent: 0, roundingMode: "CENTS" }),
}));
vi.mock("./shopify-import-products.server", () => ({
  buildShopifyDraftProductInputs: () => [fakes.draftProduct],
  createShopifyDraftProductSafely: fakes.create,
  resolveDraftImportPublicationOptions: async () => ({ status: "ready", options: {} }),
}));
vi.mock("./shopify-import-persistence.server", () => ({
  buildDraftImportSummary: (input: { products: unknown[] }) => ({
    managedCount: input.products.length,
    requestedCount: input.products.length,
  }),
  getInventoryFailedResults: () => [],
  getMediaFailedResults: () => [],
  partitionUnchangedDraftProducts: async (input: { draftProducts: unknown[] }) => ({
    draftProducts: input.draftProducts,
    unchangedSkippedCount: 0,
  }),
  recordDraftImportPersistence: async () => ({ managedCount: 1 }),
}));

import { executeShopifyCatalogImport } from "./shopify-draft-import.server";
import { buildImportPreview } from "./import-preview.server";

afterEach(() => {
  delete process.env.SYNCBAY_DRAFT_IMPORT_ENABLED;
});

test("il coordinatore import inoltra una preview importabile e chiude il risultato", async () => {
  process.env.SYNCBAY_DRAFT_IMPORT_ENABLED = "true";
  const result = await executeShopifyCatalogImport({
    admin: { graphql: async () => Response.json({}) },
    defaultLocationGid: "gid://shopify/Location/1",
    hasDefaultLocation: true,
    jobId: "job-1",
    previewResult: buildImportPreview([
      {
        currency: "EUR",
        itemId: "synthetic-item-1",
        priceAmount: 19.9,
        quantity: 1,
        sku: "SYNTHETIC-1",
        title: "Prodotto sintetico",
        variantCount: 1,
      },
    ]),
    shopDomain: "synthetic.myshopify.com",
    shopId: "shop-1",
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.summary?.managedCount, 1);
  assert.equal(fakes.create.mock.calls.length, 1);
  assert.equal(fakes.create.mock.calls[0]?.[2].jobId, "job-1");
});
