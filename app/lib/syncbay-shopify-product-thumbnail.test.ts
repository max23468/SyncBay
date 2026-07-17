import assert from "node:assert/strict";
import test from "node:test";

import { getShopifyProductThumbnailUrl } from "./syncbay-shopify-product-thumbnail.ts";

test("reads the first ready Shopify media image URL", () => {
  assert.equal(
    getShopifyProductThumbnailUrl({
      media: {
        nodes: [
          {
            image: { url: "https://cdn.shopify.example/product.jpg" },
            mediaContentType: "IMAGE",
            preview: { status: "READY" },
          },
        ],
      },
    }),
    "https://cdn.shopify.example/product.jpg",
  );
});

test("falls back to Shopify media preview image URL", () => {
  assert.equal(
    getShopifyProductThumbnailUrl({
      media: {
        nodes: [
          {
            mediaContentType: "IMAGE",
            preview: {
              image: { url: "https://cdn.shopify.example/preview.jpg" },
              status: "READY",
            },
          },
        ],
      },
    }),
    "https://cdn.shopify.example/preview.jpg",
  );
});

test("skips unsafe and not ready Shopify media images", () => {
  assert.equal(
    getShopifyProductThumbnailUrl({
      media: {
        nodes: [
          {
            image: { url: "https://cdn.shopify.example/pending.jpg" },
            mediaContentType: "IMAGE",
            preview: { status: "PROCESSING" },
          },
          {
            image: { url: "javascript:alert(1)" },
            mediaContentType: "IMAGE",
            preview: { status: "READY" },
          },
        ],
      },
    }),
    null,
  );
});
