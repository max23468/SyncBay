import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import {
  buildSeededShopifyChangeBatch,
  buildShopifyChangeBatch,
} from "./syncbay-shopify-change-batch.ts";

function job(
  input: Partial<{
    id: string;
    createdAt: Date;
    inventoryItemGid: string | null;
    productGid: string | null;
    topic: string;
  }> = {},
) {
  return {
    id: input.id ?? "job-1",
    createdAt: input.createdAt ?? new Date("2026-07-11T10:00:00Z"),
    inventoryItemGid: input.inventoryItemGid ?? null,
    productGid: input.productGid ?? "gid://shopify/Product/1",
    shopId: "shop-1",
    topic: input.topic ?? "products/update",
  };
}

test("keeps the newest job and absorbs an older duplicate", () => {
  const batch = buildShopifyChangeBatch([
    job({ id: "old" }),
    job({ id: "new", createdAt: new Date("2026-07-11T10:01:00Z") }),
  ]);

  assert.deepEqual(
    batch.jobs.map(({ id }) => id),
    ["new"],
  );
  assert.deepEqual(batch.duplicateJobIds, ["old"]);
});

test("keeps product and inventory resources distinct", () => {
  const batch = buildShopifyChangeBatch([
    job({ id: "product" }),
    job({
      id: "inventory",
      productGid: null,
      inventoryItemGid: "gid://shopify/InventoryItem/1",
      topic: "inventory_levels/update",
    }),
  ]);

  assert.equal(batch.jobs.length, 2);
  assert.deepEqual(batch.duplicateJobIds, []);
});

test("caps distinct resources at 25", () => {
  const batch = buildShopifyChangeBatch(
    Array.from({ length: 30 }, (_, index) =>
      job({ id: `job-${index}`, productGid: `gid://shopify/Product/${index}` }),
    ),
  );

  assert.equal(batch.jobs.length, 25);
  assert.deepEqual(batch.duplicateJobIds, []);
});

test("keeps jobs without a resource so they can report mapping_not_found", () => {
  const batch = buildShopifyChangeBatch([
    job({ id: "missing", productGid: null, inventoryItemGid: null }),
  ]);

  assert.deepEqual(
    batch.jobs.map(({ id }) => id),
    ["missing"],
  );
});

test("always keeps the claimed seed inside a full batch", () => {
  const seed = job({
    id: "claimed-seed",
    createdAt: new Date("2026-07-10T10:00:00Z"),
    productGid: "gid://shopify/Product/seed",
  });
  const newerJobs = Array.from({ length: 49 }, (_, index) =>
    job({
      id: `newer-${index}`,
      createdAt: new Date(
        `2026-07-11T10:${String(index).padStart(2, "0")}:00Z`,
      ),
      productGid: `gid://shopify/Product/${index}`,
    }),
  );

  const batch = buildSeededShopifyChangeBatch(seed, newerJobs);

  assert.equal(batch.jobs.length, 25);
  assert.equal(
    batch.jobs.some(({ id }) => id === seed.id),
    true,
  );
});
