import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { buildEbayProductSnapshotPayload, getProductSnapshotThumbnailUrl } from "./syncbay-product-snapshot-payload.ts";

test("persists eBay image URLs in snapshot payloads", () => {
  assert.deepEqual(
    buildEbayProductSnapshotPayload({
      descriptionMode: "pulita",
      imageUrls: [
        " https://i.ebayimg.example/one.jpg ",
        "https://i.ebayimg.example/one.jpg",
        "https://i.ebayimg.example/two.jpg",
      ],
      issueCodes: ["missing_sku"],
      skuGenerated: true,
      status: "ready",
    }),
    {
      descriptionMode: "pulita",
      imageUrls: [
        "https://i.ebayimg.example/one.jpg",
        "https://i.ebayimg.example/two.jpg",
      ],
      issueCodes: ["missing_sku"],
      skuGenerated: true,
      status: "ready",
    },
  );
});

test("reads thumbnails from eBay snapshot image URLs", () => {
  assert.equal(
    getProductSnapshotThumbnailUrl({
      imageUrls: [
        "javascript:alert(1)",
        "https://i.ebayimg.example/product.jpg",
      ],
    }),
    "https://i.ebayimg.example/product.jpg",
  );
});

test("reads thumbnails from SyncBay media sync source URLs", () => {
  assert.equal(
    getProductSnapshotThumbnailUrl({
      mediaSync: {
        sourceImageUrls: ["https://i.ebayimg.example/synced.jpg"],
      },
    }),
    "https://i.ebayimg.example/synced.jpg",
  );
});

test("rejects credentialed thumbnail URLs", () => {
  assert.equal(
    getProductSnapshotThumbnailUrl({
      imageUrls: ["https://user:pass@example.com/private.jpg"],
      thumbnailUrl: "ftp://example.com/product.jpg",
    }),
    null,
  );
});
