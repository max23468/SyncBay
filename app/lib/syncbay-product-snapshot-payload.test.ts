import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { buildEbayProductSnapshotPayload, getProductSnapshotThumbnailUrl, getProductSnapshotThumbnailUrlFromPayloads } from "./syncbay-product-snapshot-payload.ts";

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

test("persists eBay store category metadata when assigned", () => {
  assert.deepEqual(
    buildEbayProductSnapshotPayload({
      descriptionMode: "pulita",
      imageUrls: [],
      issueCodes: [],
      skuGenerated: false,
      status: "ready",
      storeCategoryId: "1234567890",
      storeCategoryName: "Monete italiane",
    }),
    {
      descriptionMode: "pulita",
      imageUrls: [],
      issueCodes: [],
      skuGenerated: false,
      status: "ready",
      storeCategoryId: "1234567890",
      storeCategoryName: "Monete italiane",
    },
  );
});

test("omits eBay store category fields when missing", () => {
  const payload = buildEbayProductSnapshotPayload({
    descriptionMode: "pulita",
    imageUrls: [],
    issueCodes: [],
    skuGenerated: false,
    status: "ready",
    storeCategoryId: null,
    storeCategoryName: null,
  });

  assert.equal("storeCategoryId" in payload, false);
  assert.equal("storeCategoryName" in payload, false);
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

test("falls back to older payloads when the latest snapshot has no image", () => {
  assert.equal(
    getProductSnapshotThumbnailUrlFromPayloads([
      { reason: "stock_update" },
      {
        mediaSync: {
          sourceImageUrls: ["https://i.ebayimg.example/older.jpg"],
        },
      },
    ]),
    "https://i.ebayimg.example/older.jpg",
  );
});
