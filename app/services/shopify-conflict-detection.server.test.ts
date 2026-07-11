import assert from "node:assert/strict";
import test from "node:test";

import {
  detectShopifyChangesBatch,
  type ShopifyConflictDetectionPorts,
} from "./shopify-conflict-detection.server";

const jobs = [
  {
    id: "job-1",
    createdAt: new Date("2026-07-11T10:00:00Z"),
    inventoryItemGid: null,
    productGid: "gid://shopify/Product/1",
    shopId: "shop-1",
    topic: "products/update",
  },
];

function ports(
  overrides: Partial<ShopifyConflictDetectionPorts> = {},
): ShopifyConflictDetectionPorts & { persisted: unknown[] } {
  const persisted: unknown[] = [];
  return {
    persisted,
    async loadMappings() {
      return new Map([
        [
          "product:gid://shopify/Product/1",
          {
            id: "mapping-1",
            shopId: "shop-1",
            status: "ACTIVE",
            shopifyProductGid: "gid://shopify/Product/1",
            shopifyVariantGid: null,
            shopifyInventoryItemGid: null,
          },
        ],
      ]);
    },
    async loadBaselines() {
      return new Map([
        [
          "mapping-1",
          [
            { mappingId: "mapping-1", field: "title", serializedValue: "Old" },
            { mappingId: "mapping-1", field: "status", serializedValue: "ACTIVE" },
          ],
        ],
      ]);
    },
    async loadProducts() {
      return new Map([
        [
          "mapping-1",
          {
            productGid: "gid://shopify/Product/1",
            title: "New",
            descriptionHtml: "",
            status: "ACTIVE",
            priceAmount: null,
            quantity: null,
            imageCount: 0,
          },
        ],
      ]);
    },
    async persist(results) {
      persisted.push(...results);
    },
    ...overrides,
  };
}

test("returns mapping_not_found without calling Shopify", async () => {
  let productReads = 0;
  const fakePorts = ports({
    async loadMappings() {
      return new Map();
    },
    async loadProducts() {
      productReads += 1;
      return new Map();
    },
  });

  const execution = await detectShopifyChangesBatch(
    { jobs, shopDomain: "example.myshopify.com" },
    fakePorts,
  );

  assert.equal(productReads, 0);
  assert.equal(execution.results[0]?.outcome, "mapping_not_found");
});

test("opens conflicts from one batched Shopify read", async () => {
  let productReads = 0;
  const fakePorts = ports({
    async loadProducts(input) {
      productReads += 1;
      assert.deepEqual(input.targets, [
        {
          mappingId: "mapping-1",
          productGid: "gid://shopify/Product/1",
          variantGid: null,
        },
      ]);
      return ports().loadProducts(input);
    },
  });

  const execution = await detectShopifyChangesBatch(
    { jobs, shopDomain: "example.myshopify.com" },
    fakePorts,
  );

  assert.equal(productReads, 1);
  assert.equal(execution.providerReadCount, 1);
  assert.deepEqual(execution.results[0]?.fields, ["title"]);
  assert.equal(execution.results[0]?.outcome, "conflict_opened");
});

test("passes the mapped variant and default location to the product read", async () => {
  let seenInput: { targets: unknown; defaultLocationGid: unknown } | null = null;
  const fakePorts = ports({
    async loadMappings() {
      const mappings = await ports().loadMappings(jobs);
      mappings.get("product:gid://shopify/Product/1")!.shopifyVariantGid =
        "gid://shopify/ProductVariant/99";
      return mappings;
    },
    async loadProducts(input) {
      seenInput = {
        targets: input.targets,
        defaultLocationGid: input.defaultLocationGid,
      };
      return ports().loadProducts(input);
    },
  });

  await detectShopifyChangesBatch(
    {
      jobs,
      shopDomain: "example.myshopify.com",
      defaultLocationGid: "gid://shopify/Location/7",
    },
    fakePorts,
  );

  assert.deepEqual(seenInput, {
    targets: [
      {
        mappingId: "mapping-1",
        productGid: "gid://shopify/Product/1",
        variantGid: "gid://shopify/ProductVariant/99",
      },
    ],
    defaultLocationGid: "gid://shopify/Location/7",
  });
});

