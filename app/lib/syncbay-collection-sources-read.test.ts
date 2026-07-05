import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { conditionsSourceToRuleSet } from "./syncbay-collection-sources-read.ts";

test("converts a conjunctive product type + inventory source to legacy ruleSet", () => {
  const ruleSet = conditionsSourceToRuleSet({
    id: "gid://shopify/CollectionConditionsSource/1",
    inclusion: {
      matchType: "ALL",
      conditions: [
        {
          __typename: "CollectionSourceInclusionConditionProductType",
          relation: "CONTAINS",
          values: ["Banconote"],
        },
        {
          __typename: "CollectionSourceInclusionConditionVariantInventory",
          relation: "GREATER_THAN",
          value: 0,
        },
      ],
    },
  });

  assert.deepEqual(ruleSet, {
    appliedDisjunctively: false,
    rules: [
      { column: "TYPE", relation: "CONTAINS", condition: "Banconote" },
      { column: "VARIANT_INVENTORY", relation: "GREATER_THAN", condition: "0" },
    ],
  });
});

test("expands multi-value title conditions and marks disjunctive inclusion", () => {
  const ruleSet = conditionsSourceToRuleSet({
    inclusion: {
      matchType: "ANY",
      conditions: [
        {
          __typename: "CollectionSourceInclusionConditionProductTitle",
          relation: "CONTAINS",
          values: ["capsul", "masterphil", "raccoglitore"],
        },
      ],
    },
  });

  assert.deepEqual(ruleSet, {
    appliedDisjunctively: true,
    rules: [
      { column: "TITLE", relation: "CONTAINS", condition: "capsul" },
      { column: "TITLE", relation: "CONTAINS", condition: "masterphil" },
      { column: "TITLE", relation: "CONTAINS", condition: "raccoglitore" },
    ],
  });
});

test("returns null for a collection without a conditions source", () => {
  assert.equal(conditionsSourceToRuleSet(null), null);
  assert.equal(conditionsSourceToRuleSet({ inclusion: null }), null);
});

test("keeps unrecognised condition types visible instead of dropping them", () => {
  const ruleSet = conditionsSourceToRuleSet({
    inclusion: {
      matchType: "ALL",
      conditions: [
        {
          __typename: "CollectionSourceInclusionConditionMetafieldString",
          relation: "EQUALS",
          values: ["x"],
        },
      ],
    },
  });

  assert.deepEqual(ruleSet?.rules, [
    {
      column: "CollectionSourceInclusionConditionMetafieldString",
      relation: "EQUALS",
      condition: "x",
    },
  ]);
});
