import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { buildCollectionRuleReview } from "./syncbay-collection-rule-proposals.ts";

test("warns instead of changing disjunctive title rules without product type intent", () => {
  const review = buildCollectionRuleReview({
    collectionIntents: [
      {
        handle: "accessori-numismatici",
        requirePositiveInventory: true,
        title: "Accessori numismatici",
      },
    ],
    collections: [
      {
        handle: "accessori-numismatici",
        id: "gid://shopify/Collection/1",
        ruleSet: {
          appliedDisjunctively: true,
          rules: [
            { column: "TITLE", relation: "CONTAINS", condition: "capsul" },
            { column: "TITLE", relation: "CONTAINS", condition: "masterphil" },
          ],
        },
        title: "Accessori numismatici",
      },
    ],
  });

  assert.deepEqual(review.proposals, []);
  assert.equal(review.warnings.length, 1);
  assert.equal(review.warnings[0]?.reason, "unsafe_disjunctive_title_rules");
  assert.match(review.warnings[0]?.message ?? "", /OR.*AND/);
});

test("adds inventory guard only to conjunctive specific automatic collections", () => {
  const review = buildCollectionRuleReview({
    collectionIntents: [
      {
        handle: "cataloghi-accessori",
        requirePositiveInventory: true,
        title: "Cataloghi accessori",
      },
    ],
    collections: [
      {
        handle: "cataloghi-accessori",
        id: "gid://shopify/Collection/4",
        ruleSet: {
          appliedDisjunctively: false,
          rules: [
            { column: "TYPE", relation: "CONTAINS", condition: "Cataloghi e accessori" },
          ],
        },
        title: "Cataloghi accessori",
      },
    ],
  });

  assert.equal(review.warnings.length, 0);
  assert.equal(review.proposals.length, 1);
  assert.equal(review.proposals[0]?.reason, "missing_inventory_guard");
  assert.deepEqual(review.proposals[0]?.proposedRuleSet, {
    appliedDisjunctively: false,
    rules: [
      { column: "TYPE", relation: "CONTAINS", condition: "Cataloghi e accessori" },
      { column: "VARIANT_INVENTORY", relation: "GREATER_THAN", condition: "0" },
    ],
  });
});

test("does not propose changes for generic collections", () => {
  const review = buildCollectionRuleReview({
    collectionIntents: [
      {
        generic: true,
        handle: "negozio-online",
        requirePositiveInventory: true,
        title: "Negozio Online",
      },
    ],
    collections: [
      {
        handle: "negozio-online",
        id: "gid://shopify/Collection/2",
        ruleSet: {
          appliedDisjunctively: false,
          rules: [
            { column: "VARIANT_INVENTORY", relation: "GREATER_THAN", condition: "0" },
          ],
        },
        title: "Negozio Online",
      },
    ],
  });

  assert.deepEqual(review.proposals, []);
  assert.deepEqual(review.warnings, []);
});

test("uses product type rules from explicit collection intent", () => {
  const review = buildCollectionRuleReview({
    collectionIntents: [
      {
        handle: "banconote",
        productTypeContains: ["Banconote"],
        requirePositiveInventory: true,
        title: "Banconote",
      },
    ],
    collections: [
      {
        handle: "banconote",
        id: "gid://shopify/Collection/3",
        ruleSet: {
          appliedDisjunctively: false,
          rules: [
            { column: "TYPE", relation: "CONTAINS", condition: "Monete e banconote:Banconote" },
            { column: "VARIANT_INVENTORY", relation: "GREATER_THAN", condition: "0" },
          ],
        },
        title: "Banconote",
      },
    ],
  });

  assert.equal(review.proposals.length, 1);
  assert.equal(review.proposals[0]?.reason, "configured_product_type_alignment");
  assert.deepEqual(review.proposals[0]?.proposedRuleSet, {
    appliedDisjunctively: false,
    rules: [
      { column: "TYPE", relation: "CONTAINS", condition: "Banconote" },
      { column: "VARIANT_INVENTORY", relation: "GREATER_THAN", condition: "0" },
    ],
  });
});
