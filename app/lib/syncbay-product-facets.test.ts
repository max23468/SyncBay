import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import * as productFacets from "./syncbay-product-facets.ts";

const {
  buildShopifyProductFacetMetafields,
  buildSyncBayProductFacets,
  parseEbayTradingItemSpecifics,
} = productFacets;

test("builds only the five approved storefront facets from eBay metadata", () => {
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
        type: "single_line_text_field",
        value: "Argento",
      },
      {
        key: "conservazione",
        label: "Conservazione",
        namespace: "syncbay_facets",
        type: "list.single_line_text_field",
        value: JSON.stringify(["qFDC", "FDC"]),
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

test("does not infer the perizia facet when eBay does not provide it", () => {
  assert.deepEqual(
    buildSyncBayProductFacets({
      itemSpecifics: [
        { name: "Materiale", values: ["Bronzo"] },
        { name: "Conservazione", values: ["BB"] },
      ],
      storeCategoryName: "Medaglie",
    }).map((facet) => facet.key),
    ["categoria", "materiale", "conservazione"],
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
        type: "single_line_text_field",
        value: "BB",
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
        type: "single_line_text_field",
        value: "Argento",
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
        type: "single_line_text_field",
        value: "Bronzo",
      },
      {
        key: "conservazione",
        label: "Conservazione",
        namespace: "syncbay_facets",
        type: "single_line_text_field",
        value: "Proof",
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
        type: "single_line_text_field",
        value: "Argento",
      },
    ]),
    [
      {
        key: "materiale",
        namespace: "syncbay_facets",
        type: "single_line_text_field",
        value: "Argento",
      },
    ],
  );
});
