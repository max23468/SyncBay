import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import * as productSnapshotPayload from "./syncbay-product-snapshot-payload.ts";

const {
  buildEbayProductSnapshotPayload,
  getProductFacetBaselineFromSnapshotPayload,
  getProductFacetsFromSnapshotPayload,
  getProductSnapshotThumbnailUrlByMappingIdFromRows,
  getProductSnapshotThumbnailUrl,
  getProductSnapshotThumbnailUrlFromPayloads,
} = productSnapshotPayload;

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
      ebayPrimaryCategoryId: "11116",
      ebayPrimaryCategoryName: "Monete italiane",
      ebayPrimaryCategoryPath: "Monete e banconote > Monete italiane",
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
      ebayPrimaryCategoryId: "11116",
      ebayPrimaryCategoryName: "Monete italiane",
      ebayPrimaryCategoryPath: "Monete e banconote > Monete italiane",
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

test("persists unapplied Shopify category proposals for dry-run reporting", () => {
  assert.deepEqual(
    buildEbayProductSnapshotPayload({
      categoryProposal: {
        applied: false,
        confidence: "medium",
        productType: "Monete italiane",
        reason: "dry_run_only",
        shopifyCategoryGid: "gid://shopify/TaxonomyCategory/ae-2-2-2-2-3",
        shopifyCategoryName: "Rare Coins",
        source: "ebay_store_category",
      },
      descriptionMode: "pulita",
      imageUrls: [],
      issueCodes: [],
      skuGenerated: false,
      status: "ready",
    }),
    {
      categoryProposal: {
        applied: false,
        confidence: "medium",
        productType: "Monete italiane",
        reason: "dry_run_only",
        shopifyCategoryGid: "gid://shopify/TaxonomyCategory/ae-2-2-2-2-3",
        shopifyCategoryName: "Rare Coins",
        source: "ebay_store_category",
      },
      descriptionMode: "pulita",
      imageUrls: [],
      issueCodes: [],
      skuGenerated: false,
      status: "ready",
    },
  );
});

test("persists approved storefront facets for import audit", () => {
  assert.deepEqual(
    buildEbayProductSnapshotPayload({
      descriptionMode: "pulita",
      imageUrls: [],
      issueCodes: [],
      productFacets: [
        {
          key: "categoria",
          label: "Categoria",
          namespace: "syncbay_facets",
          type: "single_line_text_field",
          value: "Monete in euro",
        },
        {
          key: "materiale",
          label: "Materiale",
          namespace: "syncbay_facets",
          type: "single_line_text_field",
          value: "Argento",
        },
      ],
      skuGenerated: false,
      status: "ready",
    }).productFacets,
    [
      {
        key: "categoria",
        label: "Categoria",
        namespace: "syncbay_facets",
        type: "single_line_text_field",
        value: "Monete in euro",
      },
      {
        key: "materiale",
        label: "Materiale",
        namespace: "syncbay_facets",
        type: "single_line_text_field",
        value: "Argento",
      },
    ],
  );
});

test("persists explicit empty storefront facet baseline", () => {
  const payload = buildEbayProductSnapshotPayload({
    descriptionMode: "facet_only",
    imageUrls: [],
    issueCodes: [],
    productFacets: [],
    skuGenerated: false,
    status: "synced",
  });

  assert.deepEqual(payload.productFacets, []);
});

test("reads approved storefront facets from snapshot payloads", () => {
  assert.deepEqual(
    getProductFacetsFromSnapshotPayload({
      productFacets: [
        {
          key: "categoria",
          label: "Categoria",
          namespace: "syncbay_facets",
          type: "single_line_text_field",
          value: "Monete in euro",
        },
        {
          key: "area_stato",
          label: "Area",
          namespace: "syncbay_facets",
          type: "single_line_text_field",
          value: "Italia",
        },
        {
          key: "area",
          label: "Area",
          namespace: "altro",
          type: "single_line_text_field",
          value: "Da ignorare",
        },
      ],
    }),
    [
      {
        key: "categoria",
        label: "Categoria",
        namespace: "syncbay_facets",
        type: "single_line_text_field",
        value: "Monete in euro",
      },
      {
        key: "area_stato",
        label: "Area",
        namespace: "syncbay_facets",
        type: "single_line_text_field",
        value: "Italia",
      },
    ],
  );
});

test("distinguishes missing facet baseline from explicit empty baseline", () => {
  assert.equal(getProductFacetBaselineFromSnapshotPayload({}), null);
  assert.deepEqual(
    getProductFacetBaselineFromSnapshotPayload({ productFacets: [] }),
    [],
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

test("keeps the first safe thumbnail URL per mapping from ordered candidate rows", () => {
  const thumbnailUrlByMappingId =
    getProductSnapshotThumbnailUrlByMappingIdFromRows([
      {
        mappingId: "mapping-1",
        thumbnailUrl: "https://user:pass@example.com/private.jpg",
      },
      {
        mappingId: "mapping-1",
        thumbnailUrl: "https://i.ebayimg.example/latest.jpg",
      },
      {
        mappingId: "mapping-1",
        thumbnailUrl: "https://i.ebayimg.example/older.jpg",
      },
      {
        mappingId: "mapping-2",
        thumbnailUrl: "ftp://example.com/product.jpg",
      },
      {
        mappingId: "mapping-2",
        thumbnailUrl: "http://i.ebayimg.example/fallback.jpg",
      },
      {
        mappingId: null,
        thumbnailUrl: "https://i.ebayimg.example/missing-mapping.jpg",
      },
    ]);

  assert.equal(
    thumbnailUrlByMappingId.get("mapping-1"),
    "https://i.ebayimg.example/latest.jpg",
  );
  assert.equal(
    thumbnailUrlByMappingId.get("mapping-2"),
    "http://i.ebayimg.example/fallback.jpg",
  );
  assert.equal(thumbnailUrlByMappingId.size, 2);
});
