import assert from "node:assert/strict";
import { test } from "vitest";

import * as catalogPage from "./syncbay-catalog-page.ts";

const {
  catalogRowMatchesSearch,
  getCatalogQueryPlan,
  getCatalogSnapshotLookupIds,
  getCatalogPageWindow,
  isCatalogRowNeedingCheck,
  normalizeCatalogPage,
  normalizeCatalogPageFilter,
} = catalogPage;

test("normalizes catalog filters", () => {
  assert.equal(normalizeCatalogPageFilter("conflicts"), "conflicts");
  assert.equal(normalizeCatalogPageFilter("unknown"), "all");
  assert.equal(normalizeCatalogPageFilter(null), "all");
});

test("normalizes catalog page numbers", () => {
  assert.equal(normalizeCatalogPage("3"), 3);
  assert.equal(normalizeCatalogPage("0"), 1);
  assert.equal(normalizeCatalogPage("abc"), 1);
});

test("matches catalog rows by title, SKU or eBay item id", () => {
  const row = {
    ebayItemId: "123456789",
    sku: "SYNC-TAZZA-001",
    title: "Set tazze ceramica",
  };

  assert.equal(catalogRowMatchesSearch(row, ""), true);
  assert.equal(catalogRowMatchesSearch(row, "  "), true);
  assert.equal(catalogRowMatchesSearch(row, "tazze"), true);
  assert.equal(catalogRowMatchesSearch(row, "TAZZE"), true);
  assert.equal(catalogRowMatchesSearch(row, "sync-tazza"), true);
  assert.equal(catalogRowMatchesSearch(row, "456789"), true);
  assert.equal(catalogRowMatchesSearch(row, "lampada"), false);
  assert.equal(
    catalogRowMatchesSearch({ ebayItemId: null, sku: null, title: null }, "tazze"),
    false,
  );
});

test("computes catalog pagination windows", () => {
  assert.deepEqual(getCatalogPageWindow({ page: 2, pageSize: 100, totalRows: 250 }), {
    currentEnd: 200,
    currentStart: 101,
    hasNextPage: true,
    hasPreviousPage: true,
    nextPage: 3,
    offset: 100,
    page: 2,
    pageSize: 100,
    previousPage: 1,
    totalPages: 3,
    totalRows: 250,
  });
});

test("plans simple catalog views as a single visible database page", () => {
  assert.deepEqual(
    getCatalogQueryPlan({
      filter: "archived",
      page: 2,
      search: "",
      sort: null,
      sortDir: "asc",
      totalRows: 1154,
    }),
    {
      mode: "database-page",
      pagination: {
        currentEnd: 100,
        currentStart: 51,
        hasNextPage: true,
        hasPreviousPage: true,
        nextPage: 3,
        offset: 50,
        page: 2,
        pageSize: 50,
        previousPage: 1,
        totalPages: 24,
        totalRows: 1154,
      },
      take: 50,
    },
  );
});

test("keeps computed catalog views on the full in-memory plan", () => {
  assert.deepEqual(
    getCatalogQueryPlan({
      filter: "fresh",
      page: 1,
      search: "lire",
      sort: "price",
      sortDir: "asc",
      totalRows: 1154,
    }),
    {
      mode: "computed-full",
    },
  );
});

test("keeps searched catalog views on the full in-memory plan", () => {
  assert.deepEqual(
    getCatalogQueryPlan({
      filter: "archived",
      page: 1,
      search: "lire",
      sort: null,
      sortDir: "asc",
      totalRows: 274,
    }),
    {
      mode: "computed-full",
    },
  );
});

test("clamps catalog pages outside the available range", () => {
  assert.equal(getCatalogPageWindow({ page: 99, pageSize: 100, totalRows: 120 }).page, 2);
  assert.deepEqual(getCatalogPageWindow({ page: 4, pageSize: 100, totalRows: 0 }), {
    currentEnd: 0,
    currentStart: 0,
    hasNextPage: false,
    hasPreviousPage: false,
    nextPage: null,
    offset: 0,
    page: 1,
    pageSize: 100,
    previousPage: null,
    totalPages: 1,
    totalRows: 0,
  });
});

test("limits snapshot lookups to visible catalog rows", () => {
  assert.deepEqual(
    getCatalogSnapshotLookupIds({
      maxLookupRows: 3,
      rows: [
        { id: "mapping-1" },
        { id: "mapping-2" },
        { id: "mapping-1" },
        { id: "mapping-3" },
        { id: "mapping-4" },
      ],
    }),
    ["mapping-1", "mapping-2", "mapping-3"],
  );
});

test("excludes archived sold-out rows from operational check counts", () => {
  assert.equal(
    isCatalogRowNeedingCheck({
      availability: "unknown",
      status: "archived",
    }),
    false,
  );
  assert.equal(
    isCatalogRowNeedingCheck({
      availability: "unknown",
      status: "active_fresh",
    }),
    true,
  );
});