test("keeps separate targets for sibling variants of the same product", async () => {
  const secondJob = {
    ...jobs[0],
    id: "job-2",
    inventoryItemGid: "gid://shopify/InventoryItem/2",
    productGid: null,
  };
  const fakePorts = ports({
    async loadMappings() {
      const mappings = await ports().loadMappings(jobs);
      // Stesso prodotto Shopify, variante diversa: secondo mapping via
      // inventory item.
      mappings.get("product:gid://shopify/Product/1")!.shopifyVariantGid =
        "gid://shopify/ProductVariant/1";
      mappings.set("inventory:gid://shopify/InventoryItem/2", {
        id: "mapping-2",
        shopId: "shop-1",
        status: "ACTIVE",
        shopifyProductGid: "gid://shopify/Product/1",
        shopifyVariantGid: "gid://shopify/ProductVariant/2",
        shopifyInventoryItemGid: "gid://shopify/InventoryItem/2",
      });
      return mappings;
    },
    async loadBaselines() {
      return new Map([
        ["mapping-1", [{ mappingId: "mapping-1", field: "title", serializedValue: "Old" }]],
        ["mapping-2", [{ mappingId: "mapping-2", field: "title", serializedValue: "Old" }]],
      ]);
    },
    async loadProducts(input) {
      // Un target per mapping, ciascuno con la propria variante.
      assert.deepEqual(input.targets, [
        {
          mappingId: "mapping-1",
          productGid: "gid://shopify/Product/1",
          variantGid: "gid://shopify/ProductVariant/1",
        },
        {
          mappingId: "mapping-2",
          productGid: "gid://shopify/Product/1",
          variantGid: "gid://shopify/ProductVariant/2",
        },
      ]);
      return new Map([
        ["mapping-1", {
          productGid: "gid://shopify/Product/1",
          title: "New",
          descriptionHtml: "",
          status: "ACTIVE",
          priceAmount: null,
          quantity: null,
          imageCount: 0,
        }],
        ["mapping-2", {
          productGid: "gid://shopify/Product/1",
          title: "Old",
          descriptionHtml: "",
          status: "ACTIVE",
          priceAmount: null,
          quantity: null,
          imageCount: 0,
        }],
      ]);
    },
  });

  const execution = await detectShopifyChangesBatch(
    { jobs: [...jobs, secondJob], shopDomain: "example.myshopify.com" },
    fakePorts,
  );

  // mapping-1 vede il titolo cambiato → conflitto; mapping-2 no → risolto.
  assert.deepEqual(
    execution.results.map(({ jobId, outcome }) => `${jobId}:${outcome}`),
    ["job-1:conflict_opened", "job-2:conflict_resolved"],
  );
});

test("keeps one failed product isolated from successful siblings", async () => {
  const secondJob = {
    ...jobs[0],
    id: "job-2",
    productGid: "gid://shopify/Product/2",
  };
  const fakePorts = ports({
    async loadMappings() {
      const first = await ports().loadMappings(jobs);
      first.set("product:gid://shopify/Product/2", {
        ...first.get("product:gid://shopify/Product/1")!,
        id: "mapping-2",
        shopifyProductGid: "gid://shopify/Product/2",
      });
      return first;
    },
  });

  const execution = await detectShopifyChangesBatch(
    { jobs: [...jobs, secondJob], shopDomain: "example.myshopify.com" },
    fakePorts,
  );

  assert.deepEqual(
    execution.results.map(({ outcome }) => outcome),
    ["conflict_opened", "failed"],
  );
});

test("skips archived paused and error mappings without a Shopify read", async () => {
  for (const status of ["ARCHIVED", "PAUSED", "ERROR"] as const) {
    let productReads = 0;
    const fakePorts = ports({
      async loadMappings() {
        const mappings = await ports().loadMappings(jobs);
        mappings.get("product:gid://shopify/Product/1")!.status = status;
        return mappings;
      },
      async loadProducts() {
        productReads += 1;
        return new Map();
      },
    });

    const execution = await detectShopifyChangesBatch(
      { jobs, shopDomain: "example.myshopify.com" },
      fakePorts,
    );
    assert.equal(productReads, 0);
    assert.equal(execution.results[0]?.outcome, "noop");
  }
});

test("reports every absorbed job id exactly once", async () => {
  const execution = await detectShopifyChangesBatch(
    { jobs: [...jobs, { ...jobs[0], id: "job-2" }], shopDomain: "example.myshopify.com" },
    ports(),
  );

  assert.deepEqual(execution.results.map(({ jobId }) => jobId), ["job-1", "job-2"]);
});
