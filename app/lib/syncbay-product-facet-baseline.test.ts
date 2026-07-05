import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { hasSyncBayProductFacetBaselineChanged } from "./syncbay-product-facet-baseline.ts";
import type { SyncBayProductFacet } from "./syncbay-product-facets";

const categoria: SyncBayProductFacet = {
  key: "categoria",
  label: "Categoria",
  namespace: "syncbay_facets",
  type: "single_line_text_field",
  value: "Monete",
};

const materiale: SyncBayProductFacet = {
  key: "materiale",
  label: "Materiale",
  namespace: "syncbay_facets",
  type: "list.single_line_text_field",
  value: JSON.stringify(["Argento"]),
};

test("compares facet baselines independent of facet order", () => {
  assert.equal(
    hasSyncBayProductFacetBaselineChanged(
      [categoria, materiale],
      [materiale, categoria],
    ),
    false,
  );
});

test("detects baseline changes when the writer-owned set changes", () => {
  assert.equal(
    hasSyncBayProductFacetBaselineChanged([categoria, materiale], [categoria]),
    true,
  );
});
