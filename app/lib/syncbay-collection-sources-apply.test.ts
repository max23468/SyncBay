import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { buildSourcesUpdate } from "./syncbay-collection-sources-apply.ts";

const bancoteSource = {
  id: "gid://shopify/CollectionConditionsSource/4782883151",
  inclusion: {
    matchType: "ALL",
    conditions: [
      {
        __typename: "CollectionSourceInclusionConditionProductType",
        id: "gid://shopify/CollectionSourceInclusionConditionProductType/1",
        relation: "CONTAINS",
        values: ["Monete e banconote:Banconote"],
      },
      {
        __typename: "CollectionSourceInclusionConditionVariantInventory",
        id: "gid://shopify/CollectionSourceInclusionConditionVariantInventory/2",
        relation: "GREATER_THAN",
        value: 0,
      },
    ],
  },
};

test("updates the product type condition in place and leaves matching inventory untouched", () => {
  const entry = buildSourcesUpdate({
    currentSource: bancoteSource,
    proposedRuleSet: {
      appliedDisjunctively: false,
      rules: [
        { column: "TYPE", relation: "CONTAINS", condition: "Banconote" },
        { column: "VARIANT_INVENTORY", relation: "GREATER_THAN", condition: "0" },
      ],
    },
  });

  assert.deepEqual(entry, {
    condition: {
      id: "gid://shopify/CollectionConditionsSource/4782883151",
      inclusion: {
        matchType: "ALL",
        conditionsToUpdate: [
          {
            id: "gid://shopify/CollectionSourceInclusionConditionProductType/1",
            condition: { productType: { matchType: "ALL", relation: "CONTAINS", values: ["Banconote"] } },
          },
        ],
      },
    },
  });
});

test("changes EQUALS to CONTAINS on the existing product type condition", () => {
  const entry = buildSourcesUpdate({
    currentSource: {
      id: "gid://shopify/CollectionConditionsSource/9",
      inclusion: {
        matchType: "ALL",
        conditions: [
          {
            __typename: "CollectionSourceInclusionConditionProductType",
            id: "gid://shopify/CollectionSourceInclusionConditionProductType/9",
            relation: "EQUALS",
            values: ["Monete e banconote:Monete in euro:Italia"],
          },
          {
            __typename: "CollectionSourceInclusionConditionVariantInventory",
            id: "gid://shopify/CollectionSourceInclusionConditionVariantInventory/9",
            relation: "GREATER_THAN",
            value: 0,
          },
        ],
      },
    },
    proposedRuleSet: {
      appliedDisjunctively: false,
      rules: [
        { column: "TYPE", relation: "CONTAINS", condition: "Monete in euro:Italia" },
        { column: "VARIANT_INVENTORY", relation: "GREATER_THAN", condition: "0" },
      ],
    },
  });

  assert.equal(
    entry.condition.inclusion.conditionsToUpdate?.[0]?.condition &&
      JSON.stringify(entry.condition.inclusion.conditionsToUpdate[0].condition),
    JSON.stringify({ productType: { matchType: "ALL", relation: "CONTAINS", values: ["Monete in euro:Italia"] } }),
  );
  assert.equal(entry.condition.inclusion.conditionsToCreate, undefined);
});

test("creates an inventory condition when the collection lacks one", () => {
  const entry = buildSourcesUpdate({
    currentSource: {
      id: "gid://shopify/CollectionConditionsSource/3",
      inclusion: {
        matchType: "ALL",
        conditions: [
          {
            __typename: "CollectionSourceInclusionConditionProductType",
            id: "gid://shopify/CollectionSourceInclusionConditionProductType/3",
            relation: "CONTAINS",
            values: ["Cataloghi e accessori"],
          },
        ],
      },
    },
    proposedRuleSet: {
      appliedDisjunctively: false,
      rules: [
        { column: "TYPE", relation: "CONTAINS", condition: "Cataloghi e accessori" },
        { column: "VARIANT_INVENTORY", relation: "GREATER_THAN", condition: "0" },
      ],
    },
  });

  assert.deepEqual(entry.condition.inclusion.conditionsToCreate, [
    { variantInventory: { relation: "GREATER_THAN", value: 0 } },
  ]);
});

test("rejects unsupported rule columns instead of writing ambiguous conditions", () => {
  assert.throws(
    () =>
      buildSourcesUpdate({
        currentSource: bancoteSource,
        proposedRuleSet: {
          appliedDisjunctively: false,
          rules: [{ column: "TITLE", relation: "CONTAINS", condition: "capsul" }],
        },
      }),
    /TITLE/,
  );
});
