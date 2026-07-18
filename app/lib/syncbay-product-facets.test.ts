import assert from "node:assert/strict";
import { test } from "vitest";

import * as productFacets from "./syncbay-product-facets.ts";

const {
  buildShopifyProductFacetMetafields,
  buildSyncBayProductFacetInferences,
  buildSyncBayProductFacets,
  parseEbayTradingItemSpecifics,
} = productFacets;

test("builds only high-confidence storefront facets for Shopify writes", () => {
  assert.deepEqual(
    buildSyncBayProductFacets({
      ebayPrimaryCategoryName: "Monete e banconote",
      itemSpecifics: [
        { name: "Area / Stato", values: [" Italia - Regno "] },
        { name: "Metallo", values: ["Argento"] },
        { name: "Grado di conservazione", values: ["qFDC", " FDC "] },
        { name: "Certificazione", values: ["Con perizia"] },
        { name: "Anno", values: ["1928"] },
      ],
      storeCategoryName: "Monete italiane in lire",
    }),
    [
      {
        key: "categoria",
        label: "Categoria",
        namespace: "syncbay_facets",
        type: "single_line_text_field",
        value: "Monete italiane in lire",
      },
    ],
  );
});

test("does not infer the perizia facet when eBay does not provide it", () => {
  assert.deepEqual(
    buildSyncBayProductFacets({
      itemSpecifics: [
        { name: "Materiale", values: ["Bronzo"] },
        { name: "Conservazione", values: ["BB"] },
      ],
      storeCategoryName: "Medaglie",
    }).map((facet) => facet.key),
    ["categoria"],
  );
});

test("marks title-derived facet values as high confidence inferences", () => {
  assert.deepEqual(
    buildSyncBayProductFacetInferences({
      title: "NL* VEIII 5 Lire ARGENTO AQUILOTTO 1928 BB/SPL Perizia",
    }).map((inference) => ({
      confidence: inference.confidence,
      key: inference.key,
      source: inference.source,
      value: inference.value,
    })),
    [
      {
        confidence: "high",
        key: "categoria",
        source: "title_rule",
        value: "Monete italiane in lire",
      },
      {
        confidence: "high",
        key: "materiale",
        source: "title_rule",
        value: JSON.stringify(["Argento"]),
      },
      {
        confidence: "high",
        key: "conservazione",
        source: "title_rule",
        value: JSON.stringify(["BB", "SPL"]),
      },
      {
        confidence: "high",
        key: "perizia",
        source: "title_rule",
        value: "Con perizia",
      },
    ],
  );
});

test("keeps eBay item specifics as medium confidence suggestions", () => {
  const inferences = buildSyncBayProductFacetInferences({
    itemSpecifics: [
      { name: "Materiale", values: ["Argento"] },
      { name: "Conservazione", values: ["FDC"] },
    ],
  });

  assert.deepEqual(
    inferences.map((inference) => ({
      confidence: inference.confidence,
      key: inference.key,
      source: inference.source,
    })),
    [
      { confidence: "medium", key: "materiale", source: "ebay_specific" },
      { confidence: "medium", key: "conservazione", source: "ebay_specific" },
    ],
  );
  assert.deepEqual(
    buildSyncBayProductFacets({
      itemSpecifics: [
        { name: "Materiale", values: ["Argento"] },
        { name: "Conservazione", values: ["FDC"] },
      ],
    }),
    [],
  );
});

test("extracts Numisleo conservation and perizia signals from the title", () => {
  assert.deepEqual(
    buildSyncBayProductFacets({
      itemSpecifics: [{ name: "Paese di origine", values: ["Italia"] }],
      storeCategoryName: "Monete italiane in lire",
      title:
        "NL* ITALIA Repubblica 50 LIRE VULCANO 1958 RARA BB Perizia Filisina Massimo",
    }),
    [
      {
        key: "categoria",
        label: "Categoria",
        namespace: "syncbay_facets",
        type: "single_line_text_field",
        value: "Monete italiane in lire",
      },
      {
        key: "area_stato",
        label: "Area / Stato",
        namespace: "syncbay_facets",
        type: "single_line_text_field",
        value: "Italia - Repubblica",
      },
      {
        key: "conservazione",
        label: "Conservazione",
        namespace: "syncbay_facets",
        type: "list.single_line_text_field",
        value: JSON.stringify(["BB"]),
      },
      {
        key: "perizia",
        label: "Perizia",
        namespace: "syncbay_facets",
        type: "single_line_text_field",
        value: "Con perizia",
      },
    ],
  );
});

test("extracts split conservation and material from coin titles without inferring perizia from a surname alone", () => {
  assert.deepEqual(
    buildSyncBayProductFacets({
      itemSpecifics: [{ name: "Paese di origine", values: ["Italia"] }],
      storeCategoryName: "Monete italiane in lire",
      title:
        "NL* UMBERTO I COLONIA ERITREA Tallero 5 LIRE ARGENTO 1896 RR QSPL/SPL Filisina",
    }),
    [
      {
        key: "categoria",
        label: "Categoria",
        namespace: "syncbay_facets",
        type: "single_line_text_field",
        value: "Monete italiane in lire",
      },
      {
        key: "area_stato",
        label: "Area / Stato",
        namespace: "syncbay_facets",
        type: "single_line_text_field",
        value: "Italia - Regno",
      },
      {
        key: "materiale",
        label: "Materiale",
        namespace: "syncbay_facets",
        type: "list.single_line_text_field",
        value: JSON.stringify(["Argento"]),
      },
      {
        key: "conservazione",
        label: "Conservazione",
        namespace: "syncbay_facets",
        type: "list.single_line_text_field",
        value: JSON.stringify(["qSPL", "SPL"]),
      },
    ],
  );
});

