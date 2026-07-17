import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProductFacetApplyPlan,
  buildProductFacetBackfillReport,
} from "./syncbay-product-facet-backfill-report.ts";

const categoriaFacet = {
  key: "categoria" as const,
  label: "Categoria",
  namespace: "syncbay_facets" as const,
  type: "single_line_text_field" as const,
  value: "Monete italiane in lire",
};

const conservazioneFacet = {
  key: "conservazione" as const,
  label: "Conservazione",
  namespace: "syncbay_facets" as const,
  type: "list.single_line_text_field" as const,
  value: JSON.stringify(["BB"]),
};

test("classifies facet backfill rows without applying changes", () => {
  const report = buildProductFacetBackfillReport({
    rows: [
      {
        currentMetafields: [],
        ebayItemId: "1",
        proposedFacets: [categoriaFacet, conservazioneFacet],
        shopifyProductGid: "gid://shopify/Product/1",
      },
      {
        currentMetafields: [
          {
            key: "categoria",
            namespace: "syncbay_facets",
            type: "single_line_text_field",
            value: "Monete italiane in lire",
          },
        ],
        ebayItemId: "2",
        proposedFacets: [categoriaFacet],
        shopifyProductGid: "gid://shopify/Product/2",
      },
      {
        currentMetafields: [
          {
            key: "categoria",
            namespace: "syncbay_facets",
            type: "single_line_text_field",
            value: "Medaglie",
          },
        ],
        ebayItemId: "3",
        proposedFacets: [categoriaFacet],
        shopifyProductGid: "gid://shopify/Product/3",
      },
      {
        currentMetafields: [],
        ebayItemId: "4",
        proposedFacets: [],
        shopifyProductGid: "gid://shopify/Product/4",
      },
    ],
    shopDomain: "fixture-shop.myshopify.com",
  });

  assert.deepEqual(report.summary, {
    alreadyCorrect: 1,
    applicable: 1,
    conflictsManual: 1,
    ebayLookupFailed: 0,
    missingShopifyProduct: 0,
    total: 4,
    uncertain: 1,
  });
  assert.deepEqual(
    report.rows.map((row) => row.status),
    ["applicable", "already_correct", "conflict_manual", "uncertain"],
  );
  assert.deepEqual(report.proposedFacets, [
    {
      count: 3,
      key: "categoria",
      label: "Categoria",
      value: "Monete italiane in lire",
    },
    {
      count: 1,
      key: "conservazione",
      label: "Conservazione",
      value: JSON.stringify(["BB"]),
    },
  ]);
});

test("keeps missing Shopify products and failed lookups out of applicable changes", () => {
  const report = buildProductFacetBackfillReport({
    rows: [
      {
        currentMetafields: [],
        ebayItemId: "1",
        proposedFacets: [categoriaFacet],
        shopifyProductGid: null,
      },
      {
        currentMetafields: [],
        ebayItemId: "2",
        lookupFailed: true,
        lookupFailureReason: "Limite Trading API raggiunto.",
        proposedFacets: [],
        shopifyProductGid: "gid://shopify/Product/2",
      },
    ],
    shopDomain: "fixture-shop.myshopify.com",
  });

  assert.deepEqual(
    report.rows.map((row) => row.status),
    ["missing_shopify_product", "ebay_lookup_failed"],
  );
  assert.equal(report.summary.applicable, 0);
  assert.equal(
    report.rows[1]?.lookupFailureReason,
    "Limite Trading API raggiunto.",
  );
});

test("builds an apply plan only for missing approved facet metafields", () => {
  const report = buildProductFacetBackfillReport({
    rows: [
      {
        currentMetafields: [
          {
            key: "categoria",
            namespace: "syncbay_facets",
            type: "single_line_text_field",
            value: "Monete italiane in lire",
          },
        ],
        ebayItemId: "1",
        proposedFacets: [categoriaFacet, conservazioneFacet],
        shopifyProductGid: "gid://shopify/Product/1",
      },
      {
        currentMetafields: [
          {
            key: "categoria",
            namespace: "syncbay_facets",
            type: "single_line_text_field",
            value: "Medaglie",
          },
        ],
        ebayItemId: "2",
        proposedFacets: [categoriaFacet],
        shopifyProductGid: "gid://shopify/Product/2",
      },
    ],
    shopDomain: "fixture-shop.myshopify.com",
  });

  assert.deepEqual(buildProductFacetApplyPlan(report), {
    rows: [
      {
        ebayItemId: "1",
        metafields: [
          {
            key: "conservazione",
            namespace: "syncbay_facets",
            ownerId: "gid://shopify/Product/1",
            type: "list.single_line_text_field",
            value: JSON.stringify(["BB"]),
          },
        ],
        shopifyProductGid: "gid://shopify/Product/1",
      },
    ],
    skipped: {
      alreadyCorrect: 0,
      conflictsManual: 1,
      ebayLookupFailed: 0,
      missingShopifyProduct: 0,
      uncertain: 0,
    },
  });
});

test("repairs legacy single-line facet metafields when values match the stable list type", () => {
  const report = buildProductFacetBackfillReport({
    rows: [
      {
        currentMetafields: [
          {
            key: "conservazione",
            namespace: "syncbay_facets",
            type: "single_line_text_field",
            value: "BB",
          },
        ],
        ebayItemId: "1",
        proposedFacets: [conservazioneFacet],
        shopifyProductGid: "gid://shopify/Product/1",
      },
    ],
    shopDomain: "fixture-shop.myshopify.com",
  });

  assert.equal(report.rows[0]?.status, "applicable");
  assert.deepEqual(buildProductFacetApplyPlan(report).rows, [
    {
      ebayItemId: "1",
      metafields: [
        {
          key: "conservazione",
          namespace: "syncbay_facets",
          ownerId: "gid://shopify/Product/1",
          type: "list.single_line_text_field",
          value: JSON.stringify(["BB"]),
        },
      ],
      shopifyProductGid: "gid://shopify/Product/1",
    },
  ]);
});
