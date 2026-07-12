import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import * as shopifyAdminDiagnostics from "./syncbay-shopify-admin-diagnostics.ts";

const {
  buildShopifyAdminDiagnosticsProductQuery,
  normalizeShopifyAdminDiagnosticsProductInput,
} = shopifyAdminDiagnostics;

test("normalizes a bounded product diagnostics payload", () => {
  assert.deepEqual(
    normalizeShopifyAdminDiagnosticsProductInput(
      {
        defaultLocationGid: "gid://shopify/Location/1",
        productGids: [
          "gid://shopify/Product/1",
          "gid://shopify/Product/1",
          " gid://shopify/Product/2 ",
        ],
        shopDomain: "fixture-shop.myshopify.com",
      },
      { fallbackShopDomain: "fallback.myshopify.com" },
    ),
    {
      defaultLocationGid: "gid://shopify/Location/1",
      productGids: ["gid://shopify/Product/1", "gid://shopify/Product/2"],
      shopDomain: "fixture-shop.myshopify.com",
    },
  );
});

test("uses the explicit diagnostics shop even without a fallback", () => {
  assert.equal(
    normalizeShopifyAdminDiagnosticsProductInput(
      {
        productGids: ["gid://shopify/Product/1"],
        shopDomain: "explicit-shop.myshopify.com",
      },
      { fallbackShopDomain: "" },
    ).shopDomain,
    "explicit-shop.myshopify.com",
  );
});

test("rejects product diagnostics payloads that are not a safe id list", () => {
  assert.throws(
    () =>
      normalizeShopifyAdminDiagnosticsProductInput(
        { productGids: "gid://shopify/Product/1" },
        { fallbackShopDomain: "fallback.myshopify.com" },
      ),
    /productGids deve essere un array/,
  );

  assert.throws(
    () =>
      normalizeShopifyAdminDiagnosticsProductInput(
        { productGids: ["gid://shopify/Variant/1"] },
        { fallbackShopDomain: "fallback.myshopify.com" },
      ),
    /Product GID Shopify non valido/,
  );

  assert.throws(
    () =>
      normalizeShopifyAdminDiagnosticsProductInput(
        {
          productGids: Array.from(
            { length: 21 },
            (_, index) => `gid://shopify/Product/${index + 1}`,
          ),
        },
        { fallbackShopDomain: "fallback.myshopify.com" },
      ),
    /massimo 20 prodotti/,
  );
});

test("builds the fixed Shopify product diagnostics query without arbitrary GraphQL", () => {
  const withoutLocation = buildShopifyAdminDiagnosticsProductQuery({
    defaultLocationGid: null,
    productGids: ["gid://shopify/Product/1"],
  });
  assert.equal(withoutLocation.variables.ids.length, 1);
  assert.equal("locationId" in withoutLocation.variables, false);
  assert.match(withoutLocation.query, /query SyncBayVerifyProducts/);
  assert.doesNotMatch(withoutLocation.query, /inventoryLevel\(locationId:/);

  const withLocation = buildShopifyAdminDiagnosticsProductQuery({
    defaultLocationGid: "gid://shopify/Location/1",
    productGids: ["gid://shopify/Product/1"],
  });
  assert.deepEqual(withLocation.variables, {
    ids: ["gid://shopify/Product/1"],
    locationId: "gid://shopify/Location/1",
  });
  assert.match(
    withLocation.query,
    /inventoryLevel\(locationId: \$locationId\)/,
  );
});

test("includes product category and product type for category backfill dry-runs", () => {
  const query = buildShopifyAdminDiagnosticsProductQuery({
    defaultLocationGid: null,
    productGids: ["gid://shopify/Product/1"],
  }).query;

  assert.match(query, /productType/);
  assert.match(query, /category\s*\{/);
  assert.match(query, /fullName/);
});
