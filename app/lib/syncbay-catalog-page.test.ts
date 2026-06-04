import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import * as catalogPage from "./syncbay-catalog-page.ts";

const {
  getCatalogPageWindow,
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

test("computes catalog pagination windows", () => {
  assert.deepEqual(
    getCatalogPageWindow({ page: 2, pageSize: 100, totalRows: 250 }),
    {
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
    },
  );
});

test("clamps catalog pages outside the available range", () => {
  assert.equal(
    getCatalogPageWindow({ page: 99, pageSize: 100, totalRows: 120 }).page,
    2,
  );
  assert.deepEqual(
    getCatalogPageWindow({ page: 4, pageSize: 100, totalRows: 0 }),
    {
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
    },
  );
});
