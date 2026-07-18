import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveShopifyCategoryProposal } from "./syncbay-shopify-category-mapping.ts";

test("maps historic coin listings to collectible coins with high confidence", () => {
  assert.deepEqual(
    resolveShopifyCategoryProposal({
      ebayPrimaryCategoryName: "Monete italiane",
      ebayPrimaryCategoryPath: "Monete e banconote > Monete > Italia Regno",
      ebayStoreCategoryName: "Italia Regno - Vittorio Emanuele III",
      title: "5 Lire Aquilino 1927 Regno d'Italia SPL",
    }),
    {
      applied: false,
      confidence: "high",
      productType: "Monete italiane",
      reason: "dry_run_only",
      shopifyCategoryGid: "gid://shopify/TaxonomyCategory/ae-2-2-2-2",
      shopifyCategoryName: "Collectible Coins",
      source: "ebay_primary_category",
    },
  );
});

test("maps banknotes to collectible banknotes", () => {
  assert.deepEqual(
    resolveShopifyCategoryProposal({
      ebayPrimaryCategoryName: "Banconote italiane",
      ebayPrimaryCategoryPath: "Monete e banconote > Banconote > Italia",
      title: "Banconota 1000 Lire Montessori",
    }),
    {
      applied: false,
      confidence: "high",
      productType: "Banconote italiane",
      reason: "dry_run_only",
      shopifyCategoryGid: "gid://shopify/TaxonomyCategory/ae-2-2-2-1",
      shopifyCategoryName: "Collectible Banknotes",
      source: "ebay_primary_category",
    },
  );
});

test("uses store category and title with medium confidence when primary category is missing", () => {
  assert.deepEqual(
    resolveShopifyCategoryProposal({
      ebayStoreCategoryName: "Italia Regno - Vittorio Emanuele III",
      title: "20 Lire oro 1882 Umberto I",
    }),
    {
      applied: false,
      confidence: "medium",
      productType: "Monete italiane",
      reason: "dry_run_only",
      shopifyCategoryGid: "gid://shopify/TaxonomyCategory/ae-2-2-2-2",
      shopifyCategoryName: "Collectible Coins",
      source: "ebay_store_category",
    },
  );
});

test("does not treat precious metal alone as bullion coins", () => {
  assert.deepEqual(
    resolveShopifyCategoryProposal({
      ebayPrimaryCategoryName: "Monete italiane",
      title: "20 Lire oro Regno d'Italia 1882",
    })?.shopifyCategoryName,
    "Collectible Coins",
  );
});

test("keeps bullion details in productType without using the bullion Shopify category", () => {
  assert.deepEqual(
    resolveShopifyCategoryProposal({
      ebayPrimaryCategoryName: "Monete bullion",
      title: "Krugerrand 1 oz oro bullion coin",
    }),
    {
      applied: false,
      confidence: "high",
      productType: "Monete bullion",
      reason: "dry_run_only",
      shopifyCategoryGid: "gid://shopify/TaxonomyCategory/ae-2-2-2-2",
      shopifyCategoryName: "Collectible Coins",
      source: "ebay_primary_category",
    },
  );
});

test("keeps commemorative details in productType without using a narrow Shopify category", () => {
  assert.deepEqual(
    resolveShopifyCategoryProposal({
      ebayPrimaryCategoryName: "Monete e banconote:Monete",
      title: "Moneta commemorativa Expo 2015 FDC",
    }),
    {
      applied: false,
      confidence: "medium",
      productType: "Monete commemorative",
      reason: "dry_run_only",
      shopifyCategoryGid: "gid://shopify/TaxonomyCategory/ae-2-2-2-2",
      shopifyCategoryName: "Collectible Coins",
      source: "title",
    },
  );
});

test("maps French pre-euro coins away from Italian product type", () => {
  assert.equal(
    resolveShopifyCategoryProposal({
      ebayPrimaryCategoryName:
        "Monete e banconote:Monete europee pre euro:Francia",
      title:
        "NL* FRANCIA REPUBBLICA NAPOLEONE I Imperatore 1 Franc ARGENTO AN 13 A",
    }).productType,
    "Monete europee pre euro:Francia",
  );
});

