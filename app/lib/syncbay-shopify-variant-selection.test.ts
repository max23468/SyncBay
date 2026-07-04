import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import * as variantSelection from "./syncbay-shopify-variant-selection.ts";

const {
  mergePreferredShopifyVariantForSync,
  preserveSelectedShopifyVariantForSync,
  selectShopifyVariantForSync,
} = variantSelection;

test("selects the persisted mapped variant instead of the first product variant", () => {
  const selected = selectShopifyVariantForSync({
    preferredVariantGid: "gid://shopify/ProductVariant/target",
    variants: [
      { id: "gid://shopify/ProductVariant/first" },
      { id: "gid://shopify/ProductVariant/target" },
    ],
  });

  assert.deepEqual(selected, {
    id: "gid://shopify/ProductVariant/target",
  });
});

test("does not fall back to the first variant when a preferred variant is missing", () => {
  const selected = selectShopifyVariantForSync({
    preferredVariantGid: "gid://shopify/ProductVariant/missing",
    variants: [{ id: "gid://shopify/ProductVariant/first" }],
  });

  assert.equal(selected, null);
});

test("falls back to the first variant only when no preferred variant is stored", () => {
  const selected = selectShopifyVariantForSync({
    preferredVariantGid: null,
    variants: [{ id: "gid://shopify/ProductVariant/first" }],
  });

  assert.deepEqual(selected, {
    id: "gid://shopify/ProductVariant/first",
  });
});

test("prepends the directly fetched mapped variant to the product variants", () => {
  const variants = mergePreferredShopifyVariantForSync({
    preferredVariant: {
      id: "gid://shopify/ProductVariant/target",
      price: "12.00",
    },
    variants: [
      {
        id: "gid://shopify/ProductVariant/first",
        price: "99.00",
      },
    ],
  });

  assert.deepEqual(variants, [
    {
      id: "gid://shopify/ProductVariant/target",
      price: "12.00",
    },
    {
      id: "gid://shopify/ProductVariant/first",
      price: "99.00",
    },
  ]);
});

test("deduplicates the mapped variant when it is already in product variants", () => {
  const variants = mergePreferredShopifyVariantForSync({
    preferredVariant: {
      id: "gid://shopify/ProductVariant/target",
      price: "13.00",
    },
    variants: [
      {
        id: "gid://shopify/ProductVariant/target",
        price: "12.00",
      },
      {
        id: "gid://shopify/ProductVariant/first",
        price: "99.00",
      },
    ],
  });

  assert.deepEqual(variants, [
    {
      id: "gid://shopify/ProductVariant/target",
      price: "13.00",
    },
    {
      id: "gid://shopify/ProductVariant/first",
      price: "99.00",
    },
  ]);
});

test("keeps product variants unchanged when no preferred variant is fetched", () => {
  const variants = [
    {
      id: "gid://shopify/ProductVariant/first",
      price: "99.00",
    },
  ];

  assert.equal(
    mergePreferredShopifyVariantForSync({
      preferredVariant: null,
      variants,
    }),
    variants,
  );
});

test("keeps the selected mapped variant when productUpdate returns the first variant", () => {
  const product = preserveSelectedShopifyVariantForSync({
    previousProduct: {
      id: "gid://shopify/Product/1",
      title: "Prima",
      variants: {
        nodes: [
          {
            id: "gid://shopify/ProductVariant/target",
            price: "12.00",
          },
        ],
      },
    },
    updatedProduct: {
      id: "gid://shopify/Product/1",
      title: "Dopo",
      variants: {
        nodes: [
          {
            id: "gid://shopify/ProductVariant/first",
            price: "99.00",
          },
        ],
      },
    },
  });

  assert.equal(product.title, "Dopo");
  assert.deepEqual(product.variants.nodes, [
    {
      id: "gid://shopify/ProductVariant/target",
      price: "12.00",
    },
  ]);
});

test("uses the updated selected variant when productUpdate returns it", () => {
  const product = preserveSelectedShopifyVariantForSync({
    previousProduct: {
      variants: {
        nodes: [
          {
            id: "gid://shopify/ProductVariant/target",
            price: "12.00",
          },
        ],
      },
    },
    updatedProduct: {
      variants: {
        nodes: [
          {
            id: "gid://shopify/ProductVariant/target",
            price: "13.00",
          },
        ],
      },
    },
  });

  assert.deepEqual(product.variants.nodes, [
    {
      id: "gid://shopify/ProductVariant/target",
      price: "13.00",
    },
  ]);
});
