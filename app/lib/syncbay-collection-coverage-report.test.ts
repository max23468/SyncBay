import assert from "node:assert/strict";
import { test } from "vitest";

import { buildCollectionCoverageReport } from "./syncbay-collection-coverage-report.ts";

const genericHandles = ["negozio-online", "non-disponibili"];

test("flags available products that only belong to generic collections", () => {
  const report = buildCollectionCoverageReport({
    genericCollectionHandles: genericHandles,
    products: [
      {
        collections: [{ handle: "negozio-online", title: "Negozio Online" }],
        handle: "syncbay-ebay-1",
        id: "gid://shopify/Product/1",
        productType: "Monete italiane",
        title: "NL* VEIII 1 CENTESIMO 1905",
        totalInventory: 1,
      },
    ],
  });

  assert.equal(report.summary.availableOnlyGeneric, 1);
  assert.deepEqual(
    report.availableOnlyGeneric.map((row) => row.handle),
    ["syncbay-ebay-1"],
  );
});

test("flags unavailable products that remain in specific collections", () => {
  const report = buildCollectionCoverageReport({
    genericCollectionHandles: genericHandles,
    products: [
      {
        collections: [
          { handle: "non-disponibili", title: "Non disponibili" },
          { handle: "accessori-numismatici", title: "Accessori numismatici" },
        ],
        handle: "album-masterphil",
        id: "gid://shopify/Product/2",
        productType: "Monete e banconote:Cataloghi e accessori",
        title: "NL* ALBUM MONETE MASTERPHIL",
        totalInventory: 0,
      },
    ],
  });

  assert.equal(report.summary.unavailableInSpecific, 1);
  assert.deepEqual(report.unavailableInSpecific[0]?.specificCollections, ["Accessori numismatici"]);
});

test("keeps available products in specific collections out of problem lists", () => {
  const report = buildCollectionCoverageReport({
    genericCollectionHandles: genericHandles,
    products: [
      {
        collections: [
          { handle: "negozio-online", title: "Negozio Online" },
          { handle: "banconote", title: "Banconote" },
        ],
        handle: "banconota-1",
        id: "gid://shopify/Product/3",
        productType: "Monete e banconote:Banconote",
        title: "NL* Banconota 1000 Lire",
        totalInventory: 2,
      },
    ],
  });

  assert.equal(report.summary.availableOnlyGeneric, 0);
  assert.equal(report.summary.unavailableInSpecific, 0);
});