test("maps Regno d'Italia lire to collection-grade product type", () => {
  assert.equal(
    resolveShopifyCategoryProposal({
      ebayPrimaryCategoryName:
        "Monete e banconote:Monete italiane in lire:Regno:Dal 1901 al 1945",
      title: "NL* VEIII 1 CENTESIMO 1905 VARIANTE 5 SPOSTATO NC QFDC",
    }).productType,
    "Monete italiane in lire:Regno",
  );
});

test("maps Repubblica lire to collection-grade product type", () => {
  assert.equal(
    resolveShopifyCategoryProposal({
      ebayPrimaryCategoryName:
        "Monete e banconote:Monete italiane in lire:Repubblica:Dal 1981 al 2001",
      title:
        "NL* ITALIA Divisionale 1993 GOLDONI 11 V con 500 Lire ARGENTO FDC",
    }).productType,
    "Monete italiane in lire:Repubblica",
  );
});

test("maps euro Italy to collection-grade product type", () => {
  assert.equal(
    resolveShopifyCategoryProposal({
      ebayPrimaryCategoryName: "Monete e banconote:Monete in euro:Italia",
      title: "Italia 2 Euro commemorativo FDC 2024",
    }).productType,
    "Monete in euro:Italia",
  );
});

test("keeps medals usable by existing medal collections", () => {
  assert.equal(
    resolveShopifyCategoryProposal({
      ebayPrimaryCategoryName: "Monete e banconote:Medaglie",
      title: "NL* FRANCIA PARIGI MEDAGLIA Camera di Commercio PARIGI LABAYE",
    }).productType,
    "Medaglie",
  );
});

test("keeps medal categories in coins and currency instead of stamps", () => {
  assert.deepEqual(
    resolveShopifyCategoryProposal({
      ebayPrimaryCategoryName: "Monete e banconote:Medaglie",
      ebayStoreCategoryName: "Medaglie italiane ed estere",
      title: "Medaglia commemorativa Casa Savoia",
    }),
    {
      applied: false,
      confidence: "high",
      productType: "Medaglie",
      reason: "dry_run_only",
      shopifyCategoryGid: "gid://shopify/TaxonomyCategory/ae-2-2-2",
      shopifyCategoryName: "Collectible Coins & Currency",
      source: "ebay_primary_category",
    },
  );
});

test("allows medal titles when eBay category context is generic numismatics", () => {
  assert.deepEqual(
    resolveShopifyCategoryProposal({
      ebayPrimaryCategoryName: "Monete e banconote",
      title: "Medaglia commemorativa Vittorio Emanuele III",
    }),
    {
      applied: false,
      confidence: "medium",
      productType: "Medaglie",
      reason: "dry_run_only",
      shopifyCategoryGid: "gid://shopify/TaxonomyCategory/ae-2-2-2",
      shopifyCategoryName: "Collectible Coins & Currency",
      source: "title",
    },
  );
});

test("maps explicit first day cover stamp listings to first day covers", () => {
  assert.deepEqual(
    resolveShopifyCategoryProposal({
      ebayPrimaryCategoryName: "Francobolli:Italia:Buste primo giorno",
      title: "Busta primo giorno FDC francobolli Italia 1984",
    })?.shopifyCategoryName,
    "First Day Covers",
  );
});

test("combines FDC title abbreviations with stamp category context", () => {
  assert.deepEqual(
    resolveShopifyCategoryProposal({
      ebayPrimaryCategoryName: "Francobolli:Italia",
      title: "Italia 1984 FDC serie completa",
    })?.shopifyCategoryName,
    "First Day Covers",
  );
});

test("maps scale model cars to Shopify scale model cars", () => {
  assert.deepEqual(
    resolveShopifyCategoryProposal({
      title:
        "NL* MODELLINO FIAT 500 COMMERCIALE 1968 Olio Carli Scala 1:43 come da foto",
    }),
    {
      applied: false,
      confidence: "medium",
      productType: "Modellini auto",
      reason: "dry_run_only",
      shopifyCategoryGid: "gid://shopify/TaxonomyCategory/ae-2-2-8-3",
      shopifyCategoryName: "Cars",
      source: "title",
    },
  );
});