test("uses title fallback for category, area and material when eBay structured fields are absent", () => {
  assert.deepEqual(
    buildSyncBayProductFacets({
      title:
        "NL* GERMANIA Medaglia Bronzo HELMUT KOHL ELEZIONI 1990 proof in oblo' protettivo",
    }),
    [
      {
        key: "categoria",
        label: "Categoria",
        namespace: "syncbay_facets",
        type: "single_line_text_field",
        value: "Medaglie",
      },
      {
        key: "area_stato",
        label: "Area / Stato",
        namespace: "syncbay_facets",
        type: "single_line_text_field",
        value: "Germania",
      },
      {
        key: "materiale",
        label: "Materiale",
        namespace: "syncbay_facets",
        type: "list.single_line_text_field",
        value: JSON.stringify(["Bronzo"]),
      },
      {
        key: "conservazione",
        label: "Conservazione",
        namespace: "syncbay_facets",
        type: "list.single_line_text_field",
        value: JSON.stringify(["Proof"]),
      },
    ],
  );
});

test("normalizes nested eBay store categories to storefront category values", () => {
  assert.deepEqual(
    buildSyncBayProductFacets({
      storeCategoryName:
        "Monete e banconote:Monete italiane in lire:Regno:Dal 1901 al 1945",
      title: "NL* VEIII 5 Lire ARGENTO AQUILOTTO 1928 BB/SPL Perizia",
    }).find((facet) => facet.key === "categoria")?.value,
    "Monete italiane in lire",
  );
});

test("prefers store category over conflicting title category fallback", () => {
  assert.equal(
    buildSyncBayProductFacets({
      storeCategoryName: "Medaglie",
      title: "NL* ITALIA 500 LIRE ARGENTO CARAVELLE 1961 FDC",
    }).find((facet) => facet.key === "categoria")?.value,
    "Medaglie",
  );
});

test("uses high-confidence title category before medium marketplace category hints", () => {
  assert.equal(
    buildSyncBayProductFacets({
      ebayPrimaryCategoryName: "Monete e banconote",
      title: "NL* ITALIA 500 LIRE ARGENTO CARAVELLE 1961 FDC",
    }).find((facet) => facet.key === "categoria")?.value,
    "Monete italiane in lire",
  );
});

test("uses Numisleo-like category values from coin title fallback", () => {
  assert.deepEqual(
    buildSyncBayProductFacets({
      title: "NL* ITALIA 500 LIRE ARGENTO CARAVELLE 1961 FDC",
    }).find((facet) => facet.key === "categoria")?.value,
    "Monete italiane in lire",
  );
  assert.deepEqual(
    buildSyncBayProductFacets({
      title: "NL* ITALIA 2 EURO COMMEMORATIVO 2020 FDC",
    }).find((facet) => facet.key === "categoria")?.value,
    "Monete in euro",
  );
});

test("does not infer copper material from ramo in Italian coin titles", () => {
  assert.equal(
    buildSyncBayProductFacets({
      title: "NL* ITALIA 20 LIRE RAMO DI QUERCIA 1968 RARA FDC",
    }).some((facet) => facet.key === "materiale"),
    false,
  );
});

test("matches short country aliases only on token boundaries", () => {
  assert.equal(
    buildSyncBayProductFacets({
      title: "NL* MEDAGLIA DUKA BRONZO 1990",
    }).some((facet) => facet.key === "area_stato"),
    false,
  );
  assert.equal(
    buildSyncBayProductFacets({
      title: "NL* MEDAGLIA USATO SICURO BRONZO 1990",
    }).some((facet) => facet.key === "area_stato"),
    false,
  );
  assert.equal(
    buildSyncBayProductFacets({
      title: "NL* UK MEDAGLIA BRONZO 1990",
    }).find((facet) => facet.key === "area_stato")?.value,
    "Regno Unito",
  );
  assert.equal(
    buildSyncBayProductFacets({
      title: "NL* USA MEDAGLIA BRONZO 1990",
    }).find((facet) => facet.key === "area_stato")?.value,
    "Stati Uniti",
  );
});

test("parses eBay Trading NameValueList item specifics into normalized entries", () => {
  assert.deepEqual(
    parseEbayTradingItemSpecifics({
      NameValueList: [
        { Name: "Materiale", Value: [" Argento ", "Argento", "Oro"] },
        { Name: "Conservazione", Value: "FDC" },
        { Name: "", Value: "ignorato" },
      ],
    }),
    [
      { name: "Materiale", values: ["Argento", "Oro"] },
      { name: "Conservazione", values: ["FDC"] },
    ],
  );
});

test("serializes product facets as Shopify metafields without audit labels", () => {
  assert.deepEqual(
    buildShopifyProductFacetMetafields([
      {
        key: "materiale",
        label: "Materiale",
        namespace: "syncbay_facets",
        type: "list.single_line_text_field",
        value: JSON.stringify(["Argento"]),
      },
    ]),
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
