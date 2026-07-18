import assert from "node:assert/strict";
import { test } from "vitest";

import { buildProductFacetSyncPlan } from "./syncbay-product-facet-sync-plan.ts";

const materiale = {
  key: "materiale" as const,
  label: "Materiale",
  namespace: "syncbay_facets" as const,
  type: "list.single_line_text_field" as const,
  value: JSON.stringify(["Argento"]),
};

const materialeBronzo = {
  ...materiale,
  value: JSON.stringify(["Bronzo"]),
};

test("writes missing facet metafields", () => {
  assert.deepEqual(
    buildProductFacetSyncPlan({
      currentMetafields: [],
      previousSyncBayFacets: [],
      proposedFacets: [materiale],
    }).writes,
    [
      {
        key: "materiale",
        namespace: "syncbay_facets",
        type: "list.single_line_text_field",
        value: JSON.stringify(["Argento"]),
      },
    ],
  );
});

test("updates facets still aligned to previous SyncBay baseline", () => {
  const plan = buildProductFacetSyncPlan({
    currentMetafields: [
      {
        key: "materiale",
        namespace: "syncbay_facets",
        type: "list.single_line_text_field",
        value: JSON.stringify(["Bronzo"]),
      },
    ],
    previousSyncBayFacets: [materialeBronzo],
    proposedFacets: [materiale],
  });

  assert.equal(plan.conflicts.length, 0);
  assert.deepEqual(plan.writes, [
    {
      key: "materiale",
      namespace: "syncbay_facets",
      type: "list.single_line_text_field",
      value: JSON.stringify(["Argento"]),
    },
  ]);
});

test("does not overwrite Shopify values changed after the SyncBay baseline", () => {
  const plan = buildProductFacetSyncPlan({
    currentMetafields: [
      {
        key: "materiale",
        namespace: "syncbay_facets",
        type: "list.single_line_text_field",
        value: JSON.stringify(["Oro"]),
      },
    ],
    previousSyncBayFacets: [materialeBronzo],
    proposedFacets: [materiale],
  });

  assert.deepEqual(plan.writes, []);
  assert.deepEqual(plan.conflicts, [
    {
      key: "materiale",
      namespace: "syncbay_facets",
      type: "list.single_line_text_field",
      value: JSON.stringify(["Argento"]),
    },
  ]);
  assert.deepEqual(plan.skipped, [
    { key: "materiale", reason: "manual_conflict" },
  ]);
});

test("deletes facets still aligned to SyncBay when evidence disappears", () => {
  const plan = buildProductFacetSyncPlan({
    currentMetafields: [
      {
        key: "materiale",
        namespace: "syncbay_facets",
        type: "list.single_line_text_field",
        value: JSON.stringify(["Bronzo"]),
      },
    ],
    deleteMissingFacets: true,
    previousSyncBayFacets: [materialeBronzo],
    proposedFacets: [],
  });

  assert.deepEqual(plan.writes, []);
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(plan.deletes, [
    {
      key: "materiale",
      namespace: "syncbay_facets",
    },
  ]);
  assert.deepEqual(plan.skipped, [
    { key: "materiale", reason: "evidence_missing" },
  ]);
});

test("preserves facets by default when evidence is temporarily missing", () => {
  const plan = buildProductFacetSyncPlan({
    currentMetafields: [
      {
        key: "materiale",
        namespace: "syncbay_facets",
        type: "list.single_line_text_field",
        value: JSON.stringify(["Bronzo"]),
      },
    ],
    previousSyncBayFacets: [materialeBronzo],
    proposedFacets: [],
  });

  assert.deepEqual(plan.writes, []);
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(plan.deletes, []);
  assert.deepEqual(plan.preserved, [materialeBronzo]);
  assert.deepEqual(plan.skipped, [
    { key: "materiale", reason: "evidence_missing" },
  ]);
});