test("derives category confidence from the text source that matched", () => {
  assert.deepEqual(
    resolveShopifyCategoryProposal({
      ebayPrimaryCategoryName: "Collezionismo altro",
      title: "NL* MODELLINO FIAT 500 COMMERCIALE 1968 Olio Carli Scala 1:43",
    }),
    {
      applied: false,
      confidence: "medium",
      productType: "Modellini auto",
      reason: "dry_run_only",
      shopifyCategoryGid: "gid://shopify/TaxonomyCategory/ae-2-2-8-3",
      shopifyCategoryName: "Cars",
      source: "title",
    },
  );
});

test("maps single stamp listings from store or title signals even when primary category is broad", () => {
  assert.deepEqual(
    resolveShopifyCategoryProposal({
      ebayPrimaryCategoryName: "Francobolli",
      title: "Francobollo singolo Regno d'Italia",
    }),
    {
      applied: false,
      confidence: "medium",
      productType: "Francobolli",
      reason: "dry_run_only",
      shopifyCategoryGid: "gid://shopify/TaxonomyCategory/ae-2-2-5-4",
      shopifyCategoryName: "Single Stamps",
      source: "title",
    },
  );
});

test("maps music records to records and LPs without assuming vinyl", () => {
  assert.deepEqual(
    resolveShopifyCategoryProposal({
      title: "NL* ITALIA DISCO GIORDANO ANDREA CHENIER Grand Opera Series",
    }),
    {
      applied: false,
      confidence: "medium",
      productType: "Dischi musicali",
      reason: "dry_run_only",
      shopifyCategoryGid: "gid://shopify/TaxonomyCategory/me-3-4",
      shopifyCategoryName: "Records & LPs",
      source: "title",
    },
  );
});

test("maps Fabbri music volumes to records and LPs by maintainer decision", () => {
  assert.deepEqual(
    resolveShopifyCategoryProposal({
      title: "NL* FABBRI EDITORE I GRANDI MUSICISTI Volume X BACH E BEETHOVEN",
    }),
    {
      applied: false,
      confidence: "medium",
      productType: "Dischi musicali",
      reason: "dry_run_only",
      shopifyCategoryGid: "gid://shopify/TaxonomyCategory/me-3-4",
      shopifyCategoryName: "Records & LPs",
      source: "title",
    },
  );
});

test("maps typewriters to office typewriters", () => {
  assert.deepEqual(
    resolveShopifyCategoryProposal({
      title:
        "NL* Macchina da Scrivere ADLER MODELLO TIPPA OLANDA Custodia originale Top",
    }),
    {
      applied: false,
      confidence: "medium",
      productType: "Macchine da scrivere",
      reason: "dry_run_only",
      shopifyCategoryGid: "gid://shopify/TaxonomyCategory/os-10-10",
      shopifyCategoryName: "Typewriters",
      source: "title",
    },
  );
});

test("maps paper catalog books to print books", () => {
  assert.deepEqual(
    resolveShopifyCategoryProposal({
      title:
        "NL* Libro CATALOGO CARTE TELEFONICHE Lotto 3 PEZZI ANNO 1996 1997 1998",
    }),
    {
      applied: false,
      confidence: "medium",
      productType: "Libri e cataloghi",
      reason: "dry_run_only",
      shopifyCategoryGid: "gid://shopify/TaxonomyCategory/me-1-3",
      shopifyCategoryName: "Print Books",
      source: "title",
    },
  );
});

test("keeps phone card catalog books as print books even with collectible store category", () => {
  assert.deepEqual(
    resolveShopifyCategoryProposal({
      ebayStoreCategoryName: "Numismatica > Cataloghi",
      title:
        "NL* Libro CATALOGO CARTE TELEFONICHE Lotto 3 PEZZI ANNO 1996 1997 1998 pari al n",
    }),
    {
      applied: false,
      confidence: "medium",
      productType: "Libri e cataloghi",
      reason: "dry_run_only",
      shopifyCategoryGid: "gid://shopify/TaxonomyCategory/me-1-3",
      shopifyCategoryName: "Print Books",
      source: "title",
    },
  );
});

test("returns a low-confidence unapplied proposal for unknown collectibles", () => {
  assert.deepEqual(
    resolveShopifyCategoryProposal({
      ebayPrimaryCategoryName: "Collezionismo altro",
      title: "Lotto misto da collezione",
    }),
    {
      applied: false,
      confidence: "low",
      productType: "Collezionismo",
      reason: "low_confidence",
      shopifyCategoryGid: null,
      shopifyCategoryName: null,
      source: "fallback",
    },
  );
});
