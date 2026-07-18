import assert from "node:assert/strict";
import { test } from "vitest";

import { shouldCreateProductSnapshot } from "./syncbay-product-snapshot-dedupe.ts";

const previousSnapshot = {
  currency: "EUR",
  descriptionHash: "desc-a",
  ebayItemId: "1001",
  imageCount: 2,
  payload: {
    imageUrls: ["https://i.ebayimg.example/1.jpg"],
    pricing: {
      priceAmount: 10,
    },
  },
  priceAmount: "10.00",
  productStatus: "ACTIVE",
  quantity: 4,
  shopifyProductGid: "gid://shopify/Product/1",
  shopifyVariantGid: "gid://shopify/ProductVariant/1",
  sku: "SKU-1",
  source: "SYNCBAY",
  title: "Prodotto",
};

test("skips identical consecutive product snapshots", () => {
  assert.equal(
    shouldCreateProductSnapshot({
      next: {
        ...previousSnapshot,
        payload: {
          pricing: {
            priceAmount: 10,
          },
          imageUrls: ["https://i.ebayimg.example/1.jpg"],
        },
        priceAmount: 10,
      },
      previous: previousSnapshot,
    }),
    false,
  );
});

test("creates a snapshot when the price changes", () => {
  assert.equal(
    shouldCreateProductSnapshot({
      next: {
        ...previousSnapshot,
        priceAmount: "11.00",
      },
      previous: previousSnapshot,
    }),
    true,
  );
});

test("creates a snapshot when the quantity changes", () => {
  assert.equal(
    shouldCreateProductSnapshot({
      next: {
        ...previousSnapshot,
        quantity: 3,
      },
      previous: previousSnapshot,
    }),
    true,
  );
});

test("creates a snapshot when the description hash changes", () => {
  assert.equal(
    shouldCreateProductSnapshot({
      next: {
        ...previousSnapshot,
        descriptionHash: "desc-b",
      },
      previous: previousSnapshot,
    }),
    true,
  );
});

test("creates a snapshot when image payload changes", () => {
  assert.equal(
    shouldCreateProductSnapshot({
      next: {
        ...previousSnapshot,
        payload: {
          imageUrls: ["https://i.ebayimg.example/2.jpg"],
          pricing: {
            priceAmount: 10,
          },
        },
      },
      previous: previousSnapshot,
    }),
    true,
  );
});

test("ignores volatile job metadata when comparing product state", () => {
  assert.equal(
    shouldCreateProductSnapshot({
      next: {
        ...previousSnapshot,
        payload: {
          imageUrls: ["https://i.ebayimg.example/1.jpg"],
          pricing: {
            priceAmount: 10,
            syncJobId: "job-next",
          },
          syncJobId: "job-next",
        },
      },
      previous: {
        ...previousSnapshot,
        payload: {
          imageUrls: ["https://i.ebayimg.example/1.jpg"],
          pricing: {
            priceAmount: 10,
            syncJobId: "job-prev",
          },
          syncJobId: "job-prev",
        },
      },
    }),
    false,
  );
});
