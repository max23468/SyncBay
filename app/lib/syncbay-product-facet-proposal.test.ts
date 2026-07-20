import assert from "node:assert/strict";
import { test } from "vitest";

import { buildSyncBayProductFacetProposalFromSnapshot } from "./syncbay-product-facet-proposal.ts";

test("prefers normalized snapshot productFacets over raw category inference", () => {
  assert.deepEqual(
    buildSyncBayProductFacetProposalFromSnapshot({
      ebayPrimaryCategoryName: "Monete e banconote:Banconote altri continenti:Asia",
      payload: {
        productFacets: [
          {
            key: "categoria",
            label: "Categoria",
            namespace: "syncbay_facets",
            type: "single_line_text_field",
            value: "Banconote",
          },
        ],
      },
      storeCategoryName: null,
      title: "NL* VIETNAM Banconota 10 MUOI DONG",
    }),
    [
      {
        key: "categoria",
        label: "Categoria",
        namespace: "syncbay_facets",
        type: "single_line_text_field",
        value: "Banconote",
      },
    ],
  );
});

test("falls back to deterministic inference when the snapshot has no facets", () => {
  assert.deepEqual(
    buildSyncBayProductFacetProposalFromSnapshot({
      payload: {},
      title: "NL* VEIII 5 Lire ARGENTO AQUILOTTO 1928 BB/SPL Perizia",
    }).map((facet) => facet.key),
    ["categoria", "materiale", "conservazione", "perizia"],
  );
});

test("respects explicit empty snapshot productFacets", () => {
  assert.deepEqual(
    buildSyncBayProductFacetProposalFromSnapshot({
      payload: { productFacets: [] },
      title: "NL* VEIII 5 Lire ARGENTO AQUILOTTO 1928 BB/SPL Perizia",
    }),
    [],
  );
});
