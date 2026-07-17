import assert from "node:assert/strict";
import test from "node:test";

import * as fieldPolicy from "./syncbay-existing-catalog-field-policy.ts";

const {
  buildExistingCatalogTagMutations,
  buildExistingCatalogFieldPolicy,
  getShopifyImageMediaIds,
  parseExistingCatalogFieldPoliciesByItemId,
  parseExistingCatalogLegacyTagsToRemove,
  serializeExistingCatalogFieldPoliciesByItemId,
  shouldSyncExistingCatalogImages,
} = fieldPolicy;

test("preserves product handles by default", () => {
  const policy = buildExistingCatalogFieldPolicy({
    currentHandle: "moneta-argento-1901",
    legacyTagsToRemove: [],
    shopifyImageCount: 2,
    syncbayLegacyTags: [],
  });

  assert.equal(policy.handle.operation, "preserve");
  assert.equal(policy.handle.redirectRequired, false);
  assert.equal(policy.handle.currentHandle, "moneta-argento-1901");
});

test("removes only explicit legacy tags and adds SyncBay source tag", () => {
  const policy = buildExistingCatalogFieldPolicy({
    currentTags: ["Vecchia app", "Monete rare"],
    legacyTagsToRemove: ["Vecchia app"],
    shopifyImageCount: 1,
    syncbayLegacyTags: ["Import preview"],
  });

  assert.deepEqual(policy.tags.remove, ["Vecchia app"]);
  assert.deepEqual(policy.tags.add, ["Negozio eBay"]);
  assert.deepEqual(policy.tags.preserve, ["Monete rare"]);
});

test("preserves existing images and only syncs images when Shopify has none", () => {
  assert.equal(
    buildExistingCatalogFieldPolicy({
      shopifyImageCount: 1,
      syncbayLegacyTags: [],
    }).images.operation,
    "preserve",
  );
  assert.equal(
    buildExistingCatalogFieldPolicy({
      shopifyImageCount: 0,
      syncbayLegacyTags: [],
    }).images.operation,
    "sync_from_ebay_if_available",
  );
});

test("counts only Shopify image media for takeover image preservation", () => {
  const preservePolicy = buildExistingCatalogFieldPolicy({
    shopifyImageCount: 1,
    syncbayLegacyTags: [],
  });
  const imageIds = getShopifyImageMediaIds([
    {
      id: "gid://shopify/MediaImage/1",
      mediaContentType: "IMAGE",
    },
    {
      id: "gid://shopify/Video/1",
      mediaContentType: "VIDEO",
    },
    {
      id: "gid://shopify/Model3d/1",
      mediaContentType: "MODEL_3D",
    },
  ]);

  assert.deepEqual(imageIds, ["gid://shopify/MediaImage/1"]);
  assert.equal(
    shouldSyncExistingCatalogImages({
      currentImageCount: getShopifyImageMediaIds([
        {
          id: "gid://shopify/Video/1",
          mediaContentType: "VIDEO",
        },
      ]).length,
      fieldPolicy: preservePolicy,
    }),
    true,
  );
});

test("normalizes legacy tag allowlists from comma-separated input", () => {
  assert.deepEqual(
    parseExistingCatalogLegacyTagsToRemove(
      " Vecchia app,Import preview, Vecchia app, ,Tag finale ",
    ),
    ["Vecchia app", "Import preview", "Tag finale"],
  );
});

test("caps legacy tag allowlists at fifty exact tags", () => {
  const tags = parseExistingCatalogLegacyTagsToRemove(
    Array.from({ length: 55 }, (_, index) => `Tag ${index + 1}`).join(","),
  );

  assert.equal(tags.length, 50);
  assert.equal(tags[0], "Tag 1");
  assert.equal(tags.at(-1), "Tag 50");
});

test("parses only valid field policies from job payloads", () => {
  assert.deepEqual(
    parseExistingCatalogFieldPoliciesByItemId({
      "1001": buildExistingCatalogFieldPolicy({
        currentHandle: "moneta-1001",
        currentTags: ["Vecchia app"],
        legacyTagsToRemove: ["Vecchia app"],
        shopifyImageCount: 1,
        syncbayLegacyTags: [],
      }),
      "1002": {
        handle: { operation: "replace", redirectRequired: true },
        images: { operation: "replace" },
        tags: { add: ["x"], preserve: [], remove: [] },
      },
    }),
    {
      "1001": {
        handle: {
          currentHandle: "moneta-1001",
          operation: "preserve",
          redirectRequired: false,
        },
        images: {
          operation: "preserve",
        },
        tags: {
          add: ["Negozio eBay"],
          preserve: [],
          remove: ["Vecchia app"],
        },
      },
    },
  );
});

test("serializes field policies to a JSON-safe job payload", () => {
  const policies = {
    "1001": buildExistingCatalogFieldPolicy({
      currentHandle: "moneta-1001",
      currentTags: ["Vecchia app"],
      legacyTagsToRemove: ["Vecchia app"],
      shopifyImageCount: 1,
      syncbayLegacyTags: [],
    }),
  };

  assert.deepEqual(
    parseExistingCatalogFieldPoliciesByItemId(
      serializeExistingCatalogFieldPoliciesByItemId(policies),
    ),
    policies,
  );
});

test("skips image sync only when existing Shopify images must be preserved", () => {
  const preservePolicy = buildExistingCatalogFieldPolicy({
    shopifyImageCount: 1,
    syncbayLegacyTags: [],
  });
  const syncPolicy = buildExistingCatalogFieldPolicy({
    shopifyImageCount: 0,
    syncbayLegacyTags: [],
  });

  assert.equal(
    shouldSyncExistingCatalogImages({
      currentImageCount: 2,
      fieldPolicy: preservePolicy,
    }),
    false,
  );
  assert.equal(
    shouldSyncExistingCatalogImages({
      currentImageCount: 0,
      fieldPolicy: preservePolicy,
    }),
    true,
  );
  assert.equal(
    shouldSyncExistingCatalogImages({
      currentImageCount: 2,
      fieldPolicy: syncPolicy,
    }),
    false,
  );
});

test("builds tag mutations against current Shopify tags", () => {
  assert.deepEqual(
    buildExistingCatalogTagMutations({
      currentTags: ["Vecchia app", "Negozio eBay", "Monete rare"],
      fieldPolicy: {
        handle: {
          currentHandle: "moneta",
          operation: "preserve",
          redirectRequired: false,
        },
        images: { operation: "preserve" },
        tags: {
          add: ["Negozio eBay"],
          preserve: ["Monete rare"],
          remove: ["Vecchia app", "Tag assente"],
        },
      },
    }),
    {
      add: [],
      remove: ["Vecchia app"],
    },
  );
});
